import { describe, it, expect } from 'vitest';
import { TemporalStabilizer } from '../src/modules/recognition/temporal-stabilizer';
import { MatchResult } from '../src/modules/recognition/recognition.types';

describe('TemporalStabilizer Unit Tests', () => {
  const bbox = { x: 100, y: 100, width: 80, height: 80 };
  const residentA = { id: 'res-A', residentCode: 'R001', fullName: 'Rahul Patil' };
  const residentB = { id: 'res-B', residentCode: 'R002', fullName: 'Amit Kumar' };

  const matchResA: MatchResult = {
    classification: 'MATCH',
    resident: residentA,
    similarity: 0.85,
    secondBestSimilarity: 0.20,
  };

  const unknownRes: MatchResult = {
    classification: 'UNKNOWN',
    similarity: 0.15,
    secondBestSimilarity: 0.10,
  };

  it('does NOT produce a stable MATCH on a single frame', () => {
    const stabilizer = new TemporalStabilizer({ minConsistentFrames: 3, windowSize: 5 });
    const res = stabilizer.update(bbox, matchResA, 1000);

    // After 1 frame, it should not be a stable MATCH yet
    expect(res.classification).toBe('UNCERTAIN');
    expect(res.resident).toBeUndefined();
    expect(res.isStable).toBe(false);
    expect(res.shouldEmitEvent).toBe(false);
  });

  it('produces stable MATCH after 3 consistent frames for the same resident', () => {
    const stabilizer = new TemporalStabilizer({ minConsistentFrames: 3, windowSize: 5, cooldownMs: 5000 });

    const f1 = stabilizer.update(bbox, matchResA, 1000);
    expect(f1.classification).toBe('UNCERTAIN');

    const f2 = stabilizer.update(bbox, matchResA, 1200);
    expect(f2.classification).toBe('UNCERTAIN');

    const f3 = stabilizer.update(bbox, matchResA, 1400);
    expect(f3.classification).toBe('MATCH');
    expect(f3.resident?.residentCode).toBe('R001');
    expect(f3.isStable).toBe(true);
    expect(f3.shouldEmitEvent).toBe(true); // First stable emission
  });

  it('emits once per continuous appearance and rearms only after absence', () => {
    const stabilizer = new TemporalStabilizer({ minConsistentFrames: 3, windowSize: 5, cooldownMs: 5000, trackTimeoutMs: 10000 });

    stabilizer.update(bbox, matchResA, 1000);
    stabilizer.update(bbox, matchResA, 1200);
    const f3 = stabilizer.update(bbox, matchResA, 1400);
    expect(f3.shouldEmitEvent).toBe(true);

    const f4 = stabilizer.update(bbox, matchResA, 2000);
    expect(f4.shouldEmitEvent).toBe(false);

    // Still continuously visible well beyond the old timer: must remain locked.
    const f5 = stabilizer.update(bbox, matchResA, 7000);
    expect(f5.classification).toBe('MATCH');
    expect(f5.shouldEmitEvent).toBe(false);

    // Resident disappears for >5 seconds, then returns. This is a new appearance.
    const f6 = stabilizer.update(bbox, matchResA, 13050);
    expect(f6.classification).toBe('MATCH');
    expect(f6.shouldEmitEvent).toBe(true);
  });

  it('stabilizes UNKNOWN without flickering', () => {
    const stabilizer = new TemporalStabilizer({ minConsistentFrames: 3, windowSize: 5 });

    stabilizer.update(bbox, unknownRes, 1000);
    stabilizer.update(bbox, unknownRes, 1200);
    const f3 = stabilizer.update(bbox, unknownRes, 1400);

    expect(f3.classification).toBe('UNKNOWN');
    expect(f3.resident).toBeUndefined();
    expect(f3.isStable).toBe(true);
  });

  it('does not stabilize when identities are conflicting or mixed', () => {
    const stabilizer = new TemporalStabilizer({ minConsistentFrames: 3, windowSize: 5 });

    const matchResB: MatchResult = {
      classification: 'MATCH',
      resident: residentB,
      similarity: 0.75,
      secondBestSimilarity: 0.20,
    };

    stabilizer.update(bbox, matchResA, 1000);
    stabilizer.update(bbox, matchResB, 1200);
    stabilizer.update(bbox, matchResA, 1400);
    const f4 = stabilizer.update(bbox, matchResB, 1600);

    // Neither has 3 consistent frames: must remain UNCERTAIN
    expect(f4.classification).toBe('UNCERTAIN');
    expect(f4.resident).toBeUndefined();
  });

  it('prunes expired tracks when face has disappeared', () => {
    const stabilizer = new TemporalStabilizer({ trackTimeoutMs: 2000 });

    stabilizer.update(bbox, matchResA, 1000);
    expect(stabilizer.getTrackCount()).toBe(1);

    // Time progresses past timeout (3500ms > 1000 + 2000)
    stabilizer.pruneOldTracks(3500);
    expect(stabilizer.getTrackCount()).toBe(0);
  });
});
