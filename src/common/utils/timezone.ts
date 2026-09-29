import { DateTime } from 'luxon';
import { config } from '../../config';

/**
 * Returns the current date-time in UTC
 */
export function nowUtc(): Date {
  return new Date();
}

/**
 * Converts a UTC Date to a formatted string in the application presentation timezone (Asia/Kolkata)
 */
export function formatInAppTimezone(date: Date, format = 'yyyy-MM-dd HH:mm:ss ZZ'): string {
  return DateTime.fromJSDate(date, { zone: 'utc' })
    .setZone(config.timezone)
    .toFormat(format);
}

/**
 * Parses an ISO string or local date string in the app timezone to a UTC Date
 */
export function parseToUtcDate(dateString: string, zone = config.timezone): Date {
  const dt = DateTime.fromISO(dateString, { zone });
  if (!dt.isValid) {
    throw new Error(`Invalid date string: ${dateString}`);
  }
  return dt.toJSDate();
}

/**
 * Formats a Date as an ISO UTC string
 */
export function toUtcIso(date: Date): string {
  return date.toISOString();
}
