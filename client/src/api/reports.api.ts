import { apiClient, API_BASE_URL, getStoredToken } from './client';
import {
  AttendanceSessionReportItem,
  SessionRosterReport,
  AttendanceTrendPoint,
  ResidentAttendanceSummaryReport,
  MovementReportItem,
  PresenceSummaryReport,
  CurrentlyOutsideReportItem,
  ResidentSummaryReport,
  PaginatedReportResponse,
  PaginatedAttendanceReportResponse,
} from '../types/reports.types';

export const reportsApi = {
  getAttendanceSessions: async (params?: {
    hostelId?: string;
    sessionId?: string;
    status?: string;
    sessionType?: string;
    date?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedAttendanceReportResponse> => {
    const query = new URLSearchParams();
    if (params?.hostelId) query.set('hostelId', params.hostelId);
    if (params?.sessionId) query.set('sessionId', params.sessionId);
    if (params?.status) query.set('status', params.status);
    if (params?.sessionType) query.set('sessionType', params.sessionType);
    if (params?.date) query.set('date', params.date);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());

    const qs = query.toString();
    return apiClient<PaginatedAttendanceReportResponse>(
      `/reports/attendance${qs ? `?${qs}` : ''}`
    );
  },

  getSessionRoster: async (
    sessionId: string,
    params?: { status?: string; search?: string }
  ): Promise<SessionRosterReport> => {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.search) query.set('search', params.search);

    const qs = query.toString();
    return apiClient<SessionRosterReport>(
      `/reports/attendance/sessions/${sessionId}${qs ? `?${qs}` : ''}`
    );
  },

  getAttendanceTrend: async (params?: {
    hostelId?: string;
    dateFrom?: string;
    dateTo?: string;
    days?: number;
  }): Promise<{ data: AttendanceTrendPoint[] }> => {
    const query = new URLSearchParams();
    if (params?.hostelId) query.set('hostelId', params.hostelId);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.days) query.set('days', params.days.toString());

    const qs = query.toString();
    return apiClient<{ data: AttendanceTrendPoint[] }>(
      `/reports/attendance/trend${qs ? `?${qs}` : ''}`
    );
  },

  getResidentAttendance: async (residentId: string): Promise<ResidentAttendanceSummaryReport> => {
    return apiClient<ResidentAttendanceSummaryReport>(
      `/reports/residents/${residentId}/attendance`
    );
  },

  getMovements: async (params?: {
    hostelId?: string;
    residentId?: string;
    direction?: string;
    cameraId?: string;
    source?: string;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PaginatedReportResponse<MovementReportItem>> => {
    const query = new URLSearchParams();
    if (params?.hostelId) query.set('hostelId', params.hostelId);
    if (params?.residentId) query.set('residentId', params.residentId);
    if (params?.direction) query.set('direction', params.direction);
    if (params?.cameraId) query.set('cameraId', params.cameraId);
    if (params?.source) query.set('source', params.source);
    if (params?.search) query.set('search', params.search);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);
    if (params?.page) query.set('page', params.page.toString());
    if (params?.pageSize) query.set('pageSize', params.pageSize.toString());

    const qs = query.toString();
    return apiClient<PaginatedReportResponse<MovementReportItem>>(
      `/reports/movements${qs ? `?${qs}` : ''}`
    );
  },

  getResidentMovements: async (
    residentId: string,
    limit?: number
  ): Promise<{ data: MovementReportItem[] }> => {
    const qs = limit ? `?limit=${limit}` : '';
    return apiClient<{ data: MovementReportItem[] }>(
      `/reports/residents/${residentId}/movements${qs}`
    );
  },

  getPresence: async (hostelId?: string): Promise<PresenceSummaryReport> => {
    const qs = hostelId ? `?hostelId=${encodeURIComponent(hostelId)}` : '';
    return apiClient<PresenceSummaryReport>(`/reports/presence${qs}`);
  },

  getCurrentlyOutside: async (
    hostelId?: string
  ): Promise<{ data: CurrentlyOutsideReportItem[]; total: number }> => {
    const qs = hostelId ? `?hostelId=${encodeURIComponent(hostelId)}` : '';
    return apiClient<{ data: CurrentlyOutsideReportItem[]; total: number }>(
      `/reports/presence/outside${qs}`
    );
  },

  getResidentSummary: async (residentId: string): Promise<ResidentSummaryReport> => {
    return apiClient<ResidentSummaryReport>(`/reports/residents/${residentId}/summary`);
  },

  downloadAttendanceCsv: async (params?: {
    hostelId?: string;
    sessionId?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<void> => {
    const query = new URLSearchParams();
    if (params?.hostelId) query.set('hostelId', params.hostelId);
    if (params?.sessionId) query.set('sessionId', params.sessionId);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);

    const qs = query.toString();
    const url = `${API_BASE_URL}/reports/export/attendance${qs ? `?${qs}` : ''}`;
    const token = getStoredToken();

    const response = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download attendance CSV: ${response.statusText}`);
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `attendance-report-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(downloadUrl);
  },

  downloadMovementCsv: async (params?: {
    hostelId?: string;
    residentId?: string;
    direction?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<void> => {
    const query = new URLSearchParams();
    if (params?.hostelId) query.set('hostelId', params.hostelId);
    if (params?.residentId) query.set('residentId', params.residentId);
    if (params?.direction) query.set('direction', params.direction);
    if (params?.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params?.dateTo) query.set('dateTo', params.dateTo);

    const qs = query.toString();
    const url = `${API_BASE_URL}/reports/export/movements${qs ? `?${qs}` : ''}`;
    const token = getStoredToken();

    const response = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to download movement CSV: ${response.statusText}`);
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = `movement-report-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(downloadUrl);
  },
};
