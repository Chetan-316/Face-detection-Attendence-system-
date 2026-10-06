import React, { useState, useEffect, useCallback, useRef } from 'react';
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
import {
  Play,
  Square,
  RefreshCw,
  Video,
  Shield,
  Activity,
  Layers,
  Clock,
  UserCheck,
  UserX,
  HelpCircle,
  AlertCircle,
  Eye,
  Camera as CameraIcon,
  LogIn,
  LogOut,
  User as UserIcon,
} from 'lucide-react';

export const RecognitionPage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError, info } = useToast();


  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [selectedCamera, setSelectedCamera] = useState<CameraEntity | null>(null);

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

      setSelectedCameraId((current) => {
        const activeId = current || (res.data.length > 0 ? res.data[0].id : '');
        if (activeId) {
          const found = res.data.find((c) => c.id === activeId) || null;
          setSelectedCamera(found);
          fetchStatusAndResults(activeId);
        }
        return activeId;
      });
    } catch (err: any) {
      toastError(err.message || 'Failed to load cameras');
    } finally {
      setIsLoading(false);
    }
  }, [user?.hostelId, toastError, fetchStatusAndResults]);

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
            setTimeout(() => {
              setActiveBoxes((prev) => prev.filter((b) => b.id !== obs.id));
            }, 2500);
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

    const interval = setInterval(() => {
      recognitionApi.getStatus(selectedCameraId).then(setSessionStatus).catch(() => {});
    }, 3000);

    return () => clearInterval(interval);
  }, [selectedCameraId]);

  // 5. Draw bounding boxes on canvas overlay
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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

      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 3;
      ctx.strokeRect(bbox.x, bbox.y, bbox.width, bbox.height);
      ctx.fillStyle = fillColor;
      ctx.fillRect(bbox.x, bbox.y, bbox.width, bbox.height);

      // Label background & text
      ctx.font = 'bold 12px Inter, system-ui, sans-serif';
      const textWidth = ctx.measureText(label).width;
      const labelY = Math.max(16, bbox.y - 6);

      ctx.fillStyle = strokeColor;
      ctx.fillRect(bbox.x, labelY - 14, textWidth + 8, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, bbox.x + 4, labelY);
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
    const cam = cameras.find((c) => c.id === id) || null;
    setSelectedCamera(cam);
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

  useEffect(() => {
    if (latestResidentMatch?.resident?.id) {
      residentsApi
        .getResident(latestResidentMatch.resident.id)
        .then((res) => {
          setActiveResidentDetails(res);
          if (res.presence?.currentState) {
            setActiveResidentPresence(res.presence.currentState);
          }
        })
        .catch(() => {});
    }
  }, [latestResidentMatch?.resident?.id]);

  return (
    <div className="recognition-page-container">
      {/* Page Header */}
      <div className="page-header-row mb-6">
        <div>
          <h1 className="page-title text-2xl font-bold flex items-center gap-2">
            <Eye className="text-primary-500" size={24} />
            Gate Monitor
            <span className="text-slate-500 text-sm font-normal">Face Recognition</span>
          </h1>
          <p className="page-subtitle text-slate-600 text-sm mt-1">
            Live resident identification and supervised gate movement controls.
          </p>
        </div>

        {/* Camera Selector & Session Controls */}
        <div className="flex items-center gap-3">
          <div className="camera-select-wrapper">
            <select
              aria-label="Select Camera"
              className="form-select min-w-[220px]"
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
          </div>

          {canManageSession ? (
            isRunning ? (
              <button
                type="button"
                className="btn btn-danger flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded bg-rose-600 hover:bg-rose-700 text-white shadow"
                onClick={handleStopRecognition}
                disabled={isActionPending}
                data-testid="stop-recognition-btn"
              >
                <Square size={16} />
                <span>Stop Recognition</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded bg-emerald-600 hover:bg-emerald-700 text-white shadow"
                onClick={handleStartRecognition}
                disabled={isActionPending || !selectedCamera?.isEnabled}
                data-testid="start-recognition-btn"
              >
                <Play size={16} />
                <span>Start Recognition</span>
              </button>
            )
          ) : (
            <div className="flex items-center gap-2">
              <span
                className={`px-3 py-1.5 text-xs font-semibold rounded-full border ${
                  isRunning
                    ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40'
                    : 'bg-slate-800 text-slate-300 border-slate-700'
                }`}
              >
                {isRunning ? '● Gate Recognition Active' : '○ Standby'}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Gate Monitor & Telemetry Status Bar */}
      <div className="gate-monitor-summary-card mb-6 grid grid-cols-1 md:grid-cols-4 gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800 shadow-md">
        <div className="gate-role-cell flex flex-col gap-0.5">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Active Gate & Role</span>
          <span className="text-base font-bold text-slate-100 flex items-center gap-1.5">
            <span>{selectedCamera?.name || 'Gate Camera'}</span>
            <span
              className={`text-xs px-2 py-0.5 rounded font-mono font-bold uppercase ${
                selectedCamera?.role === 'IN'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : selectedCamera?.role === 'OUT'
                  ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                  : 'bg-slate-800 text-slate-300 border border-slate-700'
              }`}
            >
              {selectedCamera?.role || 'GENERAL'}
            </span>
          </span>
        </div>

        <div className="rec-state-cell flex flex-col gap-0.5">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Recognition</span>
          <span className="text-base font-bold flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                isRunning ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
              }`}
            />
            <span className={isRunning ? 'text-emerald-400' : 'text-slate-400'}>
              {isRunning ? 'RUNNING' : 'STOPPED'}
            </span>
          </span>
        </div>

        <div className="automation-state-cell flex flex-col gap-0.5">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Movement Automation</span>
          {(() => {
            const isRoleMovement = selectedCamera?.role === 'IN' || selectedCamera?.role === 'OUT';
            const isCamAutoEnabled = selectedCamera?.configMetadata?.movementAutomationEnabled !== false;
            const isGlobalAuto = automationStatus?.globalAutomationEnabled ?? false;
            const isAutomationActive = isRoleMovement && isCamAutoEnabled && isGlobalAuto;

            return (
              <span className="text-base font-bold flex items-center gap-1.5">
                <span
                  className={`text-xs px-2.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                    isAutomationActive
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                  data-testid="movement-automation-indicator"
                >
                  Movement automation: {isAutomationActive ? 'ENABLED' : 'DISABLED'}
                </span>
              </span>
            );
          })()}
        </div>

        <div className="presence-stats-cell flex flex-col gap-0.5">
          <span className="text-xs text-slate-400 uppercase tracking-wider font-semibold">Hostel Presence</span>
          <div className="text-sm font-semibold flex items-center gap-3">
            <span className="text-emerald-400 flex items-center gap-1">
              <span>Inside hostel:</span>
              <strong className="text-white text-base font-bold">{presenceCounts?.currentlyIn ?? '—'}</strong>
            </span>
            <span className="text-slate-500">•</span>
            <span className="text-amber-400 flex items-center gap-1">
              <span>Outside hostel:</span>
              <strong className="text-white text-base font-bold">{presenceCounts?.currentlyOut ?? '—'}</strong>
            </span>
          </div>
        </div>
      </div>

      {/* Main Grid: Video Stream on Left, Live Observations on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Live Camera + HUD */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          <div className="camera-viewport-card bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg">
            {/* Top Toolbar */}
            <div className="viewport-header px-4 py-3 bg-slate-800/80 border-b border-slate-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Video size={16} className="text-slate-400" />
                <span className="font-semibold text-sm text-slate-200">
                  {selectedCamera?.name || 'Camera View'}
                </span>
                <span className="text-xs text-slate-400">
                  ({selectedCamera?.role || 'GENERAL'})
                </span>
              </div>

              {/* Status Badge */}
              <div className="flex items-center gap-2">
                <span
                  data-testid="recognition-status-badge"
                  className={`status-chip text-xs px-2.5 py-1 rounded-full font-medium flex items-center gap-1.5 ${
                    isRunning
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : sessionStatus?.state === 'ERROR'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-slate-700 text-slate-300'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isRunning
                        ? 'bg-emerald-400 animate-pulse'
                        : sessionStatus?.state === 'ERROR'
                        ? 'bg-rose-400'
                        : 'bg-slate-400'
                    }`}
                  />
                  {sessionStatus?.state || 'STOPPED'}
                </span>
              </div>
            </div>

            {/* Video Viewport Container */}
            <div
              ref={videoContainerRef}
              className="relative aspect-video bg-black flex items-center justify-center overflow-hidden"
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
                    className="w-full h-full object-contain"
                  />
                  {/* Canvas Overlay for Bounding Boxes */}
                  <canvas
                    ref={canvasRef}
                    width={640}
                    height={480}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />
                  <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 shadow">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Live Laptop Camera</span>
                  </div>
                  <button
                    type="button"
                    onClick={stopLaptopCamera}
                    className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-lg transition"
                  >
                    Switch to Server Stream
                  </button>
                </>
              ) : selectedCameraId && !streamError ? (
                <>
                  <img
                    src={camerasApi.getPreviewStreamUrl(selectedCameraId)}
                    alt="Live Camera Feed"
                    className="w-full h-full object-contain"
                    onError={() => setStreamError('Stream disconnected or unavailable')}
                  />
                  {/* Canvas Overlay for Bounding Boxes */}
                  <canvas
                    ref={canvasRef}
                    width={640}
                    height={480}
                    className="absolute inset-0 w-full h-full pointer-events-none"
                  />
                  <button
                    type="button"
                    onClick={startLaptopCamera}
                    className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-lg transition flex items-center gap-1"
                  >
                    <CameraIcon size={12} />
                    <span>Use Laptop Camera</span>
                  </button>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-400 p-6 text-center gap-3">
                  <CameraIcon size={48} className="opacity-40" />
                  <p className="text-sm font-medium text-slate-200">Camera Feed Offline</p>
                  <p className="text-xs text-slate-400 max-w-sm">
                    {cameraError || streamError || 'Server camera adapter is offline. Click below to stream directly from your laptop.'}
                  </p>
                  <button
                    type="button"
                    onClick={startLaptopCamera}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center gap-1.5 shadow transition"
                  >
                    <CameraIcon size={13} />
                    <span>Start Laptop Camera</span>
                  </button>
                </div>
              )}

              {/* HUD Telemetry Bar (Bottom overlay) */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 flex items-center justify-between text-xs text-slate-300">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 font-mono">
                    <Activity size={13} className="text-emerald-400" />
                    FPS: {sessionStatus?.processingFps || 0} / {sessionStatus?.configuredMaxFps || 5}
                  </span>
                  <span className="flex items-center gap-1 font-mono">
                    <Layers size={13} className="text-sky-400" />
                    Frames: {sessionStatus?.framesProcessed || 0}
                  </span>
                  <span className="flex items-center gap-1 font-mono">
                    <UserCheck size={13} className="text-indigo-400" />
                    Enrolled Residents: {sessionStatus?.eligibleTemplates || 0}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-xs">Hostel Node Scoped</span>
                </div>
              </div>
            </div>

            {/* Metrics Breakdown Bar */}
            <div className="px-4 py-3 bg-slate-900 border-t border-slate-800 grid grid-cols-4 gap-2 text-center text-xs">
              <div className="bg-slate-800/60 p-2 rounded border border-slate-700/50">
                <span className="text-emerald-400 font-semibold block text-base">
                  {sessionStatus?.matches || 0}
                </span>
                <span className="text-slate-400">Stable MATCH</span>
              </div>
              <div className="bg-slate-800/60 p-2 rounded border border-slate-700/50">
                <span className="text-amber-400 font-semibold block text-base">
                  {sessionStatus?.uncertains || 0}
                </span>
                <span className="text-slate-400">UNCERTAIN</span>
              </div>
              <div className="bg-slate-800/60 p-2 rounded border border-slate-700/50">
                <span className="text-purple-400 font-semibold block text-base">
                  {sessionStatus?.unknowns || 0}
                </span>
                <span className="text-slate-400">UNKNOWN</span>
              </div>
              <div className="bg-slate-800/60 p-2 rounded border border-slate-700/50">
                <span className="text-rose-400 font-semibold block text-base">
                  {sessionStatus?.qualityInsufficients || 0}
                </span>
                <span className="text-slate-400">Low Quality</span>
              </div>
            </div>
          </div>

          {/* Operational Policy Notice */}
          <div className="isolation-notice bg-slate-900/60 border border-slate-800/80 rounded-lg p-3 text-xs text-slate-400 flex items-start gap-2.5">
            <AlertCircle size={16} className="text-sky-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-300">Passive Observation Mode</span>
              <p className="mt-0.5 text-slate-400 leading-relaxed">
                Configured gate cameras (IN / OUT) automatically create resident movement records from stable MATCH observations. Attendance sessions and leave automation remain decoupled.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Live Person Identified + Gate Decision Action + Observations Feed */}
        <div className="lg:col-span-1 flex flex-col gap-4">
          {/* Prominent Current Identified Resident & IN/OUT Action Card */}
          <div
            className="identified-person-card p-4 rounded-xl border shadow-lg transition-all"
            style={{
              backgroundColor: 'var(--bg-surface-elevated)',
              borderColor: latestResidentMatch ? 'var(--primary-subtle)' : 'var(--border-subtle)',
            }}
          >
            <div className="flex items-center justify-between pb-3 border-b border-slate-700/50 mb-3">
              <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck size={14} className="text-emerald-400" />
                Current Resident at Gate
              </span>
              {latestResidentMatch && (
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  {typeof latestResidentMatch.similarity === 'number'
                    ? `${(latestResidentMatch.similarity * 100).toFixed(0)}% Match`
                    : 'Matched'}
                </span>
              )}
            </div>

            {latestResidentMatch?.resident ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-14 h-14 rounded-lg overflow-hidden border-2 border-slate-600 bg-slate-800 shrink-0 flex items-center justify-center shadow">
                    <img
                      src={residentsApi.getProfilePhotoUrl(latestResidentMatch.resident.id)}
                      alt={latestResidentMatch.resident.fullName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <UserIcon size={24} className="text-slate-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-base font-bold text-slate-100 truncate">
                      {latestResidentMatch.resident.fullName}
                    </div>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      {latestResidentMatch.resident.residentCode} • {latestResidentMatch.resident.roomGroup || activeResidentDetails?.roomGroup || 'Resident'}
                    </div>
                    <div className="mt-1">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold ${
                          activeResidentPresence === 'IN'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {activeResidentPresence === 'IN' ? '● Currently INSIDE' : '○ Currently OUTSIDE'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Direct Action Button based strictly on Resident Presence (Requirement 20) */}
                <div className="pt-2 border-t border-slate-700/50 flex flex-col gap-2">
                  {activeResidentPresence === 'IN' ? (
                    <button
                      type="button"
                      onClick={() => handleInitiateConfirm(latestResidentMatch.resident, 'OUT')}
                      disabled={isConfirmingMovement}
                      className="w-full px-4 py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white shadow transition-all"
                    >
                      <LogOut size={18} />
                      <span>MARK OUT (Exit)</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleInitiateConfirm(latestResidentMatch.resident, 'IN')}
                      disabled={isConfirmingMovement}
                      className="w-full px-4 py-3 rounded-lg font-bold text-sm flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow transition-all"
                    >
                      <LogIn size={18} />
                      <span>MARK IN (Entry)</span>
                    </button>
                  )}
                  <span className="text-[11px] text-slate-400 text-center">
                    Resident is currently {activeResidentPresence === 'IN' ? 'inside' : 'outside'} — click to record {activeResidentPresence === 'IN' ? 'exit' : 'entry'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-6 flex flex-col items-center justify-center text-center text-slate-500">
                <CameraIcon size={32} className="mb-2 opacity-40 text-slate-400" />
                <p className="text-sm font-semibold text-slate-300">Awaiting Resident at Gate</p>
                <p className="text-xs text-slate-500 mt-1 max-w-[240px]">
                  When a resident stands in front of the camera, their details and Mark In / Out buttons appear here.
                </p>
              </div>
            )}
          </div>

          <div className="feed-card bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col h-[480px]">
            {/* Feed Tabs Header */}
            <div className="feed-header px-4 py-2.5 bg-slate-800/80 border-b border-slate-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFeedTab('observations')}
                  className={`text-xs font-semibold px-2.5 py-1 rounded transition-all ${
                    feedTab === 'observations'
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Observations ({observations.length})
                </button>
                <button
                  type="button"
                  onClick={() => setFeedTab('movements')}
                  className={`text-xs font-semibold px-2.5 py-1 rounded transition-all ${
                    feedTab === 'movements'
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Gate Feed ({recentMovements.length})
                </button>
              </div>
            </div>

            {feedTab === 'movements' ? (
              /* Recent Gate Movement Decisions Feed (Requirement 35) */
              <div className="feed-list p-3 overflow-y-auto flex-1 flex flex-col gap-2">
                {recentMovements.length === 0 ? (
                  <div className="text-center py-12 text-slate-500 text-xs flex flex-col items-center">
                    <Clock size={32} className="mb-2 opacity-30" />
                    <p>No recent gate movements recorded</p>
                  </div>
                ) : (
                  recentMovements.map((mov) => {
                    const movTime = new Date(mov.effectiveTimestamp).toLocaleTimeString();
                    const isIN = mov.movementType === 'IN';

                    return (
                      <div
                        key={mov.id}
                        className="movement-feed-item p-2.5 rounded-lg bg-slate-800/50 border border-slate-700/50 flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="font-mono text-slate-400 text-[11px]">{movTime}</span>
                          <span className="font-semibold text-slate-200">
                            {mov.resident?.fullName || mov.residentId}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                              isIN
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                            }`}
                          >
                            {mov.movementType}
                          </span>
                          <span className="text-[11px] text-slate-400 truncate max-w-[90px]">
                            {mov.camera?.name || 'Gate'}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            ) : (
              /* Scrollable Observations List */
              <div className="feed-list p-3 overflow-y-auto flex-1 flex flex-col gap-2.5">
              {observations.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-xs flex flex-col items-center">
                  <Eye size={32} className="mb-2 opacity-30" />
                  <p>No recognition events yet</p>
                  <p className="mt-1 text-slate-600">Start recognition to begin passive face identification</p>
                </div>
              ) : (
                observations.map((obs) => {
                  const isMatch = obs.classification === 'MATCH';
                  const isUncertain = obs.classification === 'UNCERTAIN';
                  const isUnknown = obs.classification === 'UNKNOWN';
                  const isQualityInsufficient = obs.classification === 'QUALITY_INSUFFICIENT';

                  const badgeClass = isMatch
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : isUncertain
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : isQualityInsufficient
                    ? 'bg-rose-500/10 text-rose-400 border-rose-500/30'
                    : 'bg-purple-500/10 text-purple-400 border-purple-500/30';

                  const timeStr = new Date(obs.detectedAt).toLocaleTimeString();

                  return (
                    <div
                      key={obs.id}
                      className="observation-card p-3 rounded-lg bg-slate-800/50 border border-slate-700/50 flex flex-col gap-1.5 transition-all hover:border-slate-600"
                      data-testid={`observation-${obs.classification.toLowerCase()}`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`classification-badge text-[11px] font-bold px-2 py-0.5 rounded border uppercase tracking-wider ${badgeClass}`}
                        >
                          {obs.classification === 'QUALITY_INSUFFICIENT' ? 'QUALITY INSUFFICIENT' : obs.classification}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">{timeStr}</span>
                      </div>

                      {/* Content based on Classification */}
                      {isMatch && obs.resident && (
                        <div className="resident-match-info mt-1 flex items-start gap-2.5">
                          <div className="w-10 h-10 rounded overflow-hidden border border-slate-700 bg-slate-800 shrink-0 flex items-center justify-center">
                            <img
                              src={residentsApi.getProfilePhotoUrl(obs.resident.id)}
                              alt=""
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <UserIcon size={18} className="text-slate-500" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm text-slate-200">
                              {obs.resident.fullName}
                            </div>
                            <div className="text-xs text-slate-400 flex items-center justify-between mt-0.5">
                              <span>Code: {obs.resident.residentCode}</span>
                              {typeof obs.similarity === 'number' && (
                                <span className="text-emerald-400 font-mono">
                                  sim: {(obs.similarity * 100).toFixed(1)}%
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Supervised Movement Confirm Buttons */}
                      {isMatch && obs.resident && canControl && (
                        <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-700/50">
                          <button
                            type="button"
                            onClick={() => handleInitiateConfirm(obs.resident, 'IN')}
                            disabled={isConfirmingMovement}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1"
                          >
                            <LogIn size={12} />
                            <span>Confirm Entry</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleInitiateConfirm(obs.resident, 'OUT')}
                            disabled={isConfirmingMovement}
                            className="px-2.5 py-1 text-xs font-semibold rounded bg-amber-600 hover:bg-amber-700 text-white flex items-center gap-1"
                          >
                            <LogOut size={12} />
                            <span>Confirm Exit</span>
                          </button>
                        </div>
                      )}

                      {/* Movement Decision Status Banner */}
                      <div className="movement-decision-block mt-2 pt-2 border-t border-slate-700/50 text-xs">
                        {isMatch ? (
                          obs.movementDecision ? (
                            obs.movementDecision.status === 'MOVEMENT_CREATED' ? (
                              <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                                <span>
                                  Movement Decision: <strong>{obs.movementDecision.direction} RECORDED</strong> (Presence: {obs.movementDecision.currentPresence})
                                </span>
                              </div>
                            ) : obs.movementDecision.status === 'ALREADY_IN' ? (
                              <div className="font-semibold text-sky-400 flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                                <span>Already IN — duplicate suppressed</span>
                              </div>
                            ) : obs.movementDecision.status === 'ALREADY_OUT' ? (
                              <div className="font-semibold text-sky-400 flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                                <span>Already OUT — duplicate suppressed</span>
                              </div>
                            ) : obs.movementDecision.status === 'TRANSITION_SUPPRESSED' ? (
                              <div className="font-semibold text-amber-400 flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                                <span>Transition suppressed (rapid opposite movement)</span>
                              </div>
                            ) : obs.movementDecision.status === 'AUTOMATION_DISABLED' ? (
                              <div className="font-semibold text-slate-400 flex items-center gap-1.5">
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-500" />
                                <span>Movement automation disabled — No movement recorded</span>
                              </div>
                            ) : obs.movementDecision.status === 'CAMERA_NOT_MOVEMENT_CAPABLE' ? (
                              <div className="text-slate-400">
                                Camera role {selectedCamera?.role || 'GENERAL'} — No movement action
                              </div>
                            ) : (
                              <div className="text-slate-400">
                                Decision: {obs.movementDecision.status}
                              </div>
                            )
                          ) : (
                            <div className="text-slate-400">Movement Decision: Evaluating...</div>
                          )
                        ) : isUnknown ? (
                          <div className="text-slate-400 font-medium">UNKNOWN No movement action</div>
                        ) : isUncertain ? (
                          <div className="text-slate-400 font-medium">UNCERTAIN No movement action</div>
                        ) : (
                          <div className="text-slate-400 font-medium">QUALITY INSUFFICIENT No movement action</div>
                        )}
                      </div>

                      {isUncertain && (
                        <div className="uncertain-info text-xs text-amber-300/80 mt-0.5">
                          Ambiguous match or low candidate separation. Identity kept private.
                        </div>
                      )}

                      {isUnknown && (
                        <div className="unknown-info text-xs text-slate-400 mt-0.5">
                          No enrolled hostel resident matched confidently.
                        </div>
                      )}

                      {isQualityInsufficient && (
                        <div className="quality-insufficient-info text-xs text-rose-300/90 mt-0.5">
                          Face detected — quality insufficient ({obs.qualityReason || 'unusable frame'}). Biometric comparison omitted.
                        </div>
                      )}

                      {!obs.qualityUsable && obs.qualityReason && !isQualityInsufficient && (
                        <div className="quality-warning text-[10px] text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-900/50 mt-1">
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
          <form onSubmit={handleOverrideSubmit} className="space-y-4">
            <div className="p-3 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 rounded border border-amber-200 dark:border-amber-900 text-xs">
              The camera role is set for the opposite direction. An audit reason is mandatory to record this movement override.
            </div>

            {overrideError && (
              <div className="p-3 bg-rose-50 text-rose-700 text-xs rounded border border-rose-200">
                {overrideError}
              </div>
            )}

            <div>
              <label htmlFor="gateOverrideReason" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Override Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                id="gateOverrideReason"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Resident permitted to exit through entrance turnstile"
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-primary focus:outline-none dark:bg-slate-800"
                rows={3}
                required
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
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
