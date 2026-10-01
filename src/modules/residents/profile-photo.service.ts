import fs from 'fs';
import path from 'path';
import { PrismaClient, StaffRole, AuditAction } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { NotFoundError, ValidationError, ForbiddenError } from '../../common/errors';
import { assertPermission, StaffActor } from '../auth/permissions';
import { AuditService } from '../audit/audit.service';

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
const MIN_FILE_SIZE_BYTES = 12; // 12 B (minimum needed for WEBP header check)

export interface ProfilePhotoInfo {
  buffer: Buffer;
  mimeType: string;
  filePath: string;
}

export class ProfilePhotoService {
  private auditService: AuditService;
  private storageDir: string;

  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    customStorageDir?: string
  ) {
    this.auditService = new AuditService(this.db);
    this.storageDir = customStorageDir || path.resolve(process.cwd(), 'data/profile-photos');
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  public detectMimeType(buffer: Buffer): { mimeType: string; ext: string } {
    if (!buffer || buffer.length < MIN_FILE_SIZE_BYTES) {
      throw new ValidationError('Image file is too small or empty');
    }
    if (buffer.length > MAX_FILE_SIZE_BYTES) {
      throw new ValidationError('Image file exceeds the 5MB maximum size limit');
    }

    // JPEG
    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
      return { mimeType: 'image/jpeg', ext: '.jpg' };
    }

    // PNG
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    ) {
      return { mimeType: 'image/png', ext: '.png' };
    }

    // WEBP
    if (
      buffer.length >= 12 &&
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
    ) {
      return { mimeType: 'image/webp', ext: '.webp' };
    }

    throw new ValidationError('Invalid image format. Allowed formats: JPEG, PNG, WEBP');
  }

  private async getResidentScoped(residentId: string, actor: StaffActor) {
    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
    });

    if (!resident) {
      throw new NotFoundError('Resident', residentId);
    }

    if (resident.organizationId !== actor.organizationId) {
      throw new NotFoundError('Resident', residentId);
    }

    if (
      (actor.role === StaffRole.WARDEN || actor.role === StaffRole.GUARD) &&
      actor.hostelId &&
      resident.hostelId !== actor.hostelId
    ) {
      throw new NotFoundError('Resident', residentId);
    }

    return resident;
  }

  public async saveProfilePhoto(
    residentId: string,
    buffer: Buffer,
    actor: StaffActor
  ): Promise<{ profilePhotoPath: string; url: string }> {
    assertPermission(actor.role, 'RESIDENT_MANAGE');
    const resident = await this.getResidentScoped(residentId, actor);

    const { mimeType, ext } = this.detectMimeType(buffer);
    const filename = `${resident.id}${ext}`;
    const fullPath = path.join(this.storageDir, filename);

    // Remove existing file if extension changed
    if (resident.profilePhotoPath && resident.profilePhotoPath !== filename) {
      const oldPath = path.join(this.storageDir, resident.profilePhotoPath);
      if (fs.existsSync(oldPath)) {
        try {
          fs.unlinkSync(oldPath);
        } catch {}
      }
    }

    fs.writeFileSync(fullPath, buffer);

    await this.db.resident.update({
      where: { id: resident.id },
      data: { profilePhotoPath: filename },
    });

    try {
      await this.auditService.record({
        performedByUserId: actor.id,
        performedByRole: actor.role,
        action: AuditAction.UPDATE,
        entityType: 'Resident',
        entityId: resident.id,
        organizationId: resident.organizationId,
        hostelId: resident.hostelId,
        newValues: {
          profilePhotoPath: filename,
          mimeType,
          sizeBytes: buffer.length,
        },
      });
    } catch {}

    return {
      profilePhotoPath: filename,
      url: `/api/v1/residents/${resident.id}/profile-photo`,
    };
  }

  public async getProfilePhoto(
    residentId: string,
    actor: StaffActor
  ): Promise<ProfilePhotoInfo> {
    const resident = await this.getResidentScoped(residentId, actor);

    if (!resident.profilePhotoPath) {
      throw new NotFoundError('Profile photo for resident', residentId);
    }

    const fullPath = path.join(this.storageDir, resident.profilePhotoPath);
    if (!fs.existsSync(fullPath)) {
      throw new NotFoundError('Profile photo file on disk', residentId);
    }

    const buffer = fs.readFileSync(fullPath);
    const { mimeType } = this.detectMimeType(buffer);

    return {
      buffer,
      mimeType,
      filePath: fullPath,
    };
  }

  public async deleteProfilePhoto(
    residentId: string,
    actor: StaffActor
  ): Promise<{ message: string }> {
    assertPermission(actor.role, 'RESIDENT_MANAGE');
    const resident = await this.getResidentScoped(residentId, actor);

    if (resident.profilePhotoPath) {
      const fullPath = path.join(this.storageDir, resident.profilePhotoPath);
      if (fs.existsSync(fullPath)) {
        try {
          fs.unlinkSync(fullPath);
        } catch {}
      }

      await this.db.resident.update({
        where: { id: resident.id },
        data: { profilePhotoPath: null },
      });

      try {
        await this.auditService.record({
          performedByUserId: actor.id,
          performedByRole: actor.role,
          action: AuditAction.UPDATE,
          entityType: 'Resident',
          entityId: resident.id,
          organizationId: resident.organizationId,
          hostelId: resident.hostelId,
          oldValues: { profilePhotoPath: resident.profilePhotoPath },
          newValues: { profilePhotoPath: null },
        });
      } catch {}
    }

    return { message: 'Profile photo removed successfully' };
  }
}
