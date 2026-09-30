export type AttendanceSessionStatus = 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
export type AttendanceRecordStatus =
  | 'PRESENT'
  | 'ABSENT'
  | 'NOT_IN_HOSTEL'
  | 'NOT_RECORDED'
  | 'CORRECTED_PRESENT'
  | 'EXCUSED';
export type AttendanceMarkMethod =
  | 'FACE_RECOGNITION'
  | 'MANUAL_STAFF'
  | 'WARDEN_OVERRIDE'
  | 'SYSTEM';

export interface AttendanceSession {
  id: string;
  organizationId: string;
  hostelId: string;
  locationId?: string | null;
  cameraId?: string | null;
  sessionType: 'NIGHT' | 'GENERAL' | 'CURFEW' | 'EVENT';
  title: string;
  attendanceDate: string;
  status: AttendanceSessionStatus;
  startTime: string;
  endTime?: string | null;
  createdByUserId: string;
  startedByUserId?: string | null;
  closedByUserId?: string | null;
  createdAt: string;
  updatedAt: string;
  camera?: {
    id: string;
    name: string;
    role: string;
  } | null;
  hostel?: {
    id: string;
    code: string;
    name: string;
  };
  presentCount?: number;
  absentCount?: number;
  recordCount?: number;
}

export interface AttendanceStats {
  expectedResidents: number;
  presentCount: number;
  absentCount: number;
  notRecordedCount: number;
  remainingCount: number;
}

export interface AttendanceRosterItem {
  residentId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  faceEnrollmentStatus: string;
  status: AttendanceRecordStatus | 'NOT_RECORDED';
  markedAt: string | null;
  markMethod: AttendanceMarkMethod | null;
  recordId: string | null;
  correctionReason: string | null;
  notes: string | null;
}

export interface AttendanceRosterResponse {
  session: AttendanceSession;
  stats: AttendanceStats;
  roster: AttendanceRosterItem[];
}
