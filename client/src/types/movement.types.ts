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
  direction?: 'IN' | 'OUT';
  movementEventId?: string;
  residentId?: string;
  residentCode?: string;
  residentName?: string;
  previousPresence?: 'IN' | 'OUT';
  currentPresence?: 'IN' | 'OUT';
  cameraId: string;
  cameraRole?: string;
  timestamp: string;
  reason?: string;
}

export interface MovementEventEntity {
  id: string;
  residentId: string;
  hostelId: string;
  locationId?: string | null;
  cameraId?: string | null;
  movementType: 'IN' | 'OUT';
  source: string;
  effectiveTimestamp: string;
  recordedTimestamp: string;
  notes?: string | null;
  recognitionReference?: string | null;
  resident?: {
    id: string;
    residentCode: string;
    fullName: string;
    roomGroup: string;
    status: string;
  };
  camera?: {
    id: string;
    name: string;
    role: string;
  } | null;
  location?: {
    id: string;
    name: string;
    code: string;
  } | null;
}

export interface PresenceCounts {
  totalResidents: number;
  currentlyIn: number;
  currentlyOut: number;
}

export interface AutomationStatus {
  globalAutomationEnabled: boolean;
  minTransitionIntervalMs: number;
}
