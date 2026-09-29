import { FaceEnrollmentStatus, PresenceState, ResidentStatus } from '../types/resident.types';
import { StaffRole } from '../types/auth.types';

export function formatDate(dateString?: string | null): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

export function formatDateTime(dateString?: string | null): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export function formatRole(role: StaffRole): string {
  switch (role) {
    case 'ADMIN':
      return 'Administrator';
    case 'WARDEN':
      return 'Hostel Warden';
    case 'GUARD':
      return 'Gate Guard';
    default:
      return role;
  }
}

export function formatPresence(state?: PresenceState | null): string {
  if (!state) return 'UNKNOWN';
  return state === 'IN' ? 'IN HOSTEL' : 'OUTSIDE';
}

export function formatEnrollment(status?: FaceEnrollmentStatus | null): string {
  switch (status) {
    case 'ENROLLED':
      return 'Enrolled';
    case 'NOT_ENROLLED':
      return 'Not Enrolled';
    case 'NEEDS_REENROLLMENT':
      return 'Needs Re-enrollment';
    case 'REVOKED':
      return 'Revoked';
    default:
      return 'Not Enrolled';
  }
}

export function formatResidentStatus(status?: ResidentStatus | null): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'INACTIVE':
      return 'Inactive';
    case 'SUSPENDED':
      return 'Suspended';
    case 'ARCHIVED':
      return 'Archived';
    default:
      return 'Active';
  }
}
