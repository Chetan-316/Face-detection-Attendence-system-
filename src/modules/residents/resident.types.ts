import { ResidentStatus, FaceEnrollmentStatus, PresenceState, MovementType } from '@prisma/client';

export interface SafeResident {
  id: string;
  organizationId: string;
  hostelId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  contactPhone: string | null;
  contactEmail: string | null;
  profilePhotoPath?: string | null;
  status: ResidentStatus;
  faceEnrollmentStatus: FaceEnrollmentStatus;
  presence?: {
    currentState: PresenceState;
    lastMovementType: MovementType | null;
    lastMovementTime: Date | null;
    updatedAt: Date;
  } | null;
  hostel?: {
    id: string;
    code: string;
    name: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateResidentInput {
  residentCode?: string;
  fullName?: string;
  roomGroup?: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
}

export interface ListResidentsParams {
  organizationId: string;
  hostelId?: string;
  page?: number;
  pageSize?: number;
  search?: string;
  status?: ResidentStatus;
  presence?: PresenceState;
  faceEnrollmentStatus?: FaceEnrollmentStatus;
  roomGroup?: string;
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
