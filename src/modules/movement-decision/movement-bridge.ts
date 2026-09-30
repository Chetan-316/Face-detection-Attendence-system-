import { EventEmitter } from 'events';
import { RecognitionObservation } from '../recognition/recognition.types';
import { MovementDecisionService } from './movement-decision.service';
import { MovementDecisionResult } from './movement-decision.types';

export class MovementRecognitionBridge extends EventEmitter {
  private activeSubscriptions: Map<string, (obs: RecognitionObservation) => void> = new Map();

  constructor(private readonly decisionService: MovementDecisionService) {
    super();
  }

  /**
   * Evaluates an observation directly and returns the movement decision
   */
  public async processObservation(
    observation: RecognitionObservation
  ): Promise<MovementDecisionResult> {
    const decision = await this.decisionService.evaluateObservation(observation);
    this.emit('movementDecision', { observation, decision });
    return decision;
  }

  /**
   * Attaches bridge listener to a camera recognition session's EventEmitter
   */
  public attachSession(
    cameraId: string,
    sessionEmitter: EventEmitter
  ): () => void {
    // Clean up any existing subscription for this camera to avoid duplicate listeners
    this.detachSession(cameraId, sessionEmitter);

    const listener = async (obs: RecognitionObservation) => {
      // Only process observations that are MATCH and stable
      if (obs.classification === 'MATCH') {
        try {
          const decision = await this.decisionService.evaluateObservation(obs);
          obs.movementDecision = decision;
          this.emit('movementDecision', { cameraId, observation: obs, decision });
        } catch (err) {
          console.error(`[MovementRecognitionBridge] Error processing observation for camera ${cameraId}:`, err);
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
