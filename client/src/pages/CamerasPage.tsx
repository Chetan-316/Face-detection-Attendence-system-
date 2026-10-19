import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { Badge } from '../components/Badge';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { camerasApi } from '../api/cameras.api';
import { facilitiesApi, Facility, FacilityLocation } from '../api/facilities.api';
import { CameraEntity, CameraDiagnostics, CameraTestResult } from '../types/camera.types';
import { usePreviewStreamUrl } from '../hooks/usePreviewStreamUrl';
import '../styles/cameras.css';
import {
  Video,
  VideoOff,
  Camera as CameraIcon,
  Play,
  Square,
  RefreshCw,
  Plus,
  AlertCircle,
  CheckCircle2,
  Wifi,
  Edit2,
  ChevronDown,
  ChevronUp,
  CircleHelp,
  ArrowRight,
  Trash2,
} from 'lucide-react';

export const CamerasPage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError, info } = useToast();

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
  const [cameraPendingDelete, setCameraPendingDelete] = useState<CameraEntity | null>(null);
  const [isDeletingCamera, setIsDeletingCamera] = useState(false);

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
  const fetchDiagnostics = useCallback(async (cameraId: string, isCurrent: () => boolean = () => true, signal?: AbortSignal) => {
    try {
      const res = await camerasApi.getCameraHealth(cameraId, signal);
      if (!isCurrent()) return;
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

    // Skip overlapping polls and drop responses that arrive after the camera changed.
    let isCurrent = true;
    let isRequestInFlight = false;
    const controller = new AbortController();
    const poll = () => {
      if (isRequestInFlight) return;
      isRequestInFlight = true;
      fetchDiagnostics(selectedCameraId, () => isCurrent, controller.signal).finally(() => {
        isRequestInFlight = false;
      });
    };

    poll();
    pollIntervalRef.current = setInterval(poll, 2000);

    return () => {
      isCurrent = false;
      controller.abort();
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
    if (newCameraSourceType === 'SMART_CAMERA') {
      toastError('Smart / Edge Camera direct integration is not available yet');
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
    if (newCameraSourceType === 'RTSP' && !/^rtsps?:\/\//i.test(newCameraRtspUrl.trim())) {
      toastError('Enter a valid RTSP stream URL beginning with rtsp:// or rtsps://');
      return;
    }
    if (newCameraSourceType === 'SMART_CAMERA') {
      toastError('Smart / Edge Camera direct integration is not available yet');
      return;
    }

    try {
      setIsSubmittingCamera(true);
      const configMetadata: Record<string, any> = {};
      if (newCameraRole === 'IN' || newCameraRole === 'OUT') {
        configMetadata.movementAutomationEnabled = newCameraMovementAutomation;
        configMetadata.movementMode = 'TOGGLE';
      }
      if (newCameraSourceType === 'WEBCAM') {
        configMetadata.deviceIndex = parseInt(newCameraDeviceIndex, 10) || 0;
        configMetadata.fps = 15;
        configMetadata.captureMode = 'browser';
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
        deltaConfig.movementMode = 'TOGGLE';
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

  const handleDeleteCamera = async () => {
    if (!cameraPendingDelete || isDeletingCamera) return;

    try {
      setIsDeletingCamera(true);
      await camerasApi.deleteCamera(cameraPendingDelete.id);

      if (selectedCameraId === cameraPendingDelete.id) {
        stopWebcamPreview();
        setSelectedCameraId(null);
        setSelectedCamera(null);
        setDiagnostics(null);
        setStreamError(null);
        setTestResult(null);
      }

      success(`${cameraPendingDelete.name} deleted successfully`);
      setCameraPendingDelete(null);
      await fetchCameras();
    } catch (err: any) {
      toastError(err.message || 'Failed to delete camera');
    } finally {
      setIsDeletingCamera(false);
    }
  };

  const canManageCameras = user?.role === 'ADMIN';
  const isStreaming = diagnostics?.isActive ?? false;
  const cameraPurposeLabel = (role: CameraEntity['role']) => {
    if (role === 'IN' || role === 'OUT') return 'Automatic Gate';
    if (role === 'ATTENDANCE') return 'Existing Attendance Checkpoint';
    return 'General Monitoring';
  };
  const cameraTypeLabel = (sourceType: CameraEntity['sourceType']) => {
    if (sourceType === 'RTSP') return 'RTSP (IP camera)';
    if (sourceType === 'WEBCAM') return 'Local webcam (development)';
    return 'Smart camera (legacy)';
  };

  const previewStreamUrl = usePreviewStreamUrl(isStreaming && !isWebcamPreviewActive ? selectedCamera?.id : null);

  const isWebcamCamera = selectedCamera?.sourceType === 'WEBCAM';
  const effectiveHealth = selectedCamera
    ? (selectedCamera.id === diagnostics?.cameraId && diagnostics?.healthStatus
        ? diagnostics.healthStatus
        : selectedCamera.healthStatus)
    : null;
  const isStreamingNow = isStreaming || isWebcamPreviewActive;
  const offlineNow = !isStreamingNow && effectiveHealth !== 'ONLINE';
  // When the camera is offline, the admin's next step is the connection test, so it becomes the emphasized action.
  const startVariant = offlineNow && isAdmin ? 'outline' : 'primary';
  const testVariant = offlineNow && isAdmin ? 'primary' : 'outline';
  const lastSeenValue =
    (selectedCamera && diagnostics?.cameraId === selectedCamera.id ? diagnostics.lastSeenAt : null) ??
    selectedCamera?.lastSeenAt ??
    null;

  const formatLastSeen = (value: string | null | undefined) => {
    if (!value) return 'Never reported';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Not available';
    return date.toLocaleString([], {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Kolkata',
    });
  };

  const healthLabel = (status: CameraEntity['healthStatus'] | null) =>
    status === 'ONLINE' ? 'Online' : status === 'DEGRADED' ? 'Needs attention' : 'Offline';

  // Compact placeholder shown in the preview frame until a live feed is running.
  const renderPreviewPlaceholder = () => {
    if (!selectedCamera) return null;
    if (isWebcamCamera) {
      return (
        <div className="cam-preview-empty">
          <div className="cam-preview-empty-title">Local webcam preview is off</div>
          <p className="cam-preview-empty-text">
            Local development only. Open the Local development section below to start it.
          </p>
        </div>
      );
    }
    if (effectiveHealth === 'ONLINE') {
      return (
        <div className="cam-preview-empty">
          <div className="cam-preview-empty-title">Preview is stopped</div>
          <p className="cam-preview-empty-text">Start the live preview to confirm the camera view and positioning.</p>
        </div>
      );
    }
    const isDegraded = effectiveHealth === 'DEGRADED';
    return (
      <div className="cam-preview-empty is-offline">
        <div className="cam-preview-empty-title">{isDegraded ? 'Camera needs attention' : 'Camera offline'}</div>
        <p className="cam-preview-empty-text">
          {isDegraded
            ? 'The camera is reconnecting. Check the network, then refresh status.'
            : 'No video has reached PRAVAHAx from this camera. Check its power and network, then test the connection.'}
          {!isAdmin && ' Ask an administrator to check the connection.'}
        </p>
        <div className="cam-preview-empty-meta">Last seen: {formatLastSeen(lastSeenValue)}</div>
      </div>
    );
  };

  if (user?.role === 'GUARD') {
    return <Navigate to="/gate" replace />;
  }

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

      <div className="cam-setup-note">
        <CircleHelp size={16} />
        <div>
          <strong>Camera setup:</strong> IP cameras need a reachable RTSP stream URL, plus credentials when the
          camera requires them. Browser webcams are for local development only.
        </div>
      </div>

      <div className="cam-layout">
        {/* Left: camera list */}
        <section className="cam-pane cam-list-pane" aria-label="Camera list">
          <div className="cam-pane-header">
            <h3 className="cam-pane-title">Camera list</h3>
            <span className="cam-count">
              {cameras.length} {cameras.length === 1 ? 'camera' : 'cameras'}
            </span>
          </div>

          {isLoading && cameras.length === 0 ? (
            <div className="cam-loading">
              <RefreshCw size={16} className="animate-spin" />
              <span>Loading cameras...</span>
            </div>
          ) : cameras.length === 0 ? (
            <div className="cam-empty">
              <VideoOff size={24} className="cam-muted" />
              <div className="cam-empty-title">No cameras added</div>
              <p className="cam-empty-text">Add a gate IP camera to start previewing its live feed.</p>
              {canManageCameras && (
                <button type="button" className="btn btn-primary btn-sm" onClick={openRegisterModal}>
                  <Plus size={14} />
                  <span>Add first camera</span>
                </button>
              )}
            </div>
          ) : (
            <div className="cam-list">
              {cameras.map((camera) => {
                const isSelected = camera.id === selectedCameraId;
                const dotClass =
                  camera.healthStatus === 'ONLINE'
                    ? 'is-online'
                    : camera.healthStatus === 'DEGRADED'
                    ? 'is-degraded'
                    : 'is-offline';

                return (
                  <button
                    type="button"
                    key={camera.id}
                    className={`cam-list-item ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => handleSelectCamera(camera)}
                    aria-pressed={isSelected}
                  >
                    <span className="cam-list-row">
                      <span className="cam-list-name">
                        <span className={`cam-dot ${dotClass}`} aria-hidden="true" />
                        <span>{camera.name}</span>
                      </span>
                      <Badge value={camera.healthStatus} size="sm" />
                    </span>
                    <span className="cam-list-meta">
                      {cameraTypeLabel(camera.sourceType)} · {cameraPurposeLabel(camera.role)}
                      {camera.location?.name ? ` · ${camera.location.name}` : ''}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </section>

        {/* Right: selected camera detail */}
        {selectedCamera ? (
          <section className="cam-pane cam-detail" aria-label={`Details for ${selectedCamera.name}`}>
            <header className="cam-detail-header">
              <div>
                <h2 className="cam-detail-title">{selectedCamera.name}</h2>
                <div className="cam-detail-subtitle">{cameraTypeLabel(selectedCamera.sourceType)}</div>
              </div>
              {isAdmin && (
                <div className="cam-detail-header-actions">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => openEditModal(selectedCamera)}
                    title="Edit camera configuration"
                  >
                    <Edit2 size={14} />
                    <span>Edit</span>
                  </button>
                </div>
              )}
            </header>

            <dl className="cam-facts">
              <div className="cam-fact">
                <dt className="cam-label">Status</dt>
                <dd className="cam-value">{healthLabel(effectiveHealth)}</dd>
              </div>
              <div className="cam-fact">
                <dt className="cam-label">Preview</dt>
                <dd className="cam-value">{isStreamingNow ? 'Running' : 'Stopped'}</dd>
              </div>
              <div className="cam-fact">
                <dt className="cam-label">Last seen</dt>
                <dd className="cam-value">{formatLastSeen(lastSeenValue)}</dd>
              </div>
              <div className="cam-fact">
                <dt className="cam-label">Location</dt>
                <dd className="cam-value">{selectedCamera.location?.name || 'Not assigned'}</dd>
              </div>
              <div className="cam-fact">
                <dt className="cam-label">Purpose</dt>
                <dd className="cam-value">{cameraPurposeLabel(selectedCamera.role)}</dd>
              </div>
              <div className="cam-fact">
                <dt className="cam-label">Source</dt>
                <dd className="cam-value">{cameraTypeLabel(selectedCamera.sourceType)}</dd>
              </div>
              <div className="cam-fact">
                <dt className="cam-label">Enabled</dt>
                <dd className="cam-value">{selectedCamera.isEnabled ? 'Enabled' : 'Disabled'}</dd>
              </div>
            </dl>

            {effectiveHealth === 'DEGRADED' && (
              <div className="cam-banner is-warning" role="status">
                <RefreshCw size={16} className="animate-spin" />
                <div>
                  <strong>Connection issue:</strong> Reconnecting to camera stream...
                </div>
              </div>
            )}

            {streamError && (
              <div className="cam-banner is-danger" role="alert">
                <AlertCircle size={16} />
                <div>
                  <strong>Notice:</strong> {streamError}
                </div>
              </div>
            )}

            {webcamError && (
              <div className="cam-banner is-danger" role="alert">
                <AlertCircle size={16} />
                <div>
                  <strong>Browser webcam:</strong> {webcamError}
                </div>
              </div>
            )}

            {testResult && (
              <div className={`cam-banner ${testResult.reachable ? 'is-success' : 'is-danger'}`} role="status">
                {testResult.reachable ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                <div>
                  {testResult.reachable ? (
                    <>
                      <strong>Connection successful.</strong> The camera is reachable and ready to use.
                    </>
                  ) : (
                    testResult.message || 'Could not connect. Check camera address, credentials and network.'
                  )}
                </div>
              </div>
            )}

            {/* Preview: compact placeholder until a live feed is running */}
            <div className={`cam-preview ${isStreamingNow ? 'is-live' : ''}`}>
              {isWebcamPreviewActive ? (
                <>
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
                    className="cam-preview-media"
                  />
                  <span className="cam-preview-live-tag">
                    <span className="cam-live-dot" aria-hidden="true" />
                    <span>LIVE PREVIEW</span>
                  </span>
                </>
              ) : isStreaming ? (
                <>
                  <img
                    src={previewStreamUrl || undefined}
                    alt={`Live preview of ${selectedCamera.name}`}
                    className="cam-preview-media"
                    onError={() => {
                      setStreamError('Preview stream connection interrupted. Please restart stream.');
                    }}
                  />
                  <span className="cam-preview-live-tag">
                    <span className="cam-live-dot" aria-hidden="true" />
                    <span>LIVE PREVIEW</span>
                  </span>
                </>
              ) : (
                renderPreviewPlaceholder()
              )}
            </div>

            {/* Primary actions: one emphasized action per state */}
            <div className="cam-actions">
              <div className="cam-actions-group">
                {!isWebcamCamera &&
                  (isStreaming ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="md"
                      onClick={handleStopStream}
                      disabled={isActionPending}
                      leftIcon={<Square size={16} />}
                    >
                      Stop preview
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant={startVariant}
                      size="md"
                      onClick={handleStartStream}
                      disabled={isActionPending}
                      leftIcon={<Play size={16} />}
                    >
                      Start live preview
                    </Button>
                  ))}

                {isStreamingNow && (
                  <Button
                    type="button"
                    variant="outline"
                    size="md"
                    onClick={handleCaptureSnapshot}
                    disabled={isActionPending}
                    leftIcon={<CameraIcon size={16} />}
                  >
                    Take snapshot
                  </Button>
                )}

                {isAdmin && !isWebcamCamera && (
                  <Button
                    type="button"
                    variant={testVariant}
                    size="md"
                    onClick={handleTestConnection}
                    disabled={isTestingConnection}
                    leftIcon={<Wifi size={16} className={isTestingConnection ? 'animate-spin' : ''} />}
                  >
                    {isTestingConnection ? 'Testing...' : 'Test connection'}
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
                Refresh status
              </Button>
            </div>

            {/* Secondary: local development webcam, only for webcam-type cameras */}
            {isWebcamCamera && (
              <details className="cam-disclosure">
                <summary>Local development: browser webcam</summary>
                <div className="cam-disclosure-body">
                  <p className="cam-disclosure-note">
                    Uses the camera on this computer through the browser, for development only. It is not used for
                    production gates and needs camera permission in this browser.
                  </p>
                  <div className="cam-actions-group">
                    <Button
                      type="button"
                      variant={isWebcamPreviewActive ? 'outline' : 'secondary'}
                      size="sm"
                      onClick={isWebcamPreviewActive ? stopWebcamPreview : startWebcamPreview}
                      leftIcon={<Video size={14} />}
                    >
                      {isWebcamPreviewActive ? 'Stop browser webcam' : 'Start browser webcam'}
                    </Button>
                  </div>
                </div>
              </details>
            )}

            {/* Secondary: diagnostics, collapsed by default */}
            <details
              className="cam-disclosure"
              open={showAdvancedDiagnostics}
              onToggle={(e) => setShowAdvancedDiagnostics(e.currentTarget.open)}
            >
              <summary>Diagnostics</summary>
              <div className="cam-disclosure-body">
                <dl className="cam-diag-grid">
                  <div>
                    <dt className="cam-label">Stream rate</dt>
                    <dd className="cam-value">{diagnostics?.fps ?? 0} FPS</dd>
                  </div>
                  <div>
                    <dt className="cam-label">Resolution</dt>
                    <dd className="cam-value">
                      {diagnostics?.resolution
                        ? `${diagnostics.resolution.width} × ${diagnostics.resolution.height}`
                        : 'Not available'}
                    </dd>
                  </div>
                  <div>
                    <dt className="cam-label">Frames captured</dt>
                    <dd className="cam-value">{diagnostics?.totalFramesCaptured ?? 0}</dd>
                  </div>
                </dl>
              </div>
            </details>
          </section>
        ) : (
          <section className="cam-pane cam-empty cam-detail-empty">
            <Video size={24} className="cam-muted" />
            <div className="cam-empty-title">Select a camera</div>
            <p className="cam-empty-text">Choose a camera from the list to see its status and live preview.</p>
          </section>
        )}
      </div>

      {/* Snapshot Preview Modal */}
      <Modal
        isOpen={Boolean(snapshotData)}
        onClose={() => setSnapshotData(null)}
        title="Camera Snapshot"
        size="lg"
        footer={
          snapshotData ? (
            <>
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
            </>
          ) : undefined
        }
      >
        {snapshotData && (
          <>
            <div className="snapshot-preview-frame">
                <img
                  src={`data:image/jpeg;base64,${snapshotData.dataBase64}`}
                  alt="Captured Snapshot"
                  className="snapshot-image"
                />
              </div>

              <div className="snapshot-metadata-bar mt-3">
                <span className="meta-item">
                  <strong>Captured:</strong> {new Date(snapshotData.timestamp).toLocaleString([], { timeZone: 'Asia/Kolkata' })}
                </span>
                {snapshotData.width && snapshotData.height && (
                  <span className="meta-item">
                    <strong>Size:</strong> {snapshotData.width} × {snapshotData.height}
                  </span>
                )}
                
              </div>
          </>
        )}
      </Modal>

      {/* Add Camera Modal */}
      <Modal
        isOpen={isRegisterModalOpen}
        onClose={closeRegisterModal}
        title="Add Camera"
        subtitle={
          registerStep === 1
            ? 'Choose where the camera is installed and what it is used for.'
            : 'Enter the connection details and verify the camera.'
        }
        footer={
          registerStep === 1 ? (
            <>
              <Button type="button" variant="outline" onClick={closeRegisterModal}>
                Cancel
              </Button>
              <Button type="submit" form="add-camera-form" variant="primary" rightIcon={<ArrowRight size={16} />}>
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
              <Button type="submit" form="add-camera-form" variant="primary" isLoading={isSubmittingCamera}>
                Add Camera
              </Button>
            </>
          )
        }
      >
        <form
          id="add-camera-form"
          className="camera-add-form"
          onSubmit={(e) => {
            if (registerStep === 1) {
              e.preventDefault();
              handleRegisterNext();
              return;
            }
            handleRegisterCamera(e);
          }}
        >
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
                            setNewCameraSourceType(e.target.value as typeof newCameraSourceType);
                            setModalTestResult(null);
                          }}
                        >
                          <option value="RTSP">IP / Network Camera (RTSP)</option>
                          <option value="WEBCAM">Local development: browser webcam (this device)</option>
                        </select>
                      </div>

                      <div className="form-group">
                        <label htmlFor="cam-role" className="form-label">Purpose</label>
                        <select
                          id="cam-role"
                          className="form-control"
                          value={newCameraRole}
                          onChange={(e) => setNewCameraRole(e.target.value as typeof newCameraRole)}
                        >
                          <option value="GENERAL">General Monitoring</option>
                          <option value="IN">Gate — Automatic IN / OUT</option>
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
                        ? 'Enter the full RTSP stream URL. The backend must be able to reach that address over the network.'
                        : 'Local development only. This webcam is captured by the current browser and does not need an IP address. Production gates use RTSP cameras.'}
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
                            RTSP Stream URL <span className="required">*</span>
                          </label>
                          <input
                            id="cam-rtsp"
                            type="text"
                            className="form-control"
                            placeholder="rtsp://192.168.1.50:554/Streaming/Channels/101"
                            value={newCameraRtspUrl}
                            onChange={(e) => {
                              setNewCameraRtspUrl(e.target.value);
                              setModalTestResult(null);
                            }}
                            required
                          />
                          <small className="form-hint">
                            Use the exact RTSP URL from the camera or NVR. Private 192.168.x.x addresses must be reachable from the server network.
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
                              onChange={(e) => setNewCameraTransport(e.target.value as typeof newCameraTransport)}
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
                          Browser capture is used for this mode. No camera IP address is required.
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
        </form>
      </Modal>

      {/* Edit Camera Modal */}
      <Modal
        isOpen={isEditModalOpen}
        onClose={() => {
          if (!isSavingEdit) setIsEditModalOpen(false);
        }}
        title="Edit Camera"
        size="lg"
        footer={
          <>
            <Button
              type="button"
              variant="danger"
              className="mr-auto"
              onClick={() => {
                if (selectedCamera) {
                  setIsEditModalOpen(false);
                  setCameraPendingDelete(selectedCamera);
                }
              }}
              leftIcon={<Trash2 size={16} />}
            >
              Delete Camera
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="edit-camera-form"
              variant="primary"
              isLoading={isSavingEdit}
            >
              Save Changes
            </Button>
          </>
        }
      >
        <form id="edit-camera-form" onSubmit={handleSaveEdit}>
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
                    <label htmlFor="edit-facility" className="form-label">Hostel</label>
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
                    onChange={(e) => setEditCameraRole(e.target.value as typeof editCameraRole)}
                  >
                    <option value="GENERAL">General Monitoring</option>
                    <option value="IN">Gate — Automatic IN / OUT</option>
                    <option value="OUT">Gate — OUT only</option>
                    <option value="ATTENDANCE">Existing Attendance Checkpoint</option>
                  </select>
                </div>

                {(editCameraRole === 'IN' || editCameraRole === 'OUT') && (
                  <div className="form-group flex items-center gap-2 py-1">
                    <input
                      id="edit-movement-auto"
                      type="checkbox"
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      checked={editCameraMovementAutomation}
                      onChange={(e) => setEditCameraMovementAutomation(e.target.checked)}
                    />
                    <label htmlFor="edit-movement-auto" className="text-sm text-slate-700 font-medium">
                      Automatically toggle IN / OUT once per resident appearance
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
                          <span className="text-xs font-mono text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded">
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

                    <div className="border border-slate-200 rounded-lg p-3 my-2 bg-slate-50">
                      <button
                        type="button"
                        onClick={() => setShowAdvancedEdit(!showAdvancedEdit)}
                        className="w-full flex items-center justify-between text-sm font-semibold text-slate-700 hover:text-slate-900"
                      >
                        <span>Advanced connection settings</span>
                        {showAdvancedEdit ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>

                      {showAdvancedEdit && (
                        <div className="mt-3 pt-3 border-t border-slate-200 space-y-3">
                          <div className="form-group mb-0">
                            <label htmlFor="edit-transport" className="form-label text-xs">
                              Transport Protocol
                            </label>
                            <select
                              id="edit-transport"
                              className="form-control text-sm"
                              value={editCameraTransport}
                              onChange={(e) => setEditCameraTransport(e.target.value as typeof editCameraTransport)}
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
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
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
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                : 'bg-slate-100 text-slate-600 border border-slate-200'
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
                          <small className="form-hint text-emerald-700">
                            Password is saved. Leave blank unless updating.
                          </small>
                        )}
                      </div>
                    </div>
                  </>
                )}
        </form>
      </Modal>

      <Modal
        isOpen={Boolean(cameraPendingDelete)}
        onClose={() => {
          if (!isDeletingCamera) setCameraPendingDelete(null);
        }}
        title="Delete Camera"
        subtitle="Remove this camera configuration from PRAVAHAx."
        size="sm"
        footer={
          <>
            <Button
              type="button"
              variant="outline"
              onClick={() => setCameraPendingDelete(null)}
              disabled={isDeletingCamera}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              onClick={handleDeleteCamera}
              isLoading={isDeletingCamera}
              leftIcon={<Trash2 size={16} />}
            >
              Delete Camera
            </Button>
          </>
        }
      >
        <div className="alert-banner alert-banner-warning">
          <AlertCircle size={18} className="alert-icon" />
          <span>
            <strong>{cameraPendingDelete?.name}</strong> will be removed. Historical movement and attendance
            records are preserved, but they will no longer be linked to this camera.
          </span>
        </div>
      </Modal>
    </div>
  );
};
