export interface AttendanceSessionReportItem {
  id: string;
  hostelId: string;
  hostelName: string;
  sessionType: string;
  title: string;
  attendanceDate: string;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  startTime: string;
  endTime?: string | null;
  expectedResidents: number;
  presentCount: number;
  absentCount: number;
  remainingCount: number;
  attendanceRate: number;
  isFinalized: boolean;
}

export interface AttendanceRosterReportItem {
  recordId?: string | null;
  residentId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  status: 'PRESENT' | 'ABSENT' | 'CORRECTED_PRESENT' | 'NOT_RECORDED' | 'EXCUSED';
  markedAt?: string | null;
  markMethod?: string | null;
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

export interface AttendanceTrendPoint {
  date: string;
  attendanceRate: number;
  presentCount: number;
  expectedCount: number;
  sessionCount: number;
  status: 'DRAFT' | 'ACTIVE' | 'CLOSED' | 'CANCELLED';
  sessionTitles: string[];
}

export interface ResidentAttendanceRecordReport {
  sessionId: string;
  sessionTitle: string;
  sessionDate: string;
  sessionStatus: string;
  status: string;
  markedAt: string;
  markMethod: string;
  isCorrected: boolean;
  correctionReason?: string | null;
}

export interface ResidentAttendanceSummaryReport {
  residentId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  status: string;
  hostelId: string;
  hostelName: string;
  totalSessions: number;
  presentSessions: number;
  absentSessions: number;
  attendanceRate: number;
  records: ResidentAttendanceRecordReport[];
}

export interface MovementReportItem {
  id: string;
  timestamp: string;
  residentId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  direction: 'IN' | 'OUT';
  gateName: string;
  source: string;
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
  direction: 'OUT';
}

export interface ResidentSummaryReport {
  id: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  status: string;
  hostelId: string;
  hostelName: string;
  currentPresence: 'IN' | 'OUT';
  lastMovementTime?: string | null;
  lastMovementGate?: string | null;
  lastMovementDirection?: 'IN' | 'OUT' | null;
  totalAttendanceSessions: number;
  presentSessions: number;
  absentSessions: number;
  attendanceRate: number;
  recentAttendance: ResidentAttendanceRecordReport[];
  recentMovements: MovementReportItem[];
}

export interface PaginatedReportResponse<T> {
  data: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
