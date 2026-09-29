import { PrismaClient, StaffRole, UserStatus, User } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { prisma as defaultPrisma } from '../../database/client';
import { AuditService } from '../audit/audit.service';
import { ConflictError, NotFoundError, ValidationError } from '../../common/errors';

export interface CreateUserInput {
  organizationId: string;
  hostelId?: string | null;
  username: string;
  email?: string | null;
  fullName: string;
  password: string;
  role: StaffRole;
  status?: UserStatus;
  createdById?: string;
}

export class AuthService {
  private auditService: AuditService;

  constructor(private readonly db: PrismaClient = defaultPrisma) {
    this.auditService = new AuditService(this.db);
  }

  public async createUser(input: CreateUserInput): Promise<Omit<User, 'passwordHash'>> {
    if (!input.username || input.username.trim().length < 3) {
      throw new ValidationError('Username must be at least 3 characters long');
    }
    if (!input.password || input.password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters long');
    }

    const existing = await this.db.user.findFirst({
      where: {
        OR: [
          { username: input.username },
          ...(input.email ? [{ email: input.email }] : []),
        ],
      },
    });

    if (existing) {
      throw new ConflictError(`User with username '${input.username}' or email already exists`);
    }

    const passwordHash = await bcrypt.hash(input.password, 10);

    const user = await this.db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          organizationId: input.organizationId,
          hostelId: input.hostelId || null,
          username: input.username,
          email: input.email || null,
          fullName: input.fullName,
          passwordHash,
          role: input.role,
          status: input.status || UserStatus.ACTIVE,
        },
      });

      await this.auditService.record(
        {
          organizationId: input.organizationId,
          hostelId: input.hostelId,
          entityType: 'USER',
          entityId: created.id,
          action: 'CREATE',
          performedByUserId: input.createdById || null,
          performedByRole: null,
          newValues: {
            username: created.username,
            role: created.role,
            fullName: created.fullName,
            status: created.status,
          },
        },
        tx
      );

      return created;
    });

    const { passwordHash: _, ...safeUser } = user;
    return safeUser;
  }

  public async findById(id: string): Promise<User> {
    const user = await this.db.user.findUnique({
      where: { id },
      include: { organization: true, hostel: true },
    });
    if (!user) {
      throw new NotFoundError('User', id);
    }
    return user;
  }

  public async findByUsername(username: string): Promise<User | null> {
    return this.db.user.findUnique({
      where: { username },
    });
  }

  public async verifyCredentials(username: string, password: string): Promise<User | null> {
    const user = await this.findByUsername(username);
    if (!user || user.status !== UserStatus.ACTIVE) {
      return null;
    }
    const isValid = await bcrypt.compare(password, user.passwordHash);
    return isValid ? user : null;
  }
}
