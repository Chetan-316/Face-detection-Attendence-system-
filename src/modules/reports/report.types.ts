import {
  AttendanceRecordStatus,
  AttendanceSessionStatus,
  AttendanceSessionType,
  AttendanceMarkMethod,
  MovementType,
  MovementSource,
  PresenceState,
  ResidentStatus,
} from '@prisma/client';

export interface DateRangeFilter {
  dateFrom?: string;
  dateTo?: string;
}

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface AttendanceReportSummary {
  sessions: number;
  closedSessions: number;
  present: number;
  absent: number;
  expected: number;
  attendanceRate: number;
}

export interface PaginatedAttendanceResult extends PaginatedResult<AttendanceSessionReportItem> {
  summary: AttendanceReportSummary;
}

export interface AttendanceReportQuery extends DateRangeFilter, PaginationParams {
  hostelId?: string;
  sessionId?: string;
  status?: AttendanceSessionStatus;
  sessionType?: AttendanceSessionType;
  date?: string;
}

export interface AttendanceSessionReportItem {
  id: string;
  hostelId: string;
  hostelName: string;
  sessionType: AttendanceSessionType;
  title: string;
  attendanceDate: string; // ISO date string (logical date)
  status: AttendanceSessionStatus;
  startTime: string;
  endTime?: string | null;
  expectedResidents: number;
  presentCount: number;
  absentCount: number;
  remainingCount: number;
  attendanceRate: number; // Percentage (e.g. 92)
  isFinalized: boolean; // true if CLOSED
}

export interface AttendanceRosterReportItem {
  recordId?: string | null;
  residentId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  status: AttendanceRecordStatus | 'NOT_RECORDED';
  markedAt?: string | null;
  markMethod?: AttendanceMarkMethod | null;
  isCorrected: boolean;
  correctionReason?: string | null;
  correctedBy?: {
    id: string;
    fullName: string;
    role: string;
  } | null;
}

export interface SessionRosterReport {
  session: AttendanceSessionReportItem;
  roster: AttendanceRosterReportItem[];
  stats: {
    expectedResidents: number;
    presentCount: number;
    absentCount: number;
    remainingCount: number;
    attendanceRate: number;
  };
}

export interface AttendanceTrendQuery extends DateRangeFilter {
  hostelId?: string;
  days?: number;
}

export interface AttendanceTrendPoint {
  date: string; // YYYY-MM-DD
  attendanceRate: number;
  presentCount: number;
  expectedCount: number;
  sessionCount: number;
  status: AttendanceSessionStatus;
  sessionTitles: string[];
}

export interface ResidentAttendanceRecordReport {
  sessionId: string;
  sessionTitle: string;
  sessionDate: string;
  sessionStatus: AttendanceSessionStatus;
  status: AttendanceRecordStatus;
  markedAt: string;
  markMethod: AttendanceMarkMethod;
  isCorrected: boolean;
  correctionReason?: string | null;
}

export interface ResidentAttendanceSummaryReport {
  residentId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  status: ResidentStatus;
  hostelId: string;
  hostelName: string;
  totalSessions: number;
  presentSessions: number;
  absentSessions: number;
  attendanceRate: number;
  records: ResidentAttendanceRecordReport[];
}

export interface MovementReportQuery extends DateRangeFilter, PaginationParams {
  hostelId?: string;
  residentId?: string;
  direction?: MovementType;
  cameraId?: string;
  source?: MovementSource;
  search?: string;
}

export interface MovementReportItem {
  id: string;
  timestamp: string;
  residentId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  direction: MovementType;
  gateName: string;
  source: MovementSource;
  isCorrection: boolean;
  notes?: string | null;
}

export interface PresenceSummaryReport {
  hostelId: string;
  hostelName: string;
  totalResidents: number;
  insideCount: number;
  outsideCount: number;
  insideRate: number;
  outsideRate: number;
}

export interface CurrentlyOutsideReportItem {
  residentId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  lastMovementTime?: string | null;
  gateName: string;
  direction: MovementType;
}

export interface ResidentSummaryReport {
  id: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  status: ResidentStatus;
  hostelId: string;
  hostelName: string;
  currentPresence: PresenceState;
  lastMovementTime?: string | null;
  lastMovementGate?: string | null;
  lastMovementDirection?: MovementType | null;
  totalAttendanceSessions: number;
  presentSessions: number;
  absentSessions: number;
  attendanceRate: number;
  recentAttendance: ResidentAttendanceRecordReport[];
  recentMovements: MovementReportItem[];
}
