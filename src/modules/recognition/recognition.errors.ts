import { AppError } from '../../common/errors';

export class RecognitionError extends AppError {
  constructor(message: string, statusCode = 500, code = 'RECOGNITION_ERROR', details: Record<string, any> = {}) {
    super(message, statusCode, code, details);
  }
}

export class RecognitionSessionError extends AppError {
  constructor(message: string, statusCode = 400, code = 'RECOGNITION_SESSION_ERROR') {
    super(message, statusCode, code);
  }
}
