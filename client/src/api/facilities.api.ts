import { apiClient } from './client';

export interface Facility {
  id: string;
  code: string;
  name: string;
  isActive: boolean;
  returnDeadlineMinutes?: number;
  createdAt?: string;
  residentCount?: number;
  staffCount?: number;
  cameraCount?: number;
}

export interface FacilityLocation {
  id: string;
  hostelId: string;
  code: string;
  name: string;
  locationType: 'GATE' | 'ENTRANCE' | 'ATTENDANCE_POINT' | 'COMMON_AREA';
  isActive: boolean;
  createdAt?: string;
}

export const facilitiesApi = {
  async listFacilities(): Promise<{ data: Facility[] }> {
    return apiClient<{ data: Facility[] }>('/facilities');
  },

  async createFacility(payload: { name: string; code: string; returnDeadlineMinutes?: number }): Promise<Facility> {
    return apiClient<Facility>('/facilities', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateFacility(
    id: string,
    payload: { name?: string; code?: string; isActive?: boolean; returnDeadlineMinutes?: number }
  ): Promise<Facility> {
    return apiClient<Facility>(`/facilities/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async getOperationalSettings(hostelId?: string): Promise<{
    data: { hostelId: string | null; returnDeadlineMinutes: number; scoped: boolean };
  }> {
    const query = hostelId ? `?hostelId=${encodeURIComponent(hostelId)}` : '';
    return apiClient<{
      data: { hostelId: string | null; returnDeadlineMinutes: number; scoped: boolean };
    }>(`/facilities/settings${query}`);
  },

  async listLocations(facilityId: string): Promise<{ data: FacilityLocation[] }> {
    return apiClient<{ data: FacilityLocation[] }>(
      `/facilities/${encodeURIComponent(facilityId)}/locations`
    );
  },

  async createLocation(
    facilityId: string,
    payload: { name: string; code: string; locationType: FacilityLocation['locationType'] }
  ): Promise<FacilityLocation> {
    return apiClient<FacilityLocation>(
      `/facilities/${encodeURIComponent(facilityId)}/locations`,
      { method: 'POST', body: JSON.stringify(payload) }
    );
  },

  async updateLocation(
    facilityId: string,
    locationId: string,
    payload: { name?: string; code?: string; isActive?: boolean }
  ): Promise<FacilityLocation> {
    return apiClient<FacilityLocation>(
      `/facilities/${encodeURIComponent(facilityId)}/locations/${encodeURIComponent(locationId)}`,
      { method: 'PATCH', body: JSON.stringify(payload) }
    );
  },
};
