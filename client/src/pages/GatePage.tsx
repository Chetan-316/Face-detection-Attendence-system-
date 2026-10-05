import React, { useEffect, useState, useCallback, useRef } from 'react';
import { camerasApi } from '../api/cameras.api';
import { movementsApi } from '../api/movements.api';
import { recognitionApi } from '../api/recognition.api';
import { residentsApi } from '../api/residents.api';
import { CameraEntity } from '../types/camera.types';
import { RecognitionObservation } from '../types/recognition.types';
import { MovementEventEntity, PresenceCounts } from '../types/movement.types';
import { RegisterRegularComerModal } from '../features/gate/RegisterRegularComerModal';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { Button } from '../components/Button';
import {
  Camera as CameraIcon,
  LogIn,
  LogOut,
  AlertTriangle,
  UserX,
  User as UserIcon,
  Check,
  Eye,
  UserPlus,
  Scan,
  Search,
  X,
  RefreshCw,
  Sparkles,
} from 'lucide-react';

export const GatePage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [selectedCamera, setSelectedCamera] = useState<CameraEntity | null>(null);

  const [presenceCounts, setPresenceCounts] = useState<PresenceCounts | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementEventEntity[]>([]);

  // Current session observation state
  const [activeObservation, setActiveObservation] = useState<RecognitionObservation | null>(null);
  const [activeResidentPresence, setActiveResidentPresence] = useState<'IN' | 'OUT'>('OUT');
  const [isConfirming, setIsConfirming] = useState<boolean>(false);
  const [lastActionSuccessMsg, setLastActionSuccessMsg] = useState<string | null>(null);

  const [streamError, setStreamError] = useState<string | null>(null);
  const [isRegisterVisitorOpen, setIsRegisterVisitorOpen] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const resetTimerRef = useRef<any>(null);

  // Direct Laptop Browser Webcam Support
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [isCameraActive, setIsCameraActive] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isScanningFace, setIsScanningFace] = useState<boolean>(false);

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
    } catch (err: any) {
      console.warn('Webcam access error:', err);
      setCameraError(err.message || 'Permission denied. Please allow camera access in browser address bar.');
      setIsCameraActive(false);
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
    setIsCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    };
  }, []);

  // Auto-attempt start on mount
  useEffect(() => {
    startLaptopCamera();
  }, [startLaptopCamera]);

  const handleRegisterVisitorSuccess = () => {
    fetchMovementData();
  };

  // Fetch gate cameras
  const fetchCameras = useCallback(async () => {
    try {
      const res = await camerasApi.listCameras(user?.hostelId || undefined);
      const list = res.data || [];
      setCameras(list);

      const activeId = selectedCameraId || (list.length > 0 ? list[0].id : '');
      if (activeId) {
        setSelectedCameraId(activeId);
        const cam = list.find((c) => c.id === activeId) || list[0];
        setSelectedCamera(cam);
      }
    } catch (err: any) {
      toastError(err.message || 'Failed to load gate cameras');
    }
  }, [user?.hostelId, selectedCameraId, toastError]);

  useEffect(() => {
    fetchCameras();
  }, [fetchCameras]);

  // Fetch recent gate movements & presence counts
  const fetchMovementData = useCallback(async () => {
    try {
      const [counts, movs] = await Promise.all([
        movementsApi.getPresenceCounts(user?.hostelId || undefined).catch(() => null),
        movementsApi.getMovements({ hostelId: user?.hostelId || undefined, pageSize: 8 }).catch(() => ({ data: [] })),
      ]);
      if (counts) setPresenceCounts(counts);
      if (movs?.data) setRecentMovements(movs.data);
    } catch (e) {}
  }, [user?.hostelId]);

  useEffect(() => {
    fetchMovementData();
    const interval = setInterval(fetchMovementData, 5000);
    return () => clearInterval(interval);
  }, [fetchMovementData]);

  // Capture webcam frame from video and submit to backend recognition
  const captureAndProcessFrame = useCallback(async () => {
    if (!videoRef.current || !selectedCameraId || isConfirming || isScanningFace) return;
    try {
      const video = videoRef.current;
      if (video.videoWidth === 0 || video.videoHeight === 0) return;

      setIsScanningFace(true);
      const canvas = document.createElement('canvas');
      canvas.width = Math.min(640, video.videoWidth);
      canvas.height = Math.min(480, video.videoHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const b64 = canvas.toDataURL('image/jpeg', 0.75);

      const res = await recognitionApi.processFrame(selectedCameraId, b64);
      if (res.observation) {
        if (res.observation.classification === 'MATCH' && res.observation.resident) {
          setActiveObservation(res.observation);
          const pres = await movementsApi.getResidentPresence(res.observation.resident.id).catch(() => null);
          if (pres?.currentState) {
            setActiveResidentPresence(pres.currentState as 'IN' | 'OUT');
          }
          if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
          resetTimerRef.current = setTimeout(() => {
            setActiveObservation(null);
          }, 12000);
        } else if (res.observation.classification === 'UNKNOWN') {
          setActiveObservation(res.observation);
          if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
          resetTimerRef.current = setTimeout(() => {
            setActiveObservation(null);
          }, 2500);
        } else if (res.observation.classification === 'UNCERTAIN') {
          setActiveObservation(res.observation);
          if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
          resetTimerRef.current = setTimeout(() => {
            setActiveObservation(null);
          }, 2500);
        }
      }
    } catch (err) {
      // background capture non-blocking
    } finally {
      setIsScanningFace(false);
    }
  }, [selectedCameraId, isConfirming, isScanningFace]);

  // Periodic auto-scan when laptop camera is active (every 1.8 seconds)
  useEffect(() => {
    if (!isCameraActive || isConfirming) return;
    const interval = setInterval(() => {
      if (!activeObservation || activeObservation.classification !== 'MATCH') {
        captureAndProcessFrame();
      }
    }, 1800);
    return () => clearInterval(interval);
  }, [isCameraActive, isConfirming, activeObservation, captureAndProcessFrame]);

  // Connect live recognition stream via SSE using short-lived stream token
  useEffect(() => {
    if (!selectedCameraId) return;

    let isMounted = true;

    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const connectStream = async () => {
      try {
        // Auto-start recognition if not currently running
        if (user?.role === 'ADMIN' || user?.role === 'WARDEN') {
          try {
            const st = await recognitionApi.getStatus(selectedCameraId);
            if (st.state !== 'RUNNING') {
              await recognitionApi.startRecognition(selectedCameraId);
            }
          } catch {}
        }

        const { streamToken } = await recognitionApi.getStreamToken(selectedCameraId);
        if (!isMounted) return;

        const streamUrl = recognitionApi.getEventsStreamUrl(selectedCameraId, streamToken);
        const es = new EventSource(streamUrl);
        eventSourceRef.current = es;

        es.addEventListener('observation', (event: MessageEvent) => {
          try {
            const obs: RecognitionObservation = JSON.parse(event.data);

            if (isConfirming) return;

            setActiveObservation(obs);
            setLastActionSuccessMsg(null);

            if (obs.classification === 'MATCH' && obs.resident) {
              movementsApi.getResidentPresence(obs.resident.id).then((pres) => {
                if (isMounted && pres?.currentState) {
                  setActiveResidentPresence(pres.currentState as 'IN' | 'OUT');
                }
              }).catch(() => {});
            }
          } catch (e) {}
        });

        es.onerror = () => {
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          if (isMounted) {
            setTimeout(connectStream, 3000);
          }
        };
      } catch (err) {
        if (isMounted) {
          setTimeout(connectStream, 4000);
        }
      }
    };

    connectStream();

    // Fallback polling for recognition observations in environments without EventSource
    const pollInterval = setInterval(() => {
      if (selectedCameraId && isMounted && !isConfirming) {
        recognitionApi.getResults(selectedCameraId, 1).then((res) => {
          if (res.results && res.results.length > 0) {
            const latest = res.results[0];
            const ageMs = Date.now() - new Date(latest.detectedAt).getTime();
            // Discard observations older than 6 seconds so historical matches do not ghost on gate monitor
            if (ageMs > 6000) return;

            setActiveObservation(latest);
            if (latest.classification === 'MATCH' && latest.resident) {
              movementsApi.getResidentPresence(latest.resident.id).then((pres) => {
                if (isMounted && pres?.currentState) {
                  setActiveResidentPresence(pres.currentState as 'IN' | 'OUT');
                }
              }).catch(() => {});
            }
          }
        }).catch(() => {});
      }
    }, 2500);

    return () => {
      isMounted = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      clearInterval(pollInterval);
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, [selectedCameraId, isConfirming]);

  // Execute movement action (MARK OUT or MARK IN)
  const handleMarkMovement = async (forcedDirection?: 'IN' | 'OUT') => {
    const resident = activeObservation?.resident;
    if (!resident || !selectedCamera || isConfirming) return;

    const targetDirection = forcedDirection || (activeResidentPresence === 'IN' ? 'OUT' : 'IN');

    setIsConfirming(true);
    setLastActionSuccessMsg(null);

    try {
      await movementsApi.confirmMovement({
        residentId: resident.id,
        cameraId: selectedCamera.id,
        direction: targetDirection,
      });

      const actionText = targetDirection === 'OUT' ? 'marked OUT' : 'marked IN';
      const successText = `${resident.fullName} ${actionText}.`;
      setLastActionSuccessMsg(successText);
      success(successText);

      fetchMovementData();
      setActiveResidentPresence(targetDirection);

      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        setActiveObservation(null);
        setLastActionSuccessMsg(null);
      }, 3500);
    } catch (err: any) {
      toastError(err.message || 'Failed to record gate movement');
    } finally {
      setIsConfirming(false);
    }
  };

  const isMatch = activeObservation?.classification === 'MATCH' && !!activeObservation.resident;
  const isUnknown = activeObservation?.classification === 'UNKNOWN';
  const isLowQuality = activeObservation?.classification === 'QUALITY_INSUFFICIENT';
  const isUncertain = activeObservation?.classification === 'UNCERTAIN';
  const cameraHealth = selectedCamera?.healthStatus || 'OFFLINE';
  const cameraIsOnline = cameraHealth === 'ONLINE';

  return (
    <div className="gate-page flex flex-col gap-6 max-w-7xl mx-auto w-full">
      {/* Top Header: Gate Name, Online Indicator, Presence Counters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-5 rounded-xl bg-white border border-slate-200 shadow-sm">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Gate Operations</h1>
            <span className="text-slate-400 font-light">|</span>
            <span className="text-lg font-semibold text-slate-700">{selectedCamera?.name || 'Main Gate'}</span>
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-13px font-semibold border ${
                cameraIsOnline
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'
              }`}
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  cameraIsOnline ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              {cameraIsOnline ? 'Camera Online' : 'Camera Attention'}
            </span>
          </div>
          <p className="text-15px text-slate-500 mt-0.5">Live resident movement and gate exceptions</p>
        </div>

        <div className="flex items-center gap-5">
          {cameras.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-slate-600 font-medium">Camera:</span>
              <select
                value={selectedCameraId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedCameraId(id);
                  const cam = cameras.find((c) => c.id === id) || null;
                  setSelectedCamera(cam);
                  setActiveObservation(null);
                  setLastActionSuccessMsg(null);
                }}
                className="bg-white border border-slate-300 text-slate-900 rounded-lg px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-4 border-l border-slate-200 pl-5 text-sm">
            <div>
              <span className="text-slate-500 block text-xs font-medium">Inside</span>
              <span className="text-lg font-bold text-emerald-700">
                {presenceCounts?.currentlyIn ?? '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-500 block text-xs font-medium">Outside</span>
              <span className="text-lg font-bold text-amber-700">
                {presenceCounts?.currentlyOut ?? '—'}
              </span>
            </div>
          </div>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => setIsRegisterVisitorOpen(true)}
            leftIcon={<UserPlus size={16} />}
            className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs sm:text-sm py-2 px-3 rounded-lg shadow-sm whitespace-nowrap ml-2"
          >
            Visitor / Exception
          </Button>
        </div>
      </div>

      {/* 2-Column Gate Operations Layout: Live Camera Stream + Recognition Action Card */}
      <div className="gate-operations-layout">
        {/* Left Column: Live Camera Video Stream (Dominant 440-480px height) */}
        <div className="gate-camera-col bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="relative bg-slate-900 flex items-center justify-center overflow-hidden min-h-[440px] sm:min-h-[480px] h-full">
            {isCameraActive ? (
              <div className="relative w-full h-full min-h-[440px] sm:min-h-[480px]">
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
                  className="w-full h-full object-cover"
                />
                <div className="absolute top-3 left-3 bg-black/60 backdrop-blur-md text-white px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 shadow">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span>Live Gate Camera</span>
                </div>
                <button
                  type="button"
                  onClick={stopLaptopCamera}
                  className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-lg transition"
                >
                  Turn Off
                </button>

                {/* Bottom Camera Action Bar */}
                <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between gap-2 bg-black/70 backdrop-blur-md px-3 py-2 rounded-xl border border-white/10 shadow-lg">
                  <div className="flex items-center gap-2 text-white text-xs font-medium">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <span>Automatic scan active</span>
                  </div>
                  <button
                    type="button"
                    onClick={captureAndProcessFrame}
                    disabled={isScanningFace || isConfirming}
                    className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow transition"
                  >
                    {isScanningFace ? <RefreshCw size={13} className="animate-spin" /> : <Scan size={13} />}
                    <span>{isScanningFace ? 'Scanning...' : 'Scan Now'}</span>
                  </button>
                </div>
              </div>
            ) : selectedCameraId && !streamError ? (
              <div className="relative w-full h-full">
                <img
                  src={camerasApi.getPreviewStreamUrl(selectedCameraId)}
                  alt="Gate Live Feed"
                  className="w-full h-full object-cover"
                  onError={() => setStreamError('Stream interrupted')}
                />
                <button
                  type="button"
                  onClick={startLaptopCamera}
                  className="absolute top-3 right-3 bg-black/60 hover:bg-black/80 backdrop-blur-md text-white text-xs px-2.5 py-1 rounded-lg transition flex items-center gap-1"
                >
                  <CameraIcon size={12} />
                  <span>Use Laptop Camera</span>
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-400 p-8 text-center gap-3">
                <CameraIcon size={48} className="text-slate-500" />
                <p className="text-base font-semibold text-slate-200">Laptop Camera Ready</p>
                <p className="text-sm text-slate-400 max-w-xs">
                  {cameraError
                    ? `Camera access: ${cameraError}`
                    : 'Click below to stream video directly from your laptop camera.'}
                </p>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={startLaptopCamera}
                  className="mt-2"
                >
                  Start Laptop Camera
                </Button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Resident Recognition & 1-Click Action Card */}
        <div className="gate-action-col bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col justify-between min-h-[440px] sm:min-h-[480px]">
          {/* Action Success Confirmation */}
          {lastActionSuccessMsg ? (
            <div className="my-auto py-8 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-16 h-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center border border-emerald-200">
                <Check size={32} />
              </div>
              <h3 className="text-xl font-bold text-slate-900">{lastActionSuccessMsg}</h3>
              <p className="text-sm text-slate-500">The resident presence has been updated.</p>
            </div>
          ) : isMatch && activeObservation?.resident ? (
            /* Recognized Resident Card - ONLY displayed when camera detects face */
            <div className="flex flex-col gap-4 flex-1 justify-between animate-fadeIn">
              <div>
                {/* Header status */}
                <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                      Resident Identified
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveObservation(null);
                    }}
                    className="text-xs font-semibold text-slate-400 hover:text-slate-600 flex items-center gap-1"
                  >
                    <X size={12} /> Dismiss
                  </button>
                </div>

                <div className="flex items-start gap-4">
                  {/* Profile Photo */}
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center">
                    <img
                      src={residentsApi.getProfilePhotoUrl(activeObservation.resident.id)}
                      alt={activeObservation.resident.fullName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <UserIcon size={32} className="text-slate-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h2 className="text-22px sm:text-24px font-bold text-slate-900 truncate leading-snug">
                      {activeObservation.resident.fullName}
                    </h2>
                    <p className="text-15px text-slate-600 mt-1 font-medium">
                      {activeObservation.resident.residentCode} • {activeObservation.resident.roomGroup || 'Room 101'}
                    </p>
                    <div className="mt-2.5">
                      <span
                        className={`inline-block px-3 py-1 rounded-md text-14px font-bold ${
                          activeResidentPresence === 'IN'
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {activeResidentPresence === 'IN' ? '● Currently Inside' : '○ Currently Outside'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Guard Action Buttons: MARK IN & MARK OUT */}
              <div className="pt-4 border-t border-slate-200 flex flex-col gap-2">
                <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
                  Record movement
                </span>
                <div className="grid grid-cols-2 gap-3">
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="h-13 text-base font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl shadow-sm flex items-center justify-center gap-2"
                    onClick={() => handleMarkMovement('IN')}
                    isLoading={isConfirming}
                    disabled={isConfirming}
                    leftIcon={<LogIn size={20} />}
                  >
                    Mark Inside
                  </Button>
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="h-13 text-base font-bold bg-amber-600 hover:bg-amber-700 text-white rounded-xl shadow-sm flex items-center justify-center gap-2"
                    onClick={() => handleMarkMovement('OUT')}
                    isLoading={isConfirming}
                    disabled={isConfirming}
                    leftIcon={<LogOut size={20} />}
                  >
                    Mark Outside
                  </Button>
                </div>
              </div>
            </div>
          ) : isUnknown ? (
            /* Person not identified */
            <div className="my-auto py-8 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-red-50 text-red-600 flex items-center justify-center border border-red-200">
                <UserX size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Person not recognized</h3>
              <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                The person could not be matched to an enrolled resident. Use the exception workflow if assistance is needed.
              </p>
              <div className="mt-2 w-full max-w-xs">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setIsRegisterVisitorOpen(true)}
                  leftIcon={<UserPlus size={16} />}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg shadow-sm"
                >
                  Open Exception Workflow
                </Button>
              </div>
            </div>
          ) : isUncertain ? (
            <div className="my-auto py-8 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
                <AlertTriangle size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Identity needs another look</h3>
              <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                Ask the resident to look toward the camera once more. No movement has been recorded.
              </p>
            </div>
          ) : isLowQuality ? (
            /* Face not clear enough */
            <div className="my-auto py-8 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200">
                <AlertTriangle size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-900">Camera needs a clearer view</h3>
              <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                Ask the resident to face the camera briefly and hold still. No movement has been recorded.
              </p>
            </div>
          ) : (
            /* Waiting for resident - pure camera detection flow */
            <div className="my-auto py-12 flex flex-col items-center justify-center text-center gap-4 text-slate-400">
              <div className="w-16 h-16 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center border border-blue-200 shadow-sm animate-pulse">
                <Eye size={30} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Ready for next resident</h3>
                <p className="text-sm text-slate-500 max-w-xs leading-relaxed mt-1">
                  The camera scans automatically. Movement controls appear after a resident is identified.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Recent Activity Log */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="text-lg font-bold text-slate-900">Recent Activity</h3>
        </div>

        <div className="overflow-x-auto">
          {recentMovements.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">
              No recent gate activity recorded.
            </div>
          ) : (
            <table className="w-full text-left text-15px border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600 bg-slate-50/50">
                  <th className="py-3.5 px-6 text-sm font-semibold">Time</th>
                  <th className="py-3.5 px-6 text-sm font-semibold">Resident</th>
                  <th className="py-3.5 px-6 text-sm font-semibold">Code</th>
                  <th className="py-3.5 px-6 text-sm font-semibold text-right">Movement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentMovements.map((mov) => {
                  const time = new Date(mov.effectiveTimestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const isIN = mov.movementType === 'IN';

                  return (
                    <tr key={mov.id} className="hover:bg-slate-50/80 transition-colors h-14">
                      <td className="py-3.5 px-6 text-slate-500 font-mono text-sm">{time}</td>
                      <td className="py-3.5 px-6 font-semibold text-slate-900">
                        {mov.resident?.fullName || mov.residentId}
                      </td>
                      <td className="py-3.5 px-6 text-slate-600 font-mono text-sm">
                        {mov.resident?.residentCode || '—'}
                      </td>
                      <td className="py-3.5 px-6 text-right">
                        <span
                          className={`inline-block px-3 py-1 rounded-md text-13px font-semibold ${
                            isIN
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          {mov.movementType}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <RegisterRegularComerModal
        isOpen={isRegisterVisitorOpen}
        onClose={() => setIsRegisterVisitorOpen(false)}
        onSuccess={handleRegisterVisitorSuccess}
        hostelId={user?.hostelId || undefined}
      />

    </div>
  );
};

export default GatePage;
