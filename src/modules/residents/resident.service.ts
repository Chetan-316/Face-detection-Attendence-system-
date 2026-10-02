import {
  PrismaClient,
  Resident,
  ResidentStatus,
  FaceEnrollmentStatus,
  PresenceState,
  StaffRole,
  Prisma,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';
import { assertPermission, assertUserCanOperateInHostel, StaffActor } from '../auth/permissions';
import {
  SafeResident,
  UpdateResidentInput,
  ListResidentsParams,
  PaginatedResult,
  ResidentSummary,
} from './resident.types';
import { defaultTemplateCache } from '../recognition/template-cache';

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

    // Missing user check & scope validation
    if (input.performedByUserId) {
      const staffUser = await this.db.user.findUnique({ where: { id: input.performedByUserId } });
      if (!staffUser) {
        throw new NotFoundError('User', input.performedByUserId);
      }
      assertPermission(staffUser.role, 'RESIDENT_MANAGE');
      assertUserCanOperateInHostel(staffUser, input.organizationId, input.hostelId);
    }

    // Check duplicate code within organization
    const existing = await this.db.resident.findUnique({
      where: {
        organizationId_residentCode: {
          organizationId: input.organizationId,
          residentCode: input.residentCode.trim(),
        },
      },
    });
    if (existing) {
      throw new ConflictError(
        `Resident with code '${input.residentCode.trim()}' already exists in this organization`
      );
    }

    return this.db.$transaction(async (tx) => {
      const resident = await tx.resident.create({
        data: {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          residentCode: input.residentCode.trim(),
          fullName: input.fullName.trim(),
          roomGroup: input.roomGroup.trim(),
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

  public async createRegularComer(input: {
    organizationId: string;
    hostelId: string;
    residentCode: string;
    fullName: string;
    category: string;
    contactPhone?: string | null;
    initialPresence?: PresenceState;
    performedByUserId?: string;
    performedByRole?: StaffRole;
  }): Promise<Resident> {
    const hostel = await this.db.hostel.findUnique({
      where: { id: input.hostelId },
    });
    if (!hostel) {
      throw new NotFoundError('Hostel', input.hostelId);
    }
    if (hostel.organizationId !== input.organizationId) {
      throw new ValidationError('Hostel does not belong to the specified organization');
    }

    if (input.performedByUserId) {
      const staffUser = await this.db.user.findUnique({ where: { id: input.performedByUserId } });
      if (!staffUser) {
        throw new NotFoundError('User', input.performedByUserId);
      }
      assertUserCanOperateInHostel(staffUser, input.organizationId, input.hostelId);
    }

    const existing = await this.db.resident.findUnique({
      where: {
        organizationId_residentCode: {
          organizationId: input.organizationId,
          residentCode: input.residentCode.trim(),
        },
      },
    });
    if (existing) {
      throw new ConflictError(
        `Person with code '${input.residentCode.trim()}' already exists in this organization`
      );
    }

    return this.db.$transaction(async (tx) => {
      const resident = await tx.resident.create({
        data: {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          residentCode: input.residentCode.trim(),
          fullName: input.fullName.trim(),
          roomGroup: `[Non-Resident] ${input.category.trim()}`,
          contactPhone: input.contactPhone || null,
          status: ResidentStatus.ACTIVE,
          faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED,
        },
      });

      await tx.residentPresence.create({
        data: {
          residentId: resident.id,
          hostelId: resident.hostelId,
          currentState: input.initialPresence || PresenceState.IN,
          lastUpdatedByUserId: input.performedByUserId || null,
        },
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          entityType: 'RESIDENT',
          entityId: resident.id,
          action: 'CREATE',
          performedByUserId: input.performedByUserId || null,
          performedByRole: input.performedByRole || null,
          reason: 'Quick registration of regular visitor/comer at gate',
          newValues: {
            residentCode: resident.residentCode,
            fullName: resident.fullName,
            roomGroup: resident.roomGroup,
            initialPresence: input.initialPresence || PresenceState.IN,
          },
        },
        tx
      );

      return resident;
    });
  }

  public async updateResident(
    residentId: string,
    input: UpdateResidentInput,
    actor: StaffActor
  ): Promise<SafeResident> {
    assertPermission(actor.role, 'RESIDENT_MANAGE');

    // Missing user check
    const staffUser = await this.db.user.findUnique({ where: { id: actor.id } });
    if (!staffUser) {
      throw new NotFoundError('User', actor.id);
    }

    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
      include: {
        presence: true,
        hostel: { select: { id: true, code: true, name: true } },
      },
    });
    if (!resident) {
      throw new NotFoundError('Resident', residentId);
    }

    // Scoping check: must belong to actor's organization and hostel scope
    assertUserCanOperateInHostel(staffUser, resident.organizationId, resident.hostelId);

    // If residentCode is being changed, verify uniqueness within organization
    if (input.residentCode && input.residentCode.trim() !== resident.residentCode) {
      const codeTrimmed = input.residentCode.trim();
      const existing = await this.db.resident.findUnique({
        where: {
          organizationId_residentCode: {
            organizationId: resident.organizationId,
            residentCode: codeTrimmed,
          },
        },
      });
      if (existing && existing.id !== resident.id) {
        throw new ConflictError(
          `Resident with code '${codeTrimmed}' already exists in this organization`
        );
      }
    }

    // Whitelist update payload
    const updateData: Prisma.ResidentUpdateInput = {};
    const oldValues: Record<string, any> = {};
    const newValues: Record<string, any> = {};

    if (input.fullName !== undefined) {
      updateData.fullName = input.fullName.trim();
      oldValues.fullName = resident.fullName;
      newValues.fullName = updateData.fullName;
    }
    if (input.roomGroup !== undefined) {
      updateData.roomGroup = input.roomGroup.trim();
      oldValues.roomGroup = resident.roomGroup;
      newValues.roomGroup = updateData.roomGroup;
    }
    if (input.contactPhone !== undefined) {
      updateData.contactPhone = input.contactPhone ? input.contactPhone.trim() : null;
      oldValues.contactPhone = resident.contactPhone;
      newValues.contactPhone = updateData.contactPhone;
    }
    if (input.contactEmail !== undefined) {
      updateData.contactEmail = input.contactEmail ? input.contactEmail.trim() : null;
      oldValues.contactEmail = resident.contactEmail;
      newValues.contactEmail = updateData.contactEmail;
    }
    if (input.residentCode !== undefined) {
      updateData.residentCode = input.residentCode.trim();
      oldValues.residentCode = resident.residentCode;
      newValues.residentCode = updateData.residentCode;
    }

    return this.db.$transaction(async (tx) => {
      const updated = await tx.resident.update({
        where: { id: residentId },
        data: updateData,
        include: {
          presence: true,
          hostel: { select: { id: true, code: true, name: true } },
        },
      });

      await this.auditService.record(
        {
          organizationId: resident.organizationId,
          hostelId: resident.hostelId,
          entityType: 'RESIDENT',
          entityId: resident.id,
          action: 'UPDATE',
          performedByUserId: actor.id,
          performedByRole: actor.role,
          oldValues,
          newValues,
        },
        tx
      );

      return this.toSafeResident(updated);
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

    if (resident.status === ResidentStatus.INACTIVE) {
      throw new ConflictError('Resident is already inactive');
    }

    // Missing user check & scope validation
    if (performedByUserId) {
      const staffUser = await this.db.user.findUnique({ where: { id: performedByUserId } });
      if (!staffUser) {
        throw new NotFoundError('User', performedByUserId);
      }
      assertPermission(staffUser.role, 'RESIDENT_MANAGE');
      assertUserCanOperateInHostel(staffUser, resident.organizationId, resident.hostelId);
    }

    const targetHostelId = resident.hostelId;

    const updated = await this.db.$transaction(async (tx) => {
      const res = await tx.resident.update({
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
          reason: reason.trim(),
          performedByUserId: performedByUserId || null,
          performedByRole: performedByRole || null,
          oldValues: { status: resident.status },
          newValues: { status: ResidentStatus.INACTIVE },
        },
        tx
      );

      return res;
    });

    defaultTemplateCache.invalidate(targetHostelId);
    return updated;
  }

  public async reactivateResident(
    residentId: string,
    reason: string,
    performedByUserId?: string,
    performedByRole?: StaffRole
  ): Promise<Resident> {
    if (!reason || reason.trim().length === 0) {
      throw new ValidationError('Reason is mandatory for resident reactivation');
    }

    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
    });
    if (!resident) {
      throw new NotFoundError('Resident', residentId);
    }

    if (resident.status === ResidentStatus.ACTIVE) {
      throw new ConflictError('Resident is already active');
    }

    // Missing user check & scope validation
    if (performedByUserId) {
      const staffUser = await this.db.user.findUnique({ where: { id: performedByUserId } });
      if (!staffUser) {
        throw new NotFoundError('User', performedByUserId);
      }
      assertPermission(staffUser.role, 'RESIDENT_MANAGE');
      assertUserCanOperateInHostel(staffUser, resident.organizationId, resident.hostelId);
    }

    const targetHostelId = resident.hostelId;

    const updated = await this.db.$transaction(async (tx) => {
      const res = await tx.resident.update({
        where: { id: residentId },
        data: {
          status: ResidentStatus.ACTIVE,
        },
      });

      await this.auditService.record(
        {
          organizationId: resident.organizationId,
          hostelId: resident.hostelId,
          entityType: 'RESIDENT',
          entityId: resident.id,
          action: 'UPDATE',
          reason: reason.trim(),
          performedByUserId: performedByUserId || null,
          performedByRole: performedByRole || null,
          oldValues: { status: resident.status },
          newValues: { status: ResidentStatus.ACTIVE },
        },
        tx
      );

      return res;
    });

    defaultTemplateCache.invalidate(targetHostelId);
    return updated;
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

  public async getResidentScoped(id: string, actor: StaffActor): Promise<SafeResident> {
    const resident = await this.db.resident.findUnique({
      where: { id },
      include: {
        presence: true,
        hostel: { select: { id: true, code: true, name: true } },
      },
    });
    if (!resident) {
      throw new NotFoundError('Resident', id);
    }

    // Scope check: organization isolation
    if (resident.organizationId !== actor.organizationId) {
      throw new NotFoundError('Resident', id);
    }

    // Scope check: hostel isolation for Warden / Guard / scoped Admin
    if (actor.role === StaffRole.WARDEN || actor.role === StaffRole.GUARD) {
      if (!actor.hostelId || actor.hostelId !== resident.hostelId) {
        throw new NotFoundError('Resident', id);
      }
    } else if (actor.role === StaffRole.ADMIN && actor.hostelId && actor.hostelId !== resident.hostelId) {
      throw new NotFoundError('Resident', id);
    }

    return this.toSafeResident(resident);
  }

  public async getResidentByCodeScoped(code: string, actor: StaffActor): Promise<SafeResident> {
    const resident = await this.db.resident.findUnique({
      where: {
        organizationId_residentCode: {
          organizationId: actor.organizationId,
          residentCode: code.trim(),
        },
      },
      include: {
        presence: true,
        hostel: { select: { id: true, code: true, name: true } },
      },
    });
    if (!resident) {
      throw new NotFoundError('Resident with code', code);
    }

    // Scope check: hostel isolation
    if (actor.role === StaffRole.WARDEN || actor.role === StaffRole.GUARD) {
      if (!actor.hostelId || actor.hostelId !== resident.hostelId) {
        throw new NotFoundError('Resident with code', code);
      }
    } else if (actor.role === StaffRole.ADMIN && actor.hostelId && actor.hostelId !== resident.hostelId) {
      throw new NotFoundError('Resident with code', code);
    }

    return this.toSafeResident(resident);
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

  public async listResidentsPaginated(params: ListResidentsParams): Promise<PaginatedResult<SafeResident>> {
    const page = Math.max(1, params.page || 1);
    const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
    const skip = (page - 1) * pageSize;

    const where: Prisma.ResidentWhereInput = {
      organizationId: params.organizationId,
      ...(params.hostelId ? { hostelId: params.hostelId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.faceEnrollmentStatus ? { faceEnrollmentStatus: params.faceEnrollmentStatus } : {}),
      ...(params.roomGroup ? { roomGroup: { contains: params.roomGroup, mode: 'insensitive' } } : {}),
      ...(params.presence
        ? {
            presence: {
              currentState: params.presence,
            },
          }
        : {}),
      ...(params.search
        ? {
            OR: [
              { fullName: { contains: params.search, mode: 'insensitive' } },
              { residentCode: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, records] = await Promise.all([
      this.db.resident.count({ where }),
      this.db.resident.findMany({
        where,
        include: {
          presence: true,
          hostel: { select: { id: true, code: true, name: true } },
        },
        orderBy: { residentCode: 'asc' },
        skip,
        take: pageSize,
      }),
    ]);

    const totalPages = Math.ceil(total / pageSize);

    return {
      data: records.map((r) => this.toSafeResident(r)),
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    };
  }

  public async getSummary(params: { organizationId: string; hostelId?: string }): Promise<ResidentSummary> {
    const baseWhere: Prisma.ResidentWhereInput = {
      organizationId: params.organizationId,
      ...(params.hostelId ? { hostelId: params.hostelId } : {}),
    };

    const [
      total,
      active,
      inactive,
      currentlyIn,
      currentlyOut,
      faceEnrolled,
      notEnrolled,
      needsReEnrollment,
      revoked,
    ] = await Promise.all([
      this.db.resident.count({ where: baseWhere }),
      this.db.resident.count({ where: { ...baseWhere, status: ResidentStatus.ACTIVE } }),
      this.db.resident.count({ where: { ...baseWhere, status: ResidentStatus.INACTIVE } }),
      this.db.resident.count({
        where: { ...baseWhere, presence: { currentState: PresenceState.IN } },
      }),
      this.db.resident.count({
        where: { ...baseWhere, presence: { currentState: PresenceState.OUT } },
      }),
      this.db.resident.count({
        where: { ...baseWhere, faceEnrollmentStatus: FaceEnrollmentStatus.ENROLLED },
      }),
      this.db.resident.count({
        where: { ...baseWhere, faceEnrollmentStatus: FaceEnrollmentStatus.NOT_ENROLLED },
      }),
      this.db.resident.count({
        where: { ...baseWhere, faceEnrollmentStatus: FaceEnrollmentStatus.NEEDS_REENROLLMENT },
      }),
      this.db.resident.count({
        where: { ...baseWhere, faceEnrollmentStatus: FaceEnrollmentStatus.REVOKED },
      }),
    ]);

    return {
      total,
      active,
      inactive,
      currentlyIn,
      currentlyOut,
      faceEnrolled,
      notEnrolled,
      needsReEnrollment,
      revoked,
    };
  }

  private toSafeResident(resident: any): SafeResident {
    return {
      id: resident.id,
      organizationId: resident.organizationId,
      hostelId: resident.hostelId,
      residentCode: resident.residentCode,
      fullName: resident.fullName,
      roomGroup: resident.roomGroup,
      contactPhone: resident.contactPhone,
      contactEmail: resident.contactEmail,
      profilePhotoPath: resident.profilePhotoPath || null,
      status: resident.status,
      faceEnrollmentStatus: resident.faceEnrollmentStatus,
      presence: resident.presence
        ? {
            currentState: resident.presence.currentState,
            lastMovementType: resident.presence.lastMovementType,
            lastMovementTime: resident.presence.lastMovementTime,
            updatedAt: resident.presence.updatedAt,
          }
        : null,
      hostel: resident.hostel
        ? {
            id: resident.hostel.id,
            code: resident.hostel.code,
            name: resident.hostel.name,
          }
        : null,
      createdAt: resident.createdAt,
      updatedAt: resident.updatedAt,
    };
  }
}
