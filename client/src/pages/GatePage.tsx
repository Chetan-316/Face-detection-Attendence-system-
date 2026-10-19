import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError } from '../api/client';
import { camerasApi } from '../api/cameras.api';
import { movementsApi } from '../api/movements.api';
import { recognitionApi } from '../api/recognition.api';
import { residentsApi } from '../api/residents.api';
import { CameraEntity } from '../types/camera.types';
import { RecognitionObservation, RecognitionResident, RecognitionSessionStatus } from '../types/recognition.types';
import { MovementEventEntity, PresenceCounts } from '../types/movement.types';
import { RegisterRegularComerModal } from '../features/gate/RegisterRegularComerModal';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { Button } from '../components/Button';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { usePreviewStreamUrl } from '../hooks/usePreviewStreamUrl';
import { formatTime } from '../utils/formatters';
import '../styles/gate.css';
import {
  Camera as CameraIcon,
  AlertTriangle,
  UserX,
  User as UserIcon,
  Check,
  Eye,
  UserPlus,
  Scan,
  X,
  RefreshCw,
  Users,
} from 'lucide-react';

type Direction = 'IN' | 'OUT';
type ActivePresence = Direction | 'UNKNOWN' | null;

interface ManualRecord {
  residentName: string;
  direction: Direction;
  at: string;
}

interface SeenObservation {
  key: string;
  decided: boolean;
}

const MATCH_HOLD_MS = 4000;
const OTHER_HOLD_MS = 2500;
const POLL_INTERVAL_MS = 2500;
const POLL_MAX_AGE_MS = 6000;
const MOVEMENT_REFRESH_MS = 5000;
const RECOGNITION_STATUS_REFRESH_MS = 5000;

type GateRecognitionState = RecognitionSessionStatus['state'] | 'WORKER_UNAVAILABLE';
const WEBCAM_SCAN_MS = 700;
const SEEN_OBSERVATION_LIMIT = 50;
const FEED_ERROR_MESSAGE = 'Recognition is unavailable right now. Retrying automatically.';
const MOVEMENT_REFRESH_ERROR = 'Could not refresh gate activity. Showing the last loaded data.';

const ASSISTANCE_STATUSES = new Set<string>([
  'AUTOMATION_DISABLED',
  'CAMERA_NOT_MOVEMENT_CAPABLE',
  'INITIAL_PRESENCE_MISSING',
  'RESIDENT_INACTIVE',
  'RESIDENT_NOT_ENROLLED',
  'CROSS_HOSTEL_MISMATCH',
  'TRANSITION_SUPPRESSED',
  'ERROR',
]);

const NO_DUPLICATE_STATUSES = new Set<string>([
  'ALREADY_IN',
  'ALREADY_OUT',
  'DUPLICATE_OBSERVATION_SUPPRESSED',
]);

function observationKey(observation: RecognitionObservation): string {
  const decision = observation.movementDecision;
  return [
    observation.classification,
    observation.resident?.id ?? '',
    observation.isStable ?? '',
    observation.shouldEmitEvent ?? '',
    decision?.status ?? '',
    decision?.direction ?? '',
    decision?.currentPresence ?? '',
  ].join('|');
}

function rememberObservation(seen: Map<string, SeenObservation>, id: string, entry: SeenObservation) {
  seen.delete(id);
  seen.set(id, entry);
  if (seen.size > SEEN_OBSERVATION_LIMIT) {
    const oldest = seen.keys().next().value;
    if (oldest !== undefined) seen.delete(oldest);
  }
}

// Labels come from the configured sourceType only. Browser capture is used solely for WEBCAM cameras.
const SOURCE_TYPE_LABELS: Record<string, string> = {
  WEBCAM: 'Webcam',
  RTSP: 'RTSP',
  SMART_CAMERA: 'Smart Cam',
};

function cameraSourceLabel(sourceType: string | undefined): string {
  return sourceType ? SOURCE_TYPE_LABELS[sourceType] ?? sourceType : 'Camera';
}

function describeCameraError(err: unknown, deviceLabel: string): string {
  const name = (err as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return `Camera access was blocked. Allow camera access in the browser address bar, then select Start ${deviceLabel}.`;
    case 'NotFoundError':
    case 'OverconstrainedError':
      return `No ${deviceLabel} was found on this device.`;
    case 'NotReadableError':
      return `The ${deviceLabel} is in use by another application.`;
    default:
      return err instanceof Error && err.message ? err.message : `The ${deviceLabel} could not be started.`;
  }
}

export const GatePage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { error: toastError } = useToast();

  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [camerasLoaded, setCamerasLoaded] = useState<boolean>(false);
  const [camerasError, setCamerasError] = useState<string | null>(null);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const selectedCameraIdRef = useRef<string>(selectedCameraId);
  const selectedCamera = useMemo(
    () => cameras.find((camera) => camera.id === selectedCameraId) ?? null,
    [cameras, selectedCameraId]
  );
  const selectedSourceType = selectedCamera?.sourceType;
  // IP/RTSP cameras are server-driven and must never be replaced by the browser camera.
  const isBrowserCamera = !selectedCamera || selectedSourceType === 'WEBCAM';

  const [presenceCounts, setPresenceCounts] = useState<PresenceCounts | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementEventEntity[]>([]);
  const [movementsError, setMovementsError] = useState<string | null>(null);

  const [activeObservation, setActiveObservation] = useState<RecognitionObservation | null>(null);
  const [activePresence, setActivePresence] = useState<ActivePresence>(null);
  const [manualRecord, setManualRecord] = useState<ManualRecord | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [recognitionState, setRecognitionState] = useState<GateRecognitionState | null>(null);
  const [isRegisterVisitorOpen, setIsRegisterVisitorOpen] = useState(false);

  const activeObservationIdRef = useRef<string | null>(null);
  const seenObservationsRef = useRef<Map<string, SeenObservation>>(new Map());
  const recordedResidentIdRef = useRef<string | null>(null);
  const isConfirmingRef = useRef<boolean>(false);
  const cardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const scanInFlightRef = useRef<boolean>(false);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanningFace, setIsScanningFace] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const previewStreamUrl = usePreviewStreamUrl(isBrowserCamera ? null : selectedCameraId);

  useEffect(() => {
    selectedCameraIdRef.current = selectedCameraId;
  }, [selectedCameraId]);

  const startLaptopCamera = useCallback(async () => {
    setIsStartingCamera(true);
    setCameraError(null);
    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera is not supported or blocked in this browser context.');
      }
      if (localStreamRef.current) {
        if (videoRef.current && videoRef.current.srcObject !== localStreamRef.current) {
          videoRef.current.srcObject = localStreamRef.current;
          videoRef.current.play().catch(() => {});
        }
        setIsCameraActive(true);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      localStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }
      setIsCameraActive(true);
    } catch (err: unknown) {
      console.warn('Webcam access error:', err);
      // Browser capture only starts for WEBCAM-configured cameras, so the device label is "webcam".
      setCameraError(describeCameraError(err, 'webcam'));
      setIsCameraActive(false);
    } finally {
      setIsStartingCamera(false);
    }
  }, []);

  const stopLaptopCamera = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsCameraActive(false);
  }, []);

  useEffect(() => {
    if (selectedSourceType !== 'WEBCAM') return;
    startLaptopCamera();
    return stopLaptopCamera;
  }, [selectedCameraId, selectedSourceType, startLaptopCamera, stopLaptopCamera]);

  useEffect(() => {
    return () => {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      if (cardTimerRef.current) clearTimeout(cardTimerRef.current);
    };
  }, []);

  const hostelId = user?.hostelId || undefined;

  const fetchCameras = useCallback(async () => {
    try {
      const res = await camerasApi.listCameras(hostelId);
      // The server decides direction (TOGGLE); only IN/OUT cameras create automatic movements.
      const list = (res.data || []).filter(
        (camera) => camera.isEnabled !== false && (camera.role === 'IN' || camera.role === 'OUT')
      );
      setCameras(list);
      setCamerasError(null);
      setSelectedCameraId((previous) => (list.some((camera) => camera.id === previous) ? previous : list[0]?.id ?? ''));
    } catch {
      setCamerasError('The server did not return the gate camera list. Check the connection, then retry.');
    } finally {
      setCamerasLoaded(true);
    }
  }, [hostelId]);

  const retryCameras = useCallback(() => {
    setCamerasLoaded(false);
    void fetchCameras();
  }, [fetchCameras]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  const fetchMovementData = useCallback(async () => {
    const [counts, movements] = await Promise.allSettled([
      movementsApi.getPresenceCounts(hostelId),
      movementsApi.getMovements({ hostelId, pageSize: 8 }),
    ]);
    if (counts.status === 'fulfilled') setPresenceCounts(counts.value);
    if (movements.status === 'fulfilled') setRecentMovements(movements.value.data ?? []);
    setMovementsError(
      counts.status === 'rejected' || movements.status === 'rejected' ? MOVEMENT_REFRESH_ERROR : null
    );
  }, [hostelId]);

  useEffect(() => {
    fetchMovementData();
    const interval = setInterval(fetchMovementData, MOVEMENT_REFRESH_MS);
    return () => clearInterval(interval);
  }, [fetchMovementData]);

  const clearCardTimer = useCallback(() => {
    if (cardTimerRef.current) {
      clearTimeout(cardTimerRef.current);
      cardTimerRef.current = null;
    }
  }, []);

  const dismissObservation = useCallback(() => {
    clearCardTimer();
    activeObservationIdRef.current = null;
    recordedResidentIdRef.current = null;
    setActiveObservation(null);
    setActivePresence(null);
    setManualRecord(null);
  }, [clearCardTimer]);

  const holdCard = useCallback(
    (holdMs: number) => {
      clearCardTimer();
      cardTimerRef.current = setTimeout(() => {
        cardTimerRef.current = null;
        dismissObservation();
      }, holdMs);
    },
    [clearCardTimer, dismissObservation]
  );

  // Single path for every recognition source (webcam frame, SSE event, polling). The same observation id
  // can arrive several times: identical deliveries and stale re-deliveries are ignored, while the first
  // movement decision for an id already on screen updates that card instead of being dropped.
  const handleObservation = useCallback(
    (observation: RecognitionObservation) => {
      if (isConfirmingRef.current) return;
      const seen = seenObservationsRef.current;
      const key = observationKey(observation);
      const decision = observation.movementDecision;
      const previous = seen.get(observation.id);

      if (previous) {
        if (previous.key === key || previous.decided) return;
        rememberObservation(seen, observation.id, { key, decided: Boolean(decision) });

        if (!decision) {
          if (activeObservationIdRef.current === observation.id) setActiveObservation(observation);
          return;
        }

        void fetchMovementData();
        if (activeObservationIdRef.current !== observation.id) return;
        setActiveObservation(observation);
        if (decision.currentPresence) setActivePresence(decision.currentPresence);
        if (observation.classification === 'MATCH' && observation.resident && decision.status === 'MOVEMENT_CREATED') {
          recordedResidentIdRef.current = observation.resident.id;
        }
        holdCard(observation.classification === 'MATCH' ? MATCH_HOLD_MS : OTHER_HOLD_MS);
        return;
      }

      rememberObservation(seen, observation.id, { key, decided: Boolean(decision) });

      const heldResidentId = recordedResidentIdRef.current;
      if (heldResidentId && observation.classification === 'MATCH' && observation.resident?.id === heldResidentId) {
        // The same resident is still in view; keep the recorded result readable until its hold expires.
        return;
      }
      recordedResidentIdRef.current = null;

      activeObservationIdRef.current = observation.id;
      setActiveObservation(observation);
      setActivePresence(decision?.currentPresence ?? null);
      setManualRecord(null);

      if (observation.classification === 'MATCH' && observation.resident) {
        if (decision?.status === 'MOVEMENT_CREATED') {
          recordedResidentIdRef.current = observation.resident.id;
          fetchMovementData();
        }
        if (!decision?.currentPresence) {
          movementsApi
            .getResidentPresence(observation.resident.id)
            .then((presence) => {
              if (activeObservationIdRef.current !== observation.id) return;
              setActivePresence(presence?.currentState ?? 'UNKNOWN');
            })
            .catch(() => {
              if (activeObservationIdRef.current === observation.id) setActivePresence('UNKNOWN');
            });
        }
      }

      holdCard(observation.classification === 'MATCH' ? MATCH_HOLD_MS : OTHER_HOLD_MS);
    },
    [fetchMovementData, holdCard]
  );

  const captureAndProcessFrame = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !selectedCameraId || selectedSourceType !== 'WEBCAM') return;
    if (isConfirmingRef.current || scanInFlightRef.current) return;
    if (video.videoWidth === 0 || video.videoHeight === 0) return;

    const cameraId = selectedCameraId;
    scanInFlightRef.current = true;
    setIsScanningFace(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(640, video.videoWidth);
      canvas.height = Math.min(480, video.videoHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const imageBase64 = canvas.toDataURL('image/jpeg', 0.75);
      const res = await recognitionApi.processFrame(cameraId, imageBase64);
      if (selectedCameraIdRef.current !== cameraId) return;
      setFeedError(null);
      if (res.observation) handleObservation(res.observation);
    } catch {
      if (selectedCameraIdRef.current === cameraId) setFeedError(FEED_ERROR_MESSAGE);
    } finally {
      scanInFlightRef.current = false;
      setIsScanningFace(false);
    }
  }, [selectedCameraId, selectedSourceType, handleObservation]);

  useEffect(() => {
    if (selectedSourceType !== 'WEBCAM' || !isCameraActive) return;
    const interval = setInterval(() => {
      void captureAndProcessFrame();
    }, WEBCAM_SCAN_MS);
    return () => clearInterval(interval);
  }, [selectedSourceType, isCameraActive, captureAndProcessFrame]);

  useEffect(() => {
    if (!selectedCameraId) return;

    let isActive = true;
    const refreshRecognitionState = async () => {
      try {
        const status = await recognitionApi.getStatus(selectedCameraId);
        if (isActive) setRecognitionState(status.state);
      } catch (err) {
        if (!isActive) return;
        setRecognitionState(err instanceof ApiError && err.status === 503 ? 'WORKER_UNAVAILABLE' : null);
      }
    };

    void refreshRecognitionState();
    const interval = setInterval(refreshRecognitionState, RECOGNITION_STATUS_REFRESH_MS);

    return () => {
      isActive = false;
      clearInterval(interval);
    };
  }, [selectedCameraId]);

  // The stream and polling depend only on the selected camera. Manual actions must not reconnect them.
  useEffect(() => {
    if (!selectedCameraId) return;

    let isActive = true;
    let eventSource: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;

    const connectStream = async () => {
      try {
        const { streamToken } = await recognitionApi.getStreamToken(selectedCameraId);
        if (!isActive) return;
        eventSource = new EventSource(recognitionApi.getEventsStreamUrl(selectedCameraId, streamToken));
        eventSource.addEventListener('observation', (event: MessageEvent) => {
          try {
            handleObservation(JSON.parse(event.data) as RecognitionObservation);
          } catch {
            // A malformed event is skipped; polling keeps the feed current.
          }
        });
        eventSource.onerror = () => {
          eventSource?.close();
          eventSource = null;
          if (isActive) reconnectTimer = setTimeout(connectStream, 3000);
        };
      } catch {
        if (isActive) reconnectTimer = setTimeout(connectStream, 4000);
      }
    };

    connectStream();

    const pollInterval = setInterval(() => {
      recognitionApi
        .getResults(selectedCameraId, 1)
        .then((res) => {
          if (!isActive) return;
          setFeedError(null);
          const latest = res.results?.[0];
          if (!latest) return;
          const ageMs = Date.now() - new Date(latest.detectedAt).getTime();
          // Older observations are historical and must not appear as live matches.
          if (ageMs > POLL_MAX_AGE_MS) return;
          handleObservation(latest);
        })
        .catch(() => {
          if (isActive) setFeedError(FEED_ERROR_MESSAGE);
        });
    }, POLL_INTERVAL_MS);

    return () => {
      isActive = false;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSource?.close();
      clearInterval(pollInterval);
    };
  }, [selectedCameraId, handleObservation]);

  const handleCameraChange = (cameraId: string) => {
    setSelectedCameraId(cameraId);
    setStreamError(null);
    setFeedError(null);
    setRecognitionState(null);
    dismissObservation();
  };

  // Manual exception path. No direction is sent: the server toggles from the resident's locked presence
  // and returns the movement it recorded, which is the only source for the displayed result.
  const handleManualToggle = async () => {
    const resident = activeObservation?.resident;
    if (!resident || !selectedCamera || isConfirmingRef.current) return;
    if (activePresence !== 'IN' && activePresence !== 'OUT') return;

    isConfirmingRef.current = true;
    setIsConfirming(true);
    setManualRecord(null);

    try {
      const res = await movementsApi.confirmMovement({
        residentId: resident.id,
        cameraId: selectedCamera.id,
      });
      const { movementType, effectiveTimestamp } = res.data;
      setActivePresence(movementType);
      setManualRecord({
        residentName: resident.fullName,
        direction: movementType,
        at: effectiveTimestamp,
      });
      recordedResidentIdRef.current = resident.id;
      fetchMovementData();
      holdCard(MATCH_HOLD_MS);
    } catch (err: any) {
      toastError(err.message || 'Failed to record gate movement');
    } finally {
      isConfirmingRef.current = false;
      setIsConfirming(false);
    }
  };

  const observation = activeObservation;
  const decision = observation?.movementDecision;
  const isMatch = observation?.classification === 'MATCH' && !!observation.resident;
  const automaticDirection = isMatch && decision?.status === 'MOVEMENT_CREATED' ? decision.direction : undefined;

  const cameraHealthy = isBrowserCamera ? isCameraActive : selectedCamera?.healthStatus === 'ONLINE';
  const cameraStatusLabel = isBrowserCamera
    ? isCameraActive
      ? 'Camera active'
      : 'Camera not started'
    : cameraHealthy
    ? 'Camera online'
    : 'Camera needs attention';
  const cameraPillTone = cameraHealthy ? 'is-ok' : isBrowserCamera ? 'is-neutral' : 'is-warn';

  // Device wording is derived from the configured sourceType (e.g. "webcam" or "rtsp"), never assumed.
  const deviceLabel = selectedCamera ? cameraSourceLabel(selectedCamera.sourceType).toLowerCase() : 'camera';
  const sourceLabel = cameraSourceLabel(selectedCamera?.sourceType);
  // Offline presentation applies whenever the stage shows a message instead of live media.
  const isStageLive =
    camerasLoaded && !camerasError && cameras.length > 0 && (isBrowserCamera ? isCameraActive : !streamError);
  const recognitionChip =
    recognitionState === 'RUNNING'
      ? { tone: 'is-ok', label: 'Recognition running' }
      : recognitionState === 'WORKER_UNAVAILABLE'
      ? { tone: 'is-danger', label: 'Recognition unavailable' }
      : { tone: 'is-neutral', label: 'Recognition stopped' };

  const renderRecorded = (name: string, direction: Direction, at: string | undefined, manual: boolean) => (
    <div className="gate-result is-success">
      <div className="gate-result-head">
        <span className="gate-result-kicker">Latest result</span>
        <span className="gate-result-icon is-success">
          <Check size={18} />
        </span>
      </div>
      <h2 className="gate-recorded-name">{name}</h2>
      <p className={`gate-recorded-label ${direction === 'IN' ? 'is-in' : 'is-out'}`}>
        {direction === 'IN' ? 'ENTRY RECORDED' : 'EXIT RECORDED'}
      </p>
      <p className="gate-recorded-time">{formatTime(at)}</p>
      <p className="gate-result-text">
        {manual
          ? 'Recorded by the guard as a manual exception. The action is audit logged.'
          : 'Recorded automatically. No guard action is needed.'}
      </p>
      <p className="gate-ready-line">Ready for next resident</p>
    </div>
  );

  const renderPresence = () => {
    if (activePresence === 'IN') return <span className="gate-pill is-ok">Currently inside</span>;
    if (activePresence === 'OUT') return <span className="gate-pill is-warn">Currently outside</span>;
    if (activePresence === 'UNKNOWN') {
      return <span className="gate-pill is-neutral">Presence unavailable. Confirm at the desk.</span>;
    }
    return <span className="gate-pill is-neutral">Checking current presence…</span>;
  };

  const renderFooter = (current: RecognitionObservation) => {
    const status = current.movementDecision?.status;

    if (status && NO_DUPLICATE_STATUSES.has(status)) {
      return (
        <div className="gate-notice is-neutral">
          <p className="gate-notice-title">No duplicate movement created</p>
          <p className="gate-notice-body">
            The resident is already recorded in the correct state. Continuous scanning remains active.
          </p>
        </div>
      );
    }

    if (status && ASSISTANCE_STATUSES.has(status)) {
      return (
        <div className="gate-notice is-warn">
          <p className="gate-notice-title">Automatic movement needs assistance</p>
          <p className="gate-notice-body">
            {current.movementDecision?.reason || 'The automatic movement could not be completed.'}
          </p>
          <p className="gate-notice-body">
            Use manual confirmation only for this exception. The action is audit logged.
          </p>
          {(activePresence === 'IN' || activePresence === 'OUT') && (
            <Button
              type="button"
              variant="outline"
              size="md"
              className="gate-full-width"
              onClick={handleManualToggle}
              isLoading={isConfirming}
              disabled={isConfirming}
              leftIcon={<AlertTriangle size={18} />}
            >
              {activePresence === 'IN' ? 'Record manual exit' : 'Record manual entry'}
            </Button>
          )}
        </div>
      );
    }

    if (current.isStable && current.shouldEmitEvent === false) {
      return (
        <div className="gate-notice is-neutral">
          <p className="gate-notice-title">Recognition confirmed. Scanner remains active.</p>
          <p className="gate-notice-body">
            This resident is still part of the same camera appearance. No duplicate movement is created until they leave and appear again.
          </p>
        </div>
      );
    }

    return (
      <div className="gate-notice is-info">
        <p className="gate-notice-title">Confirming automatic movement...</p>
        <p className="gate-notice-body">
          Keep the resident in view briefly. The first confirmed appearance toggles presence automatically; continuous visibility is ignored until they leave the camera view.
        </p>
      </div>
    );
  };

  const renderIdentity = (current: RecognitionObservation, resident: RecognitionResident) => (
    <div className="gate-result is-info gate-identity-panel">
      <div className="gate-identity-status">
        <span className="gate-identity-status-label">
          <span className="gate-dot is-live" />
          Resident identified
        </span>
        <button type="button" className="gate-link-button" onClick={dismissObservation}>
          <X size={12} />
          <span>Dismiss</span>
        </button>
      </div>

      <div className="gate-identity">
        <div className="gate-identity-photo">
          <UserIcon size={30} aria-hidden="true" />
          <AuthenticatedImage
            src={residentsApi.getProfilePhotoUrl(resident.id)}
            alt={resident.fullName}
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        </div>
        <div className="gate-identity-body">
          <h2 className="gate-identity-name">{resident.fullName}</h2>
          <p className="gate-identity-meta">
            {resident.residentCode} · {resident.roomGroup || 'Room not assigned'}
          </p>
          <div className="gate-identity-presence">{renderPresence()}</div>
        </div>
      </div>

      <div className="gate-action-footer">{renderFooter(current)}</div>
    </div>
  );

  const renderSimpleResult = (
    icon: React.ReactNode,
    tone: 'danger' | 'warn' | 'ready',
    title: string,
    text: string,
    action?: React.ReactNode
  ) => (
    <div className={`gate-result is-${tone}`}>
      <div className="gate-result-head">
        <span className="gate-result-kicker">Gate status</span>
        <span className={`gate-result-icon is-${tone}`}>{icon}</span>
      </div>
      <h2 className="gate-result-title">{title}</h2>
      <p className="gate-result-text">{text}</p>
      {action}
    </div>
  );

  const renderActionPanel = () => {
    if (manualRecord) {
      return renderRecorded(manualRecord.residentName, manualRecord.direction, manualRecord.at, true);
    }
    if (automaticDirection && observation?.resident) {
      return renderRecorded(observation.resident.fullName, automaticDirection, decision?.timestamp, false);
    }
    if (isMatch && observation?.resident) {
      return renderIdentity(observation, observation.resident);
    }
    if (observation?.classification === 'UNKNOWN') {
      return renderSimpleResult(
        <UserX size={26} />,
        'danger',
        'Person not recognized',
        'The person could not be matched to an enrolled resident. Use the exception workflow if assistance is needed.',
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setIsRegisterVisitorOpen(true)}
          leftIcon={<UserPlus size={16} />}
          className="gate-full-width"
        >
          Open exception workflow
        </Button>
      );
    }
    if (observation?.classification === 'UNCERTAIN') {
      return renderSimpleResult(
        <AlertTriangle size={26} />,
        'warn',
        'Identity needs another look',
        'Ask the resident to look toward the camera once more. No movement has been recorded.'
      );
    }
    if (observation?.classification === 'QUALITY_INSUFFICIENT') {
      return renderSimpleResult(
        <AlertTriangle size={26} />,
        'warn',
        'Camera needs a clearer view',
        'Ask the resident to face the camera briefly and hold still. No movement has been recorded.'
      );
    }
    if (!cameraHealthy || feedError || recognitionState !== 'RUNNING') {
      return renderSimpleResult(
        <CameraIcon size={26} />,
        'warn',
        'Recognition is not running',
        recognitionState === 'WORKER_UNAVAILABLE'
          ? 'The recognition engine is unavailable. Entries and exits are not recorded until it is back.'
          : 'Entries and exits are not recorded until the gate camera and recognition are both running.'
      );
    }
    return renderSimpleResult(
      <Eye size={26} />,
      'ready',
      'Ready for next resident',
      'The camera scans continuously. Entry or exit is recorded automatically after a stable match.'
    );
  };

  const renderStage = () => {
    if (!camerasLoaded) {
      return (
        <div className="gate-stage-message">
          <RefreshCw size={28} className="gate-spin" />
          <p className="gate-stage-body">Loading gate cameras...</p>
        </div>
      );
    }

    if (camerasError) {
      return (
        <div role="alert" className="gate-stage-message">
          <CameraIcon size={44} />
          <p className="gate-stage-title">Gate cameras could not be loaded</p>
          <p className="gate-stage-body">{camerasError}</p>
          <Button type="button" variant="outline" size="sm" onClick={retryCameras}>
            Retry
          </Button>
        </div>
      );
    }

    if (cameras.length === 0) {
      return (
        <div role="status" className="gate-stage-message">
          <CameraIcon size={44} />
          <p className="gate-stage-title">No gate camera available</p>
          <p className="gate-stage-body">
            No enabled IN or OUT camera is set up for this hostel. Assign an IN or OUT role to a camera in Cameras, then reload this page.
          </p>
        </div>
      );
    }

    if (isBrowserCamera) {
      if (isCameraActive) {
        return (
          <>
            <video
              ref={(el) => {
                videoRef.current = el;
                if (el && localStreamRef.current && el.srcObject !== localStreamRef.current) {
                  el.srcObject = localStreamRef.current;
                  el.play().catch(() => {});
                }
              }}
              className="gate-stage-media"
              autoPlay
              playsInline
              muted
            />
            <div className="gate-live-badge">
              <span className="gate-dot is-live" />
              <span>Live {sourceLabel}</span>
            </div>
            <button type="button" onClick={stopLaptopCamera} className="gate-camera-overlay-button gate-corner-button">
              Turn off
            </button>
            <div className="gate-scan-bar">
              <div className="gate-scan-status">
                <span className="gate-dot is-live" />
                <span>Automatic scan active</span>
              </div>
              <button
                type="button"
                onClick={() => void captureAndProcessFrame()}
                disabled={isScanningFace || isConfirming}
                className="gate-camera-overlay-button gate-scan-button"
              >
                {isScanningFace ? <RefreshCw size={13} className="gate-spin" /> : <Scan size={13} />}
                <span>{isScanningFace ? 'Scanning...' : 'Scan now'}</span>
              </button>
            </div>
          </>
        );
      }

      if (isStartingCamera) {
        return (
          <div role="status" className="gate-stage-message">
            <RefreshCw size={28} className="gate-spin" />
            <p className="gate-stage-title">Waiting for camera permission</p>
            <p className="gate-stage-body">Allow camera access in the browser prompt to start automatic recognition.</p>
          </div>
        );
      }

      return (
        <div className="gate-stage-message">
          <CameraIcon size={44} />
          <div className="gate-stage-copy">
            <p className="gate-stage-title">{cameraError ? `${sourceLabel} not started` : `${sourceLabel} is off`}</p>
            <p className="gate-stage-body" role={cameraError ? 'alert' : undefined}>
              {cameraError ?? `Start the ${deviceLabel} to resume automatic recognition at this gate.`}
            </p>
          </div>
          <Button type="button" variant="primary" size="sm" onClick={startLaptopCamera}>
            Start {deviceLabel}
          </Button>
        </div>
      );
    }

    if (streamError) {
      return (
        <div className="gate-stage-message">
          <CameraIcon size={44} />
          <p className="gate-stage-title">Camera stream interrupted</p>
          <p className="gate-stage-body">Check this camera’s status in Cameras, then retry the preview.</p>
          <Button type="button" variant="outline" size="sm" onClick={() => setStreamError(null)}>
            Retry preview
          </Button>
        </div>
      );
    }

    return (
      <img
        src={previewStreamUrl || undefined}
        alt="Gate live feed"
        className="gate-stage-media"
        onError={() => setStreamError('Stream interrupted')}
      />
    );
  };

  return (
    <div className="gate-page">
      <div className="gate-topbar">
        <div className="gate-topbar-main">
          <h1 className="gate-title">Gate Operations</h1>
          <span className="gate-topbar-divider" aria-hidden="true" />
          <span className="gate-camera-name">{selectedCamera?.name || 'Gate camera'}</span>
          {selectedCamera && <span className="gate-pill is-info">{sourceLabel}</span>}
          {selectedCamera && <span className="gate-pill is-info">Automatic IN / OUT</span>}
          <span className={`gate-pill ${cameraPillTone}`}>
            <span className={`gate-dot ${cameraHealthy ? 'is-live' : isBrowserCamera ? '' : 'is-warn'}`} />
            {cameraStatusLabel}
          </span>
          <span className={`gate-pill ${recognitionChip.tone}`} data-testid="gate-recognition-chip">
            <span className={`gate-dot ${recognitionState === 'RUNNING' ? 'is-live' : recognitionChip.tone === 'is-danger' ? 'is-warn' : ''}`} />
            {recognitionChip.label}
          </span>
        </div>

        <div className="gate-topbar-actions">
          {cameras.length > 1 && (
            <div className="gate-camera-select-wrap">
              <label htmlFor="gate-camera-select" className="gate-count-label">
                Camera
              </label>
              <select
                id="gate-camera-select"
                value={selectedCameraId}
                onChange={(e) => handleCameraChange(e.target.value)}
                className="gate-camera-select"
              >
                {cameras.map((camera) => (
                  <option key={camera.id} value={camera.id}>
                    {camera.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="gate-counts" aria-label="Resident presence">
            <div className="gate-count">
              <span className="gate-count-label">Total</span>
              <span className="gate-count-value">{presenceCounts?.totalResidents ?? '—'}</span>
            </div>
            <div className="gate-count">
              <span className="gate-count-label">Inside</span>
              <span className="gate-count-value is-in">{presenceCounts?.currentlyIn ?? '—'}</span>
            </div>
            <div className="gate-count">
              <span className="gate-count-label">Outside</span>
              <span className="gate-count-value is-out">{presenceCounts?.currentlyOut ?? '—'}</span>
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => navigate('/residents')}
            leftIcon={<Users size={16} />}
          >
            Resident Directory
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setIsRegisterVisitorOpen(true)}
            leftIcon={<UserPlus size={16} />}
            className="gate-exception-button"
          >
            Visitor / Exception
          </Button>
        </div>
      </div>

      <div className="gate-ops">
        <section className="gate-panel gate-camera-col" aria-label="Gate camera feed">
          <div className={`gate-camera-stage${isStageLive ? '' : ' is-offline'}`}>{renderStage()}</div>
        </section>

        <section className="gate-panel gate-action-col" aria-label="Recognition result">
          {feedError && (
            <p role="alert" className="gate-inline-error">
              {feedError}
            </p>
          )}
          <div className="gate-result-region" aria-live="polite" aria-atomic="true">
            {renderActionPanel()}
          </div>
          {!isStageLive && (
            <ul className="gate-checklist" aria-label="Gate readiness">
              <li>
                <span className="gate-checklist-label">Camera</span>
                <span className="gate-checklist-value">{cameraStatusLabel}</span>
              </li>
              <li>
                <span className="gate-checklist-label">Recognition</span>
                <span className="gate-checklist-value">{recognitionChip.label}</span>
              </li>
              <li>
                <span className="gate-checklist-label">Source</span>
                <span className="gate-checklist-value">{sourceLabel}</span>
              </li>
              <li>
                <span className="gate-checklist-label">Movements</span>
                <span className="gate-checklist-value">Automatic IN / OUT</span>
              </li>
            </ul>
          )}
        </section>
      </div>

      <section className="gate-panel gate-activity" aria-labelledby="gate-activity-heading">
        <div className="gate-panel-header">
          <h2 id="gate-activity-heading" className="gate-panel-title">
            Recent activity
          </h2>
        </div>

        {movementsError && (
          <p role="alert" className="gate-inline-error gate-inline-error-band">
            {movementsError}
          </p>
        )}

        {recentMovements.length === 0 ? (
          <p className="gate-empty">
            {movementsError ? 'Gate activity could not be loaded.' : 'No recent gate activity recorded.'}
          </p>
        ) : (
          <div className="gate-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Resident</th>
                  <th scope="col">Room</th>
                  <th scope="col" className="gate-cell-right">
                    Movement
                  </th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.map((movement) => {
                  const isIn = movement.movementType === 'IN';
                  return (
                    <tr key={movement.id}>
                      <td className="gate-mono">{formatTime(movement.effectiveTimestamp)}</td>
                      <td className="gate-cell-strong">{movement.resident?.fullName || movement.residentId}</td>
                      <td>{movement.resident?.roomGroup || '—'}</td>
                      <td className="gate-cell-right">
                        <span className={`gate-pill ${isIn ? 'is-ok' : 'is-warn'}`}>{isIn ? 'Entered' : 'Left'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <RegisterRegularComerModal
        isOpen={isRegisterVisitorOpen}
        onClose={() => setIsRegisterVisitorOpen(false)}
        onSuccess={fetchMovementData}
        hostelId={user?.hostelId || undefined}
      />
    </div>
  );
};

export default GatePage;
