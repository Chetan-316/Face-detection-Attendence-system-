export type RecognitionClassification = 'MATCH' | 'UNCERTAIN' | 'UNKNOWN' | 'QUALITY_INSUFFICIENT';

export interface RecognitionBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecognitionResident {
  id: string;
  residentCode: string;
  fullName: string;
}

export interface RecognitionObservation {
  id: string;
  faceId: string;
  cameraId: string;
  classification: RecognitionClassification;
  resident?: RecognitionResident | null;
  similarity?: number | null;
  secondBestSimilarity?: number | null;
  bbox: RecognitionBoundingBox;
  qualityUsable: boolean;
  qualityReason?: string | null;
  detectedAt: string;
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

export interface StreamTokenResponse {
  streamToken: string;
  expiresIn: number;
}
