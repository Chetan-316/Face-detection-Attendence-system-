import React, { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
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

  const canManage = user?.role === 'ADMIN' || user?.role === 'WARDEN';

  // Load initial data
  const loadData = async (silent = false) => {
    try {
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);

      const [sessionsRes, activeRes, camerasRes] = await Promise.all([
        getAttendanceSessions(),
        getActiveAttendanceSession(),
        camerasApi.listCameras(undefined, 'ATTENDANCE'),
      ]);

      setSessions(sessionsRes.sessions);
      setCameras(camerasRes.data);

      // If active session exists, default to it
      if (activeRes.activeSession) {
        setSelectedSessionId(activeRes.activeSession.id);
        setActiveSessionData(activeRes.activeSession);
        const rosterRes = await getAttendanceRoster(activeRes.activeSession.id);
        setStats(rosterRes.stats);
        setRoster(rosterRes.roster);
      } else if (sessionsRes.sessions.length > 0 && !selectedSessionId) {
        const first = sessionsRes.sessions[0];
        setSelectedSessionId(first.id);
        setActiveSessionData(first);
        const rosterRes = await getAttendanceRoster(first.id);
        setStats(rosterRes.stats);
        setRoster(rosterRes.roster);
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
    } catch (err: any) {
      toastError(err.message || 'Failed to load session details');
    } finally {
      setIsRefreshing(false);
    }
  };

  // Live Face Recognition connection during ACTIVE session (Section 30 & 31)
  useEffect(() => {
    if (!activeSessionData || activeSessionData.status !== 'ACTIVE') {
      setCurrentResident(null);
      return;
    }

    const camId = activeSessionData.camera?.id || (cameras.length > 0 ? cameras[0].id : '');
    if (!camId) return;

    let isMounted = true;
    let eventSource: EventSource | null = null;

    const connectLiveStream = async () => {
      try {
        const { streamToken } = await recognitionApi.getStreamToken(camId);
        if (!isMounted) return;

        const streamUrl = recognitionApi.getEventsStreamUrl(camId, streamToken);
        const es = new EventSource(streamUrl);
        eventSource = es;

        es.addEventListener('observation', async (event: MessageEvent) => {
          try {
            const obs = JSON.parse(event.data);
            if (obs.classification === 'MATCH' && obs.resident) {
              const res = obs.resident;
              const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              setCurrentResident({
                id: res.id,
                fullName: res.fullName,
                residentCode: res.residentCode,
                roomGroup: res.roomGroup || '—',
                markedTime: timeStr,
              });

              // Mark attendance record idempotently with duplicate prevention
              await markAttendanceRecord(activeSessionData.id, res.id, 'FACE_RECOGNITION');
              const updated = await getAttendanceRoster(activeSessionData.id);
              if (isMounted) {
                setStats(updated.stats);
                setRoster(updated.roster);
              }
            }
          } catch (e) {}
        });

        es.onerror = () => {
          if (eventSource) {
            eventSource.close();
            eventSource = null;
          }
        };
      } catch (err) {}
    };

    connectLiveStream();

    // Fallback polling for recognition events
    const pollInterval = setInterval(async () => {
      if (!isMounted) return;
      try {
        const res = await recognitionApi.getResults(camId, 1);
        if (res.results && res.results.length > 0) {
          const latest = res.results[0];
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
  }, [activeSessionData?.id, activeSessionData?.status, cameras]);

  // Create session
  const handleCreateSession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newSessionTitle.trim()) {
      toastError('Session title is required');
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
      if (statusFilter === 'PRESENT') {
        return item.status === 'PRESENT' || item.status === 'CORRECTED_PRESENT';
      }
      if (statusFilter === 'ABSENT') return item.status === 'ABSENT';
      if (statusFilter === 'NOT_RECORDED') return item.status === 'NOT_RECORDED';
      return true;
    });
  }, [roster, searchQuery, statusFilter]);

  // Status badge helper
  const renderStatusBadge = (status: string) => {
    switch (status) {
      case 'PRESENT':
      case 'CORRECTED_PRESENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 size={13} className="text-emerald-600" />
            {status === 'CORRECTED_PRESENT' ? 'Present (Corrected)' : 'Present'}
          </span>
        );
      case 'ABSENT':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
            <XCircle size={13} className="text-rose-600" />
            Absent
          </span>
        );
      case 'NOT_RECORDED':
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
            <HelpCircle size={13} className="text-gray-500" />
            Not Recorded
          </span>
        );
    }
  };

  const renderSourceLabel = (method: string | null) => {
    switch (method) {
      case 'FACE_RECOGNITION':
        return 'Face Recognition';
      case 'WARDEN_OVERRIDE':
        return 'Staff Correction';
      case 'MANUAL_STAFF':
        return 'Manual Entry';
      case 'SYSTEM':
        return 'System Auto-Close';
      default:
        return '—';
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-gray-200 pb-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Hostel Attendance</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Roll call, daily night attendance sessions, and attendance roster records
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isRefreshing}
            className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 focus:outline-none"
            title="Refresh attendance data"
          >
            <RefreshCw size={16} className={isRefreshing ? 'animate-spin text-blue-600' : ''} />
            <span>Refresh</span>
          </button>

          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm transition"
            >
              <Plus size={16} />
              <span>Create Attendance</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Content */}
      {isLoading ? (
        <div className="py-24 text-center">
          <RefreshCw size={32} className="animate-spin text-blue-600 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">Loading attendance sessions...</p>
        </div>
      ) : sessions.length === 0 ? (
        <div className="attendance-empty-panel">
          <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--primary-subtle)', color: 'var(--primary-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto' }}>
            <CheckSquare size={24} />
          </div>
          <h2>Hostel Attendance</h2>
          <p>
            No attendance session is active.
            <br />
            Start a session when you are ready to conduct roll call.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              className="btn btn-primary btn-md inline-flex items-center gap-2"
            >
              <Play size={16} />
              <span>Start Attendance</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Column: Sessions Sidebar */}
          <div className="lg:col-span-1 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-gray-500 px-1">
              Attendance Sessions
            </h2>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm divide-y divide-gray-100">
              {sessions.length === 0 ? (
                <div className="p-4 text-center text-sm text-gray-500">No sessions recorded yet.</div>
              ) : (
                sessions.map((s) => {
                  const isSelected = s.id === selectedSessionId;
                  const isActive = s.status === 'ACTIVE';
                  const isClosed = s.status === 'CLOSED';
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSelectSession(s.id)}
                      className={`w-full text-left p-3.5 transition flex flex-col gap-1 ${
                        isSelected ? 'bg-blue-50/70 border-l-4 border-blue-600' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-semibold text-gray-900 text-sm truncate">{s.title}</span>
                        <span
                          className={`text-xs px-2 py-0.5 rounded font-medium ${
                            isActive
                              ? 'bg-emerald-100 text-emerald-800'
                              : isClosed
                              ? 'bg-gray-100 text-gray-600'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {s.status}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <Calendar size={12} />
                        <span>{new Date(s.attendanceDate).toLocaleDateString()}</span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Column: Active Session Card & Roster */}
          <div className="lg:col-span-3 space-y-6">
            {activeSessionData ? (
              <>
                {/* Session Summary Card */}
                <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                      <div className="flex items-center gap-2.5">
                        <h2 className="text-xl font-bold text-gray-900">{activeSessionData.title}</h2>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-semibold ${
                            activeSessionData.status === 'ACTIVE'
                              ? 'bg-emerald-100 text-emerald-800'
                              : activeSessionData.status === 'CLOSED'
                              ? 'bg-gray-100 text-gray-700'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          Status: {activeSessionData.status}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-600">
                        <span className="flex items-center gap-1.5">
                          <Calendar size={15} className="text-gray-400" />
                          {new Date(activeSessionData.attendanceDate).toLocaleDateString(undefined, {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <Clock size={15} className="text-gray-400" />
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
                        {activeSessionData.camera && (
                          <span className="flex items-center gap-1.5">
                            <CameraIcon size={15} className="text-gray-400" />
                            {activeSessionData.camera.name}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Operational Actions */}
                    {canManage && (
                      <div className="flex items-center gap-2.5">
                        {activeSessionData.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={handleStartSession}
                            disabled={isSubmitting}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition"
                          >
                            <Play size={15} />
                            <span>Start Session</span>
                          </button>
                        )}
                        {activeSessionData.status === 'ACTIVE' && (
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setIsCloseConfirmOpen(true)}
                              disabled={isSubmitting}
                              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 transition"
                            >
                              <CheckSquare size={15} />
                              <span>Close Attendance</span>
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Summary Metric Counters */}
                  {stats && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                      <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-center">
                        <span className="block text-xs font-semibold text-gray-500 uppercase tracking-wide">
                          Expected
                        </span>
                        <span className="text-2xl font-bold text-gray-900 mt-1 block">
                          {stats.expectedResidents}
                        </span>
                      </div>
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-center">
                        <span className="block text-xs font-semibold text-emerald-700 uppercase tracking-wide">
                          Present
                        </span>
                        <span className="text-2xl font-bold text-emerald-800 mt-1 block">
                          {stats.presentCount}
                        </span>
                      </div>
                      <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-center">
                        <span className="block text-xs font-semibold text-amber-700 uppercase tracking-wide">
                          Remaining
                        </span>
                        <span className="text-2xl font-bold text-amber-800 mt-1 block">
                          {stats.remainingCount}
                        </span>
                      </div>
                      <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-center">
                        <span className="block text-xs font-semibold text-rose-700 uppercase tracking-wide">
                          Absent
                        </span>
                        <span className="text-2xl font-bold text-rose-800 mt-1 block">
                          {stats.absentCount}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Live Camera & Current Resident Display (Section 30) */}
                {activeSessionData.status === 'ACTIVE' && (
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                    {/* Live Camera Card */}
                    <div className="lg:col-span-7 bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm flex flex-col">
                      <div className="px-4 py-2.5 bg-slate-850 border-b border-slate-800 flex items-center justify-between text-xs">
                        <span className="font-semibold text-slate-200 flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                          Live Attendance Camera
                        </span>
                        <span className="text-slate-400 font-mono text-[11px]">
                          {activeSessionData.camera?.name || (cameras.length > 0 ? cameras[0].name : 'Hostel Camera')}
                        </span>
                      </div>
                      <div className="relative bg-black flex items-center justify-center overflow-hidden min-h-[300px]">
                        {(activeSessionData.camera?.id || cameras[0]?.id) ? (
                          <img
                            src={
                              typeof (camerasApi as any)?.getPreviewStreamUrl === 'function'
                                ? (camerasApi as any).getPreviewStreamUrl(activeSessionData.camera?.id || cameras[0].id)
                                : `/api/v1/cameras/${activeSessionData.camera?.id || cameras[0].id}/preview`
                            }
                            alt="Live Attendance Camera Feed"
                            className="w-full h-full object-contain max-h-[340px]"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-500 p-8 text-center gap-2">
                            <CameraIcon size={36} className="opacity-40" />
                            <p className="text-sm font-semibold text-slate-300">Camera Feed Active</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Current Resident Card */}
                    <div className="lg:col-span-5 bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex flex-col justify-between min-h-[300px]">
                      <div>
                        <span className="text-xs uppercase tracking-wider font-bold text-blue-600 block mb-3">
                          Current Resident
                        </span>

                        {currentResident ? (
                          <div className="flex flex-col gap-4">
                            <div className="flex items-center gap-4">
                              <div className="w-20 h-20 rounded-xl overflow-hidden bg-gray-100 border-2 border-gray-200 shrink-0 flex items-center justify-center shadow-sm">
                                <img
                                  src={residentsApi.getProfilePhotoUrl(currentResident.id)}
                                  alt={currentResident.fullName}
                                  className="w-full h-full object-cover"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = 'none';
                                  }}
                                />
                                <Users size={32} className="text-gray-400" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <h3 className="text-xl font-bold text-gray-900 truncate">
                                  {currentResident.fullName}
                                </h3>
                                <p className="text-xs font-mono text-gray-500 mt-0.5">
                                  {currentResident.residentCode} • {currentResident.roomGroup}
                                </p>
                                <div className="mt-2.5">
                                  <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                                    <CheckCircle2 size={14} className="text-emerald-600" />
                                    PRESENT
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="text-xs text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-100 mt-2">
                              Recognized and marked Present at {currentResident.markedTime || 'Just now'}
                            </div>
                          </div>
                        ) : (
                          <div className="my-auto py-12 flex flex-col items-center justify-center text-center gap-3 text-gray-400">
                            <div className="w-14 h-14 rounded-full bg-gray-50 text-gray-400 flex items-center justify-center border border-gray-200">
                              <Users size={28} />
                            </div>
                            <h4 className="text-sm font-semibold text-gray-700">Waiting for resident...</h4>
                            <p className="text-xs text-gray-500 max-w-xs leading-relaxed">
                              Residents standing before the camera will be identified and marked Present automatically.
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
                        <span>Roll call in progress</span>
                        <span className="font-semibold text-emerald-600 flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                          Live Face Marking Active
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Roster Controls */}
                <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-2.5 text-gray-400" size={17} />
                    <input
                      type="text"
                      placeholder="Search residents by code, name, or room..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Filter size={16} className="text-gray-400" />
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="text-sm border border-gray-300 rounded-lg px-2.5 py-2 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="PRESENT">Present</option>
                      <option value="ABSENT">Absent</option>
                      <option value="NOT_RECORDED">Not Recorded</option>
                    </select>
                  </div>
                </div>

                {/* Roster Table */}
                <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 text-gray-600 font-semibold">
                      <tr>
                        <th scope="col" className="px-4 py-3 text-left">
                          Resident
                        </th>
                        <th scope="col" className="px-4 py-3 text-left">
                          Room
                        </th>
                        <th scope="col" className="px-4 py-3 text-left">
                          Status
                        </th>
                        <th scope="col" className="px-4 py-3 text-left">
                          Marked At
                        </th>
                        <th scope="col" className="px-4 py-3 text-left">
                          Source
                        </th>
                        {canManage && (
                          <th scope="col" className="px-4 py-3 text-right">
                            Action
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {filteredRoster.length === 0 ? (
                        <tr>
                          <td colSpan={canManage ? 6 : 5} className="px-4 py-12 text-center text-gray-500">
                            No resident attendance records matching current criteria.
                          </td>
                        </tr>
                      ) : (
                        filteredRoster.map((item) => (
                          <tr key={item.residentId} className="hover:bg-gray-50/60 transition">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 overflow-hidden flex-shrink-0 flex items-center justify-center">
                                  <img
                                    src={typeof residentsApi.getProfilePhotoUrl === 'function' ? residentsApi.getProfilePhotoUrl(item.residentId) : `/api/v1/residents/${item.residentId}/profile-photo`}
                                    alt=""
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                      (e.currentTarget as HTMLElement).style.display = 'none';
                                    }}
                                  />
                                  <Users size={16} className="text-gray-400" />
                                </div>
                                <div>
                                  <div className="font-semibold text-gray-900">{item.fullName}</div>
                                  <div className="text-xs text-gray-500 font-mono">{item.residentCode}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-700 font-medium">{item.roomGroup}</td>
                            <td className="px-4 py-3">{renderStatusBadge(item.status)}</td>
                            <td className="px-4 py-3 text-gray-600">
                              {item.markedAt
                                ? new Date(item.markedAt).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : '—'}
                            </td>
                            <td className="px-4 py-3 text-gray-600 text-xs">
                              {renderSourceLabel(item.markMethod)}
                              {item.correctionReason && (
                                <div className="text-xs text-amber-700 italic truncate max-w-xs mt-0.5">
                                  {item.correctionReason}
                                </div>
                              )}
                            </td>
                            {canManage && (
                              <td className="px-4 py-3 text-right">
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
                                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50 focus:outline-none"
                                >
                                  <Edit2 size={12} />
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
              </>
            ) : (
              <div className="attendance-empty-panel">
                <div style={{ width: '48px', height: '48px', borderRadius: '50%', background: 'var(--primary-subtle)', color: 'var(--primary-500)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1.25rem auto' }}>
                  <CheckSquare size={24} />
                </div>
                <h2>Hostel Attendance</h2>
                <p>
                  No attendance session is active.
                  <br />
                  Start a session when you are ready to conduct roll call.
                </p>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(true)}
                    className="btn btn-primary btn-md inline-flex items-center gap-2"
                  >
                    <Play size={16} />
                    <span>Start Attendance</span>
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Create Attendance Session */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="text-lg font-bold text-gray-900">Create Attendance</h3>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="space-y-4">
              <div>
                <label htmlFor="new-session-title" className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Attendance Name
                </label>
                <input
                  id="new-session-title"
                  type="text"
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Session Type
                </label>
                <select
                  value={newSessionType}
                  onChange={(e) => setNewSessionType(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500"
                >
                  <option value="NIGHT">Night Attendance</option>
                  <option value="GENERAL">General Assembly</option>
                  <option value="CURFEW">Hostel Curfew Check</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">Date</label>
                <input
                  type="date"
                  value={newSessionDate}
                  onChange={(e) => setNewSessionDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={newSessionStartTime}
                    onChange={(e) => setNewSessionStartTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={newSessionEndTime}
                    onChange={(e) => setNewSessionEndTime(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Camera (Optional)
                </label>
                <select
                  value={newSessionCameraId}
                  onChange={(e) => setNewSessionCameraId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Any Attendance Camera in Hostel</option>
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Create Attendance
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Close Attendance Confirmation */}
      {isCloseConfirmOpen && activeSessionData && stats && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center gap-3 text-rose-600">
              <AlertCircle size={24} />
              <h3 className="text-lg font-bold text-gray-900">Close Night Attendance?</h3>
            </div>

            <div className="text-sm text-gray-600 space-y-2">
              <p>
                Present: <strong className="text-gray-900">{stats.presentCount}</strong>
              </p>
              <p>
                Not yet marked: <strong className="text-rose-600">{stats.remainingCount}</strong>
              </p>
              <p className="text-xs text-gray-500 bg-amber-50 border border-amber-200 p-2.5 rounded-lg text-amber-900">
                Residents not marked will be recorded as absent upon closing this session.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
              <button
                type="button"
                onClick={() => setIsCloseConfirmOpen(false)}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCloseSession}
                disabled={isSubmitting}
                className="px-4 py-2 text-sm font-semibold text-white bg-rose-600 rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                Close Attendance
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Manual Correction */}
      {correctingResident && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-gray-200 pb-3">
              <h3 className="text-lg font-bold text-gray-900">Change attendance</h3>
              <button
                type="button"
                onClick={() => setCorrectingResident(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCorrection} className="space-y-4">
              <div className="text-sm text-gray-700 space-y-1">
                <div>
                  Resident: <strong>{correctingResident.fullName}</strong> ({correctingResident.residentCode})
                </div>
                <div>
                  Current: <strong>{correctingResident.status}</strong>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Change to
                </label>
                <select
                  value={targetCorrectionStatus}
                  onChange={(e) => setTargetCorrectionStatus(e.target.value as any)}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:ring-1 focus:ring-blue-500"
                >
                  <option value="PRESENT">Present</option>
                  <option value="ABSENT">Absent</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 uppercase mb-1">
                  Reason (Mandatory)
                </label>
                <textarea
                  rows={3}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="Explain why this attendance record is being changed..."
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-1 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setCorrectingResident(null)}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
                >
                  Save correction
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttendancePage;
