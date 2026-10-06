import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { Badge } from '../components/Badge';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { camerasApi } from '../api/cameras.api';
import { facilitiesApi, Facility, FacilityLocation } from '../api/facilities.api';
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
  X,
  CheckCircle2,
  Wifi,
  Edit2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  MapPin,
  ArrowRight,
} from 'lucide-react';

export const CamerasPage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError, info } = useToast();

  if (user?.role === 'GUARD') {
    return <Navigate to="/gate" replace />;
  }

  const isAdmin = user?.role === 'ADMIN';

  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [newCameraFacilityId, setNewCameraFacilityId] = useState(user?.hostelId || '');
  const [newCameraLocations, setNewCameraLocations] = useState<FacilityLocation[]>([]);
  const [newCameraLocationId, setNewCameraLocationId] = useState('');
  const [editCameraFacilityId, setEditCameraFacilityId] = useState('');
  const [editCameraLocations, setEditCameraLocations] = useState<FacilityLocation[]>([]);
  const [editCameraLocationId, setEditCameraLocationId] = useState('');
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
  const [registerStep, setRegisterStep] = useState<1 | 2>(1);
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
  const [showAdvancedRegister, setShowAdvancedRegister] = useState(false);

  // Edit camera modal state
  const [isEditModalOpen, setIsEditModalOpen] = useState<boolean>(false);
  const [editCameraName, setEditCameraName] = useState('');
  const [editCameraRole, setEditCameraRole] = useState<'GENERAL' | 'IN' | 'OUT' | 'ATTENDANCE'>('GENERAL');
  const [editCameraMovementAutomation, setEditCameraMovementAutomation] = useState(true);
  const [editCameraRtspUrl, setEditCameraRtspUrl] = useState('');
  const [editConfiguredAddress, setEditConfiguredAddress] = useState('');
  const [editCameraTransport, setEditCameraTransport] = useState<'tcp' | 'udp'>('tcp');
  const [editCameraUsername, setEditCameraUsername] = useState('');
  const [editHasExistingUsername, setEditHasExistingUsername] = useState(false);
  const [editCameraPassword, setEditCameraPassword] = useState('');
  const [editHasExistingPassword, setEditHasExistingPassword] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showAdvancedEdit, setShowAdvancedEdit] = useState(false);
  const [showAdvancedDiagnostics, setShowAdvancedDiagnostics] = useState(false);

  // Direct Laptop Browser Webcam Support
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const [isWebcamPreviewActive, setIsWebcamPreviewActive] = useState<boolean>(false);
  const [webcamError, setWebcamError] = useState<string | null>(null);

  const startWebcamPreview = useCallback(async () => {
    try {
      setWebcamError(null);
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera is not supported or blocked in this browser context.');
      }
      if (localStreamRef.current) {
        if (videoRef.current && videoRef.current.srcObject !== localStreamRef.current) {
          videoRef.current.srcObject = localStreamRef.current;
          videoRef.current.play().catch(() => {});
        }
        setIsWebcamPreviewActive(true);
        setStreamError(null);
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
      setIsWebcamPreviewActive(true);
      setStreamError(null);
    } catch (err: any) {
      setWebcamError(err.message || 'Permission denied. Please allow camera access in browser address bar.');
      setIsWebcamPreviewActive(false);
    }
  }, []);

  const stopWebcamPreview = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setIsWebcamPreviewActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((t) => t.stop());
        localStreamRef.current = null;
      }
    };
  }, []);

  const pollIntervalRef = useRef<number | null>(null);

  const fetchFacilities = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const res = await facilitiesApi.listFacilities();
      const activeFacilities = (res.data || []).filter((facility) => facility.isActive);
      setFacilities(activeFacilities);
      const initialFacilityId = user?.hostelId || activeFacilities[0]?.id || '';
      setNewCameraFacilityId((current) => current || initialFacilityId);
      if (initialFacilityId) {
        const locationRes = await facilitiesApi.listLocations(initialFacilityId);
        setNewCameraLocations((locationRes.data || []).filter((location) => location.isActive));
      }
    } catch (err: any) {
      toastError(err.message || 'Failed to load hostels');
    }
  }, [isAdmin, user?.hostelId, toastError]);

  const loadNewCameraLocations = useCallback(async (facilityId: string) => {
    setNewCameraFacilityId(facilityId);
    setNewCameraLocationId('');
    if (!facilityId) {
      setNewCameraLocations([]);
      return;
    }
    try {
      const res = await facilitiesApi.listLocations(facilityId);
      setNewCameraLocations((res.data || []).filter((location) => location.isActive));
    } catch {
      setNewCameraLocations([]);
    }
  }, []);

  const loadEditCameraLocations = useCallback(async (facilityId: string, selectedLocationId?: string | null) => {
    setEditCameraFacilityId(facilityId);
    setEditCameraLocationId(selectedLocationId || '');
    if (!facilityId) {
      setEditCameraLocations([]);
      return;
    }
    try {
      const res = await facilitiesApi.listLocations(facilityId);
      setEditCameraLocations((res.data || []).filter((location) => location.isActive || location.id === selectedLocationId));
    } catch {
      setEditCameraLocations([]);
    }
  }, []);

  useEffect(() => {
    fetchFacilities();
  }, [fetchFacilities]);

  // Fetch cameras list
  const fetchCameras = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await camerasApi.listCameras(isAdmin ? undefined : user?.hostelId || undefined);
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
  }, [isAdmin, user?.hostelId, selectedCameraId, toastError]);

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
    setWebcamError(null);
    stopWebcamPreview();
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

  const openRegisterModal = () => {
    setRegisterStep(1);
    setModalTestResult(null);
    setShowAdvancedRegister(false);
    setIsRegisterModalOpen(true);
  };

  const closeRegisterModal = () => {
    if (isSubmittingCamera) return;
    setIsRegisterModalOpen(false);
    setRegisterStep(1);
    setModalTestResult(null);
  };

  const handleRegisterNext = () => {
    if (!newCameraName.trim()) {
      toastError('Camera name is required');
      return;
    }
    if (!newCameraFacilityId) {
      toastError('Select a hostel for this camera');
      return;
    }
    if ((newCameraRole === 'IN' || newCameraRole === 'OUT') && !newCameraLocationId) {
      toastError('Select the gate / location monitored by this gate camera');
      return;
    }
    setRegisterStep(2);
  };

  const handleRegisterCamera = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCameraName.trim()) {
      toastError('Camera name is required');
      return;
    }
    if (!newCameraFacilityId) {
      toastError('Select a hostel for this camera');
      return;
    }
    if ((newCameraRole === 'IN' || newCameraRole === 'OUT') && !newCameraLocationId) {
      toastError('Select the gate / location monitored by this gate camera');
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
        const trimmed = newCameraRtspUrl.trim();
        const match = trimmed.match(/^(rtsp[s]?:\/\/)([^:@\s]+)(?::([^@\s]*))?@(.+)$/i);
        if (match) {
          configMetadata.rtspUrl = `${match[1]}${match[4]}`;
          if (!newCameraUsername) configMetadata.username = decodeURIComponent(match[2]);
          if (!newCameraPassword && match[3] !== undefined) configMetadata.password = decodeURIComponent(match[3]);
        } else {
          configMetadata.rtspUrl = trimmed;
          if (newCameraUsername) configMetadata.username = newCameraUsername;
          if (newCameraPassword) configMetadata.password = newCameraPassword;
        }
        configMetadata.transport = newCameraTransport;
        configMetadata.fps = 15;
      }

      await camerasApi.createCamera({
        name: newCameraName.trim(),
        sourceType: newCameraSourceType,
        role: newCameraRole,
        hostelId: newCameraFacilityId,
        locationId: newCameraLocationId || null,
        configMetadata,
      });

      success('Camera registered successfully');
      setIsRegisterModalOpen(false);
      setRegisterStep(1);
      setNewCameraName('');
      setNewCameraDeviceIndex('0');
      setNewCameraRtspUrl('');
      setNewCameraUsername('');
      setNewCameraPassword('');
      setNewCameraLocationId('');
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
    loadEditCameraLocations(camera.hostelId, camera.locationId);

    const host = camera.configMetadata?.host;
    const port = camera.configMetadata?.port ?? 554;
    const path = camera.configMetadata?.path || '/';
    const displayAddr = host ? `rtsp://${host}:${port}${path}` : '';
    setEditConfiguredAddress(displayAddr);

    // Keep editable fields clean without pre-populating "***"
    setEditCameraRtspUrl('');
    setEditCameraTransport(camera.configMetadata?.transport || 'tcp');
    setEditCameraUsername('');
    setEditHasExistingUsername(Boolean(camera.configMetadata?.username));
    setEditCameraPassword('');
    setEditHasExistingPassword(Boolean(camera.configMetadata?.credentialsConfigured));
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCamera) return;

    try {
      setIsSavingEdit(true);
      // Delta-based update: send only fields explicitly changed by operator
      const deltaConfig: Record<string, any> = {};

      if (editCameraRole === 'IN' || editCameraRole === 'OUT') {
        deltaConfig.movementAutomationEnabled = editCameraMovementAutomation;
      }

      if (selectedCamera.sourceType === 'RTSP') {
        deltaConfig.transport = editCameraTransport;

        const trimmedUrl = editCameraRtspUrl.trim();
        if (trimmedUrl && !trimmedUrl.includes('***')) {
          deltaConfig.rtspUrl = trimmedUrl;
        }

        const trimmedUser = editCameraUsername.trim();
        if (trimmedUser && trimmedUser !== '***') {
          deltaConfig.username = trimmedUser;
        }

        if (editCameraPassword) {
          deltaConfig.password = editCameraPassword;
        }
      }

      await camerasApi.updateCamera(selectedCamera.id, {
        name: editCameraName.trim(),
        role: editCameraRole,
        locationId: editCameraLocationId || null,
        configMetadata: Object.keys(deltaConfig).length > 0 ? deltaConfig : undefined,
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

  const canManageCameras = user?.role === 'ADMIN';
  const isStreaming = diagnostics?.isActive ?? false;
  const cameraPurposeLabel = (role: CameraEntity['role']) => {
    if (role === 'IN') return 'Gate Entry';
    if (role === 'OUT') return 'Gate Exit';
    if (role === 'ATTENDANCE') return 'Existing Attendance Checkpoint';
    return 'General Monitoring';
  };
  const cameraTypeLabel = (sourceType: CameraEntity['sourceType']) => {
    if (sourceType === 'RTSP') return 'IP / Network Camera';
    if (sourceType === 'WEBCAM') return 'USB / Laptop Webcam';
    return 'Smart / Edge Camera';
  };

  return (
    <div className="cameras-page">
      <PageHeader
        title="Cameras"
        subtitle="Connect gate cameras, check their status, and confirm the live view."
        actions={
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="md"
              onClick={fetchCameras}
              disabled={isLoading}
              leftIcon={<RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />}
            >
              Refresh
            </Button>
            {isAdmin && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={() => {
                  openRegisterModal();
                }}
                leftIcon={<Plus size={16} />}
              >
                Add Camera
              </Button>
            )}
          </div>
        }
      />

      <div className="camera-help-card">
        <CircleHelp size={20} className="shrink-0 mt-0.5" />
        <div>
          <strong>Camera setup is simple:</strong> choose the hostel and gate, select the camera type,
          enter its connection details, then test the connection before saving. Laptop webcams can be
          previewed directly in the browser.
        </div>
      </div>

      {/* Main Grid: Left Camera Cards | Right Video Monitor */}
      <div className="cameras-layout">
        {/* Left Column: Camera Devices List */}
        <div className="camera-list-pane">
          <div className="pane-header">
            <h3 className="pane-title">Camera Setup</h3>
            <span className="camera-count-badge">{cameras.length} {cameras.length === 1 ? 'Camera' : 'Cameras'}</span>
          </div>

          {isLoading && cameras.length === 0 ? (
            <div className="loading-state">
              <RefreshCw size={24} className="animate-spin" />
              <span>Loading cameras...</span>
            </div>
          ) : cameras.length === 0 ? (
            <div className="empty-state-card">
              <VideoOff size={36} className="empty-icon" />
              <h4>No Cameras Added</h4>
              <p>Add a gate IP camera or webcam to start previewing the live feed.</p>
              {canManageCameras && (
                <button
                  type="button"
                  className="btn btn-primary btn-sm mt-3"
                  onClick={openRegisterModal}
                >
                  <Plus size={14} />
                  <span>Add First Camera</span>
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
                      <span className="meta-tag">{cameraTypeLabel(camera.sourceType)}</span>
                      <span className="meta-tag role-tag">{cameraPurposeLabel(camera.role)}</span>
                      {camera.location && (
                        <span className="meta-tag location-tag">
                          <MapPin size={11} />
                          {camera.location.name}
                        </span>
                      )}
                    </div>

                    <div className="camera-item-footer">
                      <span className="device-hint">
                        {camera.healthStatus === 'ONLINE'
                          ? 'Ready'
                          : camera.healthStatus === 'DEGRADED'
                          ? 'Needs attention'
                          : 'Not connected'}
                      </span>
                      {isSelected && <span className="active-view-label">Viewing</span>}
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
                      <span>{cameraTypeLabel(selectedCamera.sourceType)}</span>
                      <span className="separator">•</span>
                      <span>{cameraPurposeLabel(selectedCamera.role)}</span>
                      {selectedCamera.location?.name && (
                        <>
                          <span className="separator">•</span>
                          <span>{selectedCamera.location.name}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="monitor-status-badges flex items-center gap-2">
                  <Badge
                    value={
                      (selectedCamera.id === diagnostics?.cameraId && diagnostics?.healthStatus)
                        ? diagnostics.healthStatus
                        : selectedCamera.healthStatus
                    }
                    size="md"
                  />
                  {isAdmin && (
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

              {/* Reconnection In-Progress Banner */}
              {((selectedCamera.id === diagnostics?.cameraId && diagnostics?.healthStatus)
                ? diagnostics.healthStatus
                : selectedCamera.healthStatus) === 'DEGRADED' && (
                <div className="p-3 rounded-lg border mb-3 flex items-center gap-2 bg-amber-950/40 border-amber-700/50 text-amber-200">
                  <RefreshCw size={16} className="animate-spin text-amber-400 shrink-0" />
                  <div className="text-sm">
                    <strong>Connection issue:</strong> Reconnecting to camera stream...
                  </div>
                </div>
              )}

              {/* Error Message Banner */}
              {streamError && (
                <div className="stream-error-banner">
                  <AlertCircle size={18} />
                  <div className="error-text">
                    <strong>Notice:</strong> {streamError}
                  </div>
                </div>
              )}

              {/* Webcam Error Banner */}
              {webcamError && (
                <div className="stream-error-banner">
                  <AlertCircle size={18} />
                  <div className="error-text">
                    <strong>Laptop Camera:</strong> {webcamError}
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
                        <strong>Connection successful.</strong> The camera is reachable and ready to use.
                      </span>
                    ) : (
                      <span>{testResult.message || 'Could not connect. Check camera address, credentials and network.'}</span>
                    )}
                  </div>
                </div>
              )}

              {/* Video preview */}
              <div className="video-screen-frame">
                {isWebcamPreviewActive ? (
                  <div className="video-player-wrapper">
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
                      className="live-preview-image object-contain"
                    />
                    <div className="hud-overlay pointer-events-none">
                      <div className="hud-top-left">
                        <span className="live-indicator">
                          <span className="pulse-dot" />
                          <span>LIVE PREVIEW</span>
                        </span>
                      </div>
                    </div>
                  </div>
                ) : isStreaming ? (
                  <div className="video-player-wrapper">
                    <img
                      src={camerasApi.getPreviewStreamUrl(selectedCamera.id)}
                      alt={`Live Preview of ${selectedCamera.name}`}
                      className="live-preview-image"
                      onError={() => {
                        setStreamError('Preview stream connection interrupted. Please restart stream.');
                      }}
                    />
                    <div className="hud-overlay pointer-events-none">
                      <div className="hud-top-left">
                        <span className="live-indicator">
                          <span className="pulse-dot" />
                          <span>LIVE PREVIEW</span>
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
                      <h4>Preview is not running</h4>
                      <p>
                        {selectedCamera.sourceType === 'WEBCAM'
                          ? 'Use the laptop camera button below to confirm the view and positioning.'
                          : 'Start the live preview below to confirm the camera view and positioning.'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {/* Contextual camera actions */}
              <div className="monitor-controls-toolbar">
                <div className="camera-actions-primary">
                  {selectedCamera.sourceType === 'WEBCAM' ? (
                    <Button
                      type="button"
                      variant={isWebcamPreviewActive ? 'danger' : 'primary'}
                      size="md"
                      onClick={isWebcamPreviewActive ? stopWebcamPreview : startWebcamPreview}
                      leftIcon={<Video size={16} />}
                    >
                      {isWebcamPreviewActive ? 'Stop Laptop Camera' : 'Use Laptop Camera'}
                    </Button>
                  ) : isStreaming ? (
                    <Button
                      type="button"
                      variant="danger"
                      size="md"
                      onClick={handleStopStream}
                      disabled={isActionPending}
                      leftIcon={<Square size={16} />}
                    >
                      Stop Preview
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="primary"
                      size="md"
                      onClick={handleStartStream}
                      disabled={isActionPending}
                      leftIcon={<Play size={16} />}
                    >
                      Start Live Preview
                    </Button>
                  )}

                  {(isStreaming || isWebcamPreviewActive) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      onClick={handleCaptureSnapshot}
                      disabled={isActionPending}
                      leftIcon={<CameraIcon size={16} />}
                    >
                      Take Snapshot
                    </Button>
                  )}

                  {isAdmin && selectedCamera.sourceType !== 'WEBCAM' && (
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      onClick={handleTestConnection}
                      disabled={isTestingConnection}
                      leftIcon={<Wifi size={16} className={isTestingConnection ? 'animate-spin' : ''} />}
                    >
                      {isTestingConnection ? 'Testing...' : 'Test Connection'}
                    </Button>
                  )}
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => fetchDiagnostics(selectedCamera.id)}
                  leftIcon={<RefreshCw size={14} />}
                >
                  Refresh Status
                </Button>
              </div>

              {/* Camera status summary */}
              <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <span className="text-xs font-semibold text-slate-500 block mb-1">Camera Status</span>
                    <span className="text-sm font-bold text-slate-900">
                      {((diagnostics?.healthStatus || selectedCamera.healthStatus) === 'ONLINE')
                        ? 'Online'
                        : (diagnostics?.healthStatus || selectedCamera.healthStatus) === 'DEGRADED'
                        ? 'Needs attention'
                        : 'Offline'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-slate-500 block mb-1">Preview</span>
                    <span className="text-sm font-bold text-slate-900">
                      {isStreaming || isWebcamPreviewActive ? 'Running' : 'Stopped'}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs font-semibold text-slate-500 block mb-1">Last Seen</span>
                    <span className="text-sm font-bold text-slate-900">
                      {diagnostics?.lastSeenAt
                        ? new Date(diagnostics.lastSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                        : 'Not available'}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setShowAdvancedDiagnostics(!showAdvancedDiagnostics)}
                  className="mt-4 w-full flex items-center justify-between border-t border-slate-100 pt-3 text-sm font-semibold text-slate-600 hover:text-slate-900"
                >
                  <span>Advanced diagnostics</span>
                  {showAdvancedDiagnostics ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                </button>

                {showAdvancedDiagnostics && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3 text-sm">
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="text-xs text-slate-500 block">Stream rate</span>
                      <span className="font-semibold text-slate-800">{diagnostics?.fps ?? 0} FPS</span>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="text-xs text-slate-500 block">Resolution</span>
                      <span className="font-semibold text-slate-800">
                        {diagnostics?.resolution
                          ? `${diagnostics.resolution.width} × ${diagnostics.resolution.height}`
                          : 'Not available'}
                      </span>
                    </div>
                    <div className="rounded-lg bg-slate-50 p-3">
                      <span className="text-xs text-slate-500 block">Frames captured</span>
                      <span className="font-semibold text-slate-800">{diagnostics?.totalFramesCaptured ?? 0}</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="no-selection-screen">
              <Video size={48} className="no-selection-icon" />
              <h3>Select a Camera</h3>
              <p>Choose a camera from the list to view its status and live preview.</p>
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
                <h3 className="modal-title">Camera Snapshot</h3>
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
                  <strong>Captured:</strong> {new Date(snapshotData.timestamp).toLocaleString()}
                </span>
                {snapshotData.width && snapshotData.height && (
                  <span className="meta-item">
                    <strong>Size:</strong> {snapshotData.width} × {snapshotData.height}
                  </span>
                )}
                
              </div>
            </div>

            <div className="modal-footer">
              <a
                href={`data:image/jpeg;base64,${snapshotData.dataBase64}`}
                download={`pravahax-snapshot-${Date.now()}.jpg`}
                className="btn btn-primary"
              >
                Download Snapshot
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

      {/* Add Camera Modal */}
      {isRegisterModalOpen && (
        <div className="modal-backdrop" onClick={closeRegisterModal}>
          <div className="modal-dialog modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h3 className="modal-title">Add Camera</h3>
                <p className="modal-subtitle">
                  {registerStep === 1
                    ? 'Choose where the camera is installed and what it is used for.'
                    : 'Enter the connection details and verify the camera.'}
                </p>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={closeRegisterModal}
                aria-label="Close modal"
              >
                <X size={18} />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                if (registerStep === 1) {
                  e.preventDefault();
                  handleRegisterNext();
                  return;
                }
                handleRegisterCamera(e);
              }}
            >
              <div className="modal-body">
                <div className="camera-add-progress" aria-label="Camera setup progress">
                  <div className={`camera-add-progress-step ${registerStep === 1 ? 'is-active' : ''}`}>
                    <span className="camera-add-progress-number">1</span>
                    Placement & purpose
                  </div>
                  <div className={`camera-add-progress-step ${registerStep === 2 ? 'is-active' : ''}`}>
                    <span className="camera-add-progress-number">2</span>
                    Connection
                  </div>
                </div>

                {registerStep === 1 ? (
                  <div className="camera-step-panel">
                    <div className="camera-step-heading">Camera details</div>
                    <div className="camera-step-copy">
                      Give the camera a clear name, choose its hostel and gate, then select its purpose.
                    </div>

                    <div className="form-group">
                      <label htmlFor="cam-name" className="form-label">
                        Camera Name <span className="required">*</span>
                      </label>
                      <input
                        id="cam-name"
                        type="text"
                        className="form-control"
                        placeholder="Example: Main Gate Camera"
                        value={newCameraName}
                        onChange={(e) => setNewCameraName(e.target.value)}
                        autoFocus
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="form-group">
                        <label htmlFor="cam-facility" className="form-label">
                          Hostel <span className="required">*</span>
                        </label>
                        <select
                          id="cam-facility"
                          className="form-control"
                          value={newCameraFacilityId}
                          onChange={(e) => loadNewCameraLocations(e.target.value)}
                          required
                        >
                          <option value="">Select hostel</option>
                          {facilities.map((facility) => (
                            <option key={facility.id} value={facility.id}>{facility.name}</option>
                          ))}
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="cam-location" className="form-label">
                          Gate / Location {(newCameraRole === 'IN' || newCameraRole === 'OUT') && (
                            <span className="required">*</span>
                          )}
                        </label>
                        <select
                          id="cam-location"
                          className="form-control"
                          value={newCameraLocationId}
                          onChange={(e) => setNewCameraLocationId(e.target.value)}
                          disabled={!newCameraFacilityId}
                        >
                          <option value="">Select gate / location</option>
                          {newCameraLocations.map((location) => (
                            <option key={location.id} value={location.id}>{location.name}</option>
                          ))}
                        </select>
                        <small className="form-hint">
                          For Gate Entry / Gate Exit cameras, this is required.
                        </small>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="form-group">
                        <label htmlFor="cam-source" className="form-label">
                          Camera Type <span className="required">*</span>
                        </label>
                        <select
                          id="cam-source"
                          className="form-control"
                          value={newCameraSourceType}
                          onChange={(e) => {
                            setNewCameraSourceType(e.target.value as any);
                            setModalTestResult(null);
                          }}
                        >
                          <option value="RTSP">IP / Network Camera</option>
                          <option value="WEBCAM">USB / Laptop Webcam</option>
                          <option value="SMART_CAMERA">Smart / Edge Camera</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="cam-role" className="form-label">Purpose</label>
                        <select
                          id="cam-role"
                          className="form-control"
                          value={newCameraRole}
                          onChange={(e) => setNewCameraRole(e.target.value as any)}
                        >
                          <option value="GENERAL">General Monitoring</option>
                          <option value="IN">Gate Entry</option>
                          <option value="OUT">Gate Exit</option>
                          <option value="ATTENDANCE">Existing Attendance Checkpoint</option>
                        </select>
                      </div>
                    </div>

                    {(newCameraRole === 'IN' || newCameraRole === 'OUT') && (
                      <label htmlFor="cam-movement-auto" className="camera-choice-note cursor-pointer">
                        <input
                          id="cam-movement-auto"
                          type="checkbox"
                          className="mt-0.5"
                          checked={newCameraMovementAutomation}
                          onChange={(e) => setNewCameraMovementAutomation(e.target.checked)}
                        />
                        <span>
                          <strong className="block text-slate-800">Automatic movement recording</strong>
                          Record entry / exit automatically after a confirmed resident face match.
                        </span>
                      </label>
                    )}

                    {newCameraLocations.length === 0 && newCameraFacilityId && (
                      <div className="camera-step-summary mt-3">
                        No gate is configured for this hostel yet. Create one from <strong>Hostels → Gates & Locations</strong>.
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="camera-step-panel">
                    <div className="camera-step-heading">Connection details</div>
                    <div className="camera-step-copy">
                      {newCameraSourceType === 'RTSP'
                        ? 'Enter the camera stream address. Username and password are only needed when the camera requires them.'
                        : newCameraSourceType === 'WEBCAM'
                        ? 'For a laptop or USB webcam, keep the default device unless another camera is connected.'
                        : 'This camera type does not require browser connection details.'}
                    </div>

                    <div className="camera-step-summary">
                      <strong>{newCameraName}</strong>
                      <span> • </span>
                      {facilities.find((facility) => facility.id === newCameraFacilityId)?.name || 'Hostel'}
                      {newCameraLocationId && (
                        <>
                          <span> • </span>
                          {newCameraLocations.find((location) => location.id === newCameraLocationId)?.name}
                        </>
                      )}
                    </div>

                    {newCameraSourceType === 'RTSP' && (
                      <>
                        <div className="form-group">
                          <label htmlFor="cam-rtsp" className="form-label">
                            Camera Stream Address <span className="required">*</span>
                          </label>
                          <input
                            id="cam-rtsp"
                            type="text"
                            className="form-control"
                            placeholder="rtsp://192.168.1.100:554/stream"
                            value={newCameraRtspUrl}
                            onChange={(e) => {
                              setNewCameraRtspUrl(e.target.value);
                              setModalTestResult(null);
                            }}
                            required
                          />
                          <small className="form-hint">
                            Use the RTSP address provided by the camera manufacturer or NVR.
                          </small>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="form-group">
                            <label htmlFor="cam-user" className="form-label">Username (Optional)</label>
                            <input
                              id="cam-user"
                              type="text"
                              className="form-control"
                              placeholder="Camera username"
                              value={newCameraUsername}
                              onChange={(e) => setNewCameraUsername(e.target.value)}
                            />
                          </div>
                          <div className="form-group">
                            <label htmlFor="cam-pass" className="form-label">Password (Optional)</label>
                            <input
                              id="cam-pass"
                              type="password"
                              className="form-control"
                              placeholder="Camera password"
                              value={newCameraPassword}
                              onChange={(e) => setNewCameraPassword(e.target.value)}
                            />
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setShowAdvancedRegister(!showAdvancedRegister)}
                          className="w-full flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700"
                        >
                          <span>Advanced connection settings</span>
                          {showAdvancedRegister ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>

                        {showAdvancedRegister && (
                          <div className="form-group mt-3 mb-0">
                            <label htmlFor="cam-transport" className="form-label">Stream Transport</label>
                            <select
                              id="cam-transport"
                              className="form-control"
                              value={newCameraTransport}
                              onChange={(e) => setNewCameraTransport(e.target.value as any)}
                            >
                              <option value="tcp">TCP (Recommended)</option>
                              <option value="udp">UDP</option>
                            </select>
                          </div>
                        )}

                        <div className="flex items-center justify-between gap-3 mt-4 flex-wrap">
                          <div className="text-xs text-slate-500">
                            Test the connection before saving.
                          </div>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleModalTestConnection}
                            disabled={isModalTesting || !newCameraRtspUrl.trim()}
                            leftIcon={<Wifi size={14} className={isModalTesting ? 'animate-spin' : ''} />}
                          >
                            {isModalTesting ? 'Testing...' : 'Test Connection'}
                          </Button>
                        </div>

                        {modalTestResult && (
                          <div
                            className={`mt-3 rounded-lg border px-3 py-2 text-sm ${
                              modalTestResult.reachable
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                : 'border-red-200 bg-red-50 text-red-700'
                            }`}
                          >
                            {modalTestResult.reachable
                              ? 'Connection successful. The camera is reachable.'
                              : modalTestResult.message || 'Could not connect. Check the address, credentials, and network.'}
                          </div>
                        )}
                      </>
                    )}

                    {newCameraSourceType === 'WEBCAM' && (
                      <div className="form-group mb-0">
                        <label htmlFor="cam-device" className="form-label">Webcam Device</label>
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
                          Keep 0 for the built-in webcam. Use 1 or higher only for another USB camera.
                        </small>
                      </div>
                    )}

                    {newCameraSourceType === 'SMART_CAMERA' && (
                      <div className="camera-step-summary">
                        No additional connection details are required here. You can add the camera now.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="modal-footer">
                {registerStep === 1 ? (
                  <>
                    <Button type="button" variant="outline" onClick={closeRegisterModal}>
                      Cancel
                    </Button>
                    <Button type="submit" variant="primary" rightIcon={<ArrowRight size={16} />}>
                      Continue
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setRegisterStep(1)}
                      disabled={isSubmittingCamera}
                    >
                      Back
                    </Button>
                    <Button type="submit" variant="primary" isLoading={isSubmittingCamera}>
                      Add Camera
                    </Button>
                  </>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Camera Modal */}
      {isEditModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsEditModalOpen(false)}>
          <div className="modal-dialog modal-lg" onClick={(e) => e.stopPropagation()}>
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

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="form-group">
                    <label htmlFor="edit-facility" className="form-label">Facility</label>
                    <select
                      id="edit-facility"
                      className="form-control"
                      value={editCameraFacilityId}
                      onChange={(e) => loadEditCameraLocations(e.target.value)}
                      disabled
                    >
                      {facilities
                        .filter((facility) => facility.id === editCameraFacilityId)
                        .map((facility) => (
                          <option key={facility.id} value={facility.id}>{facility.name}</option>
                        ))}
                    </select>
                  </div>

                  <div className="form-group">
                    <label htmlFor="edit-location" className="form-label">Gate / Location</label>
                    <select
                      id="edit-location"
                      className="form-control"
                      value={editCameraLocationId}
                      onChange={(e) => setEditCameraLocationId(e.target.value)}
                    >
                      <option value="">Not assigned</option>
                      {editCameraLocations.map((location) => (
                        <option key={location.id} value={location.id}>{location.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="edit-role" className="form-label">
                    Camera Purpose
                  </label>
                  <select
                    id="edit-role"
                    className="form-control"
                    value={editCameraRole}
                    onChange={(e) => setEditCameraRole(e.target.value as any)}
                  >
                    <option value="GENERAL">General Monitoring</option>
                    <option value="IN">Gate Entry</option>
                    <option value="OUT">Gate Exit</option>
                    <option value="ATTENDANCE">Existing Attendance Checkpoint</option>
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
                      Automatically record IN / OUT after a confirmed face match
                    </label>
                  </div>
                )}

                {selectedCamera?.sourceType === 'RTSP' && (
                  <>
                    <div className="form-group">
                      <div className="flex items-center justify-between mb-1">
                        <label htmlFor="edit-rtsp" className="form-label mb-0">
                          Camera Stream Address
                        </label>
                        {editConfiguredAddress && (
                          <span className="text-xs font-mono text-slate-400 bg-slate-800/80 px-2 py-0.5 rounded">
                            Current: {editConfiguredAddress}
                          </span>
                        )}
                      </div>
                      <input
                        id="edit-rtsp"
                        type="text"
                        className="form-control font-mono text-sm"
                        placeholder={
                          editConfiguredAddress
                            ? `Leave blank to keep (${editConfiguredAddress})`
                            : 'rtsp://192.168.1.50:554/stream'
                        }
                        value={editCameraRtspUrl}
                        onChange={(e) => setEditCameraRtspUrl(e.target.value)}
                      />
                    </div>

                    <div className="border border-slate-700/60 rounded-lg p-3 my-2 bg-slate-800/30">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedEdit(!showAdvancedEdit)}
                        className="w-full flex items-center justify-between text-xs font-semibold text-slate-300 hover:text-white"
                      >
                        <span>Advanced connection settings</span>
                        {showAdvancedEdit ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                      {showAdvancedEdit && (
                        <div className="mt-3 pt-3 border-t border-slate-700/60 space-y-3">
                          <div className="form-group mb-0">
                            <label htmlFor="edit-transport" className="form-label text-xs">
                              Transport Protocol
                            </label>
                            <select
                              id="edit-transport"
                              className="form-control text-sm"
                              value={editCameraTransport}
                              onChange={(e) => setEditCameraTransport(e.target.value as any)}
                            >
                              <option value="tcp">TCP (Recommended)</option>
                              <option value="udp">UDP</option>
                            </select>
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="form-group">
                        <div className="flex items-center justify-between mb-1">
                          <label htmlFor="edit-user" className="form-label mb-0">
                            Username
                          </label>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              editHasExistingUsername
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {editHasExistingUsername ? 'Configured' : 'Not set'}
                          </span>
                        </div>
                        <input
                          id="edit-user"
                          type="text"
                          className="form-control"
                          placeholder={
                            editHasExistingUsername
                              ? 'Configured (leave blank to keep)'
                              : 'admin'
                          }
                          value={editCameraUsername}
                          onChange={(e) => setEditCameraUsername(e.target.value)}
                        />
                      </div>
                      <div className="form-group">
                        <div className="flex items-center justify-between mb-1">
                          <label htmlFor="edit-pass" className="form-label mb-0">
                            Password
                          </label>
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded ${
                              editHasExistingPassword
                                ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50'
                                : 'bg-slate-800 text-slate-400'
                            }`}
                          >
                            {editHasExistingPassword ? 'Configured' : 'Not set'}
                          </span>
                        </div>
                        <input
                          id="edit-pass"
                          type="password"
                          className="form-control"
                          placeholder={
                            editHasExistingPassword
                              ? 'Configured (leave blank to keep)'
                              : '••••••••'
                          }
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
