import { apiClient } from './client';

export type EnrollmentPose = 'FRONT' | 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';

export interface EnrollmentStatusData {
  sessionId: string;
  residentId: string;
  cameraId: string;
  status: 'CREATED' | 'CAPTURING' | 'READY' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'EXPIRED';
  requiredSamples: number;
  acceptedSamples: number;
  rejectedSamples: number;
  currentPose?: EnrollmentPose | null;
  completedPoses?: EnrollmentPose[];
  requiredPoses?: EnrollmentPose[];
  progressPercentage: number;
  isReady: boolean;
  lastQuality: {
    is_valid: boolean;
    rejection_reason: string | null;
    message: string;
    face_count?: number;
    detected_pose?: EnrollmentPose | null;
    metrics?: {
      face_count: number;
      confidence: number;
      blur_score: number;
      brightness: number;
      detected_pose?: EnrollmentPose | null;
      bbox: { x: number; y: number; width: number; height: number };
    } | null;
  } | null;
  expiresAt: string;
}

export interface CaptureFrameResponse {
  sessionStatus: EnrollmentStatusData;
  quality: EnrollmentStatusData['lastQuality'];
  sampleAccepted: boolean;
}

export interface BiometricHealthData {
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
}

export const biometricsApi = {
  async startEnrollment(residentId: string, cameraId?: string): Promise<{ data: EnrollmentStatusData }> {
    return apiClient<{ data: EnrollmentStatusData }>(`/residents/${residentId}/face-enrollment/start`, {
      method: 'POST',
      body: JSON.stringify({ cameraId }),
    });
  },

  async getStatus(residentId: string): Promise<{ data: EnrollmentStatusData }> {
    return apiClient<{ data: EnrollmentStatusData }>(`/residents/${residentId}/face-enrollment/status`);
  },

  async captureFrame(residentId: string, targetPose?: EnrollmentPose): Promise<{ data: CaptureFrameResponse }> {
    return apiClient<{ data: CaptureFrameResponse }>(`/residents/${residentId}/face-enrollment/capture`, {
      method: 'POST',
      body: targetPose ? JSON.stringify({ targetPose }) : undefined,
    });
  },

  async completeEnrollment(residentId: string): Promise<{ data: any }> {
    return apiClient<{ data: any }>(`/residents/${residentId}/face-enrollment/complete`, {
      method: 'POST',
    });
  },

  async cancelEnrollment(residentId: string): Promise<{ data: any }> {
    return apiClient<{ data: any }>(`/residents/${residentId}/face-enrollment/cancel`, {
      method: 'POST',
    });
  },

  async revokeEnrollment(residentId: string, reason: string): Promise<{ data: any }> {
    return apiClient<{ data: any }>(`/residents/${residentId}/face-enrollment/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async getBiometricHealth(): Promise<{ data: BiometricHealthData }> {
    return apiClient<{ data: BiometricHealthData }>('/biometrics/health');
  },
};
