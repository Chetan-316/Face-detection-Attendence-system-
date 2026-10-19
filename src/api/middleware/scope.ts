import { StaffRole } from '@prisma/client';
import { ForbiddenError } from '../../common/errors';

export function requireHostelScope(user: { role: StaffRole; hostelId?: string | null }): string | undefined {
  if (user.role === StaffRole.ADMIN) return undefined;
  if (!user.hostelId) throw new ForbiddenError('No hostel assigned to this account');
  return user.hostelId;
}

/**
 * Fail-closed hostel scope check for a single resource. ADMIN is organization-scoped
 * and callers must perform their own organization check. WARDEN and GUARD must have an
 * assigned hostel that matches the resource; a null assignment never matches.
 */
export function isWithinHostelScope(
  actor: { role: StaffRole; hostelId?: string | null },
  resourceHostelId: string | null | undefined
): boolean {
  if (actor.role === StaffRole.ADMIN) return true;
  return Boolean(actor.hostelId) && actor.hostelId === resourceHostelId;
}
