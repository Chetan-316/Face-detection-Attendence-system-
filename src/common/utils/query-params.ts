import { ValidationError } from '../errors';

/** Returns undefined when absent; throws ValidationError for non-integers or values below `min`. */
export function optionalIntQuery(value: unknown, name: string, min = 1): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new ValidationError(`${name} must be an integer of at least ${min}`);
  }
  return parsed;
}

export function intQuery(value: unknown, name: string, fallback: number, min = 1): number {
  return optionalIntQuery(value, name, min) ?? fallback;
}

/** Returns undefined when absent; throws ValidationError when the value is not a valid date. */
export function optionalDateQuery(value: unknown, name: string): Date | undefined {
  if (value === undefined || value === '') return undefined;
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError(`${name} must be a valid date`);
  }
  return date;
}
