export type ResidentStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'ARCHIVED';
export type FaceEnrollmentStatus = 'NOT_ENROLLED' | 'ENROLLED' | 'NEEDS_REENROLLMENT' | 'REVOKED';
export type PresenceState = 'IN' | 'OUT';

export interface SafeResident {
  id: string;
  organizationId: string;
  hostelId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  contactPhone: string | null;
  contactEmail: string | null;
  status: ResidentStatus;
  faceEnrollmentStatus: FaceEnrollmentStatus;
  profilePhotoPath?: string | null;
  presence?: {
    currentState: PresenceState;
    lastMovementType: string | null;
    lastMovementTime: string | null;
    updatedAt: string;
  } | null;
  hostel?: {
    id: string;
    code: string;
    name: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedResult<T> {
  data: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
  };
}

export interface ResidentSummary {
  total: number;
  active: number;
  inactive: number;
  currentlyIn: number;
  currentlyOut: number;
  faceEnrolled: number;
  notEnrolled: number;
  needsReEnrollment: number;
  revoked: number;
}

export interface CreateResidentPayload {
  residentCode: string;
  fullName: string;
  roomGroup: string;
  contactPhone?: string;
  contactEmail?: string;
  initialPresence?: PresenceState;
  hostelId?: string;
}

export interface UpdateResidentPayload {
  residentCode?: string;
  fullName?: string;
  roomGroup?: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface ListResidentsQuery {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ResidentStatus | '';
  presence?: PresenceState | '';
  faceEnrollmentStatus?: FaceEnrollmentStatus | '';
  roomGroup?: string;
  hostelId?: string;
}
