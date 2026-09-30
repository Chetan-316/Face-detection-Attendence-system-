import { apiClient, API_BASE_URL, getStoredToken } from './client';
import {
  CameraEntity,
  CameraDiagnostics,
  CameraTestResult,
  CreateCameraPayload,
  UpdateCameraPayload,
} from '../types/camera.types';

export const camerasApi = {
  async listCameras(hostelId?: string, role?: string): Promise<{ data: CameraEntity[]; count: number }> {
    const params = new URLSearchParams();
    if (hostelId) params.append('hostelId', hostelId);
    if (role) params.append('role', role);

    const query = params.toString() ? `?${params.toString()}` : '';
    return apiClient<{ data: CameraEntity[]; count: number }>(`/cameras${query}`);
  },

  async getCamera(id: string): Promise<{ data: CameraEntity }> {
    return apiClient<{ data: CameraEntity }>(`/cameras/${id}`);
  },

  async createCamera(payload: CreateCameraPayload): Promise<{ data: CameraEntity; message: string }> {
    return apiClient<{ data: CameraEntity; message: string }>('/cameras', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateCamera(id: string, payload: UpdateCameraPayload): Promise<{ data: CameraEntity; message: string }> {
    return apiClient<{ data: CameraEntity; message: string }>(`/cameras/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async startCamera(id: string): Promise<{ data: CameraDiagnostics; message: string }> {
    return apiClient<{ data: CameraDiagnostics; message: string }>(`/cameras/${id}/start`, {
      method: 'POST',
    });
  },

  async stopCamera(id: string): Promise<{ data: CameraDiagnostics; message: string }> {
    return apiClient<{ data: CameraDiagnostics; message: string }>(`/cameras/${id}/stop`, {
      method: 'POST',
    });
  },

  async getCameraHealth(id: string): Promise<{ data: any }> {
    return apiClient<{ data: any }>(`/cameras/${id}/health`);
  },

  async captureSnapshot(id: string): Promise<{ data: any }> {
    return apiClient<{ data: any }>(`/cameras/${id}/snapshot?format=json`);
  },

  async testCameraConnection(id: string): Promise<{ data: CameraTestResult }> {
    return apiClient<{ data: CameraTestResult }>(`/cameras/${id}/test`, {
      method: 'POST',
    });
  },

  async testNewConnection(payload: {
    sourceType: string;
    rtspUrl?: string;
    transport?: 'tcp' | 'udp';
    username?: string;
    password?: string;
    deviceIndex?: number;
  }): Promise<{ data: CameraTestResult }> {
    return apiClient<{ data: CameraTestResult }>('/cameras/test-connection', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  getPreviewStreamUrl(id: string): string {
    const token = getStoredToken();
    const tokenParam = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${API_BASE_URL}/cameras/${id}/preview${tokenParam}`;
  },
};
