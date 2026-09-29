import { StaffRole } from '@prisma/client';
import { PermissionDeniedError } from '../../common/errors';

export type ActionName =
  | 'MOVEMENT_NORMAL_RECORD'
  | 'MOVEMENT_CORRECTION_MISSED_IN'
  | 'MOVEMENT_CORRECTION_MISSED_OUT'
  | 'MOVEMENT_DELETE'
  | 'MOVEMENT_BYPASS_STATE'
  | 'ATTENDANCE_SESSION_CREATE'
  | 'ATTENDANCE_SESSION_START'
  | 'ATTENDANCE_SESSION_CLOSE'
  | 'ATTENDANCE_NORMAL_MARK'
  | 'ATTENDANCE_FORCE_PRESENT_WHEN_OUT'
  | 'ATTENDANCE_CORRECTION'
  | 'NIGHT_ATTENDANCE_REVIEW_INCONSISTENCY'
  | 'RESIDENT_MANAGE'
  | 'CAMERA_MANAGE'
  | 'USER_MANAGE';

const ROLE_PERMISSIONS: Record<StaffRole, Set<ActionName>> = {
  ADMIN: new Set<ActionName>([
    'MOVEMENT_NORMAL_RECORD',
    'MOVEMENT_CORRECTION_MISSED_IN',
    'MOVEMENT_CORRECTION_MISSED_OUT',
    'ATTENDANCE_SESSION_CREATE',
    'ATTENDANCE_SESSION_START',
    'ATTENDANCE_SESSION_CLOSE',
    'ATTENDANCE_NORMAL_MARK',
    'ATTENDANCE_CORRECTION',
    'NIGHT_ATTENDANCE_REVIEW_INCONSISTENCY',
    'RESIDENT_MANAGE',
    'CAMERA_MANAGE',
    'USER_MANAGE',
  ]),
  WARDEN: new Set<ActionName>([
    'MOVEMENT_NORMAL_RECORD',
    'MOVEMENT_CORRECTION_MISSED_IN',
    'MOVEMENT_CORRECTION_MISSED_OUT',
    'ATTENDANCE_SESSION_CREATE',
    'ATTENDANCE_SESSION_START',
    'ATTENDANCE_SESSION_CLOSE',
    'ATTENDANCE_NORMAL_MARK',
    'ATTENDANCE_CORRECTION',
    'NIGHT_ATTENDANCE_REVIEW_INCONSISTENCY',
    'RESIDENT_MANAGE',
  ]),
  GUARD: new Set<ActionName>([
    'MOVEMENT_NORMAL_RECORD',
    // Guard is explicitly forbidden from corrections, deleting, bypassing, or forcing attendance
  ]),
};

export function hasPermission(role: StaffRole, action: ActionName): boolean {
  const allowed = ROLE_PERMISSIONS[role];
  return allowed ? allowed.has(action) : false;
}

export function assertPermission(role: StaffRole, action: ActionName): void {
  if (!hasPermission(role, action)) {
    throw new PermissionDeniedError(action, role);
  }
}

export interface StaffActor {
  id: string;
  organizationId: string;
  hostelId?: string | null;
  role: StaffRole;
}

export function assertUserCanOperateInOrganization(
  actor: StaffActor,
  targetOrganizationId: string
): void {
  if (actor.organizationId !== targetOrganizationId) {
    throw new PermissionDeniedError(
      `Operate in organization '${targetOrganizationId}' (actor belongs to '${actor.organizationId}')`,
      actor.role
    );
  }
}

export function assertUserCanOperateInHostel(
  actor: StaffActor,
  targetOrganizationId: string,
  targetHostelId: string
): void {
  assertUserCanOperateInOrganization(actor, targetOrganizationId);

  if (actor.role === StaffRole.GUARD || actor.role === StaffRole.WARDEN) {
    if (!actor.hostelId || actor.hostelId !== targetHostelId) {
      throw new PermissionDeniedError(
        `Operate in hostel '${targetHostelId}' (actor assigned to '${actor.hostelId || 'unassigned'}')`,
        actor.role
      );
    }
  } else if (actor.role === StaffRole.ADMIN && actor.hostelId && actor.hostelId !== targetHostelId) {
    throw new PermissionDeniedError(
      `Operate in hostel '${targetHostelId}' (admin assigned specifically to '${actor.hostelId}')`,
      actor.role
    );
  }
}

