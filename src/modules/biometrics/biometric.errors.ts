import { AppError } from '../../common/errors';
import { BiometricQualityReason } from './biometric.types';

export class BiometricQualityError extends AppError {
  constructor(public readonly reason: BiometricQualityReason, message: string, details: Record<string, any> = {}) {
    super(`Biometric quality check failed: ${reason} - ${message}`, 422, 'BIOMETRIC_QUALITY_FAILED', {
      reason,
      ...details,
    });
  }
}

export class BiometricWorkerError extends AppError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, 500, 'BIOMETRIC_WORKER_ERROR', details);
  }
}

export class EnrollmentSessionError extends AppError {
  constructor(message: string, statusCode: number = 400, details: Record<string, any> = {}) {
    super(message, statusCode, 'ENROLLMENT_SESSION_ERROR', details);
  }
}

export class EnrollmentInconsistentError extends AppError {
  constructor(message: string, details: Record<string, any> = {}) {
    super(message, 422, 'BIOMETRIC_INCONSISTENT_SAMPLES', details);
  }
}
