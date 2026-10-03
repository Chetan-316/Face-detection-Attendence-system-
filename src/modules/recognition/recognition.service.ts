import { PrismaClient, StaffRole, CameraRole, CameraSourceType } from '@prisma/client';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { prisma as defaultPrisma } from '../../database/client';
import { NotFoundError, ValidationError, ForbiddenError } from '../../common/errors';
import { CameraService } from '../cameras/camera.service';
import { CameraFrame } from '../cameras/camera.types';
import { PythonWorkerClient, defaultPythonWorkerClient } from '../biometrics/python-worker-client';
import { TemplateCache, defaultTemplateCache } from './template-cache';
import { TemplateMatcher } from './template-matcher';
import { TemporalStabilizer } from './temporal-stabilizer';
import {
  RecognitionObservation,
  RecognitionSessionState,
  RecognitionSessionStatus,
  MatcherThresholds,
} from './recognition.types';
import { MovementRecognitionBridge } from '../movement-decision/movement-bridge';
import { AttendanceRecognitionBridge } from '../attendance-decision/attendance-bridge';
import { config } from '../../config';

export interface AuthenticatedActor {
  id: string;
  role: StaffRole;
  organizationId: string;
  hostelId?: string | null;
}

export interface ActiveCameraSession {
  sessionId: string;
  cameraId: string;
  hostelId: string;
  organizationId: string;
  state: RecognitionSessionState;
  startedAt: Date;
  unsubscribeStream?: () => void;
  stabilizer: TemporalStabilizer;
  matcher: TemplateMatcher;
  recentObservations: RecognitionObservation[];
  framesProcessed: number;
  facesDetected: number;
  matches: number;
  uncertains: number;
  unknowns: number;
  qualityInsufficients: number;
  lastProcessedAt: Date | null;
  lastError: string | null;
  lastFrameProcessedTimestamp: number;
  isProcessingFrame: boolean;
  fpsWindow: number[];
  eventEmitter: EventEmitter;
}

export class RecognitionService {
  private activeSessions: Map<string, ActiveCameraSession> = new Map(); // cameraId -> ActiveCameraSession
  private cameraService: CameraService;
  private templateCache: TemplateCache;
  private workerClient: PythonWorkerClient;
  private defaultMaxFps: number;
  private defaultHistoryLimit: number;
  private movementBridge?: MovementRecognitionBridge;
  private attendanceBridge?: AttendanceRecognitionBridge;

  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    cameraService?: CameraService,
    templateCache?: TemplateCache,
    workerClient?: PythonWorkerClient,
    options?: {
      maxFps?: number;
      historyLimit?: number;
      movementBridge?: MovementRecognitionBridge;
      attendanceBridge?: AttendanceRecognitionBridge;
    }
  ) {
    this.cameraService = cameraService || new CameraService(this.db);
    this.templateCache = templateCache || defaultTemplateCache;
    this.workerClient = workerClient || defaultPythonWorkerClient;
    this.defaultMaxFps = options?.maxFps ?? config.recognition.maxFps;
    this.defaultHistoryLimit = options?.historyLimit ?? config.recognition.historyLimit;
    this.movementBridge = options?.movementBridge;
    this.attendanceBridge = options?.attendanceBridge;
  }

  public setMovementBridge(bridge: MovementRecognitionBridge): void {
    this.movementBridge = bridge;
  }

  public getMovementBridge(): MovementRecognitionBridge | undefined {
    return this.movementBridge;
  }

  public setAttendanceBridge(bridge: AttendanceRecognitionBridge): void {
    this.attendanceBridge = bridge;
  }

  public getAttendanceBridge(): AttendanceRecognitionBridge | undefined {
    return this.attendanceBridge;
  }

  /**
   * Helper to retrieve active session for inspection & testing
   */
  public getActiveSession(cameraId: string): ActiveCameraSession | undefined {
    return this.activeSessions.get(cameraId);
  }

  /**
   * Deterministically handles camera role changes or camera deactivation (Req 18, 19).
   * Prevents stale business listener routing and guarantees immediate cessation on disable.
   */
  public async handleCameraChange(
    updatedCamera: { id: string; role: CameraRole; isEnabled: boolean },
    previousRole?: CameraRole
  ): Promise<void> {
    const session = this.activeSessions.get(updatedCamera.id);
    if (!session) return;

    if (!updatedCamera.isEnabled) {
      // Camera disabled: stop recognition immediately and detach bridges
      if (session.unsubscribeStream) {
        try {
          session.unsubscribeStream();
        } catch (e) {}
        session.unsubscribeStream = undefined;
      }
      this.movementBridge?.detachSession(updatedCamera.id, session.eventEmitter);
      this.attendanceBridge?.detachSession(updatedCamera.id, session.eventEmitter);
      session.state = 'STOPPED';
      session.isProcessingFrame = false;
      session.stabilizer.clear();
      session.eventEmitter.emit('stopped');
      session.eventEmitter.removeAllListeners();
      this.activeSessions.delete(updatedCamera.id);
      return;
    }

    if (previousRole && previousRole !== updatedCamera.role) {
      // Deterministic role change: safely detach old bridge listeners first
      this.movementBridge?.detachSession(updatedCamera.id, session.eventEmitter);
      this.attendanceBridge?.detachSession(updatedCamera.id, session.eventEmitter);

      // Reattach to appropriate bridge according to new role
      if ((updatedCamera.role === CameraRole.IN || updatedCamera.role === CameraRole.OUT) && this.movementBridge) {
        this.movementBridge.attachSession(updatedCamera.id, session.eventEmitter);
        const onMovementDecision = ({ observation, decision }: { observation: any; decision: any }) => {
          const stored = session.recentObservations.find((o) => o.id === observation.id);
          if (stored) {
            stored.movementDecision = decision;
          }
          session.eventEmitter.emit('observation', { ...observation, movementDecision: decision });
        };
        this.movementBridge.on('movementDecision', onMovementDecision);
      } else if (updatedCamera.role === CameraRole.ATTENDANCE && this.attendanceBridge) {
        this.attendanceBridge.attachSession(updatedCamera.id, updatedCamera.role, session.eventEmitter);
        const onAttendanceDecision = ({ observation, decision }: { observation: any; decision: any }) => {
          const stored = session.recentObservations.find((o) => o.id === observation.id);
          if (stored) {
            stored.attendanceDecision = decision;
          }
          session.eventEmitter.emit('observation', { ...observation, attendanceDecision: decision });
        };
        this.attendanceBridge.on('attendanceDecision', onAttendanceDecision);
      }
    }
  }


  /**
   * Helper to verify actor scope and permissions on a camera
   */
  public async verifyActorScope(
    cameraId: string,
    actor: AuthenticatedActor,
    action: 'VIEW' | 'CONTROL' = 'VIEW'
  ) {
    if (action === 'CONTROL' && actor.role === StaffRole.GUARD) {
      throw new ForbiddenError('Guards are not authorized to start or stop face recognition sessions');
    }

    const camera = await this.db.camera.findUnique({
      where: { id: cameraId },
    });

    if (!camera) {
      throw new NotFoundError('Camera', cameraId);
    }

    if (camera.organizationId !== actor.organizationId) {
      throw new NotFoundError('Camera', cameraId);
    }

    if (actor.role === StaffRole.WARDEN && actor.hostelId && camera.hostelId !== actor.hostelId) {
      throw new NotFoundError('Camera', cameraId);
    }

    if (actor.role === StaffRole.GUARD && actor.hostelId && camera.hostelId !== actor.hostelId) {
      throw new NotFoundError('Camera', cameraId);
    }

    if (actor.role === StaffRole.ADMIN && actor.hostelId && camera.hostelId !== actor.hostelId) {
      throw new NotFoundError('Camera', cameraId);
    }

    return camera;
  }

  /**
   * Starts a continuous recognition session for a specific camera
   */
  public async startRecognition(
    cameraId: string,
    actor: AuthenticatedActor,
    customThresholds?: Partial<MatcherThresholds>
  ): Promise<RecognitionSessionStatus> {
    const camera = await this.verifyActorScope(cameraId, actor, 'CONTROL');

    if (!camera.isEnabled) {
      throw new ValidationError(`Camera '${camera.name}' (${camera.id}) is disabled`);
    }

    // Verify worker health
    const workerHealth = await this.workerClient.health();
    if (workerHealth.status !== 'UP' && !workerHealth.mock) {
      throw new ValidationError('Biometric inference engine is unavailable');
    }

    // Check if session already running (idempotent)
    const existing = this.activeSessions.get(cameraId);
    if (existing) {
      if (existing.state === 'RUNNING') {
        return this.buildSessionStatus(existing);
      }
      // If inactive or error session existed, ensure old streams and listeners are completely detached
      if (existing.unsubscribeStream) {
        try {
          existing.unsubscribeStream();
        } catch (e) {}
        existing.unsubscribeStream = undefined;
      }
      this.movementBridge?.detachSession(cameraId, existing.eventEmitter);
      this.attendanceBridge?.detachSession(cameraId, existing.eventEmitter);
      existing.eventEmitter.removeAllListeners();
      this.activeSessions.delete(cameraId);
    }

    // Preload eligible templates for the camera's hostel
    const eligibleTemplates = await this.templateCache.getTemplatesForHostel(
      camera.hostelId,
      camera.organizationId
    );

    const session: ActiveCameraSession = {
      sessionId: `recsess_${randomUUID().substring(0, 8)}`,
      cameraId: camera.id,
      hostelId: camera.hostelId,
      organizationId: camera.organizationId,
      state: 'RUNNING',
      startedAt: new Date(),
      stabilizer: new TemporalStabilizer({ cooldownMs: config.recognition.cooldownMs }),
      matcher: new TemplateMatcher(customThresholds),
      recentObservations: [],
      framesProcessed: 0,
      facesDetected: 0,
      matches: 0,
      uncertains: 0,
      unknowns: 0,
      qualityInsufficients: 0,
      lastProcessedAt: null,
      lastError: null,
      lastFrameProcessedTimestamp: 0,
      isProcessingFrame: false,
      fpsWindow: [],
      eventEmitter: new EventEmitter(),
    };

    // Keep max 50 event listeners per camera
    session.eventEmitter.setMaxListeners(50);

    // Subscribe to shared CameraService stream
    try {
      const unsubscribe = await this.cameraService.subscribeToStream(cameraId, (frame) => {
        this.handleCameraFrame(cameraId, frame).catch((err) => {
          console.error(`[RecognitionService] Error handling frame for camera ${cameraId}:`, err);
        });
      });
      session.unsubscribeStream = unsubscribe;
    } catch (err: any) {
      session.state = 'ERROR';
      session.lastError = err.message || 'Failed to subscribe to camera stream';
      this.activeSessions.set(cameraId, session);
      throw new ValidationError(`Unable to connect recognition to camera stream: ${err.message}`);
    }

    this.activeSessions.set(cameraId, session);

    // Event Routing (Step 08 Requirements 4, 30, 31, 32):
    // ATTENDANCE camera -> AttendanceRecognitionBridge
    // IN / OUT camera -> MovementRecognitionBridge
    // GENERAL camera -> Recognition only (no business side effects)
    if ((camera.role === CameraRole.IN || camera.role === CameraRole.OUT) && this.movementBridge) {
      this.movementBridge.attachSession(camera.id, session.eventEmitter);

      const onMovementDecision = ({ observation, decision }: { observation: any; decision: any }) => {
        const stored = session.recentObservations.find((o) => o.id === observation.id);
        if (stored) {
          stored.movementDecision = decision;
        }
        session.eventEmitter.emit('observation', { ...observation, movementDecision: decision });
      };
      this.movementBridge.on('movementDecision', onMovementDecision);

      const originalUnsubscribe = session.unsubscribeStream;
      session.unsubscribeStream = () => {
        if (originalUnsubscribe) originalUnsubscribe();
        this.movementBridge?.off('movementDecision', onMovementDecision);
        this.movementBridge?.detachSession(camera.id, session.eventEmitter);
      };
    } else if (camera.role === CameraRole.ATTENDANCE && this.attendanceBridge) {
      this.attendanceBridge.attachSession(camera.id, camera.role, session.eventEmitter);

      const onAttendanceDecision = ({ observation, decision }: { observation: any; decision: any }) => {
        const stored = session.recentObservations.find((o) => o.id === observation.id);
        if (stored) {
          stored.attendanceDecision = decision;
        }
        session.eventEmitter.emit('observation', { ...observation, attendanceDecision: decision });
      };
      this.attendanceBridge.on('attendanceDecision', onAttendanceDecision);

      const originalUnsubscribe = session.unsubscribeStream;
      session.unsubscribeStream = () => {
        if (originalUnsubscribe) originalUnsubscribe();
        this.attendanceBridge?.off('attendanceDecision', onAttendanceDecision);
        this.attendanceBridge?.detachSession(camera.id, session.eventEmitter);
      };
    }

    return this.buildSessionStatus(session);
  }

  /**
   * Stops a continuous recognition session
   */
  public async stopRecognition(
    cameraId: string,
    actor: AuthenticatedActor
  ): Promise<RecognitionSessionStatus> {
    await this.verifyActorScope(cameraId, actor, 'CONTROL');

    const session = this.activeSessions.get(cameraId);
    if (!session) {
      const camera = await this.db.camera.findUnique({ where: { id: cameraId } });
      return {
        sessionId: 'none',
        cameraId,
        hostelId: camera?.hostelId || '',
        state: 'STOPPED',
        startedAt: null,
        framesProcessed: 0,
        facesDetected: 0,
        matches: 0,
        uncertains: 0,
        unknowns: 0,
        qualityInsufficients: 0,
        lastProcessedAt: null,
        lastError: null,
        eligibleTemplates: 0,
        processingFps: 0,
        configuredMaxFps: this.defaultMaxFps,
      };
    }

    if (session.unsubscribeStream) {
      try {
        session.unsubscribeStream();
      } catch (e) {}
      session.unsubscribeStream = undefined;
    }

    // Detach movement bridge
    if (this.movementBridge) {
      this.movementBridge.detachSession(cameraId, session.eventEmitter);
    }

    // Detach attendance bridge
    if (this.attendanceBridge) {
      this.attendanceBridge.detachSession(cameraId, session.eventEmitter);
    }

    session.state = 'STOPPED';
    session.isProcessingFrame = false;
    session.stabilizer.clear();
    session.eventEmitter.emit('stopped');
    session.eventEmitter.removeAllListeners();

    const status = this.buildSessionStatus(session);
    return status;
  }

  /**
   * Retrieves runtime status and metrics for a camera recognition session
   */
  public async getStatus(
    cameraId: string,
    actor: AuthenticatedActor
  ): Promise<RecognitionSessionStatus> {
    const camera = await this.verifyActorScope(cameraId, actor, 'VIEW');

    const session = this.activeSessions.get(cameraId);
    if (!session) {
      const eligibleCount = this.templateCache.getCachedCount(camera.hostelId);
      return {
        sessionId: 'none',
        cameraId,
        hostelId: camera.hostelId,
        state: 'STOPPED',
        startedAt: null,
        framesProcessed: 0,
        facesDetected: 0,
        matches: 0,
        uncertains: 0,
        unknowns: 0,
        qualityInsufficients: 0,
        lastProcessedAt: null,
        lastError: null,
        eligibleTemplates: eligibleCount,
        processingFps: 0,
        configuredMaxFps: this.defaultMaxFps,
      };
    }

    return this.buildSessionStatus(session);
  }

  /**
   * Retrieves bounded recent recognition observations (never contains vectors)
   */
  public async getRecentObservations(
    cameraId: string,
    actor: AuthenticatedActor,
    limit = 50
  ): Promise<RecognitionObservation[]> {
    await this.verifyActorScope(cameraId, actor, 'VIEW');

    const session = this.activeSessions.get(cameraId);
    if (!session) {
      return [];
    }

    const bound = Math.min(Math.max(1, limit), this.defaultHistoryLimit);
    return session.recentObservations.slice(0, bound);
  }

  /**
   * Subscribe to live recognition observation events (for SSE)
   */
  public subscribeObservations(
    cameraId: string,
    listener: (obs: RecognitionObservation) => void
  ): () => void {
    const session = this.activeSessions.get(cameraId);
    if (!session) {
      return () => {};
    }

    session.eventEmitter.on('observation', listener);
    return () => {
      session.eventEmitter.off('observation', listener);
    };
  }

  /**
   * Ingest and process a frame uploaded directly from a client browser webcam
   */
  public async processClientFrame(
    cameraId: string,
    frameBuffer: Buffer,
    actor: AuthenticatedActor
  ): Promise<RecognitionObservation | null> {
    await this.verifyActorScope(cameraId, actor, 'VIEW');

    let session = this.activeSessions.get(cameraId);
    if (!session || session.state !== 'RUNNING') {
      try {
        await this.startRecognition(cameraId, {
          ...actor,
          role: StaffRole.ADMIN,
        });
        session = this.activeSessions.get(cameraId);
      } catch (err) {
        console.warn(`[RecognitionService] processClientFrame auto-start error:`, err);
      }
    }

    if (!session) {
      return null;
    }

    // Reset processing flag so client frame is processed immediately
    session.isProcessingFrame = false;
    session.lastFrameProcessedTimestamp = 0;

    await this.handleCameraFrame(cameraId, {
      cameraId,
      sourceType: CameraSourceType.WEBCAM,
      timestamp: new Date(),
      frameBuffer,
    });

    return session.recentObservations[0] || null;
  }

  /**
   * Frame processing pipeline (Shared Camera -> Backpressure -> Python Worker -> TemplateMatcher -> Stabilizer -> Observations)
   */
  public async handleCameraFrame(cameraId: string, frame: CameraFrame): Promise<void> {
    const session = this.activeSessions.get(cameraId);
    if (!session || session.state !== 'RUNNING') {
      return;
    }

    const now = Date.now();

    // 1. Backpressure: if worker inference is actively executing, DROP this frame (latest-frame wins)
    if (session.isProcessingFrame) {
      return;
    }

    // 2. FPS Limiting: throttle frame processing rate to defaultMaxFps
    const minFrameIntervalMs = 1000 / this.defaultMaxFps;
    if (now - session.lastFrameProcessedTimestamp < minFrameIntervalMs) {
      return;
    }

    if (!frame.frameBuffer || frame.frameBuffer.length === 0) {
      return;
    }

    session.isProcessingFrame = true;
    session.lastFrameProcessedTimestamp = now;

    try {
      // 3. Worker face detection & extraction
      const extractResult = await this.workerClient.extractFaces(frame.frameBuffer);
      if (!extractResult.success) {
        throw new Error(extractResult.error || extractResult.message || 'Worker face extraction failed');
      }

      session.framesProcessed++;
      session.lastProcessedAt = new Date();

      // Track processing FPS
      this.recordFpsTick(session, now);

      const detectedFaces = extractResult.faces || [];
      session.facesDetected += detectedFaces.length;

      // 4. Fetch hostel-scoped eligible templates from in-memory cache
      const templates = await this.templateCache.getTemplatesForHostel(
        session.hostelId,
        session.organizationId
      );

      // 5. Process each detected face independently
      for (const face of detectedFaces) {
        let obs: RecognitionObservation;

        if (!face.quality.usable || !face.embedding) {
          // Reject unusable face before matching (Rule: quality unusable -> no template matching -> no UNKNOWN increment)
          obs = {
            id: `rec_${randomUUID().substring(0, 10)}`,
            faceId: `face_${face.faceIndex}`,
            cameraId,
            classification: 'QUALITY_INSUFFICIENT',
            resident: null,
            similarity: null,
            secondBestSimilarity: null,
            bbox: face.bbox,
            qualityUsable: false,
            qualityReason: face.quality.rejectionReason || 'QUALITY_INSUFFICIENT',
            detectedAt: new Date().toISOString(),
            movementDecision: {
              status: 'NO_MATCH',
              cameraId,
              timestamp: new Date().toISOString(),
              reason: 'Quality insufficient - no movement side effect',
            },
          };
          session.qualityInsufficients++;
        } else {
          // Match against eligible enrolled templates
          const matchResult = session.matcher.match(face.embedding, templates);

          // Apply temporal stabilization & tracking
          const stabilized = session.stabilizer.update(face.bbox, matchResult, now);

          // Build clean observation (STRICT PRIVACY: NEVER include embeddings or vectors)
          obs = {
            id: `rec_${randomUUID().substring(0, 10)}`,
            faceId: stabilized.trackId,
            cameraId,
            classification: stabilized.classification,
            resident: stabilized.classification === 'MATCH' && stabilized.resident ? stabilized.resident : null,
            similarity: stabilized.similarity,
            secondBestSimilarity: stabilized.secondBestSimilarity,
            bbox: face.bbox,
            qualityUsable: true,
            qualityReason: null,
            detectedAt: new Date().toISOString(),
            isStable: stabilized.isStable,
            shouldEmitEvent: stabilized.shouldEmitEvent,
          };

          if (stabilized.classification === 'MATCH') {
            session.matches++;

            // Only trigger movement on temporally stable MATCH when cooldown allows event emission.
            // The movement bridge's 'stableMatch' listener (attached via attachSession) is the
            // SOLE authoritative path that calls decisionService.evaluateObservation().
            // Do NOT call processObservation() here – that would cause double evaluation.
            if (stabilized.isStable && stabilized.shouldEmitEvent && stabilized.resident) {
              session.eventEmitter.emit('stableMatch', obs);
              // obs.movementDecision will be populated asynchronously when the bridge emits
              // 'movementDecision' back (see onDecision handler registered in startRecognition).
            }
          } else if (stabilized.classification === 'UNCERTAIN') {
            session.uncertains++;
            obs.movementDecision = {
              status: 'NO_MATCH',
              cameraId,
              timestamp: obs.detectedAt,
              reason: 'Uncertain match - no movement side effect',
            };
          } else {
            session.unknowns++;
            obs.movementDecision = {
              status: 'NO_MATCH',
              cameraId,
              timestamp: obs.detectedAt,
              reason: 'Unknown person - no movement side effect',
            };
          }
        }

        // Add to bounded recent observations (unshift for latest-first)
        session.recentObservations.unshift(obs);
        if (session.recentObservations.length > this.defaultHistoryLimit) {
          session.recentObservations.pop();
        }

        // Emit to SSE / listeners
        session.eventEmitter.emit('observation', obs);
      }
    } catch (err: any) {
      session.lastError = err.message || 'Error during recognition frame processing';
      // If critical worker disconnection occurred, update state
      if (err.message && err.message.includes('disconnected')) {
        session.state = 'ERROR';
      }
    } finally {
      session.isProcessingFrame = false;
    }
  }

  private recordFpsTick(session: ActiveCameraSession, now: number) {
    session.fpsWindow.push(now);
    // Keep timestamps from the last 2 seconds
    const cutoff = now - 2000;
    while (session.fpsWindow.length > 0 && session.fpsWindow[0] < cutoff) {
      session.fpsWindow.shift();
    }
  }

  private calculateCurrentFps(session: ActiveCameraSession): number {
    if (session.fpsWindow.length < 2) return 0;
    const durationSec = (session.fpsWindow[session.fpsWindow.length - 1] - session.fpsWindow[0]) / 1000;
    if (durationSec <= 0) return 0;
    return Math.round((session.fpsWindow.length / durationSec) * 10) / 10;
  }

  private buildSessionStatus(session: ActiveCameraSession): RecognitionSessionStatus {
    const eligibleCount = this.templateCache.getCachedCount(session.hostelId);
    return {
      sessionId: session.sessionId,
      cameraId: session.cameraId,
      hostelId: session.hostelId,
      state: session.state,
      startedAt: session.startedAt.toISOString(),
      framesProcessed: session.framesProcessed,
      facesDetected: session.facesDetected,
      matches: session.matches,
      uncertains: session.uncertains,
      unknowns: session.unknowns,
      qualityInsufficients: session.qualityInsufficients,
      lastProcessedAt: session.lastProcessedAt ? session.lastProcessedAt.toISOString() : null,
      lastError: session.lastError,
      eligibleTemplates: eligibleCount,
      processingFps: this.calculateCurrentFps(session),
      configuredMaxFps: this.defaultMaxFps,
    };
  }
}

export const defaultRecognitionService = new RecognitionService();
