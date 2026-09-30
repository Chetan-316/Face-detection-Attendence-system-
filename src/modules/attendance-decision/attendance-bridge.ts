import { EventEmitter } from 'events';
import { RecognitionObservation } from '../recognition/recognition.types';
import { AttendanceDecisionService } from './attendance-decision.service';
import { AttendanceDecisionResult } from './attendance-decision.types';
import { CameraRole } from '@prisma/client';

export class AttendanceRecognitionBridge extends EventEmitter {
  private activeSubscriptions: Map<string, (obs: RecognitionObservation) => void> = new Map();

  constructor(private readonly decisionService: AttendanceDecisionService) {
    super();
  }

  /**
   * Evaluates an observation directly and returns the attendance decision
   */
  public async processObservation(
    observation: RecognitionObservation
  ): Promise<AttendanceDecisionResult> {
    const decision = await this.decisionService.evaluateObservation(observation);
    this.emit('attendanceDecision', { observation, decision });
    return decision;
  }

  /**
   * Attaches bridge listener to a camera recognition session's EventEmitter.
   * Only processes observations if camera role is ATTENDANCE.
   */
  public attachSession(
    cameraId: string,
    cameraRole: CameraRole,
    sessionEmitter: EventEmitter
  ): () => void {
    // If not an ATTENDANCE camera, do not attach attendance listener (MovementIsolation)
    if (cameraRole !== CameraRole.ATTENDANCE) {
      return () => {};
    }

    // Clean up any existing subscription for this camera to avoid duplicate listeners
    this.detachSession(cameraId, sessionEmitter);

    const listener = async (obs: RecognitionObservation) => {
      // Only process observations that are MATCH and stable
      if (obs.classification === 'MATCH') {
        try {
          const decision = await this.decisionService.evaluateObservation(obs);
          obs.attendanceDecision = decision;
          this.emit('attendanceDecision', { cameraId, observation: obs, decision });
        } catch (err) {
          console.error(`[AttendanceRecognitionBridge] Error processing observation for camera ${cameraId}:`, err);
        }
      }
    };

    sessionEmitter.on('stableMatch', listener);
    this.activeSubscriptions.set(cameraId, listener);

    return () => {
      this.detachSession(cameraId, sessionEmitter);
    };
  }

  /**
   * Detaches bridge listener from a camera session
   */
  public detachSession(cameraId: string, sessionEmitter?: EventEmitter): void {
    const listener = this.activeSubscriptions.get(cameraId);
    if (listener && sessionEmitter) {
      sessionEmitter.off('stableMatch', listener);
    }
    this.activeSubscriptions.delete(cameraId);
  }

  /**
   * Clean up all active subscriptions
   */
  public destroy(): void {
    this.activeSubscriptions.clear();
    this.removeAllListeners();
  }
}
