import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { Modal } from '../components/Modal';
import {
  AttendanceSession,
  AttendanceRosterItem,
  AttendanceStats,
} from '../types/attendance.types';
import {
  getAttendanceSessions,
  getActiveAttendanceSession,
  getAttendanceRoster,
  createAttendanceSession,
  startAttendanceSession,
  closeAttendanceSession,
  correctAttendanceRecord,
  markAttendanceRecord,
} from '../api/attendance.api';
import { camerasApi } from '../api/cameras.api';
import { recognitionApi } from '../api/recognition.api';
import { residentsApi } from '../api/residents.api';
import { CameraEntity } from '../types/camera.types';
import {
  Calendar,
  Clock,
  CheckCircle2,
  XCircle,
  HelpCircle,
  AlertCircle,
  Search,
  Filter,
  Plus,
  Play,
  CheckSquare,
  Edit2,
  RefreshCw,
  Camera as CameraIcon,
  Users,
  Video,
  VideoOff,
  RotateCcw,
} from 'lucide-react';

export const AttendancePage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [activeSessionData, setActiveSessionData] = useState<AttendanceSession | null>(null);
  const [stats, setStats] = useState<AttendanceStats | null>(null);
  const [roster, setRoster] = useState<AttendanceRosterItem[]>([]);
  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Modals
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCloseConfirmOpen, setIsCloseConfirmOpen] = useState(false);
  const [correctingResident, setCorrectingResident] = useState<AttendanceRosterItem | null>(null);
  const [targetCorrectionStatus, setTargetCorrectionStatus] = useState<'PRESENT' | 'ABSENT'>('PRESENT');
  const [correctionReason, setCorrectionReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Create form state
  const [newSessionTitle, setNewSessionTitle] = useState('Night Attendance');
  const [newSessionType, setNewSessionType] = useState('NIGHT');
  const [newSessionCameraId, setNewSessionCameraId] = useState('');
  const [newSessionDate, setNewSessionDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [newSessionStartTime, setNewSessionStartTime] = useState('21:00');
  const [newSessionEndTime, setNewSessionEndTime] = useState('22:00');

  // Camera stream controls
  const [cameraMode, setCameraMode] = useState<'BACKEND' | 'DEVICE'>('BACKEND');
  const [selectedLiveCameraId, setSelectedLiveCameraId] = useState<string>('');
  const [streamStatus, setStreamStatus] = useState<'LOADING' | 'CONNECTED' | 'ERROR'>('LOADING');
  const [streamRetryKey, setStreamRetryKey] = useState(0);
  const [deviceCameraError, setDeviceCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  const canManage = user?.role === 'ADMIN' || user?.role === 'WARDEN';

  // Load initial data
  const loadData = async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);

      const [sessionsRes, activeRes, camerasRes] = await Promise.all([
        getAttendanceSessions(),
        getActiveAttendanceSession(),
        camerasApi.listCameras(),
      ]);

      const allCams = camerasRes.data || [];
      const sortedCams = [...allCams].sort((a, b) => {
        if (a.role === 'ATTENDANCE' && b.role !== 'ATTENDANCE') return -1;
        if (b.role === 'ATTENDANCE' && a.role !== 'ATTENDANCE') return 1;
        return 0;
      });

      setSessions(sessionsRes.sessions);
      setCameras(sortedCams);

      if (activeRes.activeSession) {
        setSelectedSessionId(activeRes.activeSession.id);
        setActiveSessionData(activeRes.activeSession);
        const rosterRes = await getAttendanceRoster(activeRes.activeSession.id);
        setStats(rosterRes.stats);
        setRoster(rosterRes.roster);

        if (activeRes.activeSession.camera?.id) {
          setSelectedLiveCameraId(activeRes.activeSession.camera.id);
        } else if (sortedCams.length > 0) {
          setSelectedLiveCameraId(sortedCams[0].id);
        }
      } else if (sessionsRes.sessions.length > 0 && !selectedSessionId) {
        const first = sessionsRes.sessions[0];
        setSelectedSessionId(first.id);
        setActiveSessionData(first);
        const rosterRes = await getAttendanceRoster(first.id);
        setStats(rosterRes.stats);
        setRoster(rosterRes.roster);

        if (first.camera?.id) {
          setSelectedLiveCameraId(first.camera.id);
        } else if (sortedCams.length > 0) {
          setSelectedLiveCameraId(sortedCams[0].id);
        }
      } else if (sortedCams.length > 0 && !selectedLiveCameraId) {
        setSelectedLiveCameraId(sortedCams[0].id);
      }
    } catch (err: any) {
      toastError(err.message || 'Failed to load attendance records');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const [currentResident, setCurrentResident] = useState<{
    id: string;
    fullName: string;
    residentCode: string;
    roomGroup: string;
    markedTime?: string;
  } | null>(null);

  // When selected session changes
  const handleSelectSession = async (sessionId: string) => {
    try {
      setSelectedSessionId(sessionId);
      setIsRefreshing(true);
      const rosterRes = await getAttendanceRoster(sessionId);
      setActiveSessionData(rosterRes.session);
      setStats(rosterRes.stats);
      setRoster(rosterRes.roster);
      if (rosterRes.session.camera?.id) {
        setSelectedLiveCameraId(rosterRes.session.camera.id);
      }
    } catch (err: any) {
      toastError(err.message || 'Failed to load session details');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Direct Browser Device Webcam handler
  useEffect(() => {
    if (cameraMode !== 'DEVICE' || activeSessionData?.status !== 'ACTIVE') {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
      return;
    }

    let isMounted = true;
    setDeviceCameraError(null);
    setStreamStatus('LOADING');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setDeviceCameraError('Browser does not support camera access via getUserMedia.');
      setStreamStatus('ERROR');
      return;
    }

    navigator.mediaDevices
      .getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      })
      .then((stream) => {
        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(() => {});
        }
        setStreamStatus('CONNECTED');
      })
      .catch((err) => {
        if (!isMounted) return;
        setDeviceCameraError(err.message || 'Unable to access device camera. Check browser permissions.');
        setStreamStatus('ERROR');
      });

  return () => {
      isMounted = false;
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((track) => track.stop());
        mediaStreamRef.current = null;
      }
    };
  }, [cameraMode, activeSessionData?.status]);

  // Live recognition subscriber for active attendance session
  useEffect(() => {
    if (!activeSessionData || activeSessionData.status !== 'ACTIVE') return;

    let isMounted = true;
    let eventSource: EventSource | null = null;
    const camId = selectedLiveCameraId || activeSessionData.camera?.id || (cameras.length > 0 ? cameras[0].id : '');

    if (!camId) return;

    const connectLiveRecognition = async () => {
      try {
        const { streamToken } = await recognitionApi.getStreamToken(camId);
        if (!isMounted) return;

        const streamUrl = recognitionApi.getEventsStreamUrl(camId, streamToken);
        eventSource = new EventSource(streamUrl);

        eventSource.addEventListener('observation', async (event: MessageEvent) => {
          try {
            const obs = JSON.parse(event.data);
            if (obs.classification === 'MATCH' && obs.resident) {
              const resident = obs.resident;
              const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

              setCurrentResident({
                id: resident.id,
                fullName: resident.fullName,
                residentCode: resident.residentCode,
                roomGroup: resident.roomGroup || '—',
                markedTime: timeStr,
              });

              await markAttendanceRecord(activeSessionData.id, resident.id, 'FACE_RECOGNITION');
              const updated = await getAttendanceRoster(activeSessionData.id);
              if (isMounted) {
                setStats(updated.stats);
                setRoster(updated.roster);
              }
            }
          } catch (e) {}
        });
      } catch (err) {}
    };

    connectLiveRecognition();

    const pollInterval = setInterval(async () => {
      if (!isMounted) return;
      try {
        const res = await recognitionApi.getResults(camId, 1);
        if (res.results && res.results.length > 0) {
          const latest = res.results[0];
          const ageMs = Date.now() - new Date(latest.detectedAt).getTime();
          // Filter out stale observations older than 6 seconds so old matches don't ghost
          if (ageMs > 6000) return;

          if (latest.classification === 'MATCH' && latest.resident) {
            const resident = latest.resident;
            const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            setCurrentResident({
              id: resident.id,
              fullName: resident.fullName,
              residentCode: resident.residentCode,
              roomGroup: resident.roomGroup || '—',
              markedTime: timeStr,
            });
            await markAttendanceRecord(activeSessionData.id, resident.id, 'FACE_RECOGNITION');
            const updated = await getAttendanceRoster(activeSessionData.id);
            if (isMounted) {
              setStats(updated.stats);
              setRoster(updated.roster);
            }
          }
        }
      } catch (e) {}
    }, 2500);

    return () => {
      isMounted = false;
      if (eventSource) eventSource.close();
      clearInterval(pollInterval);
    };
  }, [activeSessionData?.id, activeSessionData?.status, selectedLiveCameraId, cameras]);

  // Periodic frame processing when laptop webcam is active during an active session
  useEffect(() => {
    if (cameraMode !== 'DEVICE' || activeSessionData?.status !== 'ACTIVE') return;
    const camId = selectedLiveCameraId || activeSessionData?.camera?.id || (cameras.length > 0 ? cameras[0].id : '');
    if (!camId) return;

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

        const res = await recognitionApi.processFrame(camId, b64);
        if (res.observation?.classification === 'MATCH' && res.observation.resident && isMounted) {
          const resident = res.observation.resident;
          const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          setCurrentResident({
            id: resident.id,
            fullName: resident.fullName,
            residentCode: resident.residentCode,
            roomGroup: resident.roomGroup || '—',
            markedTime: timeStr,
          });

          await markAttendanceRecord(activeSessionData.id, resident.id, 'FACE_RECOGNITION');
          const updated = await getAttendanceRoster(activeSessionData.id);
          if (isMounted) {
            setStats(updated.stats);
            setRoster(updated.roster);
          }
        }
      } catch (err) {
        // Non-blocking background scan
      } finally {
        isScanning = false;
      }
    }, 2000);

    return () => {
      isMounted = false;
      clearInterval(scanInterval);
    };
  }, [cameraMode, activeSessionData?.id, activeSessionData?.status, selectedLiveCameraId, cameras]);

  // Create session
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionTitle.trim()) {
      toastError('Attendance Name is required');
      return;
    }

    try {
      setIsSubmitting(true);
      const dateStr = newSessionDate;
      const startDateTime = new Date(`${dateStr}T${newSessionStartTime}:00Z`).toISOString();
      const endDateTime = newSessionEndTime
        ? new Date(`${dateStr}T${newSessionEndTime}:00Z`).toISOString()
        : undefined;

      const res = await createAttendanceSession({
        title: newSessionTitle.trim(),
        sessionType: newSessionType,
        attendanceDate: new Date(dateStr).toISOString(),
        startTime: startDateTime,
        endTime: endDateTime,
        cameraId: newSessionCameraId || undefined,
      });

      success(`Created attendance session: ${res.session.title}`);
      setIsCreateModalOpen(false);
      await loadData();
      handleSelectSession(res.session.id);
    } catch (err: any) {
      toastError(err.message || 'Failed to create session');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Start session
  const handleStartSession = async () => {
    if (!selectedSessionId) return;
    try {
      setIsSubmitting(true);
      const res = await startAttendanceSession(selectedSessionId);
      success(`Session started: ${res.session.title}`);
      await handleSelectSession(selectedSessionId);
    } catch (err: any) {
      toastError(err.message || 'Failed to start session');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Close session
  const handleCloseSession = async () => {
    if (!selectedSessionId) return;
    try {
      setIsSubmitting(true);
      const res = await closeAttendanceSession(selectedSessionId);
      success(`Session closed: ${res.session.title}. Unmarked residents recorded as absent.`);
      setIsCloseConfirmOpen(false);
      await handleSelectSession(selectedSessionId);
    } catch (err: any) {
      toastError(err.message || 'Failed to close session');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit manual correction
  const handleSaveCorrection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!correctingResident || !selectedSessionId) return;
    if (!correctionReason.trim()) {
      toastError('Correction reason is mandatory');
      return;
    }

    try {
      setIsSubmitting(true);
      await correctAttendanceRecord(selectedSessionId, correctingResident.residentId, {
        status: targetCorrectionStatus,
        reason: correctionReason.trim(),
      });

      success(`Updated attendance for ${correctingResident.fullName}`);
      setCorrectingResident(null);
      setCorrectionReason('');
      await handleSelectSession(selectedSessionId);
    } catch (err: any) {
      toastError(err.message || 'Failed to update attendance');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Filtered roster
  const filteredRoster = useMemo(() => {
    return roster.filter((item) => {
      const matchesSearch =
        item.fullName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.residentCode.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.roomGroup.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (statusFilter === 'ALL') return true;
      if (statusFilter === 'PRESENT') return item.status === 'PRESENT' || item.status === 'CORRECTED_PRESENT';
      if (statusFilter === 'ABSENT') return item.status === 'ABSENT';
      if (statusFilter === 'NOT_RECORDED') return item.status === 'NOT_RECORDED';
      return true;
    });
  }, [roster, searchQuery, statusFilter]);

  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'PRESENT':
      case 'CORRECTED_PRESENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <CheckCircle2 size={13} className="text-emerald-600" />
            <span>Present</span>
          </span>
        );
      case 'ABSENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-red-50 text-red-800 border border-red-200">
            <XCircle size={13} className="text-red-600" />
            <span>Absent</span>
          </span>
        );
      case 'NOT_RECORDED':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            <HelpCircle size={13} className="text-slate-400" />
            <span>Not Recorded</span>
          </span>
        );
    }
  };

  const activeLiveCameraId = selectedLiveCameraId || activeSessionData?.camera?.id || (cameras.length > 0 ? cameras[0].id : '');
  const activeCameraObj = cameras.find((c) => c.id === activeLiveCameraId) || activeSessionData?.camera;

  const basePreviewUrl = activeLiveCameraId
    ? typeof (camerasApi as any)?.getPreviewStreamUrl === 'function'
      ? (camerasApi as any).getPreviewStreamUrl(activeLiveCameraId)
      : `/api/v1/cameras/${activeLiveCameraId}/preview`
    : '';
  const streamUrl = basePreviewUrl
    ? `${basePreviewUrl}${basePreviewUrl.includes('?') ? '&' : '?'}_k=${streamRetryKey}`
    : '';

  return (
    <div className="attendance-page max-w-7xl mx-auto space-y-6">
      {/* Top Header Card */}
      <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">Hostel Attendance</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Roll call, daily night attendance sessions, and attendance roster records
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="btn btn-secondary btn-sm"
            title="Refresh attendance data"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin text-blue-600' : ''} />
            <span>Refresh</span>
          </button>

          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="btn btn-primary btn-sm"
            >
              <Plus size={16} />
              <span>Create Attendance</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {isLoading ? (
        <div className="py-24 text-center bg-white rounded-xl border border-slate-200 shadow-sm">
          <RefreshCw size={32} className="animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">Loading attendance sessions...</p>
        </div>
      ) : sessions.length === 0 ? (
        /* Empty State */
        <div className="attendance-empty-panel bg-white border border-slate-200 rounded-xl p-12 text-center max-w-xl mx-auto my-8 shadow-sm">
          <div className="w-14 h-14 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100">
            <CheckSquare size={28} />
          </div>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Hostel Attendance</h2>
          <p className="text-base text-slate-600 mb-6 leading-relaxed">
            No attendance session is active.
            <br />
            Start attendance when you are ready to conduct roll call.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              aria-label="Start Attendance"
              className="btn btn-primary btn-md inline-flex items-center gap-2"
            >
              <Play size={18} />
              <span>Start Attendance</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Column: Sessions List */}
          <div className="lg:col-span-1 space-y-3">
            <h2 className="text-sm font-semibold text-slate-700 px-1">
              Attendance Sessions
            </h2>
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm divide-y divide-slate-100">
              {sessions.map((s) => {
                const isSelected = s.id === selectedSessionId;
                const isActive = s.status === 'ACTIVE';
                const isClosed = s.status === 'CLOSED';
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectSession(s.id)}
                    className={`w-full text-left p-3.5 transition flex flex-col gap-1 ${
                      isSelected ? 'bg-blue-50/80 border-l-4 border-blue-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <span className="font-semibold text-slate-900 text-sm truncate">{s.title}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded font-semibold ${
                          isActive
                            ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                            : isClosed
                            ? 'bg-slate-100 text-slate-700'
                            : 'bg-amber-50 text-amber-800 border border-amber-200'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <Calendar size={13} />
                      <span>{new Date(s.attendanceDate).toLocaleDateString()}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Selected/Active Session Card & Roster */}
          <div className="lg:col-span-3 space-y-6">
            {activeSessionData ? (
              <>
                {/* Active Session Overview Banner */}
                <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm space-y-5">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="text-22px font-bold text-slate-900">{activeSessionData.title}</h2>
                        <span
                          className={`text-xs px-3 py-1 rounded-full font-semibold ${
                            activeSessionData.status === 'ACTIVE'
                              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                              : activeSessionData.status === 'CLOSED'
                              ? 'bg-slate-100 text-slate-700'
                              : 'bg-amber-50 text-amber-800 border border-amber-200'
                          }`}
                        >
                          Status: {activeSessionData.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-slate-600">
                        <span className="flex items-center gap-1.5">
                          <Calendar size={15} className="text-slate-400" />
                          {new Date(activeSessionData.attendanceDate).toLocaleDateString(undefined, {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock size={15} className="text-slate-400" />
                          {new Date(activeSessionData.startTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          {activeSessionData.endTime &&
                            ` – ${new Date(activeSessionData.endTime).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}`}
                        </span>
                        {activeCameraObj && (
                          <span className="flex items-center gap-1.5">
                            <CameraIcon size={15} className="text-slate-400" />
                            {activeCameraObj.name}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Operational Action Controls */}
                    {canManage && (
                      <div className="flex items-center gap-3">
                        {activeSessionData.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={handleStartSession}
                            disabled={isSubmitting}
                            className="btn btn-primary btn-sm bg-emerald-600 hover:bg-emerald-700"
                          >
                            <Play size={16} />
                            <span>Start Session</span>
                          </button>
                        )}
                        {activeSessionData.status === 'ACTIVE' && (
                          <button
                            type="button"
                            onClick={() => setIsCloseConfirmOpen(true)}
                            disabled={isSubmitting}
                            className="btn btn-danger btn-sm"
                          >
                            <CheckSquare size={16} />
                            <span>Close Attendance</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Summary Metric Counters */}
                  {stats && (
                    <div className="grid grid-cols-3 gap-4 pt-1">
                      <div className="p-4 bg-emerald-50/70 border border-emerald-200/80 rounded-xl text-center">
                        <span className="block text-sm font-semibold text-emerald-800">
                          Present
                        </span>
                        <span className="text-3xl font-bold text-emerald-900 mt-1 block">
                          {stats.presentCount}
                        </span>
                      </div>
                      <div className="p-4 bg-amber-50/70 border border-amber-200/80 rounded-xl text-center">
                        <span className="block text-sm font-semibold text-amber-800">
                          Pending
                          <span className="sr-only">Remaining</span>
                        </span>
                        <span className="text-3xl font-bold text-amber-900 mt-1 block">
                          {stats.remainingCount}
                        </span>
                      </div>
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-center">
                        <span className="block text-sm font-semibold text-slate-700">
                          Total
                          <span className="sr-only">Expected</span>
                        </span>
                        <span className="text-3xl font-bold text-slate-900 mt-1 block">
                          {stats.expectedResidents}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Live Camera & Current Resident Display (When Active) */}
                {activeSessionData.status === 'ACTIVE' && (
                  <div className="attendance-active-layout">
                    {/* Live Camera Feed Card */}
                    <div className="attendance-camera-col bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
                      {/* Camera Control Toolbar Header */}
                      <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-slate-800 flex items-center gap-1.5">
                            <CameraIcon size={14} className="text-slate-500" />
                            {cameraMode === 'DEVICE' ? 'Browser Device Webcam' : activeCameraObj?.name || 'Attendance Camera'}
                          </span>

                          {/* Pulsing Status Dot */}
                          <span
                            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-semibold ${
                              streamStatus === 'CONNECTED'
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : streamStatus === 'LOADING'
                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : 'bg-red-50 text-red-700 border border-red-200'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${
                                streamStatus === 'CONNECTED'
                                  ? 'bg-emerald-500 animate-pulse'
                                  : streamStatus === 'LOADING'
                                  ? 'bg-amber-500'
                                  : 'bg-red-500'
                              }`}
                            />
                            {streamStatus === 'CONNECTED' ? 'Live' : streamStatus === 'LOADING' ? 'Connecting' : 'Offline'}
                          </span>
                        </div>

                        {/* Camera Switcher & Mode Toggles */}
                        <div className="flex items-center gap-2">
                          {cameras.length > 1 && cameraMode === 'BACKEND' && (
                            <select
                              value={activeLiveCameraId}
                              onChange={(e) => {
                                setSelectedLiveCameraId(e.target.value);
                                setStreamStatus('LOADING');
                              }}
                              className="text-xs border border-slate-300 rounded px-2 py-1 bg-white font-medium focus:ring-1 focus:ring-blue-500"
                              title="Switch active camera"
                            >
                              {cameras.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.name}
                                </option>
                              ))}
                            </select>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              if (cameraMode === 'BACKEND') {
                                setCameraMode('DEVICE');
                              } else {
                                setCameraMode('BACKEND');
                                setStreamRetryKey((k) => k + 1);
                                setStreamStatus('LOADING');
                              }
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 transition shadow-xs"
                            title="Toggle between Server Camera Stream and Direct Browser Webcam"
                          >
                            <Video size={13} />
                            <span>{cameraMode === 'DEVICE' ? 'Switch to Server Camera' : 'Use Direct Webcam'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Video Viewport Container */}
                      <div className="relative bg-slate-900 flex items-center justify-center overflow-hidden min-h-[360px] sm:min-h-[400px] flex-1">
                        {cameraMode === 'DEVICE' ? (
                          /* Direct HTML5 Web Browser Camera Stream */
                          <>
                            <video
                              ref={videoRef}
                              autoPlay
                              playsInline
                              muted
                              className="w-full h-full object-cover"
                            />
                            {deviceCameraError && (
                              <div className="absolute inset-0 bg-slate-900/90 flex flex-col items-center justify-center p-6 text-center text-slate-200 gap-3">
                                <VideoOff size={40} className="text-red-400" />
                                <div>
                                  <p className="font-semibold text-white text-base">Camera Access Restricted</p>
                                  <p className="text-xs text-slate-400 mt-1 max-w-sm">{deviceCameraError}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setCameraMode('BACKEND')}
                                  className="btn btn-secondary btn-sm bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
                                >
                                  Back to Server Stream
                                </button>
                              </div>
                            )}
                          </>
                        ) : activeLiveCameraId && streamStatus !== 'ERROR' ? (
                          /* Backend MJPEG Preview Stream */
                          <>
                            <img
                              src={streamUrl}
                              alt="Live Attendance Camera Feed"
                              className="w-full h-full object-cover"
                              onLoad={() => setStreamStatus('CONNECTED')}
                              onError={() => setStreamStatus('ERROR')}
                            />
                            {streamStatus === 'LOADING' && (
                              <div className="absolute inset-0 bg-slate-900/60 flex items-center justify-center">
                                <div className="flex items-center gap-2 text-white text-xs font-medium">
                                  <RefreshCw size={16} className="animate-spin text-blue-400" />
                                  <span>Connecting live feed...</span>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          /* Fallback Diagnostic Card (Stream offline or no camera assigned) */
                          <div className="flex flex-col items-center justify-center p-8 text-center gap-3 text-slate-300">
                            <div className="w-14 h-14 rounded-full bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400">
                              <CameraIcon size={28} />
                            </div>
                            <div>
                              <p className="text-base font-semibold text-white">Camera Stream Offline</p>
                              <p className="text-xs text-slate-400 max-w-xs mt-1 leading-relaxed">
                                {activeLiveCameraId
                                  ? 'The backend camera stream could not be reached, or no physical stream adapter is active.'
                                  : 'No active camera is assigned to this attendance session.'}
                              </p>
                            </div>
                            <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                              <button
                                type="button"
                                onClick={() => setCameraMode('DEVICE')}
                                className="btn btn-primary btn-sm"
                              >
                                <Video size={14} />
                                <span>Turn On Direct Webcam</span>
                              </button>
                              {activeLiveCameraId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setStreamStatus('LOADING');
                                    setStreamRetryKey((k) => k + 1);
                                  }}
                                  className="btn btn-secondary btn-sm bg-slate-800 text-white border-slate-700 hover:bg-slate-700"
                                >
                                  <RotateCcw size={14} />
                                  <span>Retry Stream</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Stream Watermark / Live Badge */}
                        <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm px-2.5 py-1 rounded-md text-[11px] font-mono text-slate-200 border border-white/10 flex items-center gap-2 pointer-events-none">
                          <span className="w-2 h-2 rounded-full bg-emerald-400" />
                          <span>{cameraMode === 'DEVICE' ? 'WEBCAM 720p' : (activeCameraObj as any)?.sourceType || 'STREAM'}</span>
                          <span>•</span>
                          <span>{activeSessionData.title}</span>
                        </div>
                      </div>
                    </div>

                    {/* Current Resident Card */}
                    <div className="attendance-resident-col bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col justify-between min-h-[360px]">
                      <div>
                        <h3 className="text-sm font-semibold text-slate-500 mb-4">
                          Current Resident
                        </h3>

                        {currentResident ? (
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-4">
                              <div className="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center shadow-sm">
                                <img
                                  src={residentsApi.getProfilePhotoUrl(currentResident.id)}
                                  alt={currentResident.fullName}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = 'none';
                                  }}
                                />
                                <Users size={32} className="text-slate-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="text-22px font-bold text-slate-900 truncate">
                                  {currentResident.fullName}
                                </h3>
                                <p className="text-15px text-slate-600 mt-1 font-medium">
                                  {currentResident.residentCode} • {currentResident.roomGroup}
                                </p>
                                <div className="mt-2.5">
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-sm font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                    <CheckCircle2 size={15} className="text-emerald-600" />
                                    PRESENT
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg border border-slate-200 mt-2">
                              Marked Present at {currentResident.markedTime || 'Just now'}
                            </div>
                          </div>
                        ) : (
                          <div className="my-auto py-12 flex flex-col items-center justify-center text-center gap-3 text-slate-400">
                            <div className="w-14 h-14 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center border border-slate-200">
                              <Users size={28} />
                            </div>
                            <h4 className="text-base font-semibold text-slate-800">Waiting for resident</h4>
                            <p className="text-sm text-slate-500 max-w-xs leading-relaxed">
                              Residents will be recognized and marked Present automatically.
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="pt-4 border-t border-slate-100 flex items-center justify-between text-sm text-slate-500">
                        <span>Roll call session active</span>
                        <span className="font-semibold text-emerald-700 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full bg-emerald-500" />
                          Live Marking Active
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Roster Controls */}
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-4">
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-3 text-slate-400" size={18} />
                    <input
                      type="text"
                      placeholder="Search residents by code, name, or room..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="form-input"
                      style={{ paddingLeft: '2.5rem' }}
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Filter size={16} className="text-slate-400" />
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="form-select"
                      style={{ width: 'auto', minWidth: '150px' }}
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="PRESENT">Present</option>
                      <option value="ABSENT">Absent</option>
                      <option value="NOT_RECORDED">Not Recorded</option>
                    </select>
                  </div>
                </div>

                {/* Roster Table Card */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900">Residents</h3>
                    <span className="text-sm text-slate-500 font-medium">{filteredRoster.length} resident records</span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                      <thead className="bg-slate-50/70 text-slate-600 font-semibold">
                        <tr>
                          <th scope="col" className="px-6 py-3.5 text-left">
                            Name
                          </th>
                          <th scope="col" className="px-6 py-3.5 text-left">
                            Room
                          </th>
                          <th scope="col" className="px-6 py-3.5 text-left">
                            Status
                          </th>
                          <th scope="col" className="px-6 py-3.5 text-left">
                            Time
                          </th>
                          {canManage && (
                            <th scope="col" className="px-6 py-3.5 text-right">
                              Action
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {filteredRoster.length === 0 ? (
                          <tr>
                            <td colSpan={canManage ? 5 : 4} className="px-6 py-12 text-center text-slate-500">
                              No resident attendance records matching current criteria.
                            </td>
                          </tr>
                        ) : (
                          filteredRoster.map((item) => (
                            <tr key={item.residentId} className="hover:bg-slate-50/70 transition h-16">
                              <td className="px-6 py-3.5">
                                <div className="flex items-center gap-3">
                                  <div className="w-10 h-10 rounded-full bg-slate-100 border border-slate-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                    <img
                                      src={typeof residentsApi.getProfilePhotoUrl === 'function' ? residentsApi.getProfilePhotoUrl(item.residentId) : `/api/v1/residents/${item.residentId}/profile-photo`}
                                      alt=""
                                      className="w-full h-full object-cover"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLElement).style.display = 'none';
                                      }}
                                    />
                                    <Users size={18} className="text-slate-400" />
                                  </div>
                                  <div>
                                    <div className="font-semibold text-slate-900 text-15px">{item.fullName}</div>
                                    <div className="text-13px text-slate-500 font-mono">{item.residentCode}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-3.5 text-slate-700 font-medium text-15px">{item.roomGroup}</td>
                              <td className="px-6 py-3.5">{renderStatusBadge(item.status)}</td>
                              <td className="px-6 py-3.5 text-slate-600 font-mono text-14px">
                                {item.markedAt
                                  ? new Date(item.markedAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—'}
                              </td>
                              {canManage && (
                                <td className="px-6 py-3.5 text-right">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setCorrectingResident(item);
                                      setTargetCorrectionStatus(
                                        item.status === 'PRESENT' || item.status === 'CORRECTED_PRESENT'
                                          ? 'ABSENT'
                                          : 'PRESENT'
                                      );
                                      setCorrectionReason('');
                                    }}
                                    className="btn btn-secondary btn-sm"
                                  >
                                    <Edit2 size={13} />
                                    <span>Correct</span>
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            ) : (
              <div className="attendance-empty-panel bg-white border border-slate-200 rounded-xl p-12 text-center max-w-xl mx-auto my-8 shadow-sm">
                <div className="w-14 h-14 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center mx-auto mb-4 border border-blue-100">
                  <CheckSquare size={28} />
                </div>
                <h2 className="text-2xl font-bold text-slate-900 mb-2">Hostel Attendance</h2>
                <p className="text-base text-slate-600 mb-6 leading-relaxed">
                  No attendance session is active.
                  <br />
                  Start attendance when you are ready to conduct roll call.
                </p>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(true)}
                    aria-label="Start Attendance"
                    className="btn btn-primary btn-md inline-flex items-center gap-2"
                  >
                    <Play size={18} />
                    <span>Start Attendance</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Create Attendance Session */}
      <Modal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create Attendance"
        subtitle="Schedule roll call or daily night attendance session"
        size="md"
      >
        <form onSubmit={handleCreateSession} className="space-y-4">
          <div className="form-group">
            <label htmlFor="new-session-title" className="form-label">
              Attendance Name <span className="required-mark">*</span>
            </label>
            <input
              id="new-session-title"
              type="text"
              value={newSessionTitle}
              onChange={(e) => setNewSessionTitle(e.target.value)}
              className="form-input"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">
              Session Type
            </label>
            <select
              value={newSessionType}
              onChange={(e) => setNewSessionType(e.target.value)}
              className="form-select"
            >
              <option value="NIGHT">Night Attendance</option>
              <option value="GENERAL">General Assembly</option>
              <option value="CURFEW">Hostel Curfew Check</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Date</label>
            <input
              type="date"
              value={newSessionDate}
              onChange={(e) => setNewSessionDate(e.target.value)}
              className="form-input"
              required
            />
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">
                Start Time
              </label>
              <input
                type="time"
                value={newSessionStartTime}
                onChange={(e) => setNewSessionStartTime(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">
                End Time
              </label>
              <input
                type="time"
                value={newSessionEndTime}
                onChange={(e) => setNewSessionEndTime(e.target.value)}
                className="form-input"
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">
              Camera (Optional)
            </label>
            <select
              value={newSessionCameraId}
              onChange={(e) => setNewSessionCameraId(e.target.value)}
              className="form-select"
            >
              <option value="">Any Attendance Camera in Hostel</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} {c.role ? `(${c.role})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="modal-actions-bar pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary btn-sm"
            >
              Create Attendance
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: Close Attendance Confirmation */}
      <Modal
        isOpen={isCloseConfirmOpen && !!activeSessionData && !!stats}
        onClose={() => setIsCloseConfirmOpen(false)}
        title="Close Night Attendance?"
        size="sm"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 text-red-600">
            <AlertCircle size={24} />
            <span className="font-semibold text-slate-900">Are you sure you want to end this session?</span>
          </div>

          <div className="text-sm text-slate-600 space-y-2">
            <p>
              Present: <strong className="text-slate-900">{stats?.presentCount}</strong>
            </p>
            <p>
              Not yet marked: <strong className="text-red-600">{stats?.remainingCount}</strong>
            </p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900 text-xs leading-relaxed">
              Residents not marked will be recorded as absent upon closing this session.
            </div>
          </div>

          <div className="modal-actions-bar pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsCloseConfirmOpen(false)}
              className="btn btn-secondary btn-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCloseSession}
              disabled={isSubmitting}
              className="btn btn-danger btn-sm"
            >
              Close Attendance
            </button>
          </div>
        </div>
      </Modal>

      {/* Modal: Manual Correction */}
      <Modal
        isOpen={!!correctingResident}
        onClose={() => setCorrectingResident(null)}
        title="Change attendance"
        subtitle={correctingResident ? `Update attendance record for ${correctingResident.fullName}` : undefined}
        size="sm"
      >
        {correctingResident && (
          <form onSubmit={handleSaveCorrection} className="space-y-4">
            <div className="text-sm text-slate-700 p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1">
              <div>
                Resident: <strong>{correctingResident.fullName}</strong> ({correctingResident.residentCode})
              </div>
              <div>
                Current: <strong>{correctingResident.status}</strong>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">
                Change to
              </label>
              <select
                value={targetCorrectionStatus}
                onChange={(e) => setTargetCorrectionStatus(e.target.value as any)}
                className="form-select"
              >
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">
                Reason (Mandatory) <span className="required-mark">*</span>
              </label>
              <textarea
                rows={3}
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Explain why this attendance record is being changed..."
                className="form-input"
                style={{ height: 'auto', paddingTop: '10px' }}
                required
              />
            </div>

            <div className="modal-actions-bar pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setCorrectingResident(null)}
                className="btn btn-secondary btn-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn btn-primary btn-sm"
              >
                Save correction
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
};

export default AttendancePage;
