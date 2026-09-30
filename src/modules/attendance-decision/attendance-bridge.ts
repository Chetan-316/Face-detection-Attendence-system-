import { EventEmitter } from 'events';
import { RecognitionObservation } from '../recognition/recognition.types';
import { AttendanceDecisionService } from './attendance-decision.service';
import { AttendanceDecisionResult } from './attendance-decision.types';
import { CameraRole } from '@prisma/client';

export class AttendanceRecognitionBridge extends EventEmitter {
  private activeSubscriptions: Map<
    string,
    { listener: (obs: RecognitionObservation) => void; emitter: EventEmitter }
  > = new Map();

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
    this.activeSubscriptions.set(cameraId, { listener, emitter: sessionEmitter });

    return () => {
      this.detachSession(cameraId, sessionEmitter);
    };
  }

  /**
   * Detaches bridge listener from a camera session
   */
  public detachSession(cameraId: string, sessionEmitter?: EventEmitter): void {
    const sub = this.activeSubscriptions.get(cameraId);
    if (sub) {
      const emitterToUse = sessionEmitter || sub.emitter;
      emitterToUse.off('stableMatch', sub.listener);
      if (sub.emitter && sub.emitter !== emitterToUse) {
        sub.emitter.off('stableMatch', sub.listener);
      }
      this.activeSubscriptions.delete(cameraId);
    }
  }

  /**
   * Returns current active subscription count
   */
  public getActiveSubscriptionCount(): number {
    return this.activeSubscriptions.size;
  }

  /**
   * Checks if camera has an active subscription
   */
  public hasSubscription(cameraId: string): boolean {
    return this.activeSubscriptions.has(cameraId);
  }

  /**
   * Clean up all active subscriptions
   */
  public destroy(): void {
    for (const [, sub] of this.activeSubscriptions.entries()) {
      sub.emitter.off('stableMatch', sub.listener);
    }
    this.activeSubscriptions.clear();
    this.removeAllListeners();
  }
}
