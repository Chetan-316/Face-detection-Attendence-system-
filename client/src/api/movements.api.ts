import { apiClient } from './client';
import {
  MovementEventEntity,
  PresenceCounts,
  AutomationStatus,
} from '../types/movement.types';

export interface MovementListResponse {
  data: MovementEventEntity[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export const movementsApi = {
  getMovements: async (params?: {
    hostelId?: string;
    residentId?: string;
    direction?: string;
    cameraId?: string;
    source?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }): Promise<MovementListResponse> => {
    const query = new URLSearchParams();
    if (params?.hostelId) query.set('hostelId', params.hostelId);
    if (params?.residentId) query.set('residentId', params.residentId);
    if (params?.direction) query.set('direction', params.direction);
    if (params?.cameraId) query.set('cameraId', params.cameraId);
    if (params?.source) query.set('source', params.source);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());

    const qs = query.toString();
    return apiClient<MovementListResponse>(`/movements${qs ? `?${qs}` : ''}`);
  },

  getAutomationStatus: async (): Promise<AutomationStatus> => {
    return apiClient<AutomationStatus>('/movements/automation-status');
  },

  updateAutomationStatus: async (payload: {
    enabled: boolean;
    minTransitionIntervalMs?: number;
  }): Promise<AutomationStatus> => {
    return apiClient<AutomationStatus>('/movements/automation-status', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  getPresenceCounts: async (hostelId?: string): Promise<PresenceCounts> => {
    const qs = hostelId ? `?hostelId=${encodeURIComponent(hostelId)}` : '';
    return apiClient<PresenceCounts>(`/movements/presence-counts${qs}`);
  },

  getResidentMovements: async (residentId: string): Promise<{ data: MovementEventEntity[] }> => {
    return apiClient<{ data: MovementEventEntity[] }>(`/residents/${residentId}/movements`);
  },

  getResidentPresence: async (residentId: string): Promise<any> => {
    return apiClient<any>(`/residents/${residentId}/presence`);
  },

  confirmMovement: async (payload: {
    residentId: string;
    cameraId: string;
    direction?: 'IN' | 'OUT';
    overrideReason?: string;
  }): Promise<{ success: boolean; data: MovementEventEntity; message: string }> => {
    return apiClient<{ success: boolean; data: MovementEventEntity; message: string }>(
      '/movements/confirm',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },
};
