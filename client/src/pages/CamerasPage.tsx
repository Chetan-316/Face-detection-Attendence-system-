import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { Badge } from '../components/Badge';
import { camerasApi } from '../api/cameras.api';
import { CameraEntity, CameraDiagnostics, CameraTestResult } from '../types/camera.types';
import {
  Video,
  VideoOff,
  Camera as CameraIcon,
  Play,
  Square,
  RefreshCw,
  Plus,
  AlertCircle,
  Activity,
  Layers,
  Clock,
  X,
  Sliders,
  CheckCircle2,
  Wifi,
  Edit2,
} from 'lucide-react';

export const CamerasPage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError, info } = useToast();

  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<CameraEntity | null>(null);
  const [diagnostics, setDiagnostics] = useState<CameraDiagnostics | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isActionPending, setIsActionPending] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<string | null>(null);

  // Connection test state
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<CameraTestResult | null>(null);

  // Snapshot modal state
  const [snapshotData, setSnapshotData] = useState<{
    dataBase64: string;
    timestamp: string;
    width?: number;
    height?: number;
  } | null>(null);

  // Register camera modal state
  const [isRegisterModalOpen, setIsRegisterModalOpen] = useState<boolean>(false);
  const [newCameraName, setNewCameraName] = useState('');
  const [newCameraSourceType, setNewCameraSourceType] = useState<'WEBCAM' | 'RTSP' | 'SMART_CAMERA'>('RTSP');
  const [newCameraRole, setNewCameraRole] = useState<'GENERAL' | 'IN' | 'OUT' | 'ATTENDANCE'>('IN');
  const [newCameraMovementAutomation, setNewCameraMovementAutomation] = useState(true);
  const [newCameraDeviceIndex, setNewCameraDeviceIndex] = useState('0');
  const [newCameraRtspUrl, setNewCameraRtspUrl] = useState('');
  const [newCameraTransport, setNewCameraTransport] = useState<'tcp' | 'udp'>('tcp');
  const [newCameraUsername, setNewCameraUsername] = useState('');
  const [newCameraPassword, setNewCameraPassword] = useState('');
  const [isSubmittingCamera, setIsSubmittingCamera] = useState(false);
  const [modalTestResult, setModalTestResult] = useState<CameraTestResult | null>(null);
  const [isModalTesting, setIsModalTesting] = useState(false);

  // Edit camera modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [editCameraName, setEditCameraName] = useState('');
  const [editCameraRole, setEditCameraRole] = useState<'GENERAL' | 'IN' | 'OUT' | 'ATTENDANCE'>('GENERAL');
  const [editCameraMovementAutomation, setEditCameraMovementAutomation] = useState(true);
  const [editCameraRtspUrl, setEditCameraRtspUrl] = useState('');
  const [editCameraTransport, setEditCameraTransport] = useState<'tcp' | 'udp'>('tcp');
  const [editCameraUsername, setEditCameraUsername] = useState('');
  const [editCameraPassword, setEditCameraPassword] = useState('');
  const [editHasExistingPassword, setEditHasExistingPassword] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const pollIntervalRef = useRef<number | null>(null);

  // Fetch cameras list
  const fetchCameras = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await camerasApi.listCameras(user?.hostelId || undefined);
      setCameras(res.data);

      if (res.data.length > 0 && !selectedCameraId) {
        setSelectedCameraId(res.data[0].id);
        setSelectedCamera(res.data[0]);
      } else if (selectedCameraId) {
        const current = res.data.find((c) => c.id === selectedCameraId) || null;
        setSelectedCamera(current);
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

  // Fetch diagnostics for selected camera
  const fetchDiagnostics = useCallback(async (cameraId: string) => {
    try {
      const res = await camerasApi.getCameraHealth(cameraId);
      setDiagnostics({
        cameraId: res.data.cameraId,
        sourceType: res.data.sourceType,
        isActive: res.data.isStreaming,
        healthStatus: res.data.healthStatus,
        lastSeenAt: res.data.lastSeenAt,
        fps: res.data.fps,
        totalFramesCaptured: res.data.totalFramesCaptured,
        resolution: res.data.resolution,
        lastError: res.data.lastError,
      });

      if (res.data.lastError) {
        setStreamError(res.data.lastError);
      } else {
        setStreamError(null);
      }
    } catch {}
  }, []);

  // Polling loop for active streaming telemetry
  useEffect(() => {
    if (!selectedCameraId) return;

    fetchDiagnostics(selectedCameraId);

    pollIntervalRef.current = setInterval(() => {
      fetchDiagnostics(selectedCameraId);
    }, 2000);

    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
    };
  }, [selectedCameraId, fetchDiagnostics]);

  const handleSelectCamera = (camera: CameraEntity) => {
    setSelectedCameraId(camera.id);
    setSelectedCamera(camera);
    setStreamError(null);
    setTestResult(null);
  };

  const handleStartStream = async () => {
    if (!selectedCamera) return;
    try {
      setIsActionPending(true);
      setStreamError(null);
      const res = await camerasApi.startCamera(selectedCamera.id);
      setDiagnostics(res.data);
      success(`Started live stream on ${selectedCamera.name}`);
      fetchCameras();
    } catch (err: any) {
      setStreamError(err.message || 'Failed to start camera');
      toastError(err.message || 'Failed to start camera');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleStopStream = async () => {
    if (!selectedCamera) return;
    try {
      setIsActionPending(true);
      const res = await camerasApi.stopCamera(selectedCamera.id);
      setDiagnostics(res.data);
      info(`Stopped live stream on ${selectedCamera.name}`);
      fetchCameras();
    } catch (err: any) {
      toastError(err.message || 'Failed to stop camera');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleCaptureSnapshot = async () => {
    if (!selectedCamera) return;
    try {
      setIsActionPending(true);
      const res = await camerasApi.captureSnapshot(selectedCamera.id);
      setSnapshotData(res.data);
      success('Frame snapshot captured successfully');
    } catch (err: any) {
      toastError(err.message || 'Failed to capture snapshot');
    } finally {
      setIsActionPending(false);
    }
  };

  const handleTestConnection = async () => {
    if (!selectedCamera) return;
    try {
      setIsTestingConnection(true);
      setTestResult(null);
      const res = await camerasApi.testCameraConnection(selectedCamera.id);
      setTestResult(res.data);
      if (res.data.reachable) {
        success('Camera connection verified successfully');
      } else {
        toastError(res.data.message || 'Camera connection failed');
      }
    } catch (err: any) {
      toastError(err.message || 'Connection test failed');
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleModalTestConnection = async () => {
    try {
      setIsModalTesting(true);
      setModalTestResult(null);
      const payload: any = {
        sourceType: newCameraSourceType,
        transport: newCameraTransport,
      };
      if (newCameraSourceType === 'RTSP') {
        payload.rtspUrl = newCameraRtspUrl;
        payload.username = newCameraUsername;
        payload.password = newCameraPassword;
      } else if (newCameraSourceType === 'WEBCAM') {
        payload.deviceIndex = parseInt(newCameraDeviceIndex, 10) || 0;
      }
      const res = await camerasApi.testNewConnection(payload);
      setModalTestResult(res.data);
    } catch (err: any) {
      setModalTestResult({
        reachable: false,
        sourceType: newCameraSourceType,
        latencyMs: 0,
        message: err.message || 'Could not test connection',
      });
    } finally {
      setIsModalTesting(false);
    }
  };

  const handleRegisterCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCameraName.trim()) {
      toastError('Camera name is required');
      return;
    }

    try {
      setIsSubmittingCamera(true);
      const configMetadata: Record<string, any> = {};
      if (newCameraRole === 'IN' || newCameraRole === 'OUT') {
        configMetadata.movementAutomationEnabled = newCameraMovementAutomation;
      }
      if (newCameraSourceType === 'WEBCAM') {
        configMetadata.deviceIndex = parseInt(newCameraDeviceIndex, 10) || 0;
        configMetadata.fps = 15;
      } else if (newCameraSourceType === 'RTSP') {
        configMetadata.rtspUrl = newCameraRtspUrl;
        configMetadata.transport = newCameraTransport;
        if (newCameraUsername) configMetadata.username = newCameraUsername;
        if (newCameraPassword) configMetadata.password = newCameraPassword;
        configMetadata.fps = 15;
      }

      await camerasApi.createCamera({
        name: newCameraName.trim(),
        sourceType: newCameraSourceType,
        role: newCameraRole,
        hostelId: user?.hostelId || undefined,
        configMetadata,
      });

      success('Camera registered successfully');
      setIsRegisterModalOpen(false);
      setNewCameraName('');
      setNewCameraDeviceIndex('0');
      setNewCameraRtspUrl('');
      setNewCameraUsername('');
      setNewCameraPassword('');
      setModalTestResult(null);
      fetchCameras();
    } catch (err: any) {
      toastError(err.message || 'Failed to register camera');
    } finally {
      setIsSubmittingCamera(false);
    }
  };

  const openEditModal = (camera: CameraEntity) => {
    setEditCameraName(camera.name);
    setEditCameraRole(camera.role);
    setEditCameraMovementAutomation(camera.configMetadata?.movementAutomationEnabled !== false);
    setEditCameraRtspUrl(camera.configMetadata?.rtspUrl || '');
    setEditCameraTransport(camera.configMetadata?.transport || 'tcp');
    setEditCameraUsername(camera.configMetadata?.username || '');
    setEditCameraPassword('');
    setEditHasExistingPassword(Boolean(camera.configMetadata?.credentialsConfigured));
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCamera) return;

    try {
      setIsSavingEdit(true);
      const configMetadata: Record<string, any> = {
        ...selectedCamera.configMetadata,
      };

      if (editCameraRole === 'IN' || editCameraRole === 'OUT') {
        configMetadata.movementAutomationEnabled = editCameraMovementAutomation;
      }

      if (selectedCamera.sourceType === 'RTSP') {
        configMetadata.rtspUrl = editCameraRtspUrl;
        configMetadata.transport = editCameraTransport;
        if (editCameraUsername) configMetadata.username = editCameraUsername;
        if (editCameraPassword) {
          configMetadata.password = editCameraPassword;
        }
      }

      await camerasApi.updateCamera(selectedCamera.id, {
        name: editCameraName.trim(),
        role: editCameraRole,
        configMetadata,
      });

      success('Camera updated successfully');
      setIsEditModalOpen(false);
      fetchCameras();
    } catch (err: any) {
      toastError(err.message || 'Failed to update camera');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const canManageCameras = user?.role === 'ADMIN' || user?.role === 'WARDEN';
  const isStreaming = diagnostics?.isActive ?? false;

  return (
    <div className="cameras-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="header-text">
          <h1 className="page-title">Cameras</h1>
          <p className="page-subtitle">Manage hostel cameras and live feeds.</p>
        </div>
        <div className="header-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={fetchCameras}
            disabled={isLoading}
            title="Refresh camera list and diagnostics"
          >
            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>

          {canManageCameras && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setModalTestResult(null);
                setIsRegisterModalOpen(true);
              }}
            >
              <Plus size={16} />
              <span>Register Camera</span>
            </button>
          )}
        </div>
      </div>

      {/* Main Grid: Left Camera Cards | Right Video Monitor */}
      <div className="cameras-layout">
        {/* Left Column: Camera Devices List */}
        <div className="camera-list-pane">
          <div className="pane-header">
            <h3 className="pane-title">Configured Cameras</h3>
            <span className="camera-count-badge">{cameras.length} Devices</span>
          </div>

          {isLoading && cameras.length === 0 ? (
            <div className="loading-state">
              <RefreshCw size={24} className="animate-spin" />
              <span>Detecting camera devices...</span>
            </div>
          ) : cameras.length === 0 ? (
            <div className="empty-state-card">
              <VideoOff size={36} className="empty-icon" />
              <h4>No Cameras Configured</h4>
              <p>Register your IP network camera or webcam to preview video feeds.</p>
              {canManageCameras && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm mt-3"
                  onClick={() => setIsRegisterModalOpen(true)}
                >
                  <Plus size={14} />
                  <span>Register First Camera</span>
                </button>
              )}
            </div>
          ) : (
            <div className="camera-card-list">
              {cameras.map((camera) => {
                const isSelected = camera.id === selectedCameraId;
                const isOnline = camera.healthStatus === 'ONLINE';
                const isDegraded = camera.healthStatus === 'DEGRADED';

                return (
                  <button
                    type="button"
                    key={camera.id}
                    className={`camera-item-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleSelectCamera(camera)}
                  >
                    <div className="camera-item-header">
                      <div className="camera-name-group">
                        <span
                          className={`camera-status-indicator ${
                            isOnline ? 'is-online' : isDegraded ? 'is-degraded' : 'is-offline'
                          }`}
                        />
                        <span className="camera-name">{camera.name}</span>
                      </div>
                      <Badge value={camera.healthStatus} size="sm" />
                    </div>

                    <div className="camera-item-meta">
                      <span className="meta-tag">
                        <Badge
                          value={
                            camera.sourceType === 'RTSP'
                              ? 'Network Camera'
                              : camera.sourceType === 'WEBCAM'
                              ? 'Webcam'
                              : 'Smart Camera'
                          }
                          size="sm"
                        />
                      </span>
                      <span className="meta-tag role-tag">Role: {camera.role}</span>
                      {camera.location && (
                        <span className="meta-tag location-tag">{camera.location.name}</span>
                      )}
                    </div>

                    <div className="camera-item-footer">
                      <span className="device-hint">
                        {camera.sourceType === 'RTSP'
                          ? camera.configMetadata?.host || 'RTSP Stream'
                          : camera.sourceType === 'WEBCAM'
                          ? `Device #${camera.configMetadata?.deviceIndex ?? 0}`
                          : 'Smart Node'}
                      </span>
                      {isSelected && <span className="active-view-label">Selected</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Live Video Monitor & Telemetry */}
        <div className="camera-monitor-pane">
          {selectedCamera ? (
            <div className="monitor-container">
              {/* Monitor Top Bar */}
              <div className="monitor-header">
                <div className="monitor-title-group">
                  <div className="camera-icon-wrapper">
                    <Video size={18} />
                  </div>
                  <div>
                    <h3 className="selected-camera-title">{selectedCamera.name}</h3>
                    <div className="selected-camera-sub">
                      <span>Connection: <strong>{selectedCamera.sourceType === 'RTSP' ? 'Network Camera (RTSP)' : selectedCamera.sourceType}</strong></span>
                      <span className="separator">•</span>
                      <span>Role: <strong>{selectedCamera.role}</strong></span>
                      {(selectedCamera.role === 'IN' || selectedCamera.role === 'OUT') && (
                        <>
                          <span className="separator">•</span>
                          <span>
                            Gate Automation:{' '}
                            <strong
                              className={
                                selectedCamera.configMetadata?.movementAutomationEnabled !== false
                                  ? 'text-emerald-400 font-semibold'
                                  : 'text-slate-400'
                              }
                            >
                              {selectedCamera.configMetadata?.movementAutomationEnabled !== false
                                ? 'ON'
                                : 'OFF'}
                            </strong>
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="monitor-status-badges flex items-center gap-2">
                  <Badge value={selectedCamera.healthStatus} size="md" />
                  {canManageCameras && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => openEditModal(selectedCamera)}
                      title="Edit camera configuration"
                    >
                      <Edit2 size={14} />
                      <span>Edit</span>
                    </button>
                  )}
                </div>
              </div>

              {/* Error Message Banner */}
              {streamError && (
                <div className="stream-error-banner">
                  <AlertCircle size={18} />
                  <div className="error-text">
                    <strong>Notice:</strong> {streamError}
                  </div>
                </div>
              )}

              {/* Connection Test Result Banner */}
              {testResult && (
                <div
                  className={`p-3 rounded-lg border mb-3 flex items-center gap-2 ${
                    testResult.reachable
                      ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
                      : 'bg-rose-950/40 border-rose-700/50 text-rose-200'
                  }`}
                >
                  {testResult.reachable ? (
                    <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />
                  ) : (
                    <AlertCircle size={18} className="text-rose-400 shrink-0" />
                  )}
                  <div className="text-sm">
                    {testResult.reachable ? (
                      <span>
                        <strong>Connected:</strong>{' '}
                        {testResult.resolution
                          ? `${testResult.resolution.width} × ${testResult.resolution.height}`
                          : '1280 × 720'}
                        , {testResult.fps ?? 15} FPS • Stream available ({testResult.latencyMs}ms)
                      </span>
                    ) : (
                      <span>{testResult.message || 'Could not connect. Check camera address, credentials and network.'}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Video Screen Frame */}
              <div className="video-screen-frame">
                {isStreaming ? (
                  <div className="video-player-wrapper">
                    {/* Live Stream MJPEG Image */}
                    <img
                      src={camerasApi.getPreviewStreamUrl(selectedCamera.id)}
                      alt={`Live Preview of ${selectedCamera.name}`}
                      className="live-preview-image"
                      onError={() => {
                        setStreamError('Preview stream connection interrupted. Please restart stream.');
                      }}
                    />

                    {/* HUD Overlay */}
                    <div className="hud-overlay">
                      <div className="hud-top-left">
                        <span className="live-indicator">
                          <span className="pulse-dot" />
                          <span>LIVE PREVIEW</span>
                        </span>
                        <span className="hud-metric">{diagnostics?.fps ?? 0} FPS</span>
                      </div>

                      <div className="hud-top-right">
                        <span className="hud-resolution">
                          {diagnostics?.resolution
                            ? `${diagnostics.resolution.width}x${diagnostics.resolution.height}`
                            : '1280x720'}
                        </span>
                      </div>

                      <div className="hud-bottom-left">
                        <span className="hud-timestamp">
                          <Clock size={12} />
                          <span>{new Date().toLocaleTimeString()}</span>
                        </span>
                      </div>

                      <div className="hud-bottom-right">
                        <span className="hud-device-badge">
                          {selectedCamera.sourceType === 'RTSP'
                            ? `RTSP (${selectedCamera.configMetadata?.transport?.toUpperCase() || 'TCP'})`
                            : selectedCamera.sourceType}
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="video-placeholder">
                    <div className="placeholder-content">
                      <div className="placeholder-icon-box">
                        <VideoOff size={44} className="placeholder-icon" />
                      </div>
                      <h4>Live Video Feed Inactive</h4>
                      <p>
                        The camera stream is stopped to conserve compute.
                        Click <strong>Start Live Preview</strong> to activate real-time frames.
                      </p>
                      <button
                        type="button"
                        className="btn btn-primary mt-3"
                        onClick={handleStartStream}
                        disabled={isActionPending}
                      >
                        <Play size={16} />
                        <span>Start Live Preview</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Control Action Toolbar */}
              <div className="monitor-controls-toolbar">
                <div className="controls-left">
                  {isStreaming ? (
                    <button
                      type="button"
                      className="btn btn-danger"
                      onClick={handleStopStream}
                      disabled={isActionPending}
                      title="Stop video stream"
                    >
                      <Square size={16} />
                      <span>Stop Preview</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-success"
                      onClick={handleStartStream}
                      disabled={isActionPending}
                      title="Start live video stream"
                    >
                      <Play size={16} />
                      <span>Start Live Preview</span>
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCaptureSnapshot}
                    disabled={isActionPending}
                    title="Capture a still JPEG frame"
                  >
                    <CameraIcon size={16} />
                    <span>Capture Snapshot</span>
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleTestConnection}
                    disabled={isTestingConnection}
                    title="Probe camera address and verify connectivity"
                  >
                    <Wifi size={16} className={isTestingConnection ? 'animate-spin' : ''} />
                    <span>{isTestingConnection ? 'Testing...' : 'Test Connection'}</span>
                  </button>
                </div>

                <div className="controls-right">
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => fetchDiagnostics(selectedCamera.id)}
                    title="Refresh diagnostics"
                  >
                    <RefreshCw size={14} />
                    <span>Diagnostics</span>
                  </button>
                </div>
              </div>

              {/* Telemetry Cards */}
              <div className="telemetry-grid">
                <div className="telemetry-card">
                  <div className="telemetry-card-header">
                    <Activity size={16} className="telemetry-icon" />
                    <span className="telemetry-label">Stream Rate</span>
                  </div>
                  <span className="telemetry-value">
                    {diagnostics?.fps ? `${diagnostics.fps} FPS` : '0 FPS'}
                  </span>
                  <span className="telemetry-sub">Inference / Ingestion</span>
                </div>

                <div className="telemetry-card">
                  <div className="telemetry-card-header">
                    <Layers size={16} className="telemetry-icon" />
                    <span className="telemetry-label">Frames Captured</span>
                  </div>
                  <span className="telemetry-value">
                    {diagnostics?.totalFramesCaptured ?? 0}
                  </span>
                  <span className="telemetry-sub">Total frames</span>
                </div>

                <div className="telemetry-card">
                  <div className="telemetry-card-header">
                    <Sliders size={16} className="telemetry-icon" />
                    <span className="telemetry-label">Resolution</span>
                  </div>
                  <span className="telemetry-value">
                    {diagnostics?.resolution
                      ? `${diagnostics.resolution.width} × ${diagnostics.resolution.height}`
                      : '1280 × 720'}
                  </span>
                  <span className="telemetry-sub">Frame dimensions</span>
                </div>

                <div className="telemetry-card">
                  <div className="telemetry-card-header">
                    <Clock size={16} className="telemetry-icon" />
                    <span className="telemetry-label">Last Seen</span>
                  </div>
                  <span className="telemetry-value text-base">
                    {diagnostics?.lastSeenAt
                      ? new Date(diagnostics.lastSeenAt).toLocaleTimeString()
                      : 'Never'}
                  </span>
                  <span className="telemetry-sub">Recent signal</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="no-selection-screen">
              <Video size={48} className="no-selection-icon" />
              <h3>Select a Camera Device</h3>
              <p>Choose a camera feed from the left pane to monitor gate traffic or view live frames.</p>
            </div>
          )}
        </div>
      </div>

      {/* Snapshot Preview Modal */}
      {snapshotData && (
        <div className="modal-backdrop" onClick={() => setSnapshotData(null)}>
          <div className="modal-dialog snapshot-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <CameraIcon size={20} className="modal-icon" />
                <h3 className="modal-title">Camera Frame Snapshot</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setSnapshotData(null)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="snapshot-preview-frame">
                <img
                  src={`data:image/jpeg;base64,${snapshotData.dataBase64}`}
                  alt="Captured Snapshot"
                  className="snapshot-image"
                />
              </div>

              <div className="snapshot-metadata-bar mt-3">
                <span className="meta-item">
                  <strong>Timestamp:</strong> {new Date(snapshotData.timestamp).toLocaleString()}
                </span>
                {snapshotData.width && snapshotData.height && (
                  <span className="meta-item">
                    <strong>Dimensions:</strong> {snapshotData.width} × {snapshotData.height}
                  </span>
                )}
                <span className="meta-item">
                  <strong>Format:</strong> JPEG Standard
                </span>
              </div>
            </div>

            <div className="modal-footer">
              <a
                href={`data:image/jpeg;base64,${snapshotData.dataBase64}`}
                download={`pravahax-snapshot-${Date.now()}.jpg`}
                className="btn btn-primary"
              >
                Download Still Frame
              </a>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setSnapshotData(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Register Camera Modal */}
      {isRegisterModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsRegisterModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <Video size={20} className="modal-icon" />
                <h3 className="modal-title">Register Camera Device</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsRegisterModalOpen(false)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleRegisterCamera}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="cam-name" className="form-label">
                    Camera Name <span className="required">*</span>
                  </label>
                  <input
                    id="cam-name"
                    type="text"
                    className="form-control"
                    placeholder="e.g. Main Gate IN or Corridor 2"
                    value={newCameraName}
                    onChange={(e) => setNewCameraName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="cam-source" className="form-label">
                    Source Type <span className="required">*</span>
                  </label>
                  <select
                    id="cam-source"
                    className="form-control"
                    value={newCameraSourceType}
                    onChange={(e) => setNewCameraSourceType(e.target.value as any)}
                  >
                    <option value="RTSP">Network Camera (RTSP / IP Camera)</option>
                    <option value="WEBCAM">Webcam (USB / Laptop DirectShow)</option>
                    <option value="SMART_CAMERA">Smart Camera (Edge AI Device)</option>
                  </select>
                </div>

                <div className="form-group">
                  <label htmlFor="cam-role" className="form-label">
                    Camera Role
                  </label>
                  <select
                    id="cam-role"
                    className="form-control"
                    value={newCameraRole}
                    onChange={(e) => setNewCameraRole(e.target.value as any)}
                  >
                    <option value="GENERAL">GENERAL (Surveillance / Monitoring)</option>
                    <option value="IN">IN (Hostel Gate Ingress)</option>
                    <option value="OUT">OUT (Hostel Gate Egress)</option>
                    <option value="ATTENDANCE">ATTENDANCE (Assembly / Roll Call Checkpoint)</option>
                  </select>
                </div>

                {(newCameraRole === 'IN' || newCameraRole === 'OUT') && (
                  <div className="form-group flex items-center gap-2 py-1">
                    <input
                      id="cam-movement-auto"
                      type="checkbox"
                      className="rounded border-slate-700 text-primary-500 focus:ring-primary-500"
                      checked={newCameraMovementAutomation}
                      onChange={(e) => setNewCameraMovementAutomation(e.target.checked)}
                    />
                    <label htmlFor="cam-movement-auto" className="text-sm text-slate-300 font-medium">
                      Enable Gate Movement Automation (Create IN/OUT records on stable MATCH)
                    </label>
                  </div>
                )}

                {newCameraSourceType === 'RTSP' && (
                  <>
                    <div className="form-group">
                      <label htmlFor="cam-rtsp" className="form-label">
                        RTSP Stream Address <span className="required">*</span>
                      </label>
                      <input
                        id="cam-rtsp"
                        type="text"
                        className="form-control"
                        placeholder="rtsp://192.168.1.100:554/ch0 or substream"
                        value={newCameraRtspUrl}
                        onChange={(e) => setNewCameraRtspUrl(e.target.value)}
                        required
                      />
                      <small className="form-hint">
                        Prefer an RTSP substream for optimal recognition latency.
                      </small>
                    </div>

                    <div className="form-group">
                      <label htmlFor="cam-transport" className="form-label">
                        RTSP Transport Protocol
                      </label>
                      <select
                        id="cam-transport"
                        className="form-control"
                        value={newCameraTransport}
                        onChange={(e) => setNewCameraTransport(e.target.value as any)}
                      >
                        <option value="tcp">TCP (Recommended — reliable packet ordering)</option>
                        <option value="udp">UDP (Low overhead)</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="form-group">
                        <label htmlFor="cam-user" className="form-label">
                          Username (Optional)
                        </label>
                        <input
                          id="cam-user"
                          type="text"
                          className="form-control"
                          placeholder="admin"
                          value={newCameraUsername}
                          onChange={(e) => setNewCameraUsername(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="cam-pass" className="form-label">
                          Password (Optional)
                        </label>
                        <input
                          id="cam-pass"
                          type="password"
                          className="form-control"
                          placeholder="••••••••"
                          value={newCameraPassword}
                          onChange={(e) => setNewCameraPassword(e.target.value)}
                        />
                      </div>
                    </div>

                    <div className="pt-2">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={handleModalTestConnection}
                        disabled={isModalTesting || !newCameraRtspUrl.trim()}
                      >
                        <Wifi size={14} className={isModalTesting ? 'animate-spin' : ''} />
                        <span>{isModalTesting ? 'Testing...' : 'Test Connection'}</span>
                      </button>

                      {modalTestResult && (
                        <div
                          className={`mt-2 p-2 rounded text-xs border ${
                            modalTestResult.reachable
                              ? 'bg-emerald-950/40 border-emerald-700/50 text-emerald-200'
                              : 'bg-rose-950/40 border-rose-700/50 text-rose-200'
                          }`}
                        >
                          {modalTestResult.reachable ? (
                            <span>Connected ({modalTestResult.resolution?.width}x{modalTestResult.resolution?.height}, {modalTestResult.fps} FPS, {modalTestResult.latencyMs}ms)</span>
                          ) : (
                            <span>{modalTestResult.message || 'Could not connect. Check camera address, credentials and network.'}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}

                {newCameraSourceType === 'WEBCAM' && (
                  <div className="form-group">
                    <label htmlFor="cam-device" className="form-label">
                      Webcam Device Index
                    </label>
                    <input
                      id="cam-device"
                      type="number"
                      min="0"
                      max="10"
                      className="form-control"
                      value={newCameraDeviceIndex}
                      onChange={(e) => setNewCameraDeviceIndex(e.target.value)}
                    />
                    <small className="form-hint">
                      Device 0 is typically the built-in laptop camera. Device 1+ for external USB cameras.
                    </small>
                  </div>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsRegisterModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmittingCamera}
                >
                  {isSubmittingCamera ? 'Registering...' : 'Register Camera'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Camera Modal */}
      {isEditModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsEditModalOpen(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title-group">
                <Edit2 size={20} className="modal-icon" />
                <h3 className="modal-title">Edit Camera</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setIsEditModalOpen(false)}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSaveEdit}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="edit-name" className="form-label">
                    Camera Name <span className="required">*</span>
                  </label>
                  <input
                    id="edit-name"
                    type="text"
                    className="form-control"
                    value={editCameraName}
                    onChange={(e) => setEditCameraName(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="edit-role" className="form-label">
                    Camera Role
                  </label>
                  <select
                    id="edit-role"
                    className="form-control"
                    value={editCameraRole}
                    onChange={(e) => setEditCameraRole(e.target.value as any)}
                  >
                    <option value="GENERAL">GENERAL (Surveillance / Monitoring)</option>
                    <option value="IN">IN (Hostel Gate Ingress)</option>
                    <option value="OUT">OUT (Hostel Gate Egress)</option>
                    <option value="ATTENDANCE">ATTENDANCE (Assembly / Roll Call Checkpoint)</option>
                  </select>
                </div>

                {(editCameraRole === 'IN' || editCameraRole === 'OUT') && (
                  <div className="form-group flex items-center gap-2 py-1">
                    <input
                      id="edit-movement-auto"
                      type="checkbox"
                      className="rounded border-slate-700 text-primary-500 focus:ring-primary-500"
                      checked={editCameraMovementAutomation}
                      onChange={(e) => setEditCameraMovementAutomation(e.target.checked)}
                    />
                    <label htmlFor="edit-movement-auto" className="text-sm text-slate-300 font-medium">
                      Enable Gate Movement Automation (Create IN/OUT records on stable MATCH)
                    </label>
                  </div>
                )}

                {selectedCamera?.sourceType === 'RTSP' && (
                  <>
                    <div className="form-group">
                      <label htmlFor="edit-rtsp" className="form-label">
                        RTSP Stream Address
                      </label>
                      <input
                        id="edit-rtsp"
                        type="text"
                        className="form-control"
                        value={editCameraRtspUrl}
                        onChange={(e) => setEditCameraRtspUrl(e.target.value)}
                      />
                    </div>

                    <div className="form-group">
                      <label htmlFor="edit-transport" className="form-label">
                        Transport Protocol
                      </label>
                      <select
                        id="edit-transport"
                        className="form-control"
                        value={editCameraTransport}
                        onChange={(e) => setEditCameraTransport(e.target.value as any)}
                      >
                        <option value="tcp">TCP (Recommended)</option>
                        <option value="udp">UDP</option>
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="form-group">
                        <label htmlFor="edit-user" className="form-label">
                          Username
                        </label>
                        <input
                          id="edit-user"
                          type="text"
                          className="form-control"
                          value={editCameraUsername}
                          onChange={(e) => setEditCameraUsername(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <label htmlFor="edit-pass" className="form-label">
                          Password
                        </label>
                        <input
                          id="edit-pass"
                          type="password"
                          className="form-control"
                          placeholder={editHasExistingPassword ? 'Password configured (leave blank to keep)' : '••••••••'}
                          value={editCameraPassword}
                          onChange={(e) => setEditCameraPassword(e.target.value)}
                        />
                        {editHasExistingPassword && (
                          <small className="form-hint text-emerald-400">
                            Password is saved. Leave blank unless updating.
                          </small>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsEditModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSavingEdit}
                >
                  {isSavingEdit ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
