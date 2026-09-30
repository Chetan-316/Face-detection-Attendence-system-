import { AppError } from '../../common/errors';

export class MovementAutomationDisabledError extends AppError {
  constructor(message = 'Movement automation is disabled') {
    super(message, 400, 'MOVEMENT_AUTOMATION_DISABLED');
  }
}

export class CameraNotMovementCapableError extends AppError {
  constructor(role: string) {
    super(
      `Camera role '${role}' cannot be used for automatic movement recording`,
      400,
      'CAMERA_NOT_MOVEMENT_CAPABLE'
    );
  }
}
