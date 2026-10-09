import { BoundingBox } from '../biometrics/biometric.types';
import { MovementDecisionResult } from '../movement-decision/movement-decision.types';
import { AttendanceDecisionResult } from '../attendance-decision/attendance-decision.types';

export type RecognitionClassification = 'MATCH' | 'UNCERTAIN' | 'UNKNOWN' | 'QUALITY_INSUFFICIENT';

export interface CachedTemplate {
  residentId: string;
  residentCode: string;
  fullName: string;
  hostelId: string;
  organizationId: string;
  template: number[]; // Active-engine L2-normalized vector (128-D legacy, 512-D AdaFace)
  modelName: string;
  modelVersion: string;
  templateVersion: string;
  enrolledAt: Date;
}

export interface CandidateScore {
  candidate: CachedTemplate;
  similarity: number;
}

export interface MatchResult {
  classification: RecognitionClassification;
  resident?: {
    id: string;
    residentCode: string;
    fullName: string;
  };
  similarity: number;
  secondBestSimilarity: number;
  bestCandidate?: CachedTemplate;
  secondCandidate?: CachedTemplate;
}

export interface RecognitionObservation {
  id: string;
  faceId: string;
  cameraId: string;
  classification: RecognitionClassification;
  resident?: {
    id: string;
    residentCode: string;
    fullName: string;
  } | null;
  similarity?: number | null;
  secondBestSimilarity?: number | null;
  bbox: BoundingBox;
  qualityUsable: boolean;
  qualityReason?: string | null;
  detectedAt: string; // ISO string
  isStable?: boolean;
  shouldEmitEvent?: boolean;
  movementDecision?: MovementDecisionResult;
  attendanceDecision?: AttendanceDecisionResult;
  observationId?: string;
  residentId?: string;
}

export type RecognitionSessionState = 'STOPPED' | 'STARTING' | 'RUNNING' | 'ERROR';

export interface RecognitionSessionStatus {
  sessionId: string;
  cameraId: string;
  hostelId: string;
  state: RecognitionSessionState;
  startedAt: string | null;
  framesProcessed: number;
  facesDetected: number;
  matches: number;
  uncertains: number;
  unknowns: number;
  qualityInsufficients: number;
  lastProcessedAt: string | null;
  lastError: string | null;
  eligibleTemplates: number;
  processingFps: number;
  configuredMaxFps: number;
}

export interface MatcherThresholds {
  matchThreshold: number;
  uncertainThreshold: number;
  minMargin: number;
}
