import { AttendanceMarkMethod, AttendanceRecordStatus, CameraRole } from '@prisma/client';

export type AttendanceDecisionStatus =
  | 'ATTENDANCE_MARKED'
  | 'ALREADY_MARKED'
  | 'NO_ACTIVE_SESSION'
  | 'SESSION_NOT_STARTED'
  | 'SESSION_WINDOW_ENDED'
  | 'SESSION_CLOSED'
  | 'CAMERA_NOT_ATTENDANCE_CAPABLE'
  | 'CAMERA_SESSION_MISMATCH'
  | 'RESIDENT_INACTIVE'
  | 'CROSS_HOSTEL_MISMATCH'
  | 'NO_MATCH'
  | 'ERROR';

export interface AttendanceDecisionResult {
  status: AttendanceDecisionStatus;
  sessionId?: string;
  sessionTitle?: string;
  residentId?: string;
  residentCode?: string;
  residentName?: string;
  recordId?: string;
  attendanceStatus?: AttendanceRecordStatus;
  markMethod?: AttendanceMarkMethod;
  markedAt?: string;
  cameraId: string;
  cameraRole?: CameraRole;
  timestamp: string;
  reason?: string;
}
