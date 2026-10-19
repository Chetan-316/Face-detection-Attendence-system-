import { describe, it, expect } from 'vitest';
import { StaffRole } from '@prisma/client';
import { isWithinHostelScope } from '../src/api/middleware/scope';

describe('isWithinHostelScope (fail-closed hostel scope)', () => {
  it('lets WARDEN and GUARD access only resources in their assigned hostel', () => {
    expect(isWithinHostelScope({ role: StaffRole.WARDEN, hostelId: 'h1' }, 'h1')).toBe(true);
    expect(isWithinHostelScope({ role: StaffRole.GUARD, hostelId: 'h1' }, 'h1')).toBe(true);
    expect(isWithinHostelScope({ role: StaffRole.WARDEN, hostelId: 'h1' }, 'h2')).toBe(false);
    expect(isWithinHostelScope({ role: StaffRole.GUARD, hostelId: 'h1' }, 'h2')).toBe(false);
  });

  it('never grants WARDEN or GUARD access when the actor has no hostel', () => {
    expect(isWithinHostelScope({ role: StaffRole.WARDEN, hostelId: null }, null)).toBe(false);
    expect(isWithinHostelScope({ role: StaffRole.GUARD, hostelId: null }, null)).toBe(false);
    expect(isWithinHostelScope({ role: StaffRole.GUARD, hostelId: undefined }, undefined)).toBe(false);
    expect(isWithinHostelScope({ role: StaffRole.GUARD, hostelId: null }, 'h1')).toBe(false);
  });

  it('treats a missing resource hostel as out of scope for WARDEN and GUARD', () => {
    expect(isWithinHostelScope({ role: StaffRole.WARDEN, hostelId: 'h1' }, null)).toBe(false);
    expect(isWithinHostelScope({ role: StaffRole.GUARD, hostelId: 'h1' }, undefined)).toBe(false);
  });

  it('defers ADMIN to the caller organization check', () => {
    expect(isWithinHostelScope({ role: StaffRole.ADMIN, hostelId: null }, 'h9')).toBe(true);
    expect(isWithinHostelScope({ role: StaffRole.ADMIN, hostelId: 'h1' }, 'h2')).toBe(true);
  });
});
