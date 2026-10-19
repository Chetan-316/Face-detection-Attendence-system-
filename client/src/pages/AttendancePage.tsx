import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { Modal } from '../components/Modal';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { usePreviewStreamUrl } from '../hooks/usePreviewStreamUrl';
import { businessDateKey, businessInstant } from '../utils/businessDate';
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
  const [newSessionDate, setNewSessionDate] = useState(() => businessDateKey());
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
      const startDateTime = businessInstant(dateStr, newSessionStartTime);
      const endDateTime = newSessionEndTime ? businessInstant(dateStr, newSessionEndTime) : undefined;

      const res = await createAttendanceSession({
        title: newSessionTitle.trim(),
        sessionType: newSessionType,
        attendanceDate: businessInstant(dateStr),
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
          <span className="badge badge-sm badge-presence-in">
            <CheckCircle2 size={13} aria-hidden="true" />
            <span>Present</span>
          </span>
        );
      case 'ABSENT':
        return (
          <span className="badge badge-sm badge-absent">
            <XCircle size={13} aria-hidden="true" />
            <span>Absent</span>
          </span>
        );
      case 'NOT_RECORDED':
      default:
        return (
          <span className="badge badge-sm badge-neutral">
            <HelpCircle size={13} aria-hidden="true" />
            <span>Not Recorded</span>
          </span>
        );
    }
  };

  const activeLiveCameraId = selectedLiveCameraId || activeSessionData?.camera?.id || (cameras.length > 0 ? cameras[0].id : '');
  const activeCameraObj = cameras.find((c) => c.id === activeLiveCameraId) || activeSessionData?.camera;
  const activeSourceType = activeCameraObj && 'sourceType' in activeCameraObj && typeof activeCameraObj.sourceType === 'string' ? activeCameraObj.sourceType : undefined;

  const streamUrl = usePreviewStreamUrl(activeLiveCameraId || null, streamRetryKey);

  return (
    <div className="attendance-page attendance-stack">
      <PageHeader
        title="Hostel Attendance"
        subtitle="Run attendance sessions, monitor live marking, and review resident records."
        actions={
          <div className="page-header-actions">
            <Button
              type="button"
              variant="outline"
              onClick={() => loadData(true)}
              isLoading={isRefreshing}
              leftIcon={<RefreshCw size={16} />}
            >
              Refresh
            </Button>
            {canManage && (
              <Button
                type="button"
                variant="primary"
                onClick={() => setIsCreateModalOpen(true)}
                leftIcon={<Plus size={16} />}
              >
                Create Attendance
              </Button>
            )}
          </div>
        }
      />

      {/* Main Content Area */}
      {isLoading ? (
        <div className="card state-panel" role="status">
          <span className="spinner-inline" aria-hidden="true" />
          <p className="state-panel-text">Loading attendance sessions...</p>
        </div>
      ) : sessions.length === 0 ? (
        /* Empty State */
        <div className="attendance-empty-panel">
          <div className="attendance-empty-icon">
            <CheckSquare size={28} aria-hidden="true" />
          </div>
          <h2 className="attendance-empty-title">Hostel Attendance</h2>
          <p className="attendance-empty-text">
            No attendance session is active.
            <br />
            Start attendance when you are ready to conduct roll call.
          </p>
          {canManage && (
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(true)}
              aria-label="Start Attendance"
              className="btn btn-primary btn-md"
            >
              <Play size={18} />
              <span>Start Attendance</span>
            </button>
          )}
        </div>
      ) : (
        <div className="attendance-layout-grid">
          {/* Left Column: Sessions List */}
          <div className="attendance-sessions-col">
            <h2 className="section-heading">
              Attendance Sessions
            </h2>
            <div className="attendance-session-list">
              {sessions.map((s) => {
                const isSelected = s.id === selectedSessionId;
                const isActive = s.status === 'ACTIVE';
                const isClosed = s.status === 'CLOSED';
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => handleSelectSession(s.id)}
                    className={`attendance-session-item ${isSelected ? 'is-selected' : ''}`}
                    aria-current={isSelected ? 'true' : undefined}
                  >
                    <div className="attendance-session-row">
                      <span className="attendance-session-title">{s.title}</span>
                      <span
                        className={`badge badge-sm ${
                          isActive
                            ? 'badge-presence-in'
                            : isClosed
                            ? 'badge-neutral'
                            : 'badge-presence-out'
                        }`}
                      >
                        {s.status}
                      </span>
                    </div>
                    <div className="attendance-session-meta">
                      <Calendar size={13} aria-hidden="true" />
                      <span>{new Date(s.attendanceDate).toLocaleDateString()}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Column: Selected/Active Session Card & Roster */}
          <div className="attendance-main-col">
            {activeSessionData ? (
              <>
                {/* Active Session Overview Banner */}
                <div className="card attendance-session-card">
                  <div className="attendance-session-header">
                    <div>
                      <div className="attendance-session-heading">
                        <h2 className="attendance-session-name">{activeSessionData.title}</h2>
                        <span
                          className={`badge badge-md ${
                            activeSessionData.status === 'ACTIVE'
                              ? 'badge-presence-in'
                              : activeSessionData.status === 'CLOSED'
                              ? 'badge-neutral'
                              : 'badge-presence-out'
                          }`}
                        >
                          Status: {activeSessionData.status}
                        </span>
                      </div>

                      <div className="attendance-session-meta-row">
                        <span className="attendance-meta-item">
                          <Calendar size={15} aria-hidden="true" />
                          {new Date(activeSessionData.attendanceDate).toLocaleDateString(undefined, {
                            weekday: 'short',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </span>
                        <span className="attendance-meta-item">
                          <Clock size={15} aria-hidden="true" />
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
                          <span className="attendance-meta-item">
                            <CameraIcon size={15} aria-hidden="true" />
                            {activeCameraObj.name}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Operational Action Controls */}
                    {canManage && (
                      <div className="attendance-session-actions">
                        {activeSessionData.status === 'DRAFT' && (
                          <button
                            type="button"
                            onClick={handleStartSession}
                            disabled={isSubmitting}
                            className="btn btn-success btn-sm"
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
                    <div className="attendance-counters">
                      <div className="attendance-counter is-present">
                        <span className="attendance-counter-label">
                          Present
                        </span>
                        <span className="attendance-counter-value">
                          {stats.presentCount}
                        </span>
                      </div>
                      <div className="attendance-counter is-pending">
                        <span className="attendance-counter-label">
                          Pending
                          <span className="sr-only">Remaining</span>
                        </span>
                        <span className="attendance-counter-value">
                          {stats.remainingCount}
                        </span>
                      </div>
                      <div className="attendance-counter is-total">
                        <span className="attendance-counter-label">
                          Total
                          <span className="sr-only">Expected</span>
                        </span>
                        <span className="attendance-counter-value">
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
                    <div className="attendance-camera-col">
                      {/* Camera Control Toolbar Header */}
                      <div className="attendance-camera-toolbar">
                        <div className="attendance-camera-heading">
                          <span className="attendance-camera-title">
                            <CameraIcon size={14} aria-hidden="true" />
                            {cameraMode === 'DEVICE' ? 'Browser Device Webcam' : activeCameraObj?.name || 'Attendance Camera'}
                          </span>

                          {/* Stream Status Pill */}
                          <span
                            className={`attendance-live-pill ${
                              streamStatus === 'CONNECTED'
                                ? 'is-connected'
                                : streamStatus === 'LOADING'
                                ? 'is-loading'
                                : 'is-offline'
                            }`}
                          >
                            <span className="attendance-live-dot" aria-hidden="true" />
                            {streamStatus === 'CONNECTED' ? 'Live' : streamStatus === 'LOADING' ? 'Connecting' : 'Offline'}
                          </span>
                        </div>

                        {/* Camera Switcher & Mode Toggles */}
                        <div className="attendance-camera-controls">
                          {cameras.length > 1 && cameraMode === 'BACKEND' && (
                            <select
                              aria-label="Attendance camera"
                              value={activeLiveCameraId}
                              onChange={(e) => {
                                setSelectedLiveCameraId(e.target.value);
                                setStreamStatus('LOADING');
                              }}
                              className="form-select attendance-camera-select"
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
                            className="btn btn-outline btn-sm"
                            title="Toggle between Server Camera Stream and Direct Browser Webcam"
                          >
                            <Video size={14} aria-hidden="true" />
                            <span>{cameraMode === 'DEVICE' ? 'Switch to Server Camera' : 'Use Direct Webcam'}</span>
                          </button>
                        </div>
                      </div>

                      {/* Video Viewport Container */}
                      <div className="attendance-viewport">
                        {cameraMode === 'DEVICE' ? (
                          /* Direct HTML5 Web Browser Camera Stream */
                          <>
                            <video
                              ref={videoRef}
                              autoPlay
                              playsInline
                              muted
                              className="attendance-video"
                            />
                            {deviceCameraError && (
                              <div className="attendance-viewport-overlay is-strong">
                                <VideoOff size={40} className="attendance-overlay-icon" aria-hidden="true" />
                                <div>
                                  <p className="attendance-overlay-title">Camera Access Restricted</p>
                                  <p className="attendance-overlay-text">{deviceCameraError}</p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setCameraMode('BACKEND')}
                                  className="btn btn-secondary btn-sm"
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
                              src={streamUrl || undefined}
                              alt="Live Attendance Camera Feed"
                              className="attendance-video"
                              onLoad={() => setStreamStatus('CONNECTED')}
                              onError={() => setStreamStatus('ERROR')}
                            />
                            {streamStatus === 'LOADING' && (
                              <div className="attendance-viewport-overlay">
                                <div className="attendance-loading-text">
                                  <RefreshCw size={16} className="attendance-loading-icon" aria-hidden="true" />
                                  <span>Connecting live feed...</span>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          /* Fallback Diagnostic Card (Stream offline or no camera assigned) */
                          <div className="attendance-fallback">
                            <div className="attendance-fallback-icon" aria-hidden="true">
                              <CameraIcon size={28} />
                            </div>
                            <div>
                              <p className="attendance-overlay-title">Camera Stream Offline</p>
                              <p className="attendance-overlay-text">
                                {activeLiveCameraId
                                  ? 'The selected camera feed is unavailable. Check the camera connection or use the device camera.'
                                  : 'No active camera is assigned to this attendance session.'}
                              </p>
                            </div>
                            <div className="attendance-fallback-actions">
                              <button
                                type="button"
                                onClick={() => setCameraMode('DEVICE')}
                                className="btn btn-primary btn-sm"
                              >
                                <Video size={14} aria-hidden="true" />
                                <span>Turn On Direct Webcam</span>
                              </button>
                              {activeLiveCameraId && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setStreamStatus('LOADING');
                                    setStreamRetryKey((k) => k + 1);
                                  }}
                                  className="btn btn-secondary btn-sm"
                                >
                                  <RotateCcw size={14} aria-hidden="true" />
                                  <span>Retry Stream</span>
                                </button>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Stream Watermark / Live Badge */}
                        <div className="attendance-watermark">
                          <span className="attendance-watermark-dot" aria-hidden="true" />
                          <span>{cameraMode === 'DEVICE' ? 'WEBCAM 720p' : activeSourceType || 'STREAM'}</span>
                          <span>•</span>
                          <span>{activeSessionData.title}</span>
                        </div>
                      </div>
                    </div>

                    {/* Current Resident Card */}
                    <div className="attendance-resident-col">
                      <div>
                        <h3 className="attendance-panel-label">
                          Current Resident
                        </h3>

                        {currentResident ? (
                          <div className="attendance-resident-body">
                            <div className="attendance-resident-identity">
                              <div className="attendance-resident-photo">
                                <AuthenticatedImage
                                  src={residentsApi.getProfilePhotoUrl(currentResident.id)}
                                  alt={currentResident.fullName}
                                  className="attendance-resident-photo-img"
                                  onError={(e) => {
                                    (e.target as HTMLElement).style.display = 'none';
                                  }}
                                />
                                <Users size={32} className="attendance-resident-photo-placeholder" aria-hidden="true" />
                              </div>
                              <div className="attendance-resident-text">
                                <h3 className="attendance-resident-name">
                                  {currentResident.fullName}
                                </h3>
                                <p className="attendance-resident-meta">
                                  {currentResident.residentCode} • {currentResident.roomGroup}
                                </p>
                                <div className="attendance-resident-status">
                                  <span className="badge badge-md badge-presence-in">
                                    <CheckCircle2 size={15} aria-hidden="true" />
                                    PRESENT
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="attendance-marked-note">
                              Marked Present at {currentResident.markedTime || 'Just now'}
                            </div>
                          </div>
                        ) : (
                          <div className="attendance-waiting">
                            <div className="attendance-waiting-icon" aria-hidden="true">
                              <Users size={28} />
                            </div>
                            <h4 className="attendance-waiting-title">Waiting for resident</h4>
                            <p className="attendance-waiting-text">
                              Residents will be recognized and marked Present automatically.
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="attendance-resident-footer">
                        <span>Roll call session active</span>
                        <span className="attendance-live-status">
                          <span className="attendance-live-dot" aria-hidden="true" />
                          Live Marking Active
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Roster Controls */}
                <div className="attendance-roster-controls">
                  <div className="attendance-roster-search">
                    <Search className="attendance-search-icon" size={18} aria-hidden="true" />
                    <label htmlFor="attendance-roster-search" className="sr-only">Search attendance roster</label>
                    <input
                      id="attendance-roster-search"
                      type="text"
                      placeholder="Search residents by code, name, or room..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="form-input"
                    />
                  </div>

                  <div className="attendance-roster-filter">
                    <Filter size={16} className="attendance-filter-icon" aria-hidden="true" />
                    <label htmlFor="attendance-status-filter" className="sr-only">Filter attendance by status</label>
                    <select
                      id="attendance-status-filter"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                      className="form-select"
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="PRESENT">Present</option>
                      <option value="ABSENT">Absent</option>
                      <option value="NOT_RECORDED">Not Recorded</option>
                    </select>
                  </div>
                </div>

                {/* Roster Table Card */}
                <div className="attendance-roster-card">
                  <div className="attendance-roster-header">
                    <h3 className="attendance-roster-title">Residents</h3>
                    <span className="attendance-roster-count">{filteredRoster.length} resident records</span>
                  </div>

                  <div className="table-container">
                    <table className="data-table" aria-label="Attendance roster">
                      <thead>
                        <tr>
                          <th scope="col">
                            Name
                          </th>
                          <th scope="col">
                            Room
                          </th>
                          <th scope="col">
                            Status
                          </th>
                          <th scope="col">
                            Time
                          </th>
                          {canManage && (
                            <th scope="col" className="cell-end">
                              Action
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {filteredRoster.length === 0 ? (
                          <tr>
                            <td colSpan={canManage ? 5 : 4}>
                              <div className="state-panel state-panel-compact">
                                <p className="state-panel-text">
                                  No resident attendance records matching current criteria.
                                </p>
                              </div>
                            </td>
                          </tr>
                        ) : (
                          filteredRoster.map((item) => (
                            <tr key={item.residentId}>
                              <td>
                                <div className="attendance-person">
                                  <div className="attendance-person-photo">
                                    <AuthenticatedImage
                                      src={residentsApi.getProfilePhotoUrl(item.residentId)}
                                      alt=""
                                      className="attendance-person-photo-img"
                                      onError={(e) => {
                                        (e.currentTarget as HTMLElement).style.display = 'none';
                                      }}
                                    />
                                    <Users size={18} className="attendance-person-placeholder" aria-hidden="true" />
                                  </div>
                                  <div className="attendance-person-text">
                                    <div className="cell-primary">{item.fullName}</div>
                                    <div className="cell-meta">{item.residentCode}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="cell-secondary">{item.roomGroup}</td>
                              <td>{renderStatusBadge(item.status)}</td>
                              <td className="cell-secondary cell-nowrap">
                                {item.markedAt
                                  ? new Date(item.markedAt).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : '—'}
                              </td>
                              {canManage && (
                                <td className="cell-end">
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
                                    <Edit2 size={13} aria-hidden="true" />
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
              <div className="attendance-empty-panel">
                <div className="attendance-empty-icon" aria-hidden="true">
                  <CheckSquare size={28} />
                </div>
                <h2 className="attendance-empty-title">Hostel Attendance</h2>
                <p className="attendance-empty-text">
                  No attendance session is active.
                  <br />
                  Start attendance when you are ready to conduct roll call.
                </p>
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setIsCreateModalOpen(true)}
                    aria-label="Start Attendance"
                    className="btn btn-primary btn-md"
                  >
                    <Play size={18} aria-hidden="true" />
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
        <form onSubmit={handleCreateSession} className="modal-form-stack">
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
            <label htmlFor="new-session-type" className="form-label">
              Session Type
            </label>
            <select
              id="new-session-type"
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
            <label htmlFor="new-session-date" className="form-label">Date</label>
            <input
              id="new-session-date"
              type="date"
              value={newSessionDate}
              onChange={(e) => setNewSessionDate(e.target.value)}
              className="form-input"
              required
            />
          </div>

          <div className="form-grid-2">
            <div className="form-group">
              <label htmlFor="new-session-start" className="form-label">
                Start Time
              </label>
              <input
                id="new-session-start"
                type="time"
                value={newSessionStartTime}
                onChange={(e) => setNewSessionStartTime(e.target.value)}
                className="form-input"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-session-end" className="form-label">
                End Time
              </label>
              <input
                id="new-session-end"
                type="time"
                value={newSessionEndTime}
                onChange={(e) => setNewSessionEndTime(e.target.value)}
                className="form-input"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="new-session-camera" className="form-label">
              Camera (Optional)
            </label>
            <select
              id="new-session-camera"
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

          <div className="modal-actions-bar">
            <button
              type="button"
              onClick={() => setIsCreateModalOpen(false)}
              className="btn btn-secondary btn-md"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary btn-md"
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
        <div className="modal-form-stack">
          <div className="alert-banner alert-banner-error">
            <AlertCircle size={20} className="alert-icon" aria-hidden="true" />
            <span>Are you sure you want to end this session?</span>
          </div>

          <div className="attendance-close-summary">
            <p>
              Present: <strong>{stats?.presentCount}</strong>
            </p>
            <p>
              Not yet marked: <strong>{stats?.remainingCount}</strong>
            </p>
            <div className="alert-banner alert-banner-warning">
              Residents not marked will be recorded as absent upon closing this session.
            </div>
          </div>

          <div className="modal-actions-bar">
            <button
              type="button"
              onClick={() => setIsCloseConfirmOpen(false)}
              className="btn btn-secondary btn-md"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleCloseSession}
              disabled={isSubmitting}
              className="btn btn-danger btn-md"
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
          <form onSubmit={handleSaveCorrection} className="modal-form-stack">
            <div className="attendance-correction-summary">
              <div>
                Resident: <strong>{correctingResident.fullName}</strong> ({correctingResident.residentCode})
              </div>
              <div>
                Current: <strong>{correctingResident.status}</strong>
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="attendance-correction-status" className="form-label">
                Change to
              </label>
              <select
                id="attendance-correction-status"
                value={targetCorrectionStatus}
                onChange={(e) => setTargetCorrectionStatus(e.target.value as typeof targetCorrectionStatus)}
                className="form-select"
              >
                <option value="PRESENT">Present</option>
                <option value="ABSENT">Absent</option>
              </select>
            </div>

            <div className="form-group">
              <label htmlFor="attendance-correction-reason" className="form-label">
                Reason (Mandatory) <span className="required-mark">*</span>
              </label>
              <textarea
                id="attendance-correction-reason"
                rows={3}
                value={correctionReason}
                onChange={(e) => setCorrectionReason(e.target.value)}
                placeholder="Explain why this attendance record is being changed..."
                className="form-control form-textarea"
                required
              />
            </div>

            <div className="modal-actions-bar">
              <button
                type="button"
                onClick={() => setCorrectingResident(null)}
                className="btn btn-secondary btn-md"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn btn-primary btn-md"
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
