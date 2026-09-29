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
  let label = String(value);

  // Presence Badges
  if (value === 'IN') {
    badgeClass = 'badge-presence-in';
    label = 'IN HOSTEL';
  } else if (value === 'OUT') {
    badgeClass = 'badge-presence-out';
    label = 'OUTSIDE';
  }

  // Face Enrollment Badges
  else if (value === 'ENROLLED') {
    badgeClass = 'badge-enroll-enrolled';
    label = 'ENROLLED';
  } else if (value === 'NOT_ENROLLED') {
    badgeClass = 'badge-enroll-not';
    label = 'NOT ENROLLED';
  } else if (value === 'NEEDS_REENROLLMENT') {
    badgeClass = 'badge-enroll-needs';
    label = 'NEEDS RE-ENROLLMENT';
  } else if (value === 'REVOKED') {
    badgeClass = 'badge-enroll-revoked';
    label = 'REVOKED';
  }

  // Resident Account Status Badges
  else if (value === 'ACTIVE') {
    badgeClass = 'badge-status-active';
    label = 'ACTIVE';
  } else if (value === 'INACTIVE') {
    badgeClass = 'badge-status-inactive';
    label = 'INACTIVE';
  } else if (value === 'SUSPENDED') {
    badgeClass = 'badge-status-suspended';
    label = 'SUSPENDED';
  } else if (value === 'ARCHIVED') {
    badgeClass = 'badge-status-archived';
    label = 'ARCHIVED';
  }

  // Staff Role Badges
  else if (value === 'ADMIN') {
    badgeClass = 'badge-role-admin';
    label = 'ADMIN';
  } else if (value === 'WARDEN') {
    badgeClass = 'badge-role-warden';
    label = 'WARDEN';
  } else if (value === 'GUARD') {
    badgeClass = 'badge-role-guard';
    label = 'GUARD';
  }

  return (
    <span className={`badge badge-${size} ${badgeClass}`}>
      <span className="badge-dot" aria-hidden="true" />
      <span className="badge-text">{label}</span>
    </span>
  );
};
