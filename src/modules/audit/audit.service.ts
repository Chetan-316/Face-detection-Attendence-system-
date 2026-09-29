import { Prisma, PrismaClient, AuditAction, StaffRole } from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';

export interface AuditLogInput {
  organizationId: string;
  hostelId?: string | null;
  entityType: string;
  entityId: string;
  action: AuditAction;
  performedByUserId?: string | null;
  performedByRole?: StaffRole | null;
  reason?: string | null;
  oldValues?: Record<string, any> | null;
  newValues?: Record<string, any> | null;
  ipAddress?: string | null;
}

const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'token',
  'refreshtoken',
  'jwt',
  'secret',
  'rawtemplate',
  'embedding',
  'facetemplate',
  'camerapassword',
]);

/**
 * Recursively redacts sensitive keys from audit payloads
 */
function sanitizeAuditPayload(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;

  if (Array.isArray(obj)) {
    return obj.map(sanitizeAuditPayload);
  }

  const sanitized: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeAuditPayload(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

export class AuditService {
  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  public async record(
    input: AuditLogInput,
    tx?: Prisma.TransactionClient
  ) {
    const client = tx || this.db;

    const sanitizedOldValues = input.oldValues ? sanitizeAuditPayload(input.oldValues) : undefined;
    const sanitizedNewValues = input.newValues ? sanitizeAuditPayload(input.newValues) : undefined;

    return client.auditLog.create({
      data: {
        organizationId: input.organizationId,
        hostelId: input.hostelId || null,
        entityType: input.entityType,
        entityId: input.entityId,
        action: input.action,
        performedByUserId: input.performedByUserId || null,
        performedByRole: input.performedByRole || null,
        reason: input.reason || null,
        oldValues: sanitizedOldValues ? (sanitizedOldValues as Prisma.InputJsonValue) : Prisma.JsonNull,
        newValues: sanitizedNewValues ? (sanitizedNewValues as Prisma.InputJsonValue) : Prisma.JsonNull,
        ipAddress: input.ipAddress || null,
      },
    });
  }

  public async getHistoryForEntity(entityType: string, entityId: string) {
    return this.db.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { timestamp: 'desc' },
      include: {
        performedBy: {
          select: {
            id: true,
            username: true,
            fullName: true,
            role: true,
          },
        },
      },
    });
  }
}
