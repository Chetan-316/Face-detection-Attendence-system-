import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { camerasApi } from '../api/cameras.api';
import { recognitionApi } from '../api/recognition.api';
import { residentsApi } from '../api/residents.api';
import { CameraEntity } from '../types/camera.types';
import {
  RecognitionObservation,
  RecognitionSessionStatus,
} from '../types/recognition.types';
import { movementsApi } from '../api/movements.api';
import {
  MovementEventEntity,
  PresenceCounts,
  AutomationStatus,
} from '../types/movement.types';
import { Modal } from '../components/Modal';
import { Button } from '../components/Button';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { usePreviewStreamUrl } from '../hooks/usePreviewStreamUrl';
import {
  Play,
  Square,
  Video,
  Clock,
  UserCheck,
  AlertCircle,
  Eye,
  Camera as CameraIcon,
  LogIn,
  LogOut,
  User as UserIcon,
} from 'lucide-react';

import '../styles/gate.css';

// Labels come from the configured sourceType only.
const SOURCE_TYPE_LABELS: Record<string, string> = {
  WEBCAM: 'Webcam',
  RTSP: 'RTSP',
  SMART_CAMERA: 'Smart Cam',
};

function cameraSourceLabel(sourceType: string | undefined): string {
  return sourceType ? SOURCE_TYPE_LABELS[sourceType] ?? sourceType : 'Camera';
}

export const RecognitionPage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError, info } = useToast();


  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const selectedCamera = useMemo(
    () => cameras.find((c) => c.id === selectedCameraId) || null,
    [cameras, selectedCameraId]
  );
  // Overlay boxes are normalized against the frame that was sent for analysis, then fitted to the displayed media.
  const sourceFrameSizeRef = useRef({ width: 640, height: 480 });
  const mediaSizeRef = useRef({ width: 640, height: 480 });

  const [sessionStatus, setSessionStatus] = useState<RecognitionSessionStatus | null>(null);
  const [observations, setObservations] = useState<RecognitionObservation[]>([]);
  const [activeBoxes, setActiveBoxes] = useState<RecognitionObservation[]>([]);

  const [presenceCounts, setPresenceCounts] = useState<PresenceCounts | null>(null);
  const [automationStatus, setAutomationStatus] = useState<AutomationStatus | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementEventEntity[]>([]);
  const [feedTab, setFeedTab] = useState<'observations' | 'movements'>('observations');

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActionPending, setIsActionPending] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isConfirmingMovement, setIsConfirmingMovement] = useState<boolean>(false);
  const [overrideModalOpen, setOverrideModalOpen] = useState<boolean>(false);
  const [overrideDirection, setOverrideDirection] = useState<'IN' | 'OUT'>('IN');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [overrideResident, setOverrideResident] = useState<any>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const [activeResidentDetails, setActiveResidentDetails] = useState<any>(null);
  const [activeResidentPresence, setActiveResidentPresence] = useState<'IN' | 'OUT'>('OUT');

  // Direct Laptop Browser Webcam Support
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [isLaptopCameraActive, setIsLaptopCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const startLaptopCamera = useCallback(async () => {
    try {
      setCameraError(null);
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera is not supported or blocked in this browser context.');
      }
      if (localStreamRef.current) {
        if (videoRef.current && videoRef.current.srcObject !== localStreamRef.current) {
          videoRef.current.srcObject = localStreamRef.current;
          videoRef.current.play().catch(() => {});
        }
        setIsLaptopCameraActive(true);
        setStreamError(null);
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
      setIsLaptopCameraActive(true);
      setStreamError(null);
    } catch (err: any) {
      setCameraError(err.message || 'Permission denied. Please allow camera access in browser address bar.');
      setIsLaptopCameraActive(false);
    }
  }, []);

  const stopLaptopCamera = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsLaptopCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    };
  }, []);

  // Admin and Warden can start/stop the camera recognition process; all staff (including Guard) can confirm entry/exit
  const canManageSession = user?.role === 'ADMIN' || user?.role === 'WARDEN';
  const canControl = true; // All authenticated staff can supervise movements

  // 1. Fetch recognition status & initial observations when camera changes
  const fetchMovementData = useCallback(async (hostelId?: string) => {
    try {
      const [counts, autoStat, movs] = await Promise.all([
        hostelId ? movementsApi.getPresenceCounts(hostelId).catch(() => null) : Promise.resolve(null),
        movementsApi.getAutomationStatus().catch(() => null),
        movementsApi.getMovements({ hostelId, pageSize: 15 }).catch(() => ({ data: [] })),
      ]);
      if (counts) setPresenceCounts(counts);
      if (autoStat) setAutomationStatus(autoStat);
      if (movs?.data) setRecentMovements(movs.data);
    } catch (e) {}
  }, []);

  const fetchStatusAndResults = useCallback(async (cameraId: string) => {
    try {
      const statusRes = await recognitionApi.getStatus(cameraId);
      setSessionStatus(statusRes);

      const resultsRes = await recognitionApi.getResults(cameraId, 30);
      setObservations(resultsRes.results || []);
    } catch (err: any) {
      // Camera may not have active session yet
      setSessionStatus(null);
    }
  }, []);

  // 2. Fetch available cameras for user scope
  const fetchCameras = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await camerasApi.listCameras(user?.hostelId || undefined);
      setCameras(res.data);
      setSelectedCameraId((current) => current || (res.data.length > 0 ? res.data[0].id : ''));
    } catch (err: any) {
      toastError(err.message || 'Failed to load cameras');
    } finally {
      setIsLoading(false);
    }
  }, [user?.hostelId, toastError]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  useEffect(() => {
    if (selectedCameraId) {
      fetchStatusAndResults(selectedCameraId);
      if (selectedCamera?.hostelId) {
        fetchMovementData(selectedCamera.hostelId);
      }
    }
  }, [selectedCameraId, selectedCamera?.hostelId, fetchStatusAndResults, fetchMovementData]);

  // 3. Connect to live SSE recognition stream using short-lived stream token
  // Reconnects cleanly with fresh token on expiry rather than permanently degrading (Req 26)
  useEffect(() => {
    if (!selectedCameraId) return;

    let isMounted = true;
    const overlayTimers: number[] = [];

    // Close previous SSE connection and pending reconnect timer
    if (reconnectTimerRef.current) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const connectSse = async () => {
      if (typeof EventSource === 'undefined') {
        // Fallback polling for environments without EventSource
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = window.setInterval(() => {
            if (selectedCameraId && isMounted) {
              fetchStatusAndResults(selectedCameraId);
            }
          }, 2000);
        }
        return;
      }

      try {
        // Request dedicated short-lived stream token (primary JWT is never sent via query param)
        const { streamToken } = await recognitionApi.getStreamToken(selectedCameraId);
        if (!isMounted) return;

        const streamUrl = recognitionApi.getEventsStreamUrl(selectedCameraId, streamToken);
        const es = new EventSource(streamUrl);
        eventSourceRef.current = es;

        es.addEventListener('open', () => {
          // Clean SSE connection active: clear temporary polling fallback
          if (pollIntervalRef.current) {
            window.clearInterval(pollIntervalRef.current);
            pollIntervalRef.current = null;
          }
        });

        es.addEventListener('observation', (event: MessageEvent) => {
          try {
            const obs: RecognitionObservation = JSON.parse(event.data);

            // STRICT PRIVACY CHECK: Guarantee client never receives vector/embeddings
            const rawCheck = JSON.stringify(obs);
            if (rawCheck.includes('embedding') || rawCheck.includes('vector')) {
              console.error('CRITICAL: Biometric vector detected in client payload!');
              return;
            }

            setObservations((prev) => [obs, ...prev.slice(0, 49)]);

            // If a movement was created, refresh presence counts and recent movements feed
            if (obs.movementDecision?.status === 'MOVEMENT_CREATED' && selectedCamera?.hostelId) {
              fetchMovementData(selectedCamera.hostelId);
            }

            // Update active overlay boxes
            setActiveBoxes((prev) => {
              const updated = [obs, ...prev.filter((b) => b.faceId !== obs.faceId).slice(0, 4)];
              return updated;
            });

            // Clear overlay box after 2.5s
            overlayTimers.push(window.setTimeout(() => {
              setActiveBoxes((prev) => prev.filter((b) => b.id !== obs.id));
            }, 2500));
          } catch (e) {
            console.error('Failed to parse SSE observation:', e);
          }
        });

        es.onerror = () => {
          // Token expired or connection dropped: close old connection and schedule automatic reconnect with fresh stream token (Req 26)
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }

          // Polling fallback operates while reconnect is in-flight
          if (!pollIntervalRef.current) {
            pollIntervalRef.current = window.setInterval(() => {
              if (selectedCameraId && isMounted) {
                fetchStatusAndResults(selectedCameraId);
              }
            }, 2000);
          }

          if (isMounted && selectedCameraId) {
            if (reconnectTimerRef.current) {
              window.clearTimeout(reconnectTimerRef.current);
            }
            reconnectTimerRef.current = window.setTimeout(() => {
              if (isMounted && selectedCameraId) {
                connectSse();
              }
            }, 2000);
          }
        };
      } catch (err) {
        console.warn('Failed to obtain stream token or initialize SSE, scheduling retry:', err);
        if (!pollIntervalRef.current) {
          pollIntervalRef.current = window.setInterval(() => {
            if (selectedCameraId && isMounted) {
              fetchStatusAndResults(selectedCameraId);
            }
          }, 2000);
        }

        if (isMounted && selectedCameraId) {
          if (reconnectTimerRef.current) {
            window.clearTimeout(reconnectTimerRef.current);
          }
          reconnectTimerRef.current = window.setTimeout(() => {
            if (isMounted && selectedCameraId) {
              connectSse();
            }
          }, 3000);
        }
      }
    };

    connectSse();

    return () => {
      isMounted = false;
      overlayTimers.forEach((timer) => window.clearTimeout(timer));
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [selectedCameraId, fetchStatusAndResults]);

  // Periodic frame processing when laptop webcam is active
  useEffect(() => {
    if (!isLaptopCameraActive || !selectedCameraId) return;

    let isScanning = false;
    let isMounted = true;
    const scanInterval = setInterval(async () => {
      if (isScanning || !videoRef.current || videoRef.current.videoWidth === 0) return;
      try {
        isScanning = true;
        const video = videoRef.current;
        const canvas = document.createElement('canvas');
        canvas.width = Math.min(640, video.videoWidth);
        canvas.height = Math.min(480, video.videoHeight);
        sourceFrameSizeRef.current = { width: canvas.width, height: canvas.height };
        mediaSizeRef.current = { width: video.videoWidth, height: video.videoHeight };
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const b64 = canvas.toDataURL('image/jpeg', 0.75);

        const res = await recognitionApi.processFrame(selectedCameraId, b64);
        if (res.observation && isMounted) {
          const obs = res.observation;
          setObservations((prev) => [obs, ...prev.slice(0, 49)]);

          if (obs.movementDecision?.status === 'MOVEMENT_CREATED' && selectedCamera?.hostelId) {
            fetchMovementData(selectedCamera.hostelId);
          }

          setActiveBoxes((prev) => [obs, ...prev.filter((b) => b.faceId !== obs.faceId).slice(0, 4)]);
          setTimeout(() => {
            setActiveBoxes((prev) => prev.filter((b) => b.id !== obs.id));
          }, 2500);

          if (obs.classification === 'MATCH' && obs.resident) {
            setActiveResidentDetails(obs.resident);
            movementsApi.getResidentPresence(obs.resident.id).then((pres) => {
              if (isMounted && pres?.currentState) {
                setActiveResidentPresence(pres.currentState as 'IN' | 'OUT');
              }
            }).catch(() => {});
          }
        }
      } catch (err) {
        // Non-blocking background scan
      } finally {
        isScanning = false;
      }
    }, 1800);

    return () => {
      isMounted = false;
      clearInterval(scanInterval);
    };
  }, [isLaptopCameraActive, selectedCameraId, selectedCamera?.hostelId, fetchMovementData]);

  // 4. Periodically poll session status every 3 seconds to keep telemetry updated
  useEffect(() => {
    if (!selectedCameraId) return;

    let isCurrent = true;
    let isRequestInFlight = false;
    const interval = setInterval(() => {
      if (isRequestInFlight) return;
      isRequestInFlight = true;
      recognitionApi
        .getStatus(selectedCameraId)
        .then((status) => {
          if (isCurrent) setSessionStatus(status);
        })
        .catch(() => {})
        .finally(() => {
          isRequestInFlight = false;
        });
    }, 3000);

    return () => {
      isCurrent = false;
      clearInterval(interval);
    };
  }, [selectedCameraId]);

  // 5. Draw bounding boxes on canvas overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size the canvas to its displayed area and fit the media inside it the same way object-contain does.
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width));
    canvas.height = Math.max(1, Math.round(rect.height));
    const media = mediaSizeRef.current;
    const frame = sourceFrameSizeRef.current;
    const fitScale = Math.min(canvas.width / media.width, canvas.height / media.height);
    const contentWidth = media.width * fitScale;
    const contentHeight = media.height * fitScale;
    const offsetX = (canvas.width - contentWidth) / 2;
    const offsetY = (canvas.height - contentHeight) / 2;
    const scaleX = contentWidth / frame.width;
    const scaleY = contentHeight / frame.height;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const box of activeBoxes) {
      const { bbox, classification, resident, qualityUsable } = box;
      if (!bbox) continue;

      let strokeColor = '#94a3b8'; // gray
      let fillColor = 'rgba(148, 163, 184, 0.15)';
      let label = 'UNKNOWN';

      if (classification === 'QUALITY_INSUFFICIENT' || !qualityUsable) {
        strokeColor = '#f43f5e'; // rose-500
        fillColor = 'rgba(244, 63, 94, 0.15)';
        label = 'FACE DETECTED — QUALITY INSUFFICIENT';
      } else if (classification === 'MATCH' && resident) {
        strokeColor = '#10b981'; // green
        fillColor = 'rgba(16, 185, 129, 0.2)';
        label = `MATCH: ${resident.fullName} (${resident.residentCode})`;
      } else if (classification === 'UNCERTAIN') {
        strokeColor = '#f59e0b'; // amber
        fillColor = 'rgba(245, 158, 11, 0.15)';
        // STRICT PRIVACY: NEVER SHOW CANDIDATE NAME FOR UNCERTAIN
        label = 'UNCERTAIN';
      } else {
        strokeColor = '#8b5cf6'; // purple
        fillColor = 'rgba(139, 92, 246, 0.15)';
        label = 'UNKNOWN';
      }

      const x = offsetX + bbox.x * scaleX;
      const y = offsetY + bbox.y * scaleY;
      const width = bbox.width * scaleX;
      const height = bbox.height * scaleY;

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, width, height);
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, y, width, height);

      // Label background & text
      ctx.font = 'bold 12px Inter, system-ui, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const labelY = Math.max(16, y - 6);

      ctx.fillStyle = strokeColor;
      ctx.fillRect(x, labelY - 14, textWidth + 8, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x + 4, labelY);
    }
  }, [activeBoxes]);

  // Handlers for Start / Stop
  const handleStartRecognition = async () => {
    const targetId = selectedCameraId || (cameras.length > 0 ? cameras[0].id : '');
    if (!targetId) return;
    try {
      setIsActionPending(true);
      const res = await recognitionApi.startRecognition(targetId);
      setSessionStatus(res);
      success('Continuous face recognition started');
    } catch (err: any) {
      toastError(err.message || 'Failed to start recognition');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleStopRecognition = async () => {
    const targetId = selectedCameraId || (cameras.length > 0 ? cameras[0].id : '');
    if (!targetId) return;
    try {
      setIsActionPending(true);
      const res = await recognitionApi.stopRecognition(targetId);
      setSessionStatus(res);
      setActiveBoxes([]);
      info('Continuous face recognition stopped');
    } catch (err: any) {
      toastError(err.message || 'Failed to stop recognition');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleCameraChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedCameraId(id);
    setObservations([]);
    setActiveBoxes([]);
    setStreamError(null);
  };

  const handleInitiateConfirm = (resident: any, direction: 'IN' | 'OUT') => {
    if (!resident || !selectedCamera) return;
    const cameraRole = selectedCamera.role;
    const isOverride =
      (cameraRole === 'IN' && direction === 'OUT') ||
      (cameraRole === 'OUT' && direction === 'IN');

    if (isOverride) {
      setOverrideResident(resident);
      setOverrideDirection(direction);
      setOverrideReason('');
      setOverrideError(null);
      setOverrideModalOpen(true);
    } else {
      executeConfirmMovement(resident, direction);
    }
  };

  const executeConfirmMovement = async (resident: any, direction: 'IN' | 'OUT', reason?: string) => {
    if (!resident || !selectedCamera) return;
    try {
      setIsConfirmingMovement(true);
      await movementsApi.confirmMovement({
        residentId: resident.id,
        cameraId: selectedCamera.id,
        direction,
        overrideReason: reason,
      });
      success(`Confirmed ${direction === 'IN' ? 'Entry (IN)' : 'Exit (OUT)'} for ${resident.fullName}`);
      setOverrideModalOpen(false);
      setActiveResidentPresence(direction);
      if (selectedCamera?.hostelId) {
        fetchMovementData(selectedCamera.hostelId);
      }
    } catch (err: any) {
      toastError(err.message || 'Failed to confirm resident movement');
    } finally {
      setIsConfirmingMovement(false);
    }
  };

  const handleOverrideSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideReason.trim()) {
      setOverrideError('An override reason is mandatory when altering camera direction');
      return;
    }
    executeConfirmMovement(overrideResident, overrideDirection, overrideReason.trim());
  };

  const latestResidentMatch = observations.find((o) => o.classification === 'MATCH' && o.resident);
  const isRunning = sessionStatus?.state === 'RUNNING';

  const previewStreamUrl = usePreviewStreamUrl(isLaptopCameraActive ? null : selectedCameraId);

  useEffect(() => {
    if (!latestResidentMatch?.resident?.id) return;

    // Ignore a lookup that finishes after a newer match has replaced it.
    let isCurrent = true;
    residentsApi
      .getResident(latestResidentMatch.resident.id)
      .then((res) => {
        if (!isCurrent) return;
        setActiveResidentDetails(res);
        if (res.presence?.currentState) {
          setActiveResidentPresence(res.presence.currentState);
        }
      })
      .catch(() => {});

    return () => {
      isCurrent = false;
    };
  }, [latestResidentMatch?.resident?.id]);

  const sourceLabel = cameraSourceLabel(selectedCamera?.sourceType);
  const roleTone = selectedCamera?.role === 'IN' ? 'is-ok' : selectedCamera?.role === 'OUT' ? 'is-warn' : 'is-neutral';
  // The browser camera is an operator fallback. Labels follow the configured source, not an assumed laptop.
  const isBrowserSource = selectedCamera?.sourceType === 'WEBCAM';

  return (
    <div className="recognition-page">
      {/* Page header: title, camera selector, session control */}
      <div className="rec-topbar">
        <div className="rec-topbar-main">
          <h1 className="rec-title">
            <Eye size={18} aria-hidden="true" />
            Gate Monitor
            <span className="rec-title-sub">Face Recognition</span>
          </h1>
          <span
            data-testid="recognition-status-badge"
            className={`gate-pill ${isRunning ? 'is-ok' : sessionStatus?.state === 'ERROR' ? 'is-danger' : 'is-neutral'}`}
          >
            <span
              className={`gate-dot ${isRunning ? 'is-live' : sessionStatus?.state === 'ERROR' ? 'is-warn' : ''}`}
            />
            {sessionStatus?.state || 'STOPPED'}
          </span>
        </div>

        <div className="rec-topbar-actions">
          <select
            aria-label="Select Camera"
            className="rec-camera-select"
            value={selectedCameraId}
            onChange={handleCameraChange}
            disabled={isLoading || isActionPending}
          >
            {cameras.map((cam) => (
              <option key={cam.id} value={cam.id}>
                {cam.name} — {cam.role === 'IN' ? 'Entry' : cam.role === 'OUT' ? 'Exit' : cam.role === 'ATTENDANCE' ? 'Attendance' : 'General'}
              </option>
            ))}
          </select>

          {canManageSession ? (
            isRunning ? (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleStopRecognition}
                disabled={isActionPending}
                data-testid="stop-recognition-btn"
              >
                <Square size={14} />
                <span>Stop Recognition</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={handleStartRecognition}
                disabled={isActionPending || !selectedCamera?.isEnabled}
                data-testid="start-recognition-btn"
              >
                <Play size={14} />
                <span>Start Recognition</span>
              </button>
            )
          ) : (
            <span className={`gate-pill ${isRunning ? 'is-ok' : 'is-neutral'}`}>
              {isRunning ? 'Gate Recognition Active' : 'Standby'}
            </span>
          )}
        </div>
      </div>

      {/* Gate Monitor & Telemetry Status Bar */}
      <div className="rec-summary">
        <div className="rec-summary-cell">
          <span className="rec-summary-label">Active gate and role</span>
          <span className="rec-summary-value">
            <span className="rec-camera-name">{selectedCamera?.name || 'Gate Camera'}</span>
            <span className={`gate-pill ${roleTone}`}>{selectedCamera?.role || 'GENERAL'}</span>
          </span>
        </div>

        <div className="rec-summary-cell">
          <span className="rec-summary-label">Recognition</span>
          <span className="rec-summary-value">
            <span className={`gate-dot ${isRunning ? 'is-live' : ''}`} />
            <span>{isRunning ? 'Running' : 'Stopped'}</span>
          </span>
        </div>

        <div className="rec-summary-cell">
          <span className="rec-summary-label">Movement automation</span>
          {(() => {
            const isRoleMovement = selectedCamera?.role === 'IN' || selectedCamera?.role === 'OUT';
            const isCamAutoEnabled = selectedCamera?.configMetadata?.movementAutomationEnabled !== false;
            const isGlobalAuto = automationStatus?.globalAutomationEnabled ?? false;
            const isAutomationActive = isRoleMovement && isCamAutoEnabled && isGlobalAuto;

            return (
              <span className="rec-summary-value">
                <span
                  className={`gate-pill ${isAutomationActive ? 'is-ok' : 'is-neutral'}`}
                  data-testid="movement-automation-indicator"
                >
                  Movement automation: {isAutomationActive ? 'ENABLED' : 'DISABLED'}
                </span>
              </span>
            );
          })()}
        </div>

        <div className="rec-summary-cell">
          <span className="rec-summary-label">Hostel presence</span>
          <div className="rec-count-line">
            <span>
              <span>Inside hostel:</span> <strong>{presenceCounts?.currentlyIn ?? '—'}</strong>
            </span>
            <span aria-hidden="true">•</span>
            <span>
              <span>Outside hostel:</span> <strong>{presenceCounts?.currentlyOut ?? '—'}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Operations grid: live camera on the left, latest result and feed on the right */}
      <div className="rec-ops">
        {/* Live camera stage and HUD */}
        <div className="rec-panel rec-camera-col">
          <div className="rec-panel-header">
            <span className="rec-panel-title">
              <Video size={14} aria-hidden="true" />
              {selectedCamera?.name || 'Camera view'}
              <span className={`gate-pill ${roleTone}`}>{selectedCamera?.role || 'GENERAL'}</span>
            </span>
          </div>

          {/* Video viewport: compact strip when offline, 16:9 when live */}
          <div
            ref={videoContainerRef}
            className={`rec-stage${isLaptopCameraActive || (selectedCameraId && !streamError) ? '' : ' is-offline'}`}
          >
              {isLaptopCameraActive ? (
                <>
                  <video
                    ref={(el) => {
                      videoRef.current = el;
                      if (el && localStreamRef.current && el.srcObject !== localStreamRef.current) {
                        el.srcObject = localStreamRef.current;
                        el.play().catch(() => {});
                      }
                    }}
                    autoPlay
                    playsInline
                    muted
                    className="rec-stage-media"
                  />
                  {/* Canvas Overlay for Bounding Boxes */}
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />
                  <div className="rec-live-badge">
                    <span className="gate-dot is-live" />
                    <span>{`Live ${sourceLabel}`}</span>
                  </div>
                  <button
                    type="button"
                    onClick={stopLaptopCamera}
                    className="rec-overlay-button rec-corner-button"
                  >
                    Switch to Server Stream
                  </button>
                </>
              ) : selectedCameraId && !streamError ? (
                <>
                  <img
                    src={previewStreamUrl || undefined}
                    alt="Live Camera Feed"
                    className="rec-stage-media"
                    onError={() => setStreamError('Stream disconnected or unavailable')}
                  />
                  {/* Canvas Overlay for Bounding Boxes */}
                  <canvas
                    ref={canvasRef}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />
                  <button
                    type="button"
                    onClick={startLaptopCamera}
                    className="rec-overlay-button rec-corner-button"
                  >
                    <CameraIcon size={12} aria-hidden="true" />
                    <span>{isBrowserSource ? `Use ${sourceLabel}` : 'Use browser camera'}</span>
                  </button>
                </>
              ) : (
                <div className="rec-stage-message">
                  <CameraIcon size={24} aria-hidden="true" />
                  <div className="rec-stage-copy">
                    <p className="rec-stage-title">Camera feed offline</p>
                    <p className="rec-stage-body">
                      {cameraError || streamError || 'The camera stream is not available from the server.'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startLaptopCamera}
                    className="btn btn-outline btn-sm"
                  >
                    <CameraIcon size={13} aria-hidden="true" />
                    <span>{isBrowserSource ? `Start ${sourceLabel}` : 'Start browser camera'}</span>
                  </button>
                </div>
              )}

            </div>

            {/* Telemetry strip under the stage */}
            <div className="rec-telemetry">
              <span>
                FPS: {sessionStatus?.processingFps || 0} / {sessionStatus?.configuredMaxFps || 5}
              </span>
              <span>Frames: {sessionStatus?.framesProcessed || 0}</span>
              <span>Enrolled residents: {sessionStatus?.eligibleTemplates || 0}</span>
            </div>

            {/* Metrics breakdown */}
            <div className="rec-metrics">
              <div className="rec-metric">
                <span className="rec-metric-value">{sessionStatus?.matches || 0}</span>
                <span className="rec-metric-label">Stable MATCH</span>
              </div>
              <div className="rec-metric">
                <span className="rec-metric-value">{sessionStatus?.uncertains || 0}</span>
                <span className="rec-metric-label">UNCERTAIN</span>
              </div>
              <div className="rec-metric">
                <span className="rec-metric-value">{sessionStatus?.unknowns || 0}</span>
                <span className="rec-metric-label">UNKNOWN</span>
              </div>
              <div className="rec-metric">
                <span className="rec-metric-value">{sessionStatus?.qualityInsufficients || 0}</span>
                <span className="rec-metric-label">Low Quality</span>
              </div>
            </div>

            {/* Operational policy notice */}
            <div className="rec-notice">
              <AlertCircle size={14} aria-hidden="true" />
              <div>
                <strong>Passive Observation Mode</strong>
                Configured gate cameras (IN / OUT) automatically create resident movement records from stable MATCH observations. Attendance sessions and leave automation remain decoupled.
              </div>
            </div>
        </div>

        {/* Right column: latest result, gate decision and observations feed */}
        <div className="rec-panel rec-result-col">
          {/* Latest result: the identified resident and the IN/OUT action, dominant while a resident is at the gate */}
          <div className={`rec-result ${latestResidentMatch ? 'is-info' : 'is-ready'}`}>
            <div className="rec-result-head">
              <span className="rec-result-kicker">
                <UserCheck size={14} aria-hidden="true" />
                Current Resident at Gate
              </span>
              {latestResidentMatch && (
                <span className="gate-pill is-info">
                  {typeof latestResidentMatch.similarity === 'number'
                    ? `${(latestResidentMatch.similarity * 100).toFixed(0)}% Match`
                    : 'Matched'}
                </span>
              )}
            </div>

            {latestResidentMatch?.resident ? (
              <div className="rec-result-region">
                <div className="rec-identity">
                <div className="rec-obs-photo">
                  <AuthenticatedImage
                    src={residentsApi.getProfilePhotoUrl(latestResidentMatch.resident.id)}
                    alt={latestResidentMatch.resident.fullName}
                    className="w-full h-full object-cover"
                    onError={(e) => {
                      (e.target as HTMLElement).style.display = 'none';
                    }}
                  />
                  <UserIcon size={18} aria-hidden="true" />
                </div>
                <div>
                  <div className="rec-result-title">{latestResidentMatch.resident.fullName}</div>
                  <div className="rec-obs-meta">
                    {latestResidentMatch.resident.residentCode} • {latestResidentMatch.resident.roomGroup || activeResidentDetails?.roomGroup || 'Resident'}
                  </div>
                  <div>
                    <span className={`gate-pill ${activeResidentPresence === 'IN' ? 'is-ok' : 'is-warn'}`}>
                      {activeResidentPresence === 'IN' ? '● Currently INSIDE' : '○ Currently OUTSIDE'}
                    </span>
                  </div>
                </div>
              </div>

                {/* Direct Action Button based strictly on Resident Presence (Requirement 20) */}
                <div className="rec-result-region">
                  {activeResidentPresence === 'IN' ? (
                    <button
                      type="button"
                      onClick={() => handleInitiateConfirm(latestResidentMatch.resident, 'OUT')}
                      disabled={isConfirmingMovement}
                      className="btn btn-danger btn-lg"
                    >
                      <LogOut size={16} aria-hidden="true" />
                      <span>MARK OUT (Exit)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleInitiateConfirm(latestResidentMatch.resident, 'IN')}
                      disabled={isConfirmingMovement}
                      className="btn btn-primary btn-lg"
                    >
                      <LogIn size={16} aria-hidden="true" />
                      <span>MARK IN (Entry)</span>
                    </button>
                  )}
                  <span className="rec-obs-note">
                    Resident is currently {activeResidentPresence === 'IN' ? 'inside' : 'outside'} — click to record {activeResidentPresence === 'IN' ? 'exit' : 'entry'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="rec-empty">
                <CameraIcon size={28} aria-hidden="true" />
                <p className="rec-result-title">Awaiting Resident at Gate</p>
                <p className="rec-obs-note">
                  When a resident stands in front of the camera, their details and Mark In / Out buttons appear here.
                </p>
              </div>
            )}
          </div>

          <div className="rec-panel rec-feed">
            {/* Feed tabs */}
            <div className="rec-panel-header">
              <div className="rec-feed-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={feedTab === 'observations'}
                  onClick={() => setFeedTab('observations')}
                  className={`rec-feed-tab${feedTab === 'observations' ? ' is-active' : ''}`}
                >
                  Observations ({observations.length})
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={feedTab === 'movements'}
                  onClick={() => setFeedTab('movements')}
                  className={`rec-feed-tab${feedTab === 'movements' ? ' is-active' : ''}`}
                >
                  Gate Feed ({recentMovements.length})
                </button>
              </div>
            </div>

            {feedTab === 'movements' ? (
              /* Recent Gate Movement Decisions Feed (Requirement 35) */
              <div className="rec-list">
                {recentMovements.length === 0 ? (
                  <div className="rec-empty">
                    <Clock size={28} aria-hidden="true" />
                    <p>No recent gate movements recorded</p>
                  </div>
                ) : (
                  recentMovements.map((mov) => {
                    const movTime = new Date(mov.effectiveTimestamp).toLocaleTimeString([], { timeZone: 'Asia/Kolkata' });
                    const isIN = mov.movementType === 'IN';

                    return (
                      <div key={mov.id} className="rec-obs-card">
                        <div className="rec-obs-head">
                          <div className="rec-obs-person">
                            <span className="rec-obs-time">{movTime}</span>
                            <span className="rec-obs-name">{mov.resident?.fullName || mov.residentId}</span>
                          </div>
                          <span className={`gate-pill ${isIN ? 'is-ok' : 'is-warn'}`}>{mov.movementType}</span>
                        </div>
                        <div className="rec-obs-meta">{mov.camera?.name || 'Gate'}</div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* Scrollable Observations List */
              <div
                className="rec-list"
                role="log"
                aria-live="polite"
                aria-label="Recognition events"
              >
              {observations.length === 0 ? (
                <div className="rec-empty">
                  <Eye size={28} aria-hidden="true" />
                  <p>No recognition events yet</p>
                  <p className="rec-obs-note">Start recognition to begin passive face identification</p>
                </div>
              ) : (
                observations.map((obs) => {
                  const isMatch = obs.classification === 'MATCH';
                  const isUncertain = obs.classification === 'UNCERTAIN';
                  const isUnknown = obs.classification === 'UNKNOWN';
                  const isQualityInsufficient = obs.classification === 'QUALITY_INSUFFICIENT';

                  const badgeClass = isMatch
                    ? 'is-ok'
                    : isUncertain
                    ? 'is-warn'
                    : isQualityInsufficient
                    ? 'is-danger'
                    : 'is-neutral';

                  const timeStr = new Date(obs.detectedAt).toLocaleTimeString([], { timeZone: 'Asia/Kolkata' });

                  return (
                    <div
                      key={obs.id}
                      className="rec-obs-card"
                      data-testid={`observation-${obs.classification.toLowerCase()}`}
                    >
                      <div className="rec-obs-head">
                        <span className={`gate-pill classification-badge ${badgeClass}`}>
                          {obs.classification === 'QUALITY_INSUFFICIENT' ? 'QUALITY INSUFFICIENT' : obs.classification}
                        </span>
                        <span className="rec-obs-time">{timeStr}</span>
                      </div>

                      {/* Content based on Classification */}
                      {isMatch && obs.resident && (
                        <div className="rec-obs-person">
                          <div className="rec-obs-photo">
                            <AuthenticatedImage
                              src={residentsApi.getProfilePhotoUrl(obs.resident.id)}
                              alt=""
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <UserIcon size={16} aria-hidden="true" />
                          </div>
                          <div>
                            <div className="rec-obs-name">{obs.resident.fullName}</div>
                            <div className="rec-obs-meta">
                              <span>Code: {obs.resident.residentCode}</span>
                              {typeof obs.similarity === 'number' && (
                                <span>sim: {(obs.similarity * 100).toFixed(1)}%</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Supervised movement confirm buttons */}
                      {isMatch && obs.resident && canControl && (
                        <div className="rec-obs-actions">
                          <button
                            type="button"
                            onClick={() => handleInitiateConfirm(obs.resident, 'IN')}
                            disabled={isConfirmingMovement}
                          >
                            <LogIn size={12} aria-hidden="true" />
                            <span>Confirm Entry</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInitiateConfirm(obs.resident, 'OUT')}
                            disabled={isConfirmingMovement}
                          >
                            <LogOut size={12} aria-hidden="true" />
                            <span>Confirm Exit</span>
                          </button>
                        </div>
                      )}

                      {/* Movement Decision Status Banner */}
                      <div className="rec-obs-decision">
                        {isMatch ? (
                          obs.movementDecision ? (
                            obs.movementDecision.status === 'MOVEMENT_CREATED' ? (
                              <span className="gate-pill is-ok">
                                Movement Decision: <strong>{obs.movementDecision.direction} RECORDED</strong> (Presence: {obs.movementDecision.currentPresence})
                              </span>
                            ) : obs.movementDecision.status === 'ALREADY_IN' ? (
                              <span className="gate-pill is-info">Already IN — duplicate suppressed</span>
                            ) : obs.movementDecision.status === 'ALREADY_OUT' ? (
                              <span className="gate-pill is-info">Already OUT — duplicate suppressed</span>
                            ) : obs.movementDecision.status === 'TRANSITION_SUPPRESSED' ? (
                              <span className="gate-pill is-warn">Transition suppressed (rapid opposite movement)</span>
                            ) : obs.movementDecision.status === 'AUTOMATION_DISABLED' ? (
                              <span className="gate-pill is-neutral">Movement automation disabled — No movement recorded</span>
                            ) : obs.movementDecision.status === 'CAMERA_NOT_MOVEMENT_CAPABLE' ? (
                              <span className="rec-obs-note">
                                Camera role {selectedCamera?.role || 'GENERAL'} — No movement action
                              </span>
                            ) : (
                              <span className="rec-obs-note">
                                Decision: {obs.movementDecision.status}
                              </span>
                            )
                          ) : (
                            <span className="rec-obs-note">Movement Decision: Evaluating...</span>
                          )
                        ) : isUnknown ? (
                          <span className="rec-obs-note">UNKNOWN No movement action</span>
                        ) : isUncertain ? (
                          <span className="rec-obs-note">UNCERTAIN No movement action</span>
                        ) : (
                          <span className="rec-obs-note">QUALITY INSUFFICIENT No movement action</span>
                        )}
                      </div>

                      {isUncertain && (
                        <div className="rec-obs-note">
                          Ambiguous match or low candidate separation. Identity kept private.
                        </div>
                      )}

                      {isUnknown && (
                        <div className="rec-obs-note">
                          No enrolled hostel resident matched confidently.
                        </div>
                      )}

                      {isQualityInsufficient && (
                        <div className="rec-obs-note">
                          Face detected — quality insufficient ({obs.qualityReason || 'unusable frame'}). Biometric comparison omitted.
                        </div>
                      )}

                      {!obs.qualityUsable && obs.qualityReason && !isQualityInsufficient && (
                        <div className="rec-obs-note">
                          Quality flag: {obs.qualityReason}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
      </div>
      </div>

      {/* Override Reason Modal */}
      {overrideModalOpen && (
        <Modal
          isOpen={overrideModalOpen}
          onClose={() => setOverrideModalOpen(false)}
          title="Direction Override Reason"
          subtitle={`Overriding default direction to ${overrideDirection}`}
          size="md"
        >
          <form onSubmit={handleOverrideSubmit} className="rec-override-form">
            <div className="rec-override-note">
              The camera role is set for the opposite direction. An audit reason is mandatory to record this movement override.
            </div>

            {overrideError && (
              <div className="rec-inline-error" role="alert">
                {overrideError}
              </div>
            )}

            <div className="rec-override-field">
              <label htmlFor="gateOverrideReason">
                Override Reason <span aria-hidden="true">*</span>
              </label>
              <textarea
                id="gateOverrideReason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Resident permitted to exit through entrance turnstile"
                rows={3}
                required
              />
            </div>

            <div className="rec-override-actions">
              <Button type="button" variant="outline" onClick={() => setOverrideModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isConfirmingMovement}>
                Confirm Override {overrideDirection}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default RecognitionPage;
