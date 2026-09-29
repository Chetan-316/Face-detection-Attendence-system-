import {
  PrismaClient,
  Resident,
  ResidentStatus,
  FaceEnrollmentStatus,
  PresenceState,
  StaffRole,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';

export interface CreateResidentInput {
  organizationId: string;
  hostelId: string;
  residentCode: string;
  fullName: string;
  roomGroup: string;
  contactPhone?: string | null;
  contactEmail?: string | null;
  initialPresence?: PresenceState;
  performedByUserId?: string;
  performedByRole?: StaffRole;
}

export class ResidentService {
  private auditService: AuditService;

  constructor(private readonly db: PrismaClient = defaultPrisma) {
    this.auditService = new AuditService(this.db);
  }

  public async createResident(input: CreateResidentInput): Promise<Resident> {
    if (!input.residentCode || input.residentCode.trim().length === 0) {
      throw new ValidationError('Resident code is required');
    }
    if (!input.fullName || input.fullName.trim().length === 0) {
      throw new ValidationError('Resident full name is required');
    }

    // Verify organization and hostel exist and match
    const hostel = await this.db.hostel.findUnique({
      where: { id: input.hostelId },
    });
    if (!hostel) {
      throw new NotFoundError('Hostel', input.hostelId);
    }
    if (hostel.organizationId !== input.organizationId) {
      throw new ValidationError('Hostel does not belong to the specified organization');
    }

    // Check duplicate code
    const existing = await this.db.resident.findUnique({
      where: {
        organizationId_residentCode: {
          organizationId: input.organizationId,
          residentCode: input.residentCode.trim(),
        },
      },
    });
    if (existing) {
      throw new ConflictError(`Resident with code '${input.residentCode}' already exists in this organization`);
    }

    return this.db.$transaction(async (tx) => {
      const resident = await tx.resident.create({
        data: {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          residentCode: input.residentCode.trim(),
          fullName: input.fullName.trim(),
          roomGroup: input.roomGroup,
          contactPhone: input.contactPhone || null,
          contactEmail: input.contactEmail || null,
          status: ResidentStatus.ACTIVE,
          faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED,
        },
      });

      // Initialize presence state
      await tx.residentPresence.create({
        data: {
          residentId: resident.id,
          hostelId: resident.hostelId,
          currentState: input.initialPresence || PresenceState.OUT,
          lastUpdatedByUserId: input.performedByUserId || null,
        },
      });

      // Audit log
      await this.auditService.record(
        {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          entityType: 'RESIDENT',
          entityId: resident.id,
          action: 'CREATE',
          performedByUserId: input.performedByUserId || null,
          performedByRole: input.performedByRole || null,
          newValues: {
            residentCode: resident.residentCode,
            fullName: resident.fullName,
            roomGroup: resident.roomGroup,
            initialPresence: input.initialPresence || PresenceState.OUT,
          },
        },
        tx
      );

      return resident;
    });
  }

  public async deactivateResident(
    residentId: string,
    reason: string,
    performedByUserId?: string,
    performedByRole?: StaffRole
  ): Promise<Resident> {
    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('Reason is mandatory for resident deactivation');
    }

    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
    });
    if (!resident) {
      throw new NotFoundError('Resident', residentId);
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.resident.update({
        where: { id: residentId },
        data: {
          status: ResidentStatus.INACTIVE,
        },
      });

      await this.auditService.record(
        {
          organizationId: resident.organizationId,
          hostelId: resident.hostelId,
          entityType: 'RESIDENT',
          entityId: resident.id,
          action: 'DEACTIVATE',
          reason,
          performedByUserId: performedByUserId || null,
          performedByRole: performedByRole || null,
          oldValues: { status: resident.status },
          newValues: { status: ResidentStatus.INACTIVE },
        },
        tx
      );

      return updated;
    });
  }

  public async getResident(id: string): Promise<Resident> {
    const resident = await this.db.resident.findUnique({
      where: { id },
      include: { presence: true },
    });
    if (!resident) {
      throw new NotFoundError('Resident', id);
    }
    return resident;
  }

  public async findByResidentCode(organizationId: string, code: string): Promise<Resident | null> {
    return this.db.resident.findUnique({
      where: {
        organizationId_residentCode: {
          organizationId,
          residentCode: code,
        },
      },
      include: { presence: true },
    });
  }

  public async listResidents(hostelId: string, status?: ResidentStatus) {
    return this.db.resident.findMany({
      where: {
        hostelId,
        ...(status ? { status } : {}),
      },
      include: {
        presence: true,
      },
      orderBy: { residentCode: 'asc' },
    });
  }
}
