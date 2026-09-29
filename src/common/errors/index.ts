export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 400, 'VALIDATION_ERROR');
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(id ? `${entity} with ID '${id}' was not found` : `${entity} not found`, 404, 'NOT_FOUND');
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

export class InvalidStateTransitionError extends AppError {
  constructor(fromState: string, toState: string, reason?: string) {
    const detail = reason ? `: ${reason}` : '';
    super(`Invalid transition from ${fromState} to ${toState}${detail}`, 422, 'INVALID_STATE_TRANSITION');
  }
}

export class PermissionDeniedError extends AppError {
  constructor(action: string, role: string) {
    super(`Permission denied: Role '${role}' is not authorized to perform '${action}'`, 403, 'PERMISSION_DENIED');
  }
}

export class AttendanceRuleViolationError extends AppError {
  constructor(message: string) {
    super(message, 422, 'ATTENDANCE_RULE_VIOLATION');
  }
}

export class ConcurrencyConflictError extends AppError {
  constructor(message = 'Concurrent modification detected. Please retry the operation.') {
    super(message, 409, 'CONCURRENCY_CONFLICT');
  }
}

export class DomainIntegrityError extends AppError {
  constructor(message: string) {
    super(message, 422, 'DOMAIN_INTEGRITY_ERROR');
  }
}

