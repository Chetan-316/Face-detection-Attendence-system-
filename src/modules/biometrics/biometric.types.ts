import { FaceEnrollmentStatus } from '@prisma/client';

export type EnrollmentPose = 'FRONT' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

export type BiometricQualityReason =
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'FACE_TOO_SMALL'
  | 'FACE_OFF_CENTER'
  | 'TOO_BLURRY'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'LOW_DETECTION_CONFIDENCE'
  | 'WRONG_POSE';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BiometricQualityMetrics {
  face_count: number;
  confidence: number;
  blur_score: number;
  brightness: number;
  bbox: BoundingBox;
  frame_width: number;
  frame_height: number;
  detected_pose?: EnrollmentPose | null;
}

export interface BiometricQualityResult {
  is_valid: boolean;
  rejection_reason: BiometricQualityReason | null;
  message: string;
  face_count?: number;
  detected_pose?: EnrollmentPose | null;
  metrics?: BiometricQualityMetrics | null;
}

export interface FrameProcessingResult {
  success: boolean;
  quality: BiometricQualityResult;
  embedding?: number[] | null;
  error?: string;
  message?: string;
}

export interface AggregationResult {
  success: boolean;
  template?: number[];
  samples_count?: number;
  consistency_score?: number;
  outliers_rejected?: number;
  error?: string;
  message?: string;
}

export type EnrollmentSessionStatus =
  | 'CREATED'
  | 'CAPTURING'
  | 'READY'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'EXPIRED';

export interface EnrollmentSession {
  sessionId: string;
  residentId: string;
  hostelId: string;
  organizationId: string;
  cameraId: string;
  createdByUserId: string;
  startedAt: Date;
  expiresAt: Date;
  status: EnrollmentSessionStatus;
  requiredSamples: number;
  samplesAccepted: number;
  samplesRejected: number;
  requiredPoses: EnrollmentPose[];
  currentPoseIndex: number;
  completedPoses: EnrollmentPose[];
  acceptedPoseEmbeddings: Record<string, number[]>;
  lastQuality: BiometricQualityResult | null;
  lastCaptureTime: number;
  // In-memory embeddings (never persisted outside transaction, never returned in API)
  acceptedEmbeddings: number[][];
}

export interface EnrollmentStatusResponse {
  sessionId: string;
  residentId: string;
  cameraId: string;
  status: EnrollmentSessionStatus;
  requiredSamples: number;
  acceptedSamples: number;
  rejectedSamples: number;
  currentPose: EnrollmentPose | null;
  completedPoses: EnrollmentPose[];
  requiredPoses: EnrollmentPose[];
  progressPercentage: number;
  isReady: boolean;
  lastQuality: BiometricQualityResult | null;
  expiresAt: string;
}

export interface BiometricHealthStatus {
  status: 'UP' | 'DOWN';
  workerReady: boolean;
  detectorLoaded: boolean;
  embedderLoaded: boolean;
  detectorName: string;
  detectorVersion: string;
  modelName: string;
  modelVersion: string;
  embeddingDimension: number;
  runtime: string;
  license: string;
  mock: boolean;
  error?: string;
}

export interface ExtractedFace {
  faceIndex: number;
  bbox: BoundingBox;
  detectionConfidence: number;
  embedding: number[] | null;
  quality: {
    usable: boolean;
    rejectionReason?: string | null;
    blurScore?: number;
    brightness?: number;
  };
}

export interface ExtractFacesResult {
  success: boolean;
  faces: ExtractedFace[];
  error?: string;
  message?: string;
}
