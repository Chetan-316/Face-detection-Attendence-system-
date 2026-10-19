import { ValidationError } from '../errors';

/**
 * Hostel business days are Asia/Kolkata calendar days. IST has no DST, so the offset is a constant
 * and every helper here is plain fixed-offset arithmetic (no date library, no process-timezone dependence).
 */
export const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface DateRangeWhere {
  gte?: Date;
  lt?: Date;
  lte?: Date;
}

export function isDateOnlyString(value: string): boolean {
  return DATE_ONLY_PATTERN.test(value);
}

/**
 * Returns the UTC instant of IST midnight at the start of the given YYYY-MM-DD business day.
 * Throws ValidationError for malformed strings and non-existent calendar dates (e.g. 2026-02-30).
 */
export function istStartOfDay(value: string, name = 'date'): Date {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new ValidationError(`${name} must be a date in YYYY-MM-DD format`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const utcMidnight = Date.UTC(year, month - 1, day);
  const check = new Date(utcMidnight);
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    throw new ValidationError(`${name} must be a valid calendar date`);
  }
  return new Date(utcMidnight - IST_OFFSET_MS);
}

/** Returns the UTC instant of IST midnight at the start of the NEXT business day (exclusive end bound). */
export function istNextDayStart(value: string, name = 'date'): Date {
  return new Date(istStartOfDay(value, name).getTime() + MS_PER_DAY);
}

/** Prisma range covering one whole IST business day: gte IST midnight, lt next IST midnight. */
export function istDayRange(value: string, name = 'date'): { gte: Date; lt: Date } {
  const start = istStartOfDay(value, name);
  return { gte: start, lt: new Date(start.getTime() + MS_PER_DAY) };
}

function parseInstant(value: string, name: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${name} must be a valid date`);
  }
  return date;
}

/**
 * Builds a Prisma range filter from optional dateFrom / dateTo query values.
 * - Date-only values (YYYY-MM-DD) are IST business days: dateFrom starts at IST midnight (gte);
 *   dateTo covers the whole IST day via an exclusive bound at the next IST midnight (lt).
 * - Full timestamps keep their exact instant: dateFrom -> gte, dateTo -> lte.
 */
export function buildBusinessDayRange(
  dateFrom: string | undefined,
  dateTo: string | undefined,
  names: { from: string; to: string } = { from: 'dateFrom', to: 'dateTo' }
): DateRangeWhere {
  const range: DateRangeWhere = {};
  if (dateFrom) {
    range.gte = isDateOnlyString(dateFrom)
      ? istStartOfDay(dateFrom, names.from)
      : parseInstant(dateFrom, names.from);
  }
  if (dateTo) {
    if (isDateOnlyString(dateTo)) {
      range.lt = istNextDayStart(dateTo, names.to);
    } else {
      range.lte = parseInstant(dateTo, names.to);
    }
  }
  return range;
}
