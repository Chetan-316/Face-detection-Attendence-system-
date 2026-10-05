import { apiClient } from './client';

export interface Facility {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  createdAt?: string;
  residentCount?: number;
  staffCount?: number;
  cameraCount?: number;
}

export const facilitiesApi = {
  async listFacilities(): Promise<{ data: Facility[] }> {
    return apiClient<{ data: Facility[] }>('/facilities');
  },

  async createFacility(payload: { name: string; code: string }): Promise<Facility> {
    return apiClient<Facility>('/facilities', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateFacility(
    id: string,
    payload: { name?: string; code?: string; isActive?: boolean }
  ): Promise<Facility> {
    return apiClient<Facility>(`/facilities/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },
};
