import { describe, it, expect } from 'vitest';
import { ValidationError } from '../src/common/errors';
import {
  buildBusinessDayRange,
  istDayRange,
  istNextDayStart,
  istStartOfDay,
} from '../src/common/utils/business-day';
import { istDayKey, toMismatch } from '../scripts/dry-run-session-attendance-dates';

describe('business-day (Asia/Kolkata, fixed UTC+05:30)', () => {
  it('maps a date-only string to IST midnight, i.e. 18:30Z of the previous UTC day', () => {
    expect(istStartOfDay('2026-10-17').toISOString()).toBe('2026-10-16T18:30:00.000Z');
    expect(istStartOfDay('2026-01-01').toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  it('treats the end of a day as exclusive: the next IST midnight', () => {
    expect(istNextDayStart('2026-10-17').toISOString()).toBe('2026-10-17T18:30:00.000Z');
    expect(istNextDayStart('2026-10-31').toISOString()).toBe('2026-10-31T18:30:00.000Z');
  });

  it('istDayRange covers exactly one IST day with an exclusive upper bound', () => {
    const range = istDayRange('2026-10-17');
    expect(range.gte.toISOString()).toBe('2026-10-16T18:30:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-10-17T18:30:00.000Z');
    // Last IST millisecond of the day is inside; the first millisecond of the next day is outside.
    const lastMs = new Date('2026-10-17T18:29:59.999Z').getTime();
    expect(lastMs).toBeGreaterThanOrEqual(range.gte.getTime());
    expect(lastMs).toBeLessThan(range.lt.getTime());
    expect(new Date('2026-10-17T18:30:00.000Z').getTime()).toBeGreaterThanOrEqual(range.lt.getTime());
  });

  it('keeps UTC-evening instants on the correct IST business day', () => {
    // 2026-10-16T19:00Z is 2026-10-17 00:30 IST: belongs to the 17th, not the 16th.
    const range17 = istDayRange('2026-10-17');
    const instant = new Date('2026-10-16T19:00:00.000Z').getTime();
    expect(instant).toBeGreaterThanOrEqual(range17.gte.getTime());
    expect(instant).toBeLessThan(range17.lt.getTime());
  });

  it('accepts leap days and rejects non-existent calendar dates', () => {
    expect(istStartOfDay('2024-02-29').toISOString()).toBe('2024-02-28T18:30:00.000Z');
    expect(() => istStartOfDay('2026-02-30')).toThrow(ValidationError);
    expect(() => istStartOfDay('2026-13-01')).toThrow(ValidationError);
    expect(() => istStartOfDay('2026-00-10')).toThrow(ValidationError);
    expect(() => istStartOfDay('2025-02-29')).toThrow(ValidationError);
  });

  it('rejects malformed date strings with ValidationError (400, VALIDATION_ERROR)', () => {
    for (const bad of ['17-10-2026', '2026/10/17', '2026-10-17T00:00:00Z', 'not-a-date', '2026-1-7']) {
      let caught: unknown;
      try {
        istStartOfDay(bad, 'dateFrom');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ValidationError);
      expect((caught as ValidationError).statusCode).toBe(400);
      expect((caught as ValidationError).code).toBe('VALIDATION_ERROR');
      expect((caught as ValidationError).message).toContain('dateFrom');
    }
  });

  it('buildBusinessDayRange: date-only dateFrom/dateTo use IST start and exclusive IST end', () => {
    const range = buildBusinessDayRange('2026-10-01', '2026-10-17');
    expect(range).toEqual({
      gte: new Date('2026-09-30T18:30:00.000Z'),
      lt: new Date('2026-10-17T18:30:00.000Z'),
    });
    expect(range.lte).toBeUndefined();
  });

  it('buildBusinessDayRange: full timestamps keep their exact instant (dateTo stays inclusive lte)', () => {
    const range = buildBusinessDayRange('2026-08-01T00:00:00.000Z', '2026-08-30T00:00:00.000Z');
    expect(range).toEqual({
      gte: new Date('2026-08-01T00:00:00.000Z'),
      lte: new Date('2026-08-30T00:00:00.000Z'),
    });
  });

  it('buildBusinessDayRange: omitted or empty bounds are left out of the filter', () => {
    expect(buildBusinessDayRange(undefined, undefined)).toEqual({});
    expect(buildBusinessDayRange('2026-10-17', undefined)).toEqual({
      gte: new Date('2026-10-16T18:30:00.000Z'),
    });
    expect(buildBusinessDayRange(undefined, '2026-10-17')).toEqual({
      lt: new Date('2026-10-17T18:30:00.000Z'),
    });
  });

  it('buildBusinessDayRange: invalid values are rejected with ValidationError, naming the field', () => {
    expect(() => buildBusinessDayRange('2026-02-30', undefined)).toThrow(ValidationError);
    expect(() => buildBusinessDayRange(undefined, 'garbage')).toThrow(/dateTo must be a valid date/);
    expect(() => buildBusinessDayRange('2026-10-17', '2026-13-40')).toThrow(ValidationError);
  });
});

describe('dry-run-session-attendance-dates: mismatch detection', () => {
  const base = { id: 's1', hostelId: 'h1', sessionType: 'MORNING', status: 'CLOSED' };

  it('computes the IST day of an instant', () => {
    expect(istDayKey(new Date('2026-10-16T18:29:59.999Z'))).toBe('2026-10-16');
    expect(istDayKey(new Date('2026-10-16T18:30:00.000Z'))).toBe('2026-10-17');
  });

  it('returns null when attendanceDate is on the same IST day as startTime', () => {
    expect(
      toMismatch({
        ...base,
        startTime: new Date('2026-10-17T03:00:00.000Z'), // 08:30 IST on the 17th
        attendanceDate: new Date('2026-10-16T18:30:00.000Z'), // IST midnight of the 17th
      })
    ).toBeNull();
  });

  it('flags a UTC-midnight attendanceDate and proposes IST start-of-day of startTime', () => {
    const row = toMismatch({
      ...base,
      startTime: new Date('2026-10-17T03:00:00.000Z'), // 08:30 IST on the 17th
      attendanceDate: new Date('2026-10-16T00:00:00.000Z'), // 05:30 IST on the 16th -> old IST day 16th
    });
    expect(row).not.toBeNull();
    expect(row!.oldIstDay).toBe('2026-10-16');
    expect(row!.startIstDay).toBe('2026-10-17');
    expect(row!.proposedAttendanceDate).toBe('2026-10-16T18:30:00.000Z');
    expect(row!.oldAttendanceDate).toBe('2026-10-16T00:00:00.000Z');
  });

  it('flags sessions started just after IST midnight that were stored on the previous day', () => {
    const row = toMismatch({
      ...base,
      startTime: new Date('2026-10-16T19:00:00.000Z'), // 00:30 IST on the 17th
      attendanceDate: new Date('2026-10-15T18:30:00.000Z'), // IST midnight of the 16th
    });
    expect(row!.proposedAttendanceDate).toBe('2026-10-16T18:30:00.000Z');
  });
});
