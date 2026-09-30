import {
  PrismaClient,
  Prisma,
  CameraRole,
  AttendanceSessionStatus,
  AttendanceRecordStatus,
  AttendanceMarkMethod,
  ResidentStatus,
} from '@prisma/client';
import { prisma as defaultPrisma } from '../../database/client';
import { RecognitionObservation } from '../recognition/recognition.types';
import { AttendanceDecisionResult, AttendanceDecisionStatus } from './attendance-decision.types';

export class AttendanceDecisionService {
  private inFlightEvaluations: Map<string, Promise<AttendanceDecisionResult>> = new Map();

  constructor(private readonly db: PrismaClient = defaultPrisma) {}

  /**
   * Evaluates a recognition observation for attendance.
   * Only CameraRole.ATTENDANCE cameras are processed.
   * Only stable MATCH classifications can mark attendance.
   * Strictly decoupled from MovementEvent and ResidentPresence.
   */
  public async evaluateObservation(
    obs: RecognitionObservation
  ): Promise<AttendanceDecisionResult> {
    const timestamp = new Date().toISOString();
    const cameraId = obs.cameraId;

    const residentId = obs.resident?.id || obs.residentId;
    const observationId = obs.observationId || obs.id;

    // 1. Classification check: automatic attendance requires stable MATCH
    if (obs.classification !== 'MATCH' || !residentId) {
      return {
        status: 'NO_MATCH',
        cameraId,
        timestamp,
        reason: `Observation classification '${obs.classification}' cannot mark attendance`,
      };
    }

    // 2. Fetch and validate camera
    const camera = await this.db.camera.findUnique({
      where: { id: cameraId },
    });

    if (!camera || !camera.isEnabled) {
      return {
        status: 'CAMERA_NOT_ATTENDANCE_CAPABLE',
        residentId,
        cameraId,
        timestamp,
        reason: camera ? 'Camera is disabled' : 'Camera not found',
      };
    }

    // Role check: ONLY CameraRole.ATTENDANCE can automatically mark attendance
    if (camera.role !== CameraRole.ATTENDANCE) {
      return {
        status: 'CAMERA_NOT_ATTENDANCE_CAPABLE',
        residentId,
        cameraId,
        cameraRole: camera.role,
        timestamp,
        reason: `Camera role '${camera.role}' cannot automatically mark attendance`,
      };
    }

    // 3. Resolve active attendance session for this camera / hostel
    const activeSession = await this.findActiveSessionForCamera(camera.hostelId, camera.organizationId, camera.id);

    if (!activeSession) {
      return {
        status: 'NO_ACTIVE_SESSION',
        residentId,
        cameraId,
        cameraRole: camera.role,
        timestamp,
        reason: 'No active attendance session found for this hostel and camera',
      };
    }

    // Camera binding check if session is explicitly bound to a specific camera
    if (activeSession.cameraId && activeSession.cameraId !== camera.id) {
      return {
        status: 'CAMERA_SESSION_MISMATCH',
        sessionId: activeSession.id,
        sessionTitle: activeSession.title,
        residentId,
        cameraId,
        cameraRole: camera.role,
        timestamp,
        reason: `Session '${activeSession.title}' is bound to camera '${activeSession.cameraId}', not '${camera.id}'`,
      };
    }

    // 4. Session time window validation
    const now = new Date();
    if (activeSession.startTime && now < activeSession.startTime) {
      return {
        status: 'SESSION_NOT_STARTED',
        sessionId: activeSession.id,
        sessionTitle: activeSession.title,
        residentId,
        cameraId,
        cameraRole: camera.role,
        timestamp,
        reason: `Session '${activeSession.title}' has not started yet`,
      };
    }

    if (activeSession.endTime && now > activeSession.endTime) {
      return {
        status: 'SESSION_WINDOW_ENDED',
        sessionId: activeSession.id,
        sessionTitle: activeSession.title,
        residentId,
        cameraId,
        cameraRole: camera.role,
        timestamp,
        reason: `Session '${activeSession.title}' time window has ended`,
      };
    }

    // 5. In-flight promise deduplication to prevent concurrent racing for same session+resident
    const inFlightKey = `${activeSession.id}:${residentId}`;
    const existingInFlight = this.inFlightEvaluations.get(inFlightKey);
    if (existingInFlight) {
      return existingInFlight;
    }

    const evaluationPromise = this.processAttendanceMarking({
      session: activeSession,
      residentId,
      camera,
      observationId,
      timestamp,
    });

    this.inFlightEvaluations.set(inFlightKey, evaluationPromise);

    try {
      return await evaluationPromise;
    } finally {
      this.inFlightEvaluations.delete(inFlightKey);
    }
  }

  /**
   * Looks up the current active attendance session for a hostel and camera.
   */
  public async findActiveSessionForCamera(hostelId: string, organizationId: string, cameraId?: string) {
    // First, check if there is an active session specifically bound to this cameraId
    if (cameraId) {
      const boundSession = await this.db.attendanceSession.findFirst({
        where: {
          hostelId,
          organizationId,
          status: AttendanceSessionStatus.ACTIVE,
          cameraId,
        },
        orderBy: { startTime: 'desc' },
      });
      if (boundSession) return boundSession;
    }

    // Otherwise, check for any active session in the hostel (unbound cameraId or general)
    return this.db.attendanceSession.findFirst({
      where: {
        hostelId,
        organizationId,
        status: AttendanceSessionStatus.ACTIVE,
      },
      orderBy: { startTime: 'desc' },
    });
  }

  private async processAttendanceMarking(params: {
    session: any;
    residentId: string;
    camera: any;
    observationId?: string;
    timestamp: string;
  }): Promise<AttendanceDecisionResult> {
    const { session, residentId, camera, observationId, timestamp } = params;

    // 1. Re-validate resident fresh from DB (defense in depth)
    const resident = await this.db.resident.findUnique({
      where: { id: residentId },
    });

    if (!resident) {
      return {
        status: 'ERROR',
        sessionId: session.id,
        sessionTitle: session.title,
        residentId,
        cameraId: camera.id,
        cameraRole: camera.role,
        timestamp,
        reason: 'Resident not found in database',
      };
    }

    // Active status check
    if (resident.status !== ResidentStatus.ACTIVE) {
      return {
        status: 'RESIDENT_INACTIVE',
        sessionId: session.id,
        sessionTitle: session.title,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        cameraId: camera.id,
        cameraRole: camera.role,
        timestamp,
        reason: `Resident '${resident.residentCode}' is not active (status: ${resident.status})`,
      };
    }

    // Scope check: organization and hostel must match session
    if (resident.organizationId !== session.organizationId || resident.hostelId !== session.hostelId) {
      return {
        status: 'CROSS_HOSTEL_MISMATCH',
        sessionId: session.id,
        sessionTitle: session.title,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        cameraId: camera.id,
        cameraRole: camera.role,
        timestamp,
        reason: `Resident '${resident.residentCode}' belongs to hostel '${resident.hostelId}', not session hostel '${session.hostelId}'`,
      };
    }

    // 2. Check if resident already marked in this session (DB check)
    const existingRecord = await this.db.attendanceRecord.findUnique({
      where: {
        attendanceSessionId_residentId: {
          attendanceSessionId: session.id,
          residentId: resident.id,
        },
      },
    });

    if (existingRecord) {
      return {
        status: 'ALREADY_MARKED',
        sessionId: session.id,
        sessionTitle: session.title,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        recordId: existingRecord.id,
        attendanceStatus: existingRecord.status,
        markMethod: existingRecord.markMethod,
        markedAt: existingRecord.createdAt.toISOString(),
        recognitionReference: existingRecord.recognitionReference || undefined,
        cameraId: camera.id,
        cameraRole: camera.role,
        timestamp,
        reason: `Resident '${resident.residentCode}' already marked as ${existingRecord.status}`,
      };
    }

    // 3. Atomically write AttendanceRecord with P2002 defensive handling
    try {
      const record = await this.db.$transaction(async (tx) => {
        // Re-check session status inside transaction
        const currentSession = await tx.attendanceSession.findUnique({
          where: { id: session.id },
        });

        if (!currentSession || currentSession.status !== AttendanceSessionStatus.ACTIVE) {
          throw new Error('SESSION_NO_LONGER_ACTIVE');
        }

        const newRecord = await tx.attendanceRecord.create({
          data: {
            attendanceSessionId: session.id,
            residentId: resident.id,
            status: AttendanceRecordStatus.PRESENT,
            markMethod: AttendanceMarkMethod.FACE_RECOGNITION,
            recognitionReference: observationId || null,
          },
        });

        return newRecord;
      });

      return {
        status: 'ATTENDANCE_MARKED',
        sessionId: session.id,
        sessionTitle: session.title,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        recordId: record.id,
        attendanceStatus: record.status,
        markMethod: record.markMethod,
        markedAt: record.createdAt.toISOString(),
        recognitionReference: record.recognitionReference || undefined,
        cameraId: camera.id,
        cameraRole: camera.role,
        timestamp,
      };
    } catch (err: any) {
      if (err.message === 'SESSION_NO_LONGER_ACTIVE') {
        return {
          status: 'SESSION_CLOSED',
          sessionId: session.id,
          sessionTitle: session.title,
          residentId: resident.id,
          residentCode: resident.residentCode,
          residentName: resident.fullName,
          cameraId: camera.id,
          cameraRole: camera.role,
          timestamp,
          reason: 'Attendance session was closed before recording could complete',
        };
      }

      // Catch composite unique constraint violation P2002 on (attendanceSessionId, residentId)
      const isP2002 = (() => {
        if (!err || err.code !== 'P2002') return false;
        const target = err.meta?.target;
        if (Array.isArray(target)) {
          return target.some(
            (t: any) =>
              typeof t === 'string' &&
              (t.includes('attendanceSessionId') ||
                t.includes('residentId') ||
                t.includes('attendance_records_attendanceSessionId_residentId_key'))
          );
        }
        if (typeof target === 'string') {
          return (
            target.includes('attendanceSessionId') ||
            target.includes('residentId') ||
            target.includes('attendance_records_attendanceSessionId_residentId_key')
          );
        }
        if (typeof err.message === 'string' && (err.message.includes('attendanceSessionId') || err.message.includes('residentId'))) {
          return true;
        }
        return false;
      })();

      if (err instanceof Prisma.PrismaClientKnownRequestError && isP2002) {
        const raceRecord = await this.db.attendanceRecord.findUnique({
          where: {
            attendanceSessionId_residentId: {
              attendanceSessionId: session.id,
              residentId: resident.id,
            },
          },
        });

        return {
          status: 'ALREADY_MARKED',
          sessionId: session.id,
          sessionTitle: session.title,
          residentId: resident.id,
          residentCode: resident.residentCode,
          residentName: resident.fullName,
          recordId: raceRecord?.id,
          attendanceStatus: raceRecord?.status || AttendanceRecordStatus.PRESENT,
          markMethod: raceRecord?.markMethod || AttendanceMarkMethod.FACE_RECOGNITION,
          markedAt: raceRecord?.createdAt.toISOString() || timestamp,
          recognitionReference: raceRecord?.recognitionReference || undefined,
          cameraId: camera.id,
          cameraRole: camera.role,
          timestamp,
          reason: 'DB unique constraint caught concurrent duplicate attendance mark',
        };
      }

      console.error(`[AttendanceDecisionService] Error recording attendance for resident ${resident.id}:`, err);
      return {
        status: 'ERROR',
        sessionId: session.id,
        sessionTitle: session.title,
        residentId: resident.id,
        residentCode: resident.residentCode,
        residentName: resident.fullName,
        cameraId: camera.id,
        cameraRole: camera.role,
        timestamp,
        reason: 'Internal database error recording attendance',
      };
    }
  }
}
