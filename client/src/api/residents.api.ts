import { apiClient } from './client';
import {
  SafeResident,
  PaginatedResult,
  ResidentSummary,
  CreateResidentPayload,
  UpdateResidentPayload,
  ListResidentsQuery,
} from '../types/resident.types';

export const residentsApi = {
  async listResidents(query: ListResidentsQuery = {}): Promise<PaginatedResult<SafeResident>> {
    const params = new URLSearchParams();
    if (query.page) params.set('page', query.page.toString());
    if (query.pageSize) params.set('pageSize', query.pageSize.toString());
    if (query.search?.trim()) params.set('search', query.search.trim());
    if (query.status) params.set('status', query.status);
    if (query.presence) params.set('presence', query.presence);
    if (query.faceEnrollmentStatus) params.set('faceEnrollmentStatus', query.faceEnrollmentStatus);
    if (query.roomGroup?.trim()) params.set('roomGroup', query.roomGroup.trim());
    if (query.hostelId) params.set('hostelId', query.hostelId);

    const queryString = params.toString();
    const endpoint = queryString ? `/residents?${queryString}` : '/residents';
    return apiClient<PaginatedResult<SafeResident>>(endpoint);
  },

  async getResidents(query: ListResidentsQuery = {}): Promise<PaginatedResult<SafeResident>> {
    return this.listResidents(query);
  },

  async getSummary(hostelId?: string): Promise<ResidentSummary> {
    const endpoint = hostelId ? `/residents/summary?hostelId=${encodeURIComponent(hostelId)}` : '/residents/summary';
    return apiClient<ResidentSummary>(endpoint);
  },

  async getResident(id: string): Promise<SafeResident> {
    return apiClient<SafeResident>(`/residents/${encodeURIComponent(id)}`);
  },

  async getResidentByCode(code: string): Promise<SafeResident> {
    return apiClient<SafeResident>(`/residents/by-code/${encodeURIComponent(code)}`);
  },

  async createResident(payload: CreateResidentPayload): Promise<SafeResident> {
    return apiClient<SafeResident>('/residents', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async updateResident(id: string, payload: UpdateResidentPayload): Promise<SafeResident> {
    return apiClient<SafeResident>(`/residents/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async deactivateResident(id: string, reason: string): Promise<SafeResident> {
    return apiClient<SafeResident>(`/residents/${encodeURIComponent(id)}/deactivate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async reactivateResident(id: string, reason: string): Promise<SafeResident> {
    return apiClient<SafeResident>(`/residents/${encodeURIComponent(id)}/reactivate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  getProfilePhotoUrl(id: string): string {
    return `/api/v1/residents/${encodeURIComponent(id)}/profile-photo`;
  },

  async uploadProfilePhoto(id: string, imageBase64: string): Promise<{ success: boolean; profilePhotoUrl: string }> {
    return apiClient<{ success: boolean; profilePhotoUrl: string }>(`/residents/${encodeURIComponent(id)}/profile-photo`, {
      method: 'POST',
      body: JSON.stringify({ imageBase64 }),
    });
  },

  async captureProfilePhoto(id: string, cameraId: string): Promise<{ success: boolean; profilePhotoUrl: string }> {
    return apiClient<{ success: boolean; profilePhotoUrl: string }>(`/residents/${encodeURIComponent(id)}/profile-photo`, {
      method: 'POST',
      body: JSON.stringify({ cameraId }),
    });
  },

  async deleteProfilePhoto(id: string): Promise<{ success: boolean; message: string }> {
    return apiClient<{ success: boolean; message: string }>(`/residents/${encodeURIComponent(id)}/profile-photo`, {
      method: 'DELETE',
    });
  },

  async listHostels(): Promise<{ data: Array<{ id: string; code: string; name: string }> }> {
    return apiClient<{ data: Array<{ id: string; code: string; name: string }> }>('/residents/hostels');
  },
};
