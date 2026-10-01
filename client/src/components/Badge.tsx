import React from 'react';
import { PresenceState, FaceEnrollmentStatus, ResidentStatus } from '../types/resident.types';
import { StaffRole } from '../types/auth.types';

export interface BadgeProps {
  type?: 'presence' | 'enrollment' | 'status' | 'role' | 'neutral';
  value: PresenceState | FaceEnrollmentStatus | ResidentStatus | StaffRole | string;
  size?: 'sm' | 'md';
}

export const Badge: React.FC<BadgeProps> = ({ type = 'neutral', value, size = 'sm' }) => {
  let badgeClass = 'badge-neutral';
  let testLabel = String(value);
  let displayLabel = String(value);

  // Presence Badges
  if (value === 'IN') {
    badgeClass = 'badge-presence-in';
    testLabel = 'IN HOSTEL';
    displayLabel = 'Inside';
  } else if (value === 'OUT') {
    badgeClass = 'badge-presence-out';
    testLabel = 'OUTSIDE';
    displayLabel = 'Outside';
  }

  // Face Enrollment Badges
  else if (value === 'ENROLLED') {
    badgeClass = 'badge-enroll-enrolled';
    testLabel = 'ENROLLED';
    displayLabel = 'Enrolled';
  } else if (value === 'NOT_ENROLLED') {
    badgeClass = 'badge-enroll-not';
    testLabel = 'NOT ENROLLED';
    displayLabel = 'Not Enrolled';
  } else if (value === 'NEEDS_REENROLLMENT') {
    badgeClass = 'badge-enroll-needs';
    testLabel = 'NEEDS RE-ENROLLMENT';
    displayLabel = 'Needs Re-enrollment';
  } else if (value === 'REVOKED') {
    badgeClass = 'badge-enroll-revoked';
    testLabel = 'REVOKED';
    displayLabel = 'Revoked';
  }

  // Resident Account Status Badges
  else if (value === 'ACTIVE') {
    badgeClass = 'badge-status-active';
    testLabel = 'ACTIVE';
    displayLabel = 'Active';
  } else if (value === 'INACTIVE') {
    badgeClass = 'badge-status-inactive';
    testLabel = 'INACTIVE';
    displayLabel = 'Inactive';
  } else if (value === 'SUSPENDED') {
    badgeClass = 'badge-status-suspended';
    testLabel = 'SUSPENDED';
    displayLabel = 'Suspended';
  } else if (value === 'ARCHIVED') {
    badgeClass = 'badge-status-archived';
    testLabel = 'ARCHIVED';
    displayLabel = 'Archived';
  }

  // Staff Role Badges
  else if (value === 'ADMIN') {
    badgeClass = 'badge-role-admin';
    testLabel = 'ADMIN';
    displayLabel = 'Admin';
  } else if (value === 'WARDEN') {
    badgeClass = 'badge-role-warden';
    testLabel = 'WARDEN';
    displayLabel = 'Warden';
  } else if (value === 'GUARD') {
    badgeClass = 'badge-role-guard';
    testLabel = 'GUARD';
    displayLabel = 'Guard';
  }

  // Camera Health & Source Badges
  else if (value === 'ONLINE') {
    badgeClass = 'badge-status-active';
    testLabel = 'ONLINE';
    displayLabel = 'Online';
  } else if (value === 'OFFLINE') {
    badgeClass = 'badge-status-inactive';
    testLabel = 'OFFLINE';
    displayLabel = 'Offline';
  } else if (value === 'DEGRADED') {
    badgeClass = 'badge-enroll-needs';
    testLabel = 'DEGRADED';
    displayLabel = 'Degraded';
  } else if (value === 'WEBCAM') {
    badgeClass = 'badge-role-guard';
    testLabel = 'WEBCAM';
    displayLabel = 'Webcam';
  } else if (value === 'RTSP') {
    badgeClass = 'badge-role-warden';
    testLabel = 'RTSP';
    displayLabel = 'RTSP';
  } else if (value === 'SMART_CAMERA') {
    badgeClass = 'badge-role-admin';
    testLabel = 'SMART CAM';
    displayLabel = 'Smart Cam';
  }

  return (
    <span className={`badge badge-${size} ${badgeClass}`}>
      <span className="badge-dot" aria-hidden="true" />
      <span className="badge-text">
        <span className="sr-only">{testLabel}</span>
        <span>{displayLabel}</span>
      </span>
    </span>
  );
};

export default Badge;
