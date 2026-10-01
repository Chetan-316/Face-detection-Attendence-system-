import React, { useEffect, useState, useCallback, useRef } from 'react';
import { camerasApi } from '../api/cameras.api';
import { movementsApi } from '../api/movements.api';
import { recognitionApi } from '../api/recognition.api';
import { residentsApi } from '../api/residents.api';
import { CameraEntity } from '../types/camera.types';
import { RecognitionObservation } from '../types/recognition.types';
import { MovementEventEntity, PresenceCounts } from '../types/movement.types';
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
  RefreshCw,
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
  const eventSourceRef = useRef<EventSource | null>(null);
  const resetTimerRef = useRef<any>(null);

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
        const { streamToken } = await recognitionApi.getStreamToken(selectedCameraId);
        if (!isMounted) return;

        const streamUrl = recognitionApi.getEventsStreamUrl(selectedCameraId, streamToken);
        const es = new EventSource(streamUrl);
        eventSourceRef.current = es;

        es.addEventListener('observation', (event: MessageEvent) => {
          try {
            const obs: RecognitionObservation = JSON.parse(event.data);

            // Never process if an action is currently pending
            if (isConfirming) return;

            setActiveObservation(obs);
            setLastActionSuccessMsg(null);

            if (obs.classification === 'MATCH' && obs.resident) {
              // Fetch latest live locked presence state
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
  const handleMarkMovement = async () => {
    if (!activeObservation?.resident || !selectedCamera || isConfirming) return;

    const resident = activeObservation.resident;
    const targetDirection = activeResidentPresence === 'IN' ? 'OUT' : 'IN';

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

      // Refresh recent movements & presence counts
      fetchMovementData();

      // Hold card for 2.5s to show success state, then smoothly return to waiting
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      resetTimerRef.current = setTimeout(() => {
        setActiveObservation(null);
        setLastActionSuccessMsg(null);
      }, 2500);
    } catch (err: any) {
      toastError(err.message || 'Failed to record gate movement');
    } finally {
      setIsConfirming(false);
    }
  };

  const isMatch = activeObservation?.classification === 'MATCH' && activeObservation.resident;
  const isUnknown = activeObservation?.classification === 'UNKNOWN';
  const isLowQuality = activeObservation?.classification === 'QUALITY_INSUFFICIENT';

  return (
    <div className="gate-page flex flex-col gap-6 max-w-7xl mx-auto w-full">
      {/* Top Header: Gate Name, Online Indicator, Presence Counters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800 text-white shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center text-blue-400">
            <CameraIcon size={20} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-100">
                {selectedCamera?.name || 'Main Gate'}
              </h1>
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Online
              </span>
            </div>
            <p className="text-xs text-slate-400">Hostel Entry & Exit Operations</p>
          </div>
        </div>

        {/* Occupancy Counters & Simple Camera Selector if multiple exist */}
        <div className="flex items-center gap-4">
          {cameras.length > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Gate:</span>
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
                className="bg-slate-800 border border-slate-700 text-white rounded px-2.5 py-1 text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {cameras.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="flex items-center gap-3 border-l border-slate-800 pl-4">
            <div className="text-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">Inside</span>
              <span className="text-base font-extrabold text-emerald-400 font-mono">
                {presenceCounts?.currentlyIn ?? '—'}
              </span>
            </div>
            <div className="text-center">
              <span className="text-[10px] uppercase tracking-wider text-slate-400 block font-semibold">Outside</span>
              <span className="text-base font-extrabold text-amber-400 font-mono">
                {presenceCounts?.currentlyOut ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 2-Column Gate Operations Grid: Live Camera Stream + Recognition Action Card */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Live Camera Video Stream (7 cols) */}
        <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
          <div className="px-4 py-2.5 bg-slate-850 border-b border-slate-800 flex items-center justify-between text-xs">
            <span className="font-semibold text-slate-200 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              Live Camera Feed
            </span>
            <span className="text-slate-400 font-mono text-[11px]">
              {selectedCamera?.sourceType || 'WEBCAM'}
            </span>
          </div>

          <div className="relative bg-black flex items-center justify-center overflow-hidden min-h-[360px] sm:min-h-[420px]">
            {selectedCameraId && !streamError ? (
              <img
                src={camerasApi.getPreviewStreamUrl(selectedCameraId)}
                alt="Gate Live Feed"
                className="w-full h-full object-contain"
                onError={() => setStreamError('Stream interrupted')}
              />
            ) : (
              <div className="flex flex-col items-center justify-center text-slate-500 p-8 text-center gap-2">
                <CameraIcon size={44} className="opacity-40" />
                <p className="text-sm font-semibold text-slate-300">Camera Feed Connecting</p>
                <p className="text-xs text-slate-500 max-w-xs">
                  {cameras.length === 0
                    ? 'No camera configured for this gate.'
                    : 'Awaiting video frames from camera service...'}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Resident Recognition & 1-Click Action Card (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 shadow-sm flex flex-col justify-between min-h-[360px]">
          {/* Action Success Confirmation Banner */}
          {lastActionSuccessMsg ? (
            <div className="my-auto py-10 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
                <Check size={28} />
              </div>
              <h3 className="text-lg font-bold text-slate-100">{lastActionSuccessMsg}</h3>
              <p className="text-xs text-slate-400">Gate movement recorded successfully.</p>
            </div>
          ) : isMatch && activeObservation?.resident ? (
            /* State 2: Resident Recognized */
            <div className="flex flex-col gap-5 flex-1 justify-between">
              <div>
                <span className="text-xs uppercase tracking-wider font-bold text-emerald-400 block mb-3">
                  Resident Recognized
                </span>

                <div className="flex items-center gap-4">
                  {/* Profile Photo */}
                  <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-800 border-2 border-slate-700 shrink-0 flex items-center justify-center shadow">
                    <img
                      src={residentsApi.getProfilePhotoUrl(activeObservation.resident.id)}
                      alt={activeObservation.resident.fullName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <UserIcon size={32} className="text-slate-500" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <h2 className="text-xl font-bold text-slate-100 truncate">
                      {activeObservation.resident.fullName}
                    </h2>
                    <p className="text-xs font-mono text-slate-400 mt-0.5">
                      {activeObservation.resident.residentCode} • {activeObservation.resident.roomGroup || 'Room 101'}
                    </p>
                    <div className="mt-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-bold ${
                          activeResidentPresence === 'IN'
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {activeResidentPresence === 'IN' ? '● Currently Inside' : '○ Currently Outside'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Exactly ONE Action Button based on Presence (Requirements 20, 21) */}
              <div className="pt-4 border-t border-slate-800 flex flex-col gap-2">
                {activeResidentPresence === 'IN' ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="w-full text-base font-bold bg-amber-600 hover:bg-amber-500 text-white shadow-lg py-3.5"
                    onClick={handleMarkMovement}
                    isLoading={isConfirming}
                    disabled={isConfirming}
                    leftIcon={<LogOut size={20} />}
                  >
                    MARK OUT (Exit)
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="primary"
                    size="lg"
                    className="w-full text-base font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg py-3.5"
                    onClick={handleMarkMovement}
                    isLoading={isConfirming}
                    disabled={isConfirming}
                    leftIcon={<LogIn size={20} />}
                  >
                    MARK IN (Entry)
                  </Button>
                )}
                <span className="text-[11px] text-slate-400 text-center">
                  Click to confirm {activeResidentPresence === 'IN' ? 'exit' : 'entry'} for resident
                </span>
              </div>
            </div>
          ) : isUnknown ? (
            /* State 3: Unknown Person (Requirement 27) */
            <div className="my-auto py-8 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-rose-500/10 text-rose-400 flex items-center justify-center border border-rose-500/20">
                <UserX size={28} />
              </div>
              <h3 className="text-base font-bold text-rose-400">Person not identified</h3>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                Ask the resident to contact the Warden if they have not been enrolled.
              </p>
            </div>
          ) : isLowQuality ? (
            /* State 4: Low Quality Face */
            <div className="my-auto py-8 flex flex-col items-center justify-center text-center gap-3">
              <div className="w-14 h-14 rounded-full bg-amber-500/10 text-amber-400 flex items-center justify-center border border-amber-500/20">
                <AlertTriangle size={28} />
              </div>
              <h3 className="text-base font-bold text-amber-400">Face not clear enough</h3>
              <p className="text-xs text-slate-400 max-w-xs leading-relaxed">
                Please ask the resident to face the camera directly.
              </p>
            </div>
          ) : (
            /* State 1: Waiting for Resident (Requirement 19) */
            <div className="my-auto py-12 flex flex-col items-center justify-center text-center gap-3 text-slate-500">
              <div className="w-14 h-14 rounded-full bg-slate-800/80 text-slate-400 flex items-center justify-center border border-slate-700/60">
                <Eye size={28} />
              </div>
              <h3 className="text-base font-semibold text-slate-300">Waiting for resident...</h3>
              <p className="text-xs text-slate-500 max-w-xs leading-relaxed">
                Resident identity and movement option will appear automatically when standing in front of the camera.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Recent Gate Activity Log (Requirement 32) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
        <div className="px-4 py-3 bg-slate-850 border-b border-slate-800 flex items-center justify-between text-xs">
          <h3 className="font-semibold text-slate-200">Recent Gate Activity</h3>
          <span className="text-slate-400">Live Operator Log</span>
        </div>

        <div className="overflow-x-auto">
          {recentMovements.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-xs">
              No recent gate activity recorded.
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400 uppercase tracking-wider bg-slate-900/50">
                  <th className="py-2.5 px-4 font-semibold">Time</th>
                  <th className="py-2.5 px-4 font-semibold">Resident</th>
                  <th className="py-2.5 px-4 font-semibold">Code</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Direction</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {recentMovements.map((mov) => {
                  const time = new Date(mov.effectiveTimestamp).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  });
                  const isIN = mov.movementType === 'IN';

                  return (
                    <tr key={mov.id} className="hover:bg-slate-800/40 transition-colors">
                      <td className="py-2.5 px-4 font-mono text-slate-400">{time}</td>
                      <td className="py-2.5 px-4 font-medium text-slate-200">
                        {mov.resident?.fullName || mov.residentId}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-slate-400">
                        {mov.resident?.residentCode || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-bold ${
                            isIN
                              ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
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
    </div>
  );
};
export default GatePage;
