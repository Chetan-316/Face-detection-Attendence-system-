import React, { useEffect, useState, useRef, useCallback } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Badge } from '../../components/Badge';
import { SafeResident } from '../../types/resident.types';
import { CameraEntity } from '../../types/camera.types';
import { camerasApi } from '../../api/cameras.api';
import { biometricsApi, EnrollmentStatusData } from '../../api/biometrics.api';
import { useToast } from '../../components/ToastContext';
import {
  Camera as CameraIcon,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  ScanFace,
  RefreshCw,
  Sun,
  Focus,
  Maximize2,
  Users,
} from 'lucide-react';

interface FaceEnrollmentModalProps {
  isOpen: boolean;
  resident: SafeResident | null;
  onClose: () => void;
  onSuccess: (updatedResident: SafeResident) => void;
}

export const FaceEnrollmentModal: React.FC<FaceEnrollmentModalProps> = ({
  isOpen,
  resident,
  onClose,
  onSuccess,
}) => {
  const { success, error: toastError, info } = useToast();

  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState<string>('');
  const [session, setSession] = useState<EnrollmentStatusData | null>(null);

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [isFinishing, setIsFinishing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [feedbackMessage, setFeedbackMessage] = useState<string>('Initializing camera & biometric engine...');
  const [lastQuality, setLastQuality] = useState<EnrollmentStatusData['lastQuality']>(null);

  const captureIntervalRef = useRef<any>(null);
  const isEnrolled = resident?.faceEnrollmentStatus === 'ENROLLED';

  // Load available cameras when modal opens
  useEffect(() => {
    if (!isOpen || !resident) return;

    let isMounted = true;
    setIsLoading(true);
    setErrorMsg(null);
    setSession(null);

    const init = async () => {
      try {
        const camRes = await camerasApi.listCameras(resident.hostelId || undefined);
        if (!isMounted) return;

        const available = camRes.data || [];
        setCameras(available);

        let chosenCamId = available.length > 0 ? available[0].id : '';
        // If webcam exists, prefer webcam
        const webcam = available.find((c) => c.sourceType === 'WEBCAM' && c.isEnabled);
        if (webcam) {
          chosenCamId = webcam.id;
        }

        setSelectedCameraId(chosenCamId);

        if (!chosenCamId) {
          setErrorMsg('No active camera found for enrollment. Please register a camera first.');
          setIsLoading(false);
          return;
        }

        // Start camera stream to ensure hardware is active
        try {
          await camerasApi.startCamera(chosenCamId);
        } catch (e) {
          // If already streaming or non-blocking, continue
        }

        // Start Enrollment Session on backend
        const sessionRes = await biometricsApi.startEnrollment(resident.id, chosenCamId);
        if (!isMounted) return;
        setSession(sessionRes.data);
        setIsCapturing(true);
        setFeedbackMessage('Position one person inside the frame. Looking for face...');
      } catch (err: any) {
        if (!isMounted) return;
        setErrorMsg(err.message || 'Failed to initialize face enrollment session');
        toastError(err.message || 'Failed to initialize face enrollment session');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    };

    init();

    return () => {
      isMounted = false;
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
    };
  }, [isOpen, resident, toastError]);

  // Automated capture loop
  useEffect(() => {
    if (!isOpen || !isCapturing || !resident || isFinishing) return;

    captureIntervalRef.current = setInterval(async () => {
      try {
        const res = await biometricsApi.captureFrame(resident.id);
        const { sessionStatus, quality, sampleAccepted } = res.data;

        setSession(sessionStatus);
        setLastQuality(quality);

        if (sampleAccepted) {
          info(`Sample ${sessionStatus.acceptedSamples} / ${sessionStatus.requiredSamples} captured!`);
          setFeedbackMessage(`Good — sample ${sessionStatus.acceptedSamples} of ${sessionStatus.requiredSamples} captured.`);
        } else if (quality?.rejection_reason) {
          switch (quality.rejection_reason) {
            case 'NO_FACE':
              setFeedbackMessage('No face detected. Please face the camera directly.');
              break;
            case 'MULTIPLE_FACES':
              setFeedbackMessage('Only one person should be visible. Please ensure others step back.');
              break;
            case 'FACE_TOO_SMALL':
              setFeedbackMessage('Move closer to the camera.');
              break;
            case 'FACE_OFF_CENTER':
              setFeedbackMessage('Position your face inside the central box.');
              break;
            case 'TOO_BLURRY':
              setFeedbackMessage('Hold still — image is blurry.');
              break;
            case 'TOO_DARK':
              setFeedbackMessage('Lighting is too low. Move to a well-lit area.');
              break;
            case 'TOO_BRIGHT':
              setFeedbackMessage('Lighting is too bright / glare detected.');
              break;
            case 'LOW_DETECTION_CONFIDENCE':
              setFeedbackMessage('Face the camera directly without obstructions.');
              break;
            default:
              setFeedbackMessage(quality.message || 'Adjusting face position...');
          }
        }

        // Complete when required samples achieved
        if (sessionStatus.acceptedSamples >= sessionStatus.requiredSamples || sessionStatus.status === 'READY') {
          clearInterval(captureIntervalRef.current);
          captureIntervalRef.current = null;
          handleCompleteEnrollment();
        }
      } catch (err: any) {
        // Log intermittent capture errors non-blockingly
      }
    }, 700);

    return () => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
    };
  }, [isOpen, isCapturing, resident, isFinishing, info]);

  const handleCompleteEnrollment = async () => {
    if (!resident || isFinishing) return;
    setIsFinishing(true);
    setFeedbackMessage('Synthesizing biometric template & verifying sample consistency...');

    try {
      const res = await biometricsApi.completeEnrollment(resident.id);
      success(isEnrolled ? 'Face re-enrollment completed successfully!' : 'Face enrolled successfully!');
      
      const updatedResident: SafeResident = {
        ...resident,
        faceEnrollmentStatus: 'ENROLLED',
      };

      onSuccess(updatedResident);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to complete face enrollment');
      toastError(err.message || 'Failed to complete face enrollment');
      setIsFinishing(false);
    }
  };

  const handleCancel = async () => {
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
    if (resident) {
      try {
        await biometricsApi.cancelEnrollment(resident.id);
      } catch (e) {}
    }
    onClose();
  };

  if (!isOpen || !resident) return null;

  const samplesAccepted = session?.acceptedSamples ?? 0;
  const requiredSamples = session?.requiredSamples ?? 7;
  const progressPercent = Math.min(100, Math.round((samplesAccepted / requiredSamples) * 100));

  const isFaceDetected = lastQuality ? lastQuality.face_count === 1 : false;
  const isCentered = lastQuality?.rejection_reason !== 'FACE_OFF_CENTER' && lastQuality?.rejection_reason !== 'FACE_TOO_SMALL';
  const isGoodLighting = lastQuality?.rejection_reason !== 'TOO_DARK' && lastQuality?.rejection_reason !== 'TOO_BRIGHT';
  const isSharp = lastQuality?.rejection_reason !== 'TOO_BLURRY';

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={isEnrolled ? `Face Re-enrollment — ${resident.residentCode}` : `Face Enrollment — ${resident.residentCode}`}
      subtitle={`${resident.fullName} • ${resident.roomGroup}`}
      size="lg"
    >
      <div className="face-enrollment-modal-content">
        {/* Top Camera Status & Info Bar */}
        <div className="flex items-center justify-between bg-slate-900 text-white px-4 py-3 rounded-lg mb-3">
          <div className="flex items-center gap-2">
            <CameraIcon size={18} className="text-emerald-400" />
            <span className="text-sm font-medium">
              Camera: {cameras.find((c) => c.id === selectedCameraId)?.name || 'Laptop Webcam'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Badge value="RUNNING" size="sm" />
            <span className="text-xs text-slate-300">Live 15 FPS</span>
          </div>
        </div>

        {errorMsg ? (
          <div className="alert-banner alert-banner-error mb-4" role="alert">
            <AlertTriangle size={18} />
            <span>{errorMsg}</span>
          </div>
        ) : null}

        {/* Video Preview Frame */}
        <div className="relative bg-black rounded-xl overflow-hidden aspect-[4/3] flex items-center justify-center border border-slate-700 shadow-inner">
          {selectedCameraId ? (
            <img
              src={camerasApi.getPreviewStreamUrl(selectedCameraId)}
              alt="Face Enrollment Live Preview"
              className="w-full h-full object-cover"
              onError={() => {
                setFeedbackMessage('Camera preview stream interrupted. Reconnecting...');
              }}
            />
          ) : (
            <div className="text-slate-400 text-sm flex flex-col items-center gap-2">
              <RefreshCw className="animate-spin" size={24} />
              <span>Connecting to camera hardware...</span>
            </div>
          )}

          {/* Central Face Target Framing Box */}
          <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
            <div
              className={`w-64 h-80 border-2 rounded-3xl transition-colors duration-200 flex flex-col justify-between p-3 ${
                lastQuality?.is_valid
                  ? 'border-emerald-400 shadow-[0_0_20px_rgba(52,211,153,0.5)]'
                  : 'border-dashed border-sky-400/80'
              }`}
            >
              <div className="flex justify-between text-xs text-white/70">
                <span>[ 75% ]</span>
                <ScanFace size={16} />
              </div>
              <div className="text-center text-xs text-white/80 bg-black/60 px-2 py-1 rounded backdrop-blur-sm self-center">
                Position Face Here
              </div>
              <div className="flex justify-between text-xs text-white/70">
                <span>+</span>
                <span>+</span>
              </div>
            </div>
          </div>

          {/* Live Guidance HUD Overlay */}
          <div className="absolute bottom-3 left-3 right-3 bg-black/75 backdrop-blur-md text-white px-3 py-2 rounded-lg text-sm flex items-center justify-between border border-white/10">
            <span className="font-medium text-emerald-300 flex items-center gap-2">
              {isFinishing ? (
                <RefreshCw size={15} className="animate-spin text-emerald-400" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              )}
              {feedbackMessage}
            </span>
            <span className="text-xs text-slate-300">
              Samples: {samplesAccepted} / {requiredSamples}
            </span>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="mt-4">
          <div className="flex justify-between text-xs text-slate-600 dark:text-slate-300 mb-1 font-medium">
            <span>Biometric Samples Progress</span>
            <span>{progressPercent}% Complete ({samplesAccepted} of {requiredSamples})</span>
          </div>
          <div className="w-full bg-slate-200 dark:bg-slate-700 h-2.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-500 h-full transition-all duration-300 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Real-time Quality Gates Checklist */}
        <div className="mt-4 p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wider block mb-2">
            Quality Inspection Gates
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
            <div className={`flex items-center gap-1.5 ${isFaceDetected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {isFaceDetected ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              <span>One Face Detected</span>
            </div>
            <div className={`flex items-center gap-1.5 ${isCentered ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {isCentered ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              <span>Centered & Sized</span>
            </div>
            <div className={`flex items-center gap-1.5 ${isGoodLighting ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {isGoodLighting ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              <span>Good Lighting</span>
            </div>
            <div className={`flex items-center gap-1.5 ${isSharp ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
              {isSharp ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
              <span>Sharp Focus</span>
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="modal-actions-bar mt-5">
          <Button variant="outline" onClick={handleCancel} disabled={isFinishing}>
            Cancel Enrollment
          </Button>

          {samplesAccepted >= 5 && !isFinishing && (
            <Button
              variant="primary"
              onClick={handleCompleteEnrollment}
              leftIcon={<CheckCircle2 size={16} />}
            >
              Complete Now ({samplesAccepted} Samples)
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
