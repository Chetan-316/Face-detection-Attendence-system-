import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { Badge } from '../components/Badge';
import { camerasApi } from '../api/cameras.api';
import { CameraEntity, CameraDiagnostics } from '../types/camera.types';
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
  Shield,
  X,
  Sliders,
  CheckCircle2,
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
  const [newCameraSourceType, setNewCameraSourceType] = useState<'WEBCAM' | 'RTSP' | 'SMART_CAMERA'>('WEBCAM');
  const [newCameraRole, setNewCameraRole] = useState<'GENERAL' | 'IN' | 'OUT' | 'ATTENDANCE'>('GENERAL');
  const [newCameraDeviceIndex, setNewCameraDeviceIndex] = useState('0');
  const [newCameraRtspUrl, setNewCameraRtspUrl] = useState('');
  const [isSubmittingCamera, setIsSubmittingCamera] = useState(false);

  const pollIntervalRef = useRef<number | null>(null);

  // Fetch cameras list
  const fetchCameras = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await camerasApi.listCameras(user?.hostelId || undefined);
      setCameras(res.data);

      // Select first camera by default if none selected
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
    } catch (err: any) {
      // Non-blocking poll failure
    }
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
      setStreamError(err.message || 'Failed to start camera hardware');
      toastError(err.message || 'Failed to start camera hardware');
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

  const handleRegisterCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCameraName.trim()) {
      toastError('Camera name is required');
      return;
    }

    try {
      setIsSubmittingCamera(true);
      const configMetadata: Record<string, any> = {};
      if (newCameraSourceType === 'WEBCAM') {
        configMetadata.deviceIndex = parseInt(newCameraDeviceIndex, 10) || 0;
        configMetadata.fps = 15;
      } else if (newCameraSourceType === 'RTSP') {
        configMetadata.rtspUrl = newCameraRtspUrl;
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
      fetchCameras();
    } catch (err: any) {
      toastError(err.message || 'Failed to register camera');
    } finally {
      setIsSubmittingCamera(false);
    }
  };

  const canManageCameras = user?.role === 'ADMIN' || user?.role === 'WARDEN';
  const isStreaming = diagnostics?.isActive ?? false;

  return (
    <div className="cameras-page">
      {/* Page Header */}
      <div className="page-header">
        <div className="header-text">
          <h1 className="page-title">Camera Feeds & Gate Monitoring</h1>
          <p className="page-subtitle">
            Universal camera abstraction layer (Laptop Webcam, RTSP, Smart Cameras) with real-time hardware streaming.
          </p>
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
              onClick={() => setIsRegisterModalOpen(true)}
            >
              <Plus size={16} />
              <span>Register Camera</span>
            </button>
          )}
        </div>
      </div>

      {/* Step 04 Architecture Banner */}
      <div className="architecture-checkpoint-card">
        <div className="checkpoint-icon-wrapper">
          <Layers size={22} className="checkpoint-icon" />
        </div>
        <div className="checkpoint-content">
          <div className="checkpoint-badge">
            <span>STEP 04 CAMERA ABSTRACTION</span>
          </div>
          <h2 className="checkpoint-title">Hardware Decoupling & Multi-Source Foundation</h2>
          <p className="checkpoint-text">
            Business and movement logic interact solely through <code>cameraId</code> and the universal{' '}
            <code>ICameraAdapter</code> contract. The system connects directly to the laptop webcam via OpenCV, streams
            live low-latency MJPEG preview, and is architected to seamlessly plug into future RTSP IP cameras and Smart AI devices.
            Biometric face recognition pipelines are intentionally decoupled for Step 05.
          </p>
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
              <p>Register your laptop webcam or gate camera to preview video feeds.</p>
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

                return (
                  <button
                    type="button"
                    key={camera.id}
                    className={`camera-item-card ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleSelectCamera(camera)}
                  >
                    <div className="camera-item-header">
                      <div className="camera-name-group">
                        <span className={`camera-status-indicator ${isOnline ? 'is-online' : 'is-offline'}`} />
                        <span className="camera-name">{camera.name}</span>
                      </div>
                      <Badge value={camera.healthStatus} size="sm" />
                    </div>

                    <div className="camera-item-meta">
                      <span className="meta-tag">
                        <Badge value={camera.sourceType} size="sm" />
                      </span>
                      <span className="meta-tag role-tag">Role: {camera.role}</span>
                      {camera.location && (
                        <span className="meta-tag location-tag">{camera.location.name}</span>
                      )}
                    </div>

                    <div className="camera-item-footer">
                      <span className="device-hint">
                        {camera.sourceType === 'WEBCAM'
                          ? `Device #${camera.configMetadata?.deviceIndex ?? 0}`
                          : camera.sourceType === 'RTSP'
                          ? 'RTSP Stream'
                          : 'Smart AI Node'}
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
                      <span>ID: <code>{selectedCamera.id.substring(0, 8)}...</code></span>
                      <span className="separator">•</span>
                      <span>Type: <strong>{selectedCamera.sourceType}</strong></span>
                      <span className="separator">•</span>
                      <span>Role: <strong>{selectedCamera.role}</strong></span>
                    </div>
                  </div>
                </div>

                <div className="monitor-status-badges">
                  <Badge value={selectedCamera.healthStatus} size="md" />
                </div>
              </div>

              {/* Error Message Banner */}
              {streamError && (
                <div className="stream-error-banner">
                  <AlertCircle size={18} />
                  <div className="error-text">
                    <strong>Camera Status Notice:</strong> {streamError}
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
                            : '640x480'}
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
                          {selectedCamera.sourceType}: DEVICE #
                          {selectedCamera.configMetadata?.deviceIndex ?? 0}
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
                        The camera hardware is currently stopped to conserve CPU and energy.
                        Click <strong>Start Live Preview</strong> to activate the frame acquisition loop.
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
                      title="Stop video capture and release camera device"
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
                      title="Open camera device and start live video streaming"
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
                    title="Capture a single still JPEG frame from camera"
                  >
                    <CameraIcon size={16} />
                    <span>Capture Snapshot</span>
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

              {/* Hardware Telemetry Cards */}
              <div className="telemetry-grid">
                <div className="telemetry-card">
                  <div className="telemetry-card-header">
                    <Activity size={16} className="telemetry-icon" />
                    <span className="telemetry-label">Stream Rate</span>
                  </div>
                  <span className="telemetry-value">
                    {diagnostics?.fps ? `${diagnostics.fps} FPS` : '0 FPS'}
                  </span>
                  <span className="telemetry-sub">Frame rate</span>
                </div>

                <div className="telemetry-card">
                  <div className="telemetry-card-header">
                    <Layers size={16} className="telemetry-icon" />
                    <span className="telemetry-label">Frames Read</span>
                  </div>
                  <span className="telemetry-value">
                    {diagnostics?.totalFramesCaptured ?? 0}
                  </span>
                  <span className="telemetry-sub">Total captured</span>
                </div>

                <div className="telemetry-card">
                  <div className="telemetry-card-header">
                    <Sliders size={16} className="telemetry-icon" />
                    <span className="telemetry-label">Source Contract</span>
                  </div>
                  <span className="telemetry-value">{selectedCamera.sourceType}</span>
                  <span className="telemetry-sub">ICameraAdapter</span>
                </div>

                <div className="telemetry-card">
                  <div className="telemetry-card-header">
                    <Shield size={16} className="telemetry-icon" />
                    <span className="telemetry-label">Biometric Isolation</span>
                  </div>
                  <span className="telemetry-value">DECOUPLED</span>
                  <span className="telemetry-sub">Phase 5 separation</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="no-selection-screen">
              <Video size={48} className="no-selection-icon" />
              <h3>Select a Camera Device</h3>
              <p>Choose a camera feed from the left pane to monitor gate traffic or test laptop webcam hardware.</p>
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
                    placeholder="e.g. Laptop Webcam or Gate 1 Ingress"
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
                    <option value="WEBCAM">WEBCAM (Laptop or USB DirectShow)</option>
                    <option value="RTSP">RTSP (IP Network Security Camera)</option>
                    <option value="SMART_CAMERA">SMART_CAMERA (Edge AI Camera Node)</option>
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
                    <option value="GENERAL">GENERAL (Monitoring / Surveillance)</option>
                    <option value="IN">IN (Hostel Gate Ingress)</option>
                    <option value="OUT">OUT (Hostel Gate Egress)</option>
                    <option value="ATTENDANCE">ATTENDANCE (Assembly / Roll Call Checkpoint)</option>
                  </select>
                </div>

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
                      Device 0 is typically the built-in laptop camera. Device 1+ for external USB webcams.
                    </small>
                  </div>
                )}

                {newCameraSourceType === 'RTSP' && (
                  <div className="form-group">
                    <label htmlFor="cam-rtsp" className="form-label">
                      RTSP Stream URL
                    </label>
                    <input
                      id="cam-rtsp"
                      type="text"
                      className="form-control"
                      placeholder="rtsp://admin:pass@192.168.1.100:554/live/ch0"
                      value={newCameraRtspUrl}
                      onChange={(e) => setNewCameraRtspUrl(e.target.value)}
                    />
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
    </div>
  );
};
