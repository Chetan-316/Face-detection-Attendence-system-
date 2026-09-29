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
};
