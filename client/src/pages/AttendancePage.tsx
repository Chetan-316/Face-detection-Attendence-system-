import React, { useState, useEffect, useMemo } from 'react';
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

  // Live recognition subscriber for active attendance session
  useEffect(() => {
    if (!activeSessionData || activeSessionData.status !== 'ACTIVE') return;

    let isMounted = true;
    let eventSource: EventSource | null = null;
    const camId = activeSessionData.camera?.id || (cameras.length > 0 ? cameras[0].id : '');

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

  const hasActiveSession = activeSessionData?.status === 'ACTIVE';

  return (
    <div className="attendance-page max-w-7xl mx-auto space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
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
            className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none transition"
            title="Refresh attendance data"
          >
            <RefreshCw size={15} className={isRefreshing ? 'animate-spin text-blue-600' : ''} />
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

      {/* Main Content Area */}
      {isLoading ? (
        <div className="py-24 text-center bg-white rounded-xl border border-slate-200">
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
              className="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm transition"
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
                        {activeSessionData.camera && (
                          <span className="flex items-center gap-1.5">
                            <CameraIcon size={15} className="text-slate-400" />
                            {activeSessionData.camera.name}
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
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 transition shadow-sm"
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
                            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg transition shadow-sm"
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
                    {/* Live Camera Feed */}
                    <div className="attendance-camera-col bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                      <div className="relative bg-slate-100 flex items-center justify-center overflow-hidden min-h-[360px] sm:min-h-[400px] h-full">
                        {(activeSessionData.camera?.id || cameras[0]?.id) ? (
                          <img
                            src={
                              typeof (camerasApi as any)?.getPreviewStreamUrl === 'function'
                                ? (camerasApi as any).getPreviewStreamUrl(activeSessionData.camera?.id || cameras[0].id)
                                : `/api/v1/cameras/${activeSessionData.camera?.id || cameras[0].id}/preview`
                            }
                            alt="Live Attendance Camera Feed"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center justify-center text-slate-400 p-8 text-center gap-2">
                            <CameraIcon size={44} className="text-slate-300" />
                            <p className="text-base font-semibold text-slate-700">Attendance Camera Active</p>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Current Resident Card */}
                    <div className="attendance-resident-col bg-white border border-slate-200 rounded-xl p-6 shadow-sm justify-between min-h-[360px]">
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
                      className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                    />
                  </div>

                  <div className="flex items-center gap-2">
                    <Filter size={16} className="text-slate-400" />
                    <select
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="text-sm border border-slate-300 rounded-lg px-3 py-2.5 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="PRESENT">Present</option>
                      <option value="ABSENT">Absent</option>
                      <option value="NOT_RECORDED">Not Recorded</option>
                    </select>
                  </div>
                </div>

                {/* Roster Table */}
                <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-900">Residents</h3>
                    <span className="text-sm text-slate-500 font-medium">{filteredRoster.length} resident records</span>
                  </div>

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
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-13px font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none transition"
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
                    className="inline-flex items-center gap-2 px-6 py-3 text-base font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm transition"
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
      {isCreateModalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl max-w-md w-full p-6 shadow-xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-900">Create Attendance</h3>
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateSession} className="space-y-4">
              <div>
                <label htmlFor="new-session-title" className="block text-sm font-semibold text-slate-700 mb-1">
                  Attendance Name
                </label>
                <input
                  id="new-session-title"
                  type="text"
                  value={newSessionTitle}
                  onChange={(e) => setNewSessionTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Session Type
                </label>
                <select
                  value={newSessionType}
                  onChange={(e) => setNewSessionType(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="NIGHT">Night Attendance</option>
                  <option value="GENERAL">General Assembly</option>
                  <option value="CURFEW">Hostel Curfew Check</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Date</label>
                <input
                  type="date"
                  value={newSessionDate}
                  onChange={(e) => setNewSessionDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    Start Time
                  </label>
                  <input
                    type="time"
                    value={newSessionStartTime}
                    onChange={(e) => setNewSessionStartTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">
                    End Time
                  </label>
                  <input
                    type="time"
                    value={newSessionEndTime}
                    onChange={(e) => setNewSessionEndTime(e.target.value)}
                    className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Camera (Optional)
                </label>
                <select
                  value={newSessionCameraId}
                  onChange={(e) => setNewSessionCameraId(e.target.value)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="">Any Attendance Camera in Hostel</option>
                  {cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setIsCreateModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
            <div className="flex items-center gap-3 text-red-600">
              <AlertCircle size={24} />
              <h3 className="text-lg font-bold text-slate-900">Close Night Attendance?</h3>
            </div>

            <div className="text-sm text-slate-600 space-y-2">
              <p>
                Present: <strong className="text-slate-900">{stats.presentCount}</strong>
              </p>
              <p>
                Not yet marked: <strong className="text-red-600">{stats.remainingCount}</strong>
              </p>
              <p className="text-sm text-slate-600 bg-amber-50 border border-amber-200 p-3 rounded-lg text-amber-900">
                Residents not marked will be recorded as absent upon closing this session.
              </p>
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
              <button
                type="button"
                onClick={() => setIsCloseConfirmOpen(false)}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCloseSession}
                disabled={isSubmitting}
                className="px-5 py-2 text-sm font-semibold text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
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
            <div className="flex justify-between items-center border-b border-slate-200 pb-3">
              <h3 className="text-lg font-bold text-slate-900">Change attendance</h3>
              <button
                type="button"
                onClick={() => setCorrectingResident(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveCorrection} className="space-y-4">
              <div className="text-sm text-slate-700 space-y-1">
                <div>
                  Resident: <strong>{correctingResident.fullName}</strong> ({correctingResident.residentCode})
                </div>
                <div>
                  Current: <strong>{correctingResident.status}</strong>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Change to
                </label>
                <select
                  value={targetCorrectionStatus}
                  onChange={(e) => setTargetCorrectionStatus(e.target.value as any)}
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="PRESENT">Present</option>
                  <option value="ABSENT">Absent</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Reason (Mandatory)
                </label>
                <textarea
                  rows={3}
                  value={correctionReason}
                  onChange={(e) => setCorrectionReason(e.target.value)}
                  placeholder="Explain why this attendance record is being changed..."
                  className="w-full px-3.5 py-2.5 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  required
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setCorrectingResident(null)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
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
