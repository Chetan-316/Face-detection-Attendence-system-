import { describe, it, expect, vi } from 'vitest';
import { StaffRole } from '@prisma/client';
import { ReportService } from '../src/modules/reports/report.service';

function trendFixture() {
  const findMany = vi.fn(async () => []);
  const service = new ReportService({ attendanceSession: { findMany } } as any);
  const actor = {
    id: 'user-warden-1',
    role: StaffRole.WARDEN,
    organizationId: 'org-1',
    hostelId: 'hostel-1',
  } as any;
  return { service, actor, findMany };
}

async function attendanceDateRange(query: { dateFrom?: string; dateTo?: string }) {
  const { service, actor, findMany } = trendFixture();
  await service.getAttendanceTrend(query, actor);
  return findMany.mock.calls[0][0].where.attendanceDate;
}

describe('attendance trend date bounds', () => {
  it('covers exactly the IST days for date-only bounds', async () => {
    const range = await attendanceDateRange({ dateFrom: '2026-10-01', dateTo: '2026-10-19' });

    expect(range.gte).toEqual(new Date('2026-09-30T18:30:00.000Z'));
    expect(range.lt).toEqual(new Date('2026-10-19T18:30:00.000Z'));
    expect(range.lte).toBeUndefined();
  });

  it('does not extend a full-timestamp dateTo into the following IST day', async () => {
    const range = await attendanceDateRange({ dateTo: '2026-10-19T23:59:59.999Z' });

    expect(range.lte).toEqual(new Date('2026-10-19T23:59:59.999Z'));
    expect(range.lt).toBeUndefined();
  });
});
