import { apiClient, API_BASE_URL, getStoredToken } from './client';
import { RecognitionObservation, RecognitionSessionStatus } from '../types/recognition.types';

export const recognitionApi = {
  async startRecognition(cameraId: string): Promise<RecognitionSessionStatus> {
    return apiClient<RecognitionSessionStatus>(`/cameras/${cameraId}/recognition/start`, {
      method: 'POST',
    });
  },

  async stopRecognition(cameraId: string): Promise<RecognitionSessionStatus> {
    return apiClient<RecognitionSessionStatus>(`/cameras/${cameraId}/recognition/stop`, {
      method: 'POST',
    });
  },

  async getStatus(cameraId: string): Promise<RecognitionSessionStatus> {
    return apiClient<RecognitionSessionStatus>(`/cameras/${cameraId}/recognition/status`);
  },

  async getResults(cameraId: string, limit = 50): Promise<{ results: RecognitionObservation[] }> {
    return apiClient<{ results: RecognitionObservation[] }>(`/cameras/${cameraId}/recognition/results?limit=${limit}`);
  },

  async getStreamToken(cameraId: string): Promise<{ streamToken: string; expiresIn: number }> {
    return apiClient<{ streamToken: string; expiresIn: number }>(`/cameras/${cameraId}/recognition/stream-token`, {
      method: 'POST',
    });
  },

  getEventsStreamUrl(cameraId: string, streamToken?: string): string {
    const tokenParam = streamToken ? `?streamToken=${encodeURIComponent(streamToken)}` : '';
    return `${API_BASE_URL}/cameras/${cameraId}/recognition/events${tokenParam}`;
  },
};
