import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
import { camerasApi } from '../api/cameras.api';
import { movementsApi } from '../api/movements.api';
import { reportsApi } from '../api/reports.api';
import { recognitionApi } from '../api/recognition.api';
import { ResidentSummary } from '../types/resident.types';
import { CameraEntity } from '../types/camera.types';
import { PresenceCounts, MovementEventEntity } from '../types/movement.types';
import { RecognitionObservation } from '../types/recognition.types';
import { AttendanceSessionReportItem, MovementReportItem } from '../types/reports.types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Input } from '../components/Input';
import {
  Users,
  UserCheck,
  LogIn,
  LogOut,
  ScanFace,
  UserX,
  ArrowRight,
  RefreshCw,
  AlertCircle,
  Building,
  ShieldAlert,
  Video,
  CheckCircle2,
  Clock,
  Eye,
  Camera as CameraIcon,
  ShieldCheck,
  AlertTriangle,
  User as UserIcon,
} from 'lucide-react';

export const OverviewPage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  // Guard role redirect directly to Gate Monitor
  if (user?.role === 'GUARD') {
    return <Navigate to="/recognition" replace />;
  }

  const isWarden = user?.role === 'WARDEN';

  // State for metrics & summaries
  const [summary, setSummary] = useState<ResidentSummary | null>(null);
  const [presenceCounts, setPresenceCounts] = useState<PresenceCounts | null>(null);
  const [latestSession, setLatestSession] = useState<AttendanceSessionReportItem | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementReportItem[]>([]);
  const [hostelsCount, setHostelsCount] = useState<number>(1);
  const [camerasOnlineCount, setCamerasOnlineCount] = useState<number>(0);
  const [totalCamerasCount, setTotalCamerasCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Warden Gate Monitor states
  const [gateCameras, setGateCameras] = useState<CameraEntity[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [selectedCamera, setSelectedCamera] = useState<CameraEntity | null>(null);
  const [currentObservation, setCurrentObservation] = useState<RecognitionObservation | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState<boolean>(false);

  // Override Modal state
  const [overrideModalOpen, setOverrideModalOpen] = useState<boolean>(false);
  const [overrideDirection, setOverrideDirection] = useState<'IN' | 'OUT'>('IN');
  const [overrideReason, setOverrideReason] = useState<string>('');
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);

  const fetchOverviewData = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const [resSummary, presRes, attRes, movRes, camRes, hostelsRes] = await Promise.allSettled([
        residentsApi.getSummary(user?.hostelId || undefined),
        movementsApi.getPresenceCounts(user?.hostelId || undefined),
        reportsApi.getAttendanceSessions({ pageSize: 1, hostelId: user?.hostelId || undefined }),
        reportsApi.getMovements({ pageSize: 5, hostelId: user?.hostelId || undefined }),
        camerasApi.listCameras(user?.hostelId || undefined),
        residentsApi.listHostels(),
      ]);

      if (resSummary.status === 'fulfilled') {
        setSummary(resSummary.value);
      }
      if (presRes.status === 'fulfilled') {
        setPresenceCounts(presRes.value);
      }
      if (attRes.status === 'fulfilled' && attRes.value.data.length > 0) {
        setLatestSession(attRes.value.data[0]);
      }
      if (movRes.status === 'fulfilled') {
        setRecentMovements(movRes.value.data);
      }
      if (camRes.status === 'fulfilled') {
        const cams = camRes.value.data;
        setTotalCamerasCount(cams.length);
        setCamerasOnlineCount(cams.filter((c) => c.healthStatus === 'ONLINE').length);
        const gates = cams.filter((c) => c.role === 'IN' || c.role === 'OUT' || c.role === 'GENERAL');
        setGateCameras(gates);
        if (gates.length > 0 && !selectedCameraId) {
          setSelectedCameraId(gates[0].id);
          setSelectedCamera(gates[0]);
        }
      }
      if (hostelsRes.status === 'fulfilled') {
        setHostelsCount(hostelsRes.value.data.length || 1);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to retrieve overview metrics');
    } finally {
      setIsLoading(false);
    }
  }, [user?.hostelId, selectedCameraId]);

  useEffect(() => {
    fetchOverviewData();
  }, [fetchOverviewData]);

  // Connect SSE for Gate Camera stream observations in Warden view
  useEffect(() => {
    if (!isWarden || !selectedCameraId) return;

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
            setCurrentObservation(obs);
          } catch (e) {
            console.error('Error parsing observation:', e);
          }
        });

        es.onerror = () => {
          if (eventSourceRef.current) {
            eventSourceRef.current.close();
            eventSourceRef.current = null;
          }
          // Polling fallback
          if (isMounted && selectedCameraId) {
            recognitionApi.getResults(selectedCameraId, 1).then((res) => {
              if (res.results && res.results.length > 0) {
                setCurrentObservation(res.results[0]);
              }
            }).catch(() => {});
          }
        };
      } catch (err) {
        // SSE fallback polling
        recognitionApi.getResults(selectedCameraId, 1).then((res) => {
          if (res.results && res.results.length > 0) {
            setCurrentObservation(res.results[0]);
          }
        }).catch(() => {});
      }
    };

    connectStream();

    const pollTimer = setInterval(() => {
      if (selectedCameraId && isMounted) {
        recognitionApi.getResults(selectedCameraId, 1).then((res) => {
          if (res.results && res.results.length > 0) {
            setCurrentObservation(res.results[0]);
          }
        }).catch(() => {});
      }
    }, 3000);

    return () => {
      isMounted = false;
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      clearInterval(pollTimer);
    };
  }, [isWarden, selectedCameraId]);

  const handleCameraChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setSelectedCameraId(id);
    const cam = gateCameras.find((c) => c.id === id) || null;
    setSelectedCamera(cam);
    setCurrentObservation(null);
    setStreamError(null);
  };

  // Confirm Movement directly or open override modal if direction doesn't match camera role
  const handleInitiateConfirm = (direction: 'IN' | 'OUT') => {
    if (!currentObservation?.resident || !selectedCamera) return;

    // Check if direction overrides camera role
    const cameraRole = selectedCamera.role;
    const isOverride =
      (cameraRole === 'IN' && direction === 'OUT') ||
      (cameraRole === 'OUT' && direction === 'IN');

    if (isOverride) {
      setOverrideDirection(direction);
      setOverrideReason('');
      setOverrideError(null);
      setOverrideModalOpen(true);
    } else {
      executeConfirmMovement(direction);
    }
  };

  const executeConfirmMovement = async (direction: 'IN' | 'OUT', reason?: string) => {
    if (!currentObservation?.resident || !selectedCamera) return;

    try {
      setIsConfirming(true);
      await movementsApi.confirmMovement({
        residentId: currentObservation.resident.id,
        cameraId: selectedCamera.id,
        direction,
        overrideReason: reason,
      });

      success(`Successfully registered ${direction === 'IN' ? 'Entry' : 'Exit'} for ${currentObservation.resident.fullName}`);
      setOverrideModalOpen(false);
      setCurrentObservation(null);
      fetchOverviewData();
    } catch (err: any) {
      toastError(err.message || 'Failed to confirm resident movement');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleOverrideSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!overrideReason.trim()) {
      setOverrideError('An override reason is mandatory when altering camera direction');
      return;
    }
    executeConfirmMovement(overrideDirection, overrideReason.trim());
  };

  const isMovementAutomationEnabled = selectedCamera?.configMetadata?.movementAutomationEnabled !== false;

  return (
    <div className="overview-page">
      <PageHeader
        title={isWarden ? 'Warden Dashboard' : 'Hostel Overview'}
        subtitle={
          isWarden
            ? `Welcome, ${user?.fullName || user?.username}. Live gate monitoring, supervised movements, and hostel presence.`
            : `Welcome back, ${user?.fullName || user?.username}. Real-time facility occupancy, cameras, and roster status.`
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={fetchOverviewData}
            isLoading={isLoading}
            leftIcon={<RefreshCw size={14} />}
          >
            Refresh
          </Button>
        }
      />

      {error ? (
        <div className="alert-banner alert-banner-error mb-6" role="alert">
          <AlertCircle size={20} className="alert-icon" />
          <div className="alert-body">
            <span className="font-semibold">Failed to load overview data:</span> {error}
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={fetchOverviewData}>
                Try Again
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* ======================================================== */}
      {/* WARDEN DASHBOARD VIEW                                    */}
      {/* ======================================================== */}
      {isWarden && (
        <div className="warden-dashboard space-y-6">
          {/* Top Bar: Gate Selector & Movement Mode Badge */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800 text-white">
            <div className="flex items-center gap-3">
              <Video className="text-emerald-400" size={20} />
              <div>
                <span className="text-xs text-slate-400 block font-semibold uppercase">Supervised Gate Camera</span>
                {gateCameras.length > 0 ? (
                  <select
                    value={selectedCameraId}
                    onChange={handleCameraChange}
                    className="bg-slate-800 border border-slate-700 text-white rounded px-2.5 py-1 text-sm font-semibold focus:outline-none focus:ring-1 focus:ring-emerald-500 mt-0.5"
                  >
                    {gateCameras.map((cam) => (
                      <option key={cam.id} value={cam.id}>
                        {cam.name} ({cam.role === 'IN' ? 'Entry' : cam.role === 'OUT' ? 'Exit' : cam.role})
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-sm text-slate-300">No gate camera configured. Contact an administrator.</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                <ShieldCheck size={14} />
                <span>Movement Mode: {isMovementAutomationEnabled ? 'Supervised' : 'Manual'}</span>
              </span>
              <Link to="/recognition">
                <Button size="sm" variant="outline" rightIcon={<ArrowRight size={14} />}>
                  Full Gate Monitor
                </Button>
              </Link>
            </div>
          </div>

          {/* Main Operations Grid: Video Feed + Live Recognition Card */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Embedded Live Video Stream (7 cols) */}
            <div className="lg:col-span-7 flex flex-col gap-3">
              <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-md">
                <div className="px-4 py-2.5 bg-slate-800/80 border-b border-slate-700/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-sm font-semibold text-slate-200">
                      {selectedCamera?.name || 'Gate Camera'}
                    </span>
                    <span className="text-xs text-slate-400">
                      ({selectedCamera?.role === 'IN' ? 'Entry Gate' : selectedCamera?.role === 'OUT' ? 'Exit Gate' : 'General'})
                    </span>
                  </div>
                  <span className="text-xs text-slate-400 font-mono">LIVE PREVIEW</span>
                </div>

                <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                  {selectedCameraId && !streamError ? (
                    <img
                      src={camerasApi.getPreviewStreamUrl(selectedCameraId)}
                      alt="Gate Feed"
                      className="w-full h-full object-contain"
                      onError={() => setStreamError('Stream offline')}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-500 p-6 text-center">
                      <CameraIcon size={40} className="mb-2 opacity-40" />
                      <p className="text-sm font-medium">Camera Feed Offline</p>
                      <p className="text-xs text-slate-600 mt-1">
                        {gateCameras.length === 0
                          ? 'No gate camera configured. Contact an administrator.'
                          : 'Camera adapter is currently stopped.'}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Current Recognition Card & Supervised Actions (5 cols) */}
            <div className="lg:col-span-5 flex flex-col gap-4">
              <Card title="Current Recognition" subtitle="Real-time gate identity & supervised confirmation">
                {currentObservation && currentObservation.classification === 'MATCH' && currentObservation.resident ? (
                  <div className="flex flex-col gap-4 p-1">
                    <div className="flex items-start gap-4">
                      {/* Profile Photo Thumbnail */}
                      <div className="w-20 h-20 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0 flex items-center justify-center">
                        <img
                          src={typeof residentsApi.getProfilePhotoUrl === 'function' ? residentsApi.getProfilePhotoUrl(currentObservation.resident.id) : `/api/v1/residents/${currentObservation.resident.id}/profile-photo`}
                          alt={currentObservation.resident.fullName}
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.target as HTMLElement).style.display = 'none';
                          }}
                        />
                        <UserIcon size={32} className="text-slate-400" />
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-base font-bold text-slate-900 dark:text-white truncate">
                          {currentObservation.resident.fullName}
                        </h4>
                        <p className="text-xs font-mono text-slate-500 dark:text-slate-400">
                          {currentObservation.resident.residentCode}
                        </p>
                        {currentObservation.resident.roomGroup && (
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                            {currentObservation.resident.roomGroup}
                          </p>
                        )}
                        <p className="text-[11px] text-slate-400 mt-1">
                          Recognized at {selectedCamera?.name || 'Gate'} • {new Date(currentObservation.detectedAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>

                    <div className="p-2.5 rounded bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-300">
                      <strong>Suggested Action:</strong>{' '}
                      {selectedCamera?.role === 'OUT' ? 'Confirm EXIT (Leaving Hostel)' : 'Confirm ENTRY (Entering Hostel)'}
                    </div>

                    {/* Action Confirmation Buttons */}
                    <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleInitiateConfirm('IN')}
                        isLoading={isConfirming}
                        leftIcon={<LogIn size={14} />}
                      >
                        Confirm Entry
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleInitiateConfirm('OUT')}
                        isLoading={isConfirming}
                        leftIcon={<LogOut size={14} />}
                      >
                        Confirm Exit
                      </Button>
                    </div>
                  </div>
                ) : currentObservation && (currentObservation.classification === 'QUALITY_INSUFFICIENT' || !currentObservation.qualityUsable) ? (
                  <div className="p-6 text-center text-amber-600 dark:text-amber-400 flex flex-col items-center">
                    <AlertTriangle size={36} className="mb-2 opacity-80" />
                    <p className="text-sm font-semibold">Face not clear enough</p>
                    <p className="text-xs text-slate-500 mt-1">Please ask the person to face the camera directly.</p>
                  </div>
                ) : currentObservation && currentObservation.classification === 'UNKNOWN' ? (
                  <div className="p-6 text-center text-slate-500 flex flex-col items-center">
                    <UserX size={36} className="mb-2 opacity-60 text-rose-500" />
                    <p className="text-sm font-semibold text-rose-600 dark:text-rose-400">Person not identified</p>
                    <p className="text-xs text-slate-500 mt-1">Please verify identity manually before entry or exit.</p>
                  </div>
                ) : (
                  <div className="p-8 text-center text-slate-400 flex flex-col items-center">
                    <Eye size={36} className="mb-2 opacity-40" />
                    <p className="text-sm font-medium">Waiting for resident...</p>
                    <p className="text-xs text-slate-500 mt-1">Faces detected at gate will appear here for confirmation.</p>
                  </div>
                )}
              </Card>

              {/* Occupancy Count Card */}
              <div className="grid grid-cols-2 gap-3">
                <Card className="text-center p-3">
                  <span className="text-xs text-slate-500 block">Inside Hostel</span>
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {presenceCounts?.currentlyIn ?? summary?.currentlyIn ?? 0}
                  </span>
                </Card>
                <Card className="text-center p-3">
                  <span className="text-xs text-slate-500 block">Outside Hostel</span>
                  <span className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                    {presenceCounts?.currentlyOut ?? summary?.currentlyOut ?? 0}
                  </span>
                </Card>
              </div>
            </div>
          </div>

          {/* Operational Summaries: Today's Attendance & Recent Gate Activity */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card title="Latest Attendance Session" subtitle={latestSession ? latestSession.title : 'Night Attendance'}>
              <div className="flex justify-around items-center py-4 text-center">
                <div>
                  <span className="text-xs text-slate-500 block">Present</span>
                  <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {latestSession ? latestSession.presentCount : 0}
                  </span>
                </div>
                <div className="h-8 border-r border-slate-200 dark:border-slate-700" />
                <div>
                  <span className="text-xs text-slate-500 block">Absent</span>
                  <span className="text-2xl font-bold text-rose-600 dark:text-rose-400">
                    {latestSession ? latestSession.absentCount : 0}
                  </span>
                </div>
              </div>
              <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                <Link to="/attendance" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
                  Manage Attendance <ArrowRight size={12} />
                </Link>
              </div>
            </Card>

            <Card title="Recent Gate Activity" subtitle="Latest supervised resident movements">
              {recentMovements.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No recent gate movements logged.</p>
              ) : (
                <div className="space-y-2 py-1">
                  {recentMovements.slice(0, 4).map((m) => (
                    <div key={m.id} className="flex justify-between items-center text-xs py-1 border-b border-slate-100 dark:border-slate-800 last:border-none">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-400">
                          {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200 truncate max-w-[140px]">
                          {m.fullName}
                        </span>
                      </div>
                      <span className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                        m.direction === 'IN'
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400'
                          : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-400'
                      }`}>
                        {m.direction === 'IN' ? 'ENTRY' : 'EXIT'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="pt-3 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                <Link to="/reports" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
                  All Movement Logs <ArrowRight size={12} />
                </Link>
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* ADMIN OVERVIEW                                           */}
      {/* ======================================================== */}
      {!isWarden && (
        <div className="admin-overview space-y-6">
          {/* Primary Metrics Grid */}
          <div className="metrics-grid">
            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Hostels</span>
                <div className="metric-icon-wrap icon-blue">
                  <Building size={20} />
                </div>
              </div>
              <div className="metric-value">
                {isLoading ? <span className="skeleton-line" /> : hostelsCount}
              </div>
              <div className="metric-footer">
                <span>Configured hostel facilities</span>
              </div>
            </Card>

            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Total Residents</span>
                <div className="metric-icon-wrap icon-blue">
                  <Users size={20} />
                </div>
              </div>
              <div className="metric-value">
                {isLoading ? <span className="skeleton-line" /> : summary?.total ?? 0}
              </div>
              <div className="metric-footer">
                <span>Roster registered across hostels</span>
              </div>
            </Card>

            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Cameras Online</span>
                <div className="metric-icon-wrap icon-emerald">
                  <Video size={20} />
                </div>
              </div>
              <div className="metric-value text-emerald">
                {isLoading ? <span className="skeleton-line" /> : `${camerasOnlineCount} / ${totalCamerasCount}`}
              </div>
              <div className="metric-footer">
                <span>Gate & attendance network cameras</span>
              </div>
            </Card>

            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Currently IN</span>
                <div className="metric-icon-wrap icon-emerald">
                  <LogIn size={20} />
                </div>
              </div>
              <div className="metric-value text-emerald">
                {isLoading ? <span className="skeleton-line" /> : summary?.currentlyIn ?? 0}
              </div>
              <div className="metric-footer">
                <span>Inside hostel perimeter</span>
              </div>
            </Card>

            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Currently OUT</span>
                <div className="metric-icon-wrap icon-amber">
                  <LogOut size={20} />
                </div>
              </div>
              <div className="metric-value text-amber">
                {isLoading ? <span className="skeleton-line" /> : summary?.currentlyOut ?? 0}
              </div>
              <div className="metric-footer">
                <span>Outside hostel premises</span>
              </div>
            </Card>

            <Card className="metric-card">
              <div className="metric-header">
                <span className="metric-label">Face Enrolled</span>
                <div className="metric-icon-wrap icon-purple">
                  <ScanFace size={20} />
                </div>
              </div>
              <div className="metric-value">
                {isLoading ? <span className="skeleton-line" /> : summary?.faceEnrolled ?? 0}
              </div>
              <div className="metric-footer">
                <span>Pending: {summary?.notEnrolled ?? 0}</span>
              </div>
            </Card>
          </div>

          {/* Operational Summary Grid */}
          <div className="operational-summary-grid grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card title="Today's Hostel Status" subtitle="Authoritative presence count">
              <div className="flex justify-around items-center py-2 text-center">
                <div>
                  <span className="text-xs text-secondary block">Inside Hostel</span>
                  <span className="text-2xl font-bold text-emerald">
                    {presenceCounts ? presenceCounts.currentlyIn : summary?.currentlyIn ?? 0}
                  </span>
                </div>
                <div className="h-8 border-r border-border" />
                <div>
                  <span className="text-xs text-secondary block">Outside Hostel</span>
                  <span className="text-2xl font-bold text-amber">
                    {presenceCounts ? presenceCounts.currentlyOut : summary?.currentlyOut ?? 0}
                  </span>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-border flex justify-end">
                <Link to="/reports" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
                  View Movement Reports <ArrowRight size={12} />
                </Link>
              </div>
            </Card>

            <Card title="Latest Attendance" subtitle={latestSession ? latestSession.title : 'Night Attendance'}>
              <div className="flex justify-around items-center py-2 text-center">
                <div>
                  <span className="text-xs text-secondary block">Present</span>
                  <span className="text-2xl font-bold text-emerald">
                    {latestSession ? latestSession.presentCount : 0}
                  </span>
                </div>
                <div className="h-8 border-r border-border" />
                <div>
                  <span className="text-xs text-secondary block">Absent</span>
                  <span className="text-2xl font-bold text-amber">
                    {latestSession ? latestSession.absentCount : 0}
                  </span>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-border flex justify-end">
                <Link to="/reports" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
                  View Attendance Reports <ArrowRight size={12} />
                </Link>
              </div>
            </Card>

            <Card title="Recent Movement" subtitle="Latest gate transitions">
              {recentMovements.length === 0 ? (
                <p className="text-xs text-muted py-3 text-center">No recent gate movements logged.</p>
              ) : (
                <div className="space-y-2 py-1">
                  {recentMovements.slice(0, 3).map((m) => (
                    <div key={m.id} className="flex justify-between items-center text-xs">
                      <span className="font-mono text-muted">
                        {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span className="font-medium truncate max-w-[120px]">{m.fullName}</span>
                      <span className={`badge badge-sm badge-${m.direction === 'IN' ? 'success' : 'amber'}`}>
                        {m.direction}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-2 pt-2 border-t border-border flex justify-end">
                <Link to="/reports" className="text-xs text-primary font-medium hover:underline flex items-center gap-1">
                  All Movements <ArrowRight size={12} />
                </Link>
              </div>
            </Card>
          </div>

          {/* Scope & System Status */}
          <div className="overview-details-grid grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Facility & Operational Scope" subtitle="Current session security context">
              <div className="context-list space-y-4">
                <div className="context-item flex items-start gap-3">
                  <Building size={16} className="text-muted shrink-0 mt-1" />
                  <div>
                    <span className="context-item-label block text-xs text-slate-500 font-semibold">Scope</span>
                    <p className="context-item-value text-sm font-medium">All Hostels (Org-Wide Admin)</p>
                  </div>
                </div>

                <div className="context-item flex items-start gap-3">
                  <ShieldAlert size={16} className="text-muted shrink-0 mt-1" />
                  <div>
                    <span className="context-item-label block text-xs text-slate-500 font-semibold">Staff Role Authorization</span>
                    <p className="context-item-value text-sm font-medium">Full administrative authority across organization records and camera configurations.</p>
                  </div>
                </div>
              </div>

              <div className="mt-6 pt-4 border-t border-border flex justify-between items-center">
                <span className="text-sm text-secondary">
                  Manage resident roster or update status?
                </span>
                <Link to="/residents">
                  <Button size="sm" variant="primary" rightIcon={<ArrowRight size={14} />}>
                    Go to Residents
                  </Button>
                </Link>
              </div>
            </Card>

            <Card title="System Status" subtitle="Current platform capabilities">
              <div className="system-status-body space-y-3">
                <div className="status-row flex justify-between items-center text-sm">
                  <span className="status-label">Authentication Layer</span>
                  <span className="status-pill status-pill-success">ACTIVE & SECURED</span>
                </div>
                <div className="status-row flex justify-between items-center text-sm">
                  <span className="status-label">Resident REST API</span>
                  <span className="status-pill status-pill-success">OPERATIONAL</span>
                </div>
                <div className="status-row flex justify-between items-center text-sm">
                  <span className="status-label">PostgreSQL Database</span>
                  <span className="status-pill status-pill-success">SYNCHRONIZED</span>
                </div>
                <div className="status-row flex justify-between items-center text-sm">
                  <span className="status-label">Gate Recognition & Cameras</span>
                  <span className="status-pill status-pill-success">OPERATIONAL</span>
                </div>
                <div className="status-row flex justify-between items-center text-sm">
                  <span className="status-label">Biometric Engine</span>
                  <span className="status-pill status-pill-success">READY</span>
                </div>
              </div>
            </Card>
          </div>
        </div>
      )}

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
              <label htmlFor="overrideReasonInput" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase mb-1">
                Override Reason <span className="text-red-500">*</span>
              </label>
              <textarea
                id="overrideReasonInput"
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Resident exited through entry turnstile with warden permission"
                className="w-full px-3 py-2 text-sm border border-slate-300 dark:border-slate-700 rounded-lg focus:ring-1 focus:ring-primary focus:outline-none dark:bg-slate-800"
                rows={3}
                required
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <Button type="button" variant="outline" onClick={() => setOverrideModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isConfirming}>
                Confirm Override {overrideDirection}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default OverviewPage;
