import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { camerasApi } from '../api/cameras.api';
import { recognitionApi } from '../api/recognition.api';
import { CameraEntity } from '../types/camera.types';
import {
  RecognitionObservation,
  RecognitionSessionStatus,
} from '../types/recognition.types';
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

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActionPending, setIsActionPending] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  const videoContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const pollIntervalRef = useRef<number | null>(null);

  const canControl = user?.role === 'ADMIN' || user?.role === 'WARDEN';

  // 1. Fetch available cameras for user scope
  const fetchCameras = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await camerasApi.listCameras(user?.hostelId || undefined);
      setCameras(res.data);

      const activeId = selectedCameraId || (res.data.length > 0 ? res.data[0].id : '');
      if (activeId) {
        setSelectedCameraId(activeId);
        const found = res.data.find((c) => c.id === activeId) || null;
        setSelectedCamera(found);
        fetchStatusAndResults(activeId);
      }
    } catch (err: any) {
      toastError(err.message || 'Failed to load cameras');
    } finally {
      setIsLoading(false);
    }
  }, [user?.hostelId, selectedCameraId, toastError]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  // 2. Fetch recognition status & initial observations when camera changes
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

  useEffect(() => {
    if (selectedCameraId) {
      fetchStatusAndResults(selectedCameraId);
    }
  }, [selectedCameraId, fetchStatusAndResults]);

  // 3. Connect to live SSE recognition stream
  useEffect(() => {
    if (!selectedCameraId) return;

    // Close previous SSE connection if any
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    if (typeof EventSource !== 'undefined') {
      try {
        const streamUrl = recognitionApi.getEventsStreamUrl(selectedCameraId);
        const es = new EventSource(streamUrl);
        eventSourceRef.current = es;

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
          // SSE fallback: poll status and results every 2 seconds
          if (!pollIntervalRef.current) {
            pollIntervalRef.current = window.setInterval(() => {
              if (selectedCameraId) {
                fetchStatusAndResults(selectedCameraId);
              }
            }, 2000);
          }
        };
      } catch (err) {
        console.warn('SSE connection failed, falling back to polling:', err);
      }
    } else {
      // Fallback polling for environments without EventSource (e.g. tests or older clients)
      if (!pollIntervalRef.current) {
        pollIntervalRef.current = window.setInterval(() => {
          if (selectedCameraId) {
            fetchStatusAndResults(selectedCameraId);
          }
        }, 2000);
      }
    }

    return () => {
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

      if (!qualityUsable) {
        strokeColor = '#f59e0b'; // amber
        fillColor = 'rgba(245, 158, 11, 0.15)';
        label = 'QUALITY LOW';
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

  const isRunning = sessionStatus?.state === 'RUNNING';

  return (
    <div className="recognition-page-container">
      {/* Page Header */}
      <div className="page-header-row mb-6">
        <div>
          <h1 className="page-title text-2xl font-bold flex items-center gap-2">
            <Eye className="text-primary-500" size={24} />
            Face Recognition Monitor
          </h1>
          <p className="page-subtitle text-slate-400 text-sm mt-1">
            Continuous local face recognition & classification (MATCH / UNCERTAIN / UNKNOWN) — Observation Mode
          </p>
        </div>

        {/* Camera Selector & Session Controls */}
        <div className="flex items-center gap-3">
          <div className="camera-select-wrapper">
            <select
              aria-label="Select Camera"
              className="select-input bg-slate-800 border-slate-700 text-white rounded px-3 py-2 text-sm"
              value={selectedCameraId}
              onChange={handleCameraChange}
              disabled={isLoading || isActionPending}
            >
              {cameras.map((cam) => (
                <option key={cam.id} value={cam.id}>
                  {cam.name} ({cam.role})
                </option>
              ))}
            </select>
          </div>

          {canControl ? (
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
            <div className="guard-view-badge text-xs px-3 py-2 rounded bg-slate-800 text-slate-400 border border-slate-700 flex items-center gap-1">
              <Shield size={14} />
              <span>Guard: View-Only Access</span>
            </div>
          )}
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
              {selectedCameraId && !streamError ? (
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
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-500 p-6 text-center">
                  <CameraIcon size={48} className="mb-2 opacity-40" />
                  <p className="text-sm font-medium">Camera Feed Offline</p>
                  <p className="text-xs text-slate-600 mt-1 max-w-sm">
                    {streamError || 'Start camera adapter to initiate live preview'}
                  </p>
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
                    Eligible Templates: {sessionStatus?.eligibleTemplates || 0}
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-slate-400 text-xs">Hostel Node Scoped</span>
                </div>
              </div>
            </div>

            {/* Metrics Breakdown Bar */}
            <div className="px-4 py-3 bg-slate-900 border-t border-slate-800 grid grid-cols-3 gap-2 text-center text-xs">
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
            </div>
          </div>

          {/* Isolation Notice Alert */}
          <div className="isolation-notice bg-slate-900/60 border border-slate-800/80 rounded-lg p-3 text-xs text-slate-400 flex items-start gap-2.5">
            <AlertCircle size={16} className="text-sky-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-slate-300">Passive Observation Mode</span>
              <p className="mt-0.5 text-slate-400 leading-relaxed">
                Face recognition operates strictly as an identity observer. It does NOT create attendance records, mark IN/OUT movements, or alter resident presence status.
              </p>
            </div>
          </div>
        </div>

        {/* Right Column: Live Recognition Observations Feed */}
        <div className="lg:col-span-1 flex flex-col gap-3">
          <div className="feed-card bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-lg flex flex-col h-[600px]">
            <div className="feed-header px-4 py-3 bg-slate-800/80 border-b border-slate-700/60 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock size={16} className="text-slate-400" />
                <h3 className="text-sm font-semibold text-slate-200">Recent Observations</h3>
              </div>
              <span className="text-xs text-slate-400">{observations.length} items</span>
            </div>

            {/* Scrollable Observations List */}
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

                  const badgeClass = isMatch
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : isUncertain
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
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
                          {obs.classification}
                        </span>
                        <span className="text-[11px] text-slate-400 font-mono">{timeStr}</span>
                      </div>

                      {/* Content based on 3-State Classification */}
                      {isMatch && obs.resident && (
                        <div className="resident-match-info mt-1">
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
                      )}

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

                      {!obs.qualityUsable && obs.qualityReason && (
                        <div className="quality-warning text-[10px] text-rose-400 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-900/50 mt-1">
                          Quality flag: {obs.qualityReason}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecognitionPage;
