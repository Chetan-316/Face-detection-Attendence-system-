import { apiClient } from './client';
import {
  AttendanceSession,
  AttendanceRosterResponse,
} from '../types/attendance.types';

export async function getAttendanceSessions(params?: {
  hostelId?: string;
  status?: string;
  sessionType?: string;
  date?: string;
}): Promise<{ sessions: AttendanceSession[] }> {
  const query = new URLSearchParams();
  if (params?.hostelId) query.set('hostelId', params.hostelId);
  if (params?.status) query.set('status', params.status);
  if (params?.sessionType) query.set('sessionType', params.sessionType);
  if (params?.date) query.set('date', params.date);

  const qs = query.toString();
  return apiClient<{ sessions: AttendanceSession[] }>(`/attendance/sessions${qs ? `?${qs}` : ''}`);
}

export async function getActiveAttendanceSession(params?: {
  hostelId?: string;
  cameraId?: string;
}): Promise<{ activeSession: AttendanceSession | null; stats?: any }> {
  const query = new URLSearchParams();
  if (params?.hostelId) query.set('hostelId', params.hostelId);
  if (params?.cameraId) query.set('cameraId', params.cameraId);

  const qs = query.toString();
  return apiClient<{ activeSession: AttendanceSession | null; stats?: any }>(
    `/attendance/active${qs ? `?${qs}` : ''}`
  );
}

export async function getAttendanceSession(id: string): Promise<{ session: AttendanceSession; stats: any }> {
  return apiClient<{ session: AttendanceSession; stats: any }>(`/attendance/sessions/${id}`);
}

export async function getAttendanceRoster(sessionId: string): Promise<AttendanceRosterResponse> {
  return apiClient<AttendanceRosterResponse>(`/attendance/sessions/${sessionId}/records`);
}

export async function createAttendanceSession(data: {
  hostelId?: string;
  title?: string;
  sessionType?: string;
  attendanceDate?: string;
  startTime?: string;
  endTime?: string;
  cameraId?: string;
  locationId?: string;
}): Promise<{ session: AttendanceSession }> {
  return apiClient<{ session: AttendanceSession }>('/attendance/sessions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function startAttendanceSession(sessionId: string): Promise<{ session: AttendanceSession }> {
  return apiClient<{ session: AttendanceSession }>(`/attendance/sessions/${sessionId}/start`, {
    method: 'POST',
  });
}

export async function closeAttendanceSession(
  sessionId: string
): Promise<{ session: AttendanceSession; stats: any }> {
  return apiClient<{ session: AttendanceSession; stats: any }>(`/attendance/sessions/${sessionId}/close`, {
    method: 'POST',
  });
}

export async function correctAttendanceRecord(
  sessionId: string,
  residentId: string,
  data: { status: 'PRESENT' | 'ABSENT'; reason: string }
): Promise<{ record: any }> {
  return apiClient<{ record: any }>(`/attendance/sessions/${sessionId}/records/${residentId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}
