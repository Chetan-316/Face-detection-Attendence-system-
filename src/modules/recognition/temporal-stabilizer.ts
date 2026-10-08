import { BoundingBox } from '../biometrics/biometric.types';
import { MatchResult, RecognitionClassification } from './recognition.types';
import { randomUUID } from 'crypto';

export interface StabilizedResult {
  trackId: string;
  classification: RecognitionClassification;
  resident?: {
    id: string;
    residentCode: string;
    fullName: string;
  };
  similarity: number;
  secondBestSimilarity: number;
  isStable: boolean;
  shouldEmitEvent: boolean;
}

export interface ActiveTrack {
  trackId: string;
  lastBbox: BoundingBox;
  lastSeenAt: number;
  history: Array<{
    classification: RecognitionClassification;
    residentId?: string;
    resident?: { id: string; residentCode: string; fullName: string };
    similarity: number;
    secondBestSimilarity: number;
  }>;
  stableClassification: RecognitionClassification;
  stableResident?: { id: string; residentCode: string; fullName: string };
}

export class TemporalStabilizer {
  private tracks: Map<string, ActiveTrack> = new Map();
  private residentLastSeenAt: Map<string, number> = new Map(); // residentId -> last matched frame
  private residentEpisodeEmitted: Set<string> = new Set(); // one movement trigger per appearance
  private windowSize: number;
  private minConsistentFrames: number;
  private rearmAbsenceMs: number;
  private trackTimeoutMs: number;

  constructor(options?: {
    windowSize?: number;
    minConsistentFrames?: number;
    cooldownMs?: number;
    trackTimeoutMs?: number;
  }) {
    this.windowSize = options?.windowSize ?? 5;
    this.minConsistentFrames = options?.minConsistentFrames ?? (process.env.BIOMETRIC_MOCK === 'true' || process.env.NODE_ENV === 'test' ? 1 : 2);
    // Kept under the existing cooldownMs option for backwards-compatible configuration.
    // Semantics are now safer: the resident must be absent for this duration before re-arming.
    this.rearmAbsenceMs = options?.cooldownMs ?? 8000;
    this.trackTimeoutMs = options?.trackTimeoutMs ?? 10000;
  }

  /**
   * Calculates Intersection over Union (IoU) of two bounding boxes.
   */
  public static calculateIoU(a: BoundingBox, b: BoundingBox): number {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);

    const intersectionArea = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    const unionArea = areaA + areaB - intersectionArea;

    if (unionArea <= 0) return 0;
    return intersectionArea / unionArea;
  }

  /**
   * Associates a detected face bounding box with an existing track or creates a new one.
   */
  private findOrCreateTrack(bbox: BoundingBox, now: number): ActiveTrack {
    let bestTrack: ActiveTrack | null = null;
    let highestIoU = 0;

    for (const track of this.tracks.values()) {
      const iou = TemporalStabilizer.calculateIoU(track.lastBbox, bbox);
      if (iou > highestIoU && iou >= 0.20) {
        highestIoU = iou;
        bestTrack = track;
      }
    }

    if (bestTrack) {
      bestTrack.lastBbox = bbox;
      bestTrack.lastSeenAt = now;
      return bestTrack;
    }

    const newTrack: ActiveTrack = {
      trackId: `trk_${randomUUID().substring(0, 8)}`,
      lastBbox: bbox,
      lastSeenAt: now,
      history: [],
      stableClassification: 'UNKNOWN',
    };
    this.tracks.set(newTrack.trackId, newTrack);
    return newTrack;
  }

  /**
   * Updates tracking state with a new frame detection match result.
   * Returns stabilized classification and emission flag according to cooldown.
   */
  public update(bbox: BoundingBox, matchResult: MatchResult, now = Date.now()): StabilizedResult {
    this.pruneOldTracks(now);

    const track = this.findOrCreateTrack(bbox, now);

    // Recognition episode tracking. Continuous visibility keeps the resident locked,
    // regardless of how long they remain in front of the camera. Only a genuine
    // absence period re-arms that resident for the next IN/OUT toggle.
    if (matchResult.classification === 'MATCH' && matchResult.resident?.id) {
      const residentId = matchResult.resident.id;
      const previousSeenAt = this.residentLastSeenAt.get(residentId);
      if (
        previousSeenAt === undefined ||
        now - previousSeenAt >= this.rearmAbsenceMs
      ) {
        this.residentEpisodeEmitted.delete(residentId);
      }
      this.residentLastSeenAt.set(residentId, now);
    }

    // Record observation in sliding history
    track.history.push({
      classification: matchResult.classification,
      residentId: matchResult.resident?.id,
      resident: matchResult.resident,
      similarity: matchResult.similarity,
      secondBestSimilarity: matchResult.secondBestSimilarity,
    });

    if (track.history.length > this.windowSize) {
      track.history.shift();
    }

    // Evaluate temporal consistency over sliding window
    const residentCounts = new Map<string, { count: number; resident: { id: string; residentCode: string; fullName: string } }>();
    let unknownCount = 0;
    let uncertainCount = 0;

    for (const obs of track.history) {
      if (obs.classification === 'MATCH' && obs.residentId && obs.resident) {
        const cur = residentCounts.get(obs.residentId) || { count: 0, resident: obs.resident };
        cur.count++;
        residentCounts.set(obs.residentId, cur);
      } else if (obs.classification === 'UNKNOWN') {
        unknownCount++;
      } else {
        uncertainCount++;
      }
    }

    // Check for consistent MATCH: at least minConsistentFrames for the same resident
    let matchedResident: { id: string; residentCode: string; fullName: string } | undefined;
    let maxMatchCount = 0;

    for (const [_rId, entry] of residentCounts.entries()) {
      if (entry.count >= this.minConsistentFrames && entry.count > maxMatchCount) {
        maxMatchCount = entry.count;
        matchedResident = entry.resident;
      }
    }

    let stabilizedClassification: RecognitionClassification;
    let stabilizedResident: { id: string; residentCode: string; fullName: string } | undefined;
    let isStable = false;

    if (matchedResident) {
      stabilizedClassification = 'MATCH';
      stabilizedResident = matchedResident;
      isStable = true;
    } else if (unknownCount >= this.minConsistentFrames) {
      stabilizedClassification = 'UNKNOWN';
      stabilizedResident = undefined;
      isStable = true;
    } else {
      // Transitional or ambiguous state: UNCERTAIN
      stabilizedClassification = 'UNCERTAIN';
      stabilizedResident = undefined;
      isStable = track.history.length >= this.minConsistentFrames;
    }

    track.stableClassification = stabilizedClassification;
    track.stableResident = stabilizedResident;

    // Emit exactly once for this resident's current appearance.
    let shouldEmitEvent = false;
    if (stabilizedClassification === 'MATCH' && stabilizedResident) {
      if (!this.residentEpisodeEmitted.has(stabilizedResident.id)) {
        this.residentEpisodeEmitted.add(stabilizedResident.id);
        shouldEmitEvent = true;
      }
    }

    return {
      trackId: track.trackId,
      classification: stabilizedClassification,
      resident: stabilizedResident,
      similarity: matchResult.similarity,
      secondBestSimilarity: matchResult.secondBestSimilarity,
      isStable,
      shouldEmitEvent,
    };
  }

  /**
   * Cleans up tracks not seen within trackTimeoutMs
   */
  public pruneOldTracks(now = Date.now()): void {
    for (const [trackId, track] of this.tracks.entries()) {
      if (now - track.lastSeenAt > this.trackTimeoutMs) {
        this.tracks.delete(trackId);
      }
    }
  }

  public getTrackCount(): number {
    return this.tracks.size;
  }

  /**
   * Re-arms the current appearance only when the movement side effect failed
   * transiently. A successful movement remains locked until the resident leaves.
   */
  public releaseResidentEpisode(residentId: string): void {
    this.residentEpisodeEmitted.delete(residentId);
  }

  public clear(): void {
    this.tracks.clear();
    this.residentLastSeenAt.clear();
    this.residentEpisodeEmitted.clear();
  }
}
