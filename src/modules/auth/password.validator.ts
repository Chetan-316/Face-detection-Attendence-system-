import { ValidationError } from '../../common/errors';

export const MIN_PASSWORD_LENGTH = 8;

export function validatePassword(password: string): void {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
  }
}
