import { PrismaClient, Organization, Hostel, Location, LocationType } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors';
import { AuditService } from '../audit/audit.service';

export class OrganizationService {
  private auditService: AuditService;

  constructor(private readonly db: PrismaClient = defaultPrisma) {
    this.auditService = new AuditService(this.db);
  }

  public async createOrganization(data: {
    code: string;
    name: string;
    createdByUserId?: string;
  }): Promise<Organization> {
    if (!data.code || !data.name) {
      throw new ValidationError('Organization code and name are required');
    }

    const existing = await this.db.organization.findUnique({
      where: { code: data.code },
    });
    if (existing) {
      throw new ConflictError(`Organization with code '${data.code}' already exists`);
    }

    return this.db.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          code: data.code,
          name: data.name,
        },
      });

      await this.auditService.record(
        {
          organizationId: org.id,
          entityType: 'ORGANIZATION',
          entityId: org.id,
          action: 'CREATE',
          performedByUserId: data.createdByUserId || null,
          newValues: { code: org.code, name: org.name },
        },
        tx
      );

      return org;
    });
  }

  public async createHostel(data: {
    organizationId: string;
    code: string;
    name: string;
    createdByUserId?: string;
  }): Promise<Hostel> {
    if (!data.code || !data.name) {
      throw new ValidationError('Hostel code and name are required');
    }

    const org = await this.db.organization.findUnique({
      where: { id: data.organizationId },
    });
    if (!org) {
      throw new NotFoundError('Organization', data.organizationId);
    }

    const existing = await this.db.hostel.findUnique({
      where: {
        organizationId_code: {
          organizationId: data.organizationId,
          code: data.code,
        },
      },
    });
    if (existing) {
      throw new ConflictError(`Hostel with code '${data.code}' already exists in this organization`);
    }

    return this.db.$transaction(async (tx) => {
      const hostel = await tx.hostel.create({
        data: {
          organizationId: data.organizationId,
          code: data.code,
          name: data.name,
        },
      });

      await this.auditService.record(
        {
          organizationId: data.organizationId,
          hostelId: hostel.id,
          entityType: 'HOSTEL',
          entityId: hostel.id,
          action: 'CREATE',
          performedByUserId: data.createdByUserId || null,
          newValues: { code: hostel.code, name: hostel.name },
        },
        tx
      );

      return hostel;
    });
  }

  public async createLocation(data: {
    hostelId: string;
    code: string;
    name: string;
    locationType?: LocationType;
    createdByUserId?: string;
  }): Promise<Location> {
    if (!data.code || !data.name) {
      throw new ValidationError('Location code and name are required');
    }

    const hostel = await this.db.hostel.findUnique({
      where: { id: data.hostelId },
      include: { organization: true },
    });
    if (!hostel) {
      throw new NotFoundError('Hostel', data.hostelId);
    }

    const existing = await this.db.location.findUnique({
      where: {
        hostelId_code: {
          hostelId: data.hostelId,
          code: data.code,
        },
      },
    });
    if (existing) {
      throw new ConflictError(`Location with code '${data.code}' already exists in this hostel`);
    }

    return this.db.$transaction(async (tx) => {
      const location = await tx.location.create({
        data: {
          hostelId: data.hostelId,
          code: data.code,
          name: data.name,
          locationType: data.locationType || LocationType.GATE,
        },
      });

      await this.auditService.record(
        {
          organizationId: hostel.organizationId,
          hostelId: hostel.id,
          entityType: 'LOCATION',
          entityId: location.id,
          action: 'CREATE',
          performedByUserId: data.createdByUserId || null,
          newValues: { code: location.code, name: location.name, type: location.locationType },
        },
        tx
      );

      return location;
    });
  }

  public async getOrganization(id: string): Promise<Organization> {
    const org = await this.db.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundError('Organization', id);
    return org;
  }

  public async getHostel(id: string): Promise<Hostel> {
    const hostel = await this.db.hostel.findUnique({ where: { id } });
    if (!hostel) throw new NotFoundError('Hostel', id);
    return hostel;
  }

  public async getLocation(id: string): Promise<Location> {
    const loc = await this.db.location.findUnique({ where: { id } });
    if (!loc) throw new NotFoundError('Location', id);
    return loc;
  }
}
