import { MovementType, PresenceState } from '@prisma/client';

export type MovementDecisionStatus =
  | 'MOVEMENT_CREATED'
  | 'ALREADY_IN'
  | 'ALREADY_OUT'
  | 'TRANSITION_SUPPRESSED'
  | 'DUPLICATE_OBSERVATION_SUPPRESSED'
  | 'CAMERA_NOT_MOVEMENT_CAPABLE'
  | 'RESIDENT_INACTIVE'
  | 'RESIDENT_NOT_ENROLLED'
  | 'CROSS_HOSTEL_MISMATCH'
  | 'AUTOMATION_DISABLED'
  | 'INITIAL_PRESENCE_MISSING'
  | 'NO_MATCH'
  | 'ERROR';

export interface MovementDecisionResult {
  status: MovementDecisionStatus;
  direction?: MovementType;
  movementEventId?: string;
  residentId?: string;
  residentCode?: string;
  residentName?: string;
  previousPresence?: PresenceState;
  currentPresence?: PresenceState;
  cameraId: string;
  cameraRole?: string;
  timestamp: string;
  reason?: string;
}

export interface MovementAutomationConfig {
  globalEnabled: boolean;
  minTransitionIntervalMs: number;
}
