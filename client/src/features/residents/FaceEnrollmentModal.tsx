import React, { useEffect, useId, useRef, useState } from 'react';
import { Camera, Check, RefreshCw } from 'lucide-react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { useToast } from '../../components/ToastContext';
import { SafeResident } from '../../types/resident.types';
import { camerasApi } from '../../api/cameras.api';
import { biometricsApi, EnrollmentPose, EnrollmentStatusData } from '../../api/biometrics.api';
import { ApiError } from '../../api/client';
import { usePreviewStreamUrl } from '../../hooks/usePreviewStreamUrl';

interface FaceEnrollmentModalProps {
  isOpen: boolean;
  resident: SafeResident | null;
  onClose: () => void;
  onSuccess: (updatedResident: SafeResident) => void;
}

interface PoseStep {
  key: EnrollmentPose;
  label: string;
  stepNum: number;
  instruction: string;
  actionText: string;
}

const POSE_STEPS: PoseStep[] = [
  { key: 'FRONT', label: 'Front', stepNum: 1, instruction: 'Look straight at the camera', actionText: 'Capture Front' },
  { key: 'LEFT', label: 'Left', stepNum: 2, instruction: 'Turn slightly left', actionText: 'Capture Left' },
  { key: 'RIGHT', label: 'Right', stepNum: 3, instruction: 'Turn slightly right', actionText: 'Capture Right' },
  { key: 'UP', label: 'Up', stepNum: 4, instruction: 'Look slightly up', actionText: 'Capture Up' },
  { key: 'DOWN', label: 'Down', stepNum: 5, instruction: 'Look slightly down', actionText: 'Capture Down' },
];

const TOTAL_ANGLES = POSE_STEPS.length;

const QUALITY_MESSAGES: Record<string, string> = {
  MULTIPLE_FACES: 'Only one person should be visible.',
  NO_FACE: 'No face found. Look at the camera and hold still.',
  FACE_TOO_SMALL: 'Move closer to the camera.',
  FACE_OFF_CENTER: 'Center your face inside the guide.',
  TOO_BLURRY: 'The image is blurry. Hold still and capture again.',
  TOO_DARK: 'Too dark. Improve the lighting.',
  TOO_BRIGHT: 'Too bright. Reduce glare or backlight.',
  LOW_DETECTION_CONFIDENCE: 'Face not detected clearly. Look straight at the camera.',
};

const SESSION_ENDED_MESSAGE =
  'This enrollment session expired (sessions last five minutes), so the captured angles were discarded. Capture again to start a new session.';
const UNSUPPORTED_CAMERA_MESSAGE =
  'This browser cannot access a camera. Use a current browser on HTTPS or localhost.';

type CameraMode = 'browser' | 'server' | 'none';
type CameraPhase = 'idle' | 'requesting' | 'ready' | 'blocked';
type Busy = 'starting' | 'capturing' | 'saving' | 'cancelling' | null;
type Feedback = { kind: 'error' | 'success'; text: string } | null;
type OverlayAction = 'retry-camera' | 'reload-preview';

function qualityMessage(reason: string | null | undefined, pose: PoseStep): string {
  if (reason === 'WRONG_POSE') return `The head angle does not match this step. ${pose.instruction}.`;
  return (reason && QUALITY_MESSAGES[reason]) || 'Capture was not accepted. Hold still for a moment, then capture again.';
}

function describeApiError(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 0 || err.code === 'NETWORK_ERROR') {
      return 'Cannot reach the server. Check the connection, then try again.';
    }
    if (err.status === 401) return 'Your sign-in has expired. Sign in again to continue.';
    if (err.status === 403) return 'Your role does not allow managing face enrollment for this resident.';
    switch (err.code) {
      case 'BIOMETRIC_WORKER_ERROR':
        return 'The face recognition engine did not respond. Ask the administrator to check the biometric worker, then try again.';
      case 'BIOMETRIC_INCONSISTENT_SAMPLES':
        return 'The captured angles did not match one another. Start over with only this resident in view.';
      case 'BIOMETRIC_QUALITY_FAILED':
        return 'The capture quality was too low. Hold still and try again.';
    }
    if (err.status >= 500) {
      return 'The server could not process this request. Try again; if it keeps failing, contact the administrator.';
    }
  }
  return fallback;
}

function describeCameraError(err: unknown): string {
  const name = (err as { name?: unknown } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked for this site. Allow camera access in the browser, then select Try again.';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No camera was found on this device. Connect a camera, then select Try again.';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'The camera is in use by another application. Close that application, then select Try again.';
    default:
      return 'The camera could not be started. Select Try again.';
  }
}

function canUseBrowserCamera(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
}

function requestWebcam(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
    audio: false,
  });
}

function stopStream(stream: MediaStream | null | undefined) {
  stream?.getTracks().forEach((track) => track.stop());
}

function playVideo(el: HTMLVideoElement) {
  try {
    el.play().catch(() => {});
  } catch {
    // Playback is unavailable in this environment; the preview stays blank.
  }
}

function grabFrame(video: HTMLVideoElement): string | null {
  if (video.videoWidth === 0) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(640, video.videoWidth);
    canvas.height = Math.min(480, video.videoHeight);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

export const FaceEnrollmentModal: React.FC<FaceEnrollmentModalProps> = ({
  isOpen,
  resident,
  onClose,
  onSuccess,
}) => {
  if (!isOpen || !resident) return null;
  return <EnrollmentDialog key={resident.id} resident={resident} onClose={onClose} onSuccess={onSuccess} />;
};

interface EnrollmentDialogProps {
  resident: SafeResident;
  onClose: () => void;
  onSuccess: (updatedResident: SafeResident) => void;
}

const EnrollmentDialog: React.FC<EnrollmentDialogProps> = ({ resident, onClose, onSuccess }) => {
  const { success } = useToast();
  const residentId = resident.id;
  const hostelId = resident.hostelId;
  const isEnrolled = resident.faceEnrollmentStatus === 'ENROLLED';
  const confirmTitleId = useId();
  const confirmTextId = useId();

  const [attempt, setAttempt] = useState(0);
  const [initializing, setInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [camera, setCamera] = useState<{ id: string; sourceType: string } | null>(null);
  const [cam, setCam] = useState<{ phase: CameraPhase; message: string | null }>({ phase: 'idle', message: null });
  const [previewRetry, setPreviewRetry] = useState(0);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [session, setSession] = useState<EnrollmentStatusData | null>(null);
  const [activeKey, setActiveKey] = useState<EnrollmentPose | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [done, setDone] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(false);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  const keepEnrollingRef = useRef<HTMLButtonElement | null>(null);
  const doneRef = useRef<HTMLButtonElement | null>(null);

  const mode: CameraMode = !camera ? 'none' : camera.sourceType === 'WEBCAM' ? 'browser' : 'server';
  const previewBase = usePreviewStreamUrl(mode === 'server' ? camera?.id : null, previewRetry);
  const previewSrc = previewBase
    ? `${previewBase}${previewBase.includes('?') ? '&' : '?'}_t=${previewRetry}`
    : '';

  const completedPoses = new Set<EnrollmentPose>(session?.completedPoses ?? []);
  const completedCount = POSE_STEPS.filter((p) => completedPoses.has(p.key)).length;
  const nextPose = POSE_STEPS.find((p) => !completedPoses.has(p.key)) ?? null;
  const allComplete = nextPose === null;
  const activeStep = POSE_STEPS.find((p) => p.key === (activeKey ?? nextPose?.key)) ?? POSE_STEPS[0];

  const cameraReady = mode === 'server' || (mode === 'browser' && cam.phase === 'ready');
  const canCapture = !initializing && !initError && !busy && !done && !allComplete && cameraReady;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (video && stream && video.srcObject !== stream) {
      video.srcObject = stream;
      playVideo(video);
    }
  }, [mode, cam.phase]);

  useEffect(() => {
    let active = true;

    const run = async () => {
      let chosen: { id: string; sourceType: string } | null = null;
      try {
        const listed = await camerasApi.listCameras(hostelId || undefined);
        if (!active) return;
        const enabled = (listed.data ?? []).filter((c) => c.isEnabled);
        chosen = enabled.find((c) => c.sourceType === 'WEBCAM') ?? enabled[0] ?? null;
      } catch (err) {
        if (!active) return;
        setInitError(describeApiError(err, 'Could not load the cameras for this hostel. Try again.'));
        setInitializing(false);
        return;
      }

      if (!chosen) {
        setInitError('No enabled camera is registered for this hostel. Register and enable a camera first.');
        setInitializing(false);
        return;
      }

      setCamera(chosen);

      if (chosen.sourceType === 'WEBCAM') {
        if (!canUseBrowserCamera()) {
          setCam({ phase: 'blocked', message: UNSUPPORTED_CAMERA_MESSAGE });
        } else {
          setCam({ phase: 'requesting', message: null });
          try {
            const stream = await requestWebcam();
            if (!active) {
              stopStream(stream);
              return;
            }
            streamRef.current = stream;
            setCam({ phase: 'ready', message: null });
          } catch (err) {
            if (!active) return;
            setCam({ phase: 'blocked', message: describeCameraError(err) });
          }
        }
      } else {
        try {
          await camerasApi.startCamera(chosen.id);
        } catch {
          // The preview reports the camera's state when it cannot start.
        }
        if (!active) return;
      }

      try {
        const res = await biometricsApi.startEnrollment(residentId, chosen.id);
        if (!active) return;
        setSession(res.data);
      } catch (err) {
        if (!active) return;
        setInitError(describeApiError(err, 'Could not start the enrollment session. Try again.'));
      }
      if (active) setInitializing(false);
    };

    void run();

    return () => {
      active = false;
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, [residentId, hostelId, attempt]);

  useEffect(() => {
    if (confirmDiscard) keepEnrollingRef.current?.focus();
  }, [confirmDiscard]);

  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done]);

  useEffect(() => {
    if (busy === null && !done && !confirmDiscard && document.activeElement === document.body) {
      primaryRef.current?.focus();
    }
  }, [busy, done, confirmDiscard]);

  const retryInit = () => {
    if (inFlightRef.current) return;
    setInitializing(true);
    setInitError(null);
    setSession(null);
    setActiveKey(null);
    setFeedback(null);
    setSaveFailed(false);
    setConfirmDiscard(false);
    setPreviewFailed(false);
    setCam({ phase: 'idle', message: null });
    setAttempt((n) => n + 1);
  };

  const startBrowserCamera = async () => {
    if (streamRef.current || !canUseBrowserCamera()) return;
    setCam({ phase: 'requesting', message: null });
    try {
      const stream = await requestWebcam();
      if (!mountedRef.current) {
        stopStream(stream);
        return;
      }
      streamRef.current = stream;
      setCam({ phase: 'ready', message: null });
    } catch (err) {
      if (!mountedRef.current) return;
      setCam({ phase: 'blocked', message: describeCameraError(err) });
    }
  };

  const reloadPreview = () => {
    setPreviewFailed(false);
    setPreviewRetry((n) => n + 1);
  };

  const captureActiveAngle = async () => {
    if (inFlightRef.current || !canCapture || !camera) return;
    const pose = activeStep;

    let imageBase64: string | undefined;
    if (mode === 'browser') {
      const frame = videoRef.current ? grabFrame(videoRef.current) : null;
      if (!frame) {
        setFeedback({ kind: 'error', text: 'The camera has not produced an image yet. Wait for the preview, then capture.' });
        return;
      }
      imageBase64 = frame;
    }

    inFlightRef.current = true;
    setBusy('capturing');
    setFeedback(null);
    try {
      if (!session) {
        const started = await biometricsApi.startEnrollment(residentId, camera.id);
        setSession(started.data);
      }
      const res = await biometricsApi.captureFrame(residentId, pose.key, imageBase64);
      const data = res.data;
      if (data.sessionStatus) setSession(data.sessionStatus);
      if (data.sampleAccepted) {
        setActiveKey(null);
        setFeedback({ kind: 'success', text: `${pose.label} angle captured.` });
      } else {
        setFeedback({ kind: 'error', text: qualityMessage(data.quality?.rejection_reason, pose) });
      }
    } catch (err) {
      if (err instanceof ApiError && (err.status === 404 || err.status === 410)) {
        setSession(null);
        setActiveKey(null);
        setFeedback({ kind: 'error', text: SESSION_ENDED_MESSAGE });
      } else {
        setFeedback({ kind: 'error', text: describeApiError(err, 'Capture failed. Try again.') });
      }
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  };

  const restartSession = async () => {
    if (inFlightRef.current || !camera) return;
    inFlightRef.current = true;
    setBusy('starting');
    setFeedback(null);
    try {
      try {
        await biometricsApi.cancelEnrollment(residentId);
      } catch {
        // Nothing to cancel if the earlier session already expired.
      }
      const res = await biometricsApi.startEnrollment(residentId, camera.id);
      setSession(res.data);
      setActiveKey(null);
      setSaveFailed(false);
    } catch (err) {
      setSession(null);
      setFeedback({ kind: 'error', text: describeApiError(err, 'Could not start a new enrollment session. Try again.') });
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  };

  const saveEnrollment = async () => {
    if (inFlightRef.current || !allComplete || done) return;
    inFlightRef.current = true;
    setBusy('saving');
    setFeedback(null);
    setSaveFailed(false);
    try {
      await biometricsApi.completeEnrollment(residentId);
      setDone(true);
      success(
        isEnrolled
          ? `Face re-enrollment completed for ${resident.fullName}.`
          : `Face registered successfully for ${resident.fullName}.`
      );
      onSuccess({ ...resident, faceEnrollmentStatus: 'ENROLLED' });
    } catch (err) {
      setSaveFailed(true);
      setFeedback({ kind: 'error', text: describeApiError(err, 'The enrollment could not be saved. Try again.') });
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
  };

  const discardAndClose = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy('cancelling');
    try {
      await biometricsApi.cancelEnrollment(residentId);
    } catch {
      // The server session expires on its own within five minutes.
    } finally {
      inFlightRef.current = false;
      setBusy(null);
    }
    onClose();
  };

  const requestClose = () => {
    if (busy) return;
    if (done) {
      onClose();
      return;
    }
    if (confirmDiscard) {
      setConfirmDiscard(false);
      return;
    }
    if (completedCount > 0) {
      setConfirmDiscard(true);
      return;
    }
    void discardAndClose();
  };

  let overlay: { title: string; text?: string; spinner?: boolean; action?: OverlayAction } | null = null;
  if (initializing && !camera) {
    overlay = { title: 'Finding camera', text: 'Checking the cameras registered for this hostel.', spinner: true };
  } else if (mode === 'none') {
    overlay = { title: 'No camera available', text: initError ?? undefined };
  } else if (mode === 'browser' && cam.phase === 'requesting') {
    overlay = { title: 'Waiting for camera permission', text: 'Allow camera access when the browser asks.', spinner: true };
  } else if (mode === 'browser' && cam.phase === 'idle') {
    overlay = { title: 'Starting camera', spinner: true };
  } else if (mode === 'browser' && cam.phase === 'blocked') {
    overlay = {
      title: 'Camera unavailable',
      text: cam.message ?? undefined,
      action: 'retry-camera',
    };
  } else if (mode === 'server' && (previewFailed || !previewSrc)) {
    overlay = previewFailed
      ? {
          title: 'Preview unavailable',
          text: 'The camera preview did not load. Check the camera status on the Cameras page.',
          action: 'reload-preview',
        }
      : { title: 'Connecting to camera', spinner: true, action: 'reload-preview' };
  }

  const primaryLabel = allComplete
    ? busy === 'saving' ? 'Saving' : 'Save face enrollment'
    : busy === 'capturing' ? 'Capturing' : activeStep.actionText;

  const defaultHint = allComplete
    ? 'All angles captured. Save to activate the face profile.'
    : cameraReady
      ? `Hold still, then capture the ${activeStep.label.toLowerCase()} angle.`
      : 'Waiting for the camera.';

  if (done) {
    return (
      <Modal
        isOpen
        onClose={requestClose}
        title={`Enroll Face — ${resident.fullName}`}
        subtitle={`${resident.residentCode} • ${resident.roomGroup}`}
        size="lg"
        initialFocusRef={doneRef}
      >
        <div className="enroll-complete" role="status">
          <span className="enroll-complete-icon" aria-hidden="true">
            <Check size={22} />
          </span>
          <h3 className="enroll-complete-title">Face enrollment saved</h3>
          <p className="enroll-complete-text">{`${resident.fullName}'s face profile is now active.`}</p>
          <Button ref={doneRef} variant="primary" size="lg" onClick={onClose}>
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  const footer = (
    <div className="enroll-footer">
      <Button variant="outline" size="md" onClick={requestClose} disabled={busy !== null}>
        Cancel
      </Button>
      <span>{`${completedCount} of ${TOTAL_ANGLES} angles captured`}</span>
    </div>
  );

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={isEnrolled ? `Re-enroll Face — ${resident.fullName}` : `Enroll Face — ${resident.fullName}`}
      subtitle={`${resident.residentCode} • ${resident.roomGroup}`}
      size="lg"
      initialFocusRef={primaryRef}
      footer={footer}
    >
      <div className="enroll">
        {isEnrolled && (
          <div className="enroll-notice" role="note">
            <strong>Re-enrollment replaces the current face profile.</strong> The existing profile stays active until all
            five angles are captured and saved. Cancelling leaves it unchanged.
          </div>
        )}

        <div className="enroll-layout">
          <section className="enroll-stage-col" aria-label="Camera">
            <div className="enroll-stage">
              {mode === 'browser' && (
                <video ref={videoRef} className="enroll-video" autoPlay playsInline muted aria-label="Live camera preview" />
              )}
              {mode === 'server' && previewSrc && !previewFailed && (
                <img
                  key={previewRetry}
                  className="enroll-video"
                  src={previewSrc}
                  alt="Live camera preview"
                  onError={() => setPreviewFailed(true)}
                />
              )}

              {overlay && (
                <div className="enroll-overlay" role="status">
                  {overlay.spinner && <RefreshCw className="enroll-spin" size={24} aria-hidden="true" />}
                  <span className="enroll-overlay-title">{overlay.title}</span>
                  {overlay.text && <span className="enroll-overlay-text">{overlay.text}</span>}
                  {overlay.action && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={overlay.action === 'retry-camera' ? startBrowserCamera : reloadPreview}
                    >
                      {overlay.action === 'retry-camera' ? 'Try again' : 'Reload preview'}
                    </Button>
                  )}
                </div>
              )}

              {!overlay && (
                <>
                  <div className="enroll-live">
                    <span className="enroll-live-dot" aria-hidden="true" />
                    <span>{mode === 'browser' ? 'Camera ready' : 'Live preview'}</span>
                  </div>
                  <div className="enroll-guide" aria-hidden="true" />
                </>
              )}
            </div>
            {mode === 'browser' && cam.phase === 'ready' && (
              <p className="enroll-hint">
                <Camera size={14} aria-hidden="true" /> Captures are taken from this browser camera.
              </p>
            )}
          </section>

          <section className="enroll-steps-col" aria-label="Enrollment steps">
            <div className="enroll-step-count">
              {allComplete ? `All ${TOTAL_ANGLES} angles captured` : `Angle ${activeStep.stepNum} of ${TOTAL_ANGLES}`}
            </div>
            <h3 className="enroll-instruction">{allComplete ? 'Ready to save' : activeStep.instruction}</h3>

            <div
              className="enroll-progress"
              role="progressbar"
              aria-label="Angles captured"
              aria-valuemin={0}
              aria-valuemax={TOTAL_ANGLES}
              aria-valuenow={completedCount}
            >
              <span className="enroll-progress-fill" style={{ width: `${(completedCount / TOTAL_ANGLES) * 100}%` }} />
            </div>

            <ol className="enroll-pose-list">
              {POSE_STEPS.map((pose) => {
                const isDone = completedPoses.has(pose.key);
                const isCurrent = pose.key === activeStep.key;
                return (
                  <li key={pose.key}>
                    <button
                      type="button"
                      className="enroll-pose"
                      data-state={isDone ? 'done' : 'pending'}
                      aria-current={isCurrent ? 'step' : undefined}
                      aria-label={`${pose.label}${isDone ? ', captured' : ''}`}
                      title={isDone ? `Retake ${pose.label}` : pose.label}
                      disabled={(!isDone && !isCurrent) || busy !== null}
                      onClick={() => setActiveKey(pose.key)}
                    >
                      <span className="enroll-pose-mark" aria-hidden="true">
                        {isDone ? <Check size={14} /> : isCurrent ? '●' : '○'}
                      </span>
                      <span aria-hidden="true">{pose.label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>

            <div
              className="enroll-feedback"
              data-kind={feedback?.kind ?? 'hint'}
              role={feedback?.kind === 'error' ? 'alert' : 'status'}
            >
              {feedback?.text ?? defaultHint}
            </div>

            {initError && (
              <div className="enroll-feedback" data-kind="error" role="alert">
                <span>{initError}</span>
                <Button variant="outline" size="sm" onClick={retryInit} disabled={busy !== null}>
                  Try again
                </Button>
              </div>
            )}

            <div className="enroll-actions">
              <Button
                ref={primaryRef}
                variant="primary"
                size="lg"
                className="enroll-primary"
                onClick={allComplete ? saveEnrollment : captureActiveAngle}
                isLoading={busy === 'capturing' || busy === 'saving'}
                disabled={allComplete ? busy !== null || confirmDiscard : !canCapture}
              >
                {primaryLabel}
              </Button>
              {saveFailed && (
                <Button variant="outline" size="md" onClick={restartSession} disabled={busy !== null}>
                  Start over
                </Button>
              )}
            </div>

            {confirmDiscard && (
              <div className="enroll-confirm" role="alertdialog" aria-labelledby={confirmTitleId} aria-describedby={confirmTextId}>
                <p id={confirmTitleId} className="enroll-confirm-title">
                  {`Discard ${completedCount} captured ${completedCount === 1 ? 'angle' : 'angles'}?`}
                </p>
                <p id={confirmTextId} className="enroll-confirm-text">
                  Captured angles are held on the server only for this session and are lost when you leave.{' '}
                  {isEnrolled
                    ? "The resident's current face profile stays active."
                    : 'The resident stays without a face profile.'}
                </p>
                <div className="enroll-confirm-actions">
                  <Button ref={keepEnrollingRef} variant="outline" size="md" onClick={() => setConfirmDiscard(false)}>
                    Keep enrolling
                  </Button>
                  <Button variant="danger" size="md" onClick={discardAndClose} disabled={busy !== null}>
                    Discard and close
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </Modal>
  );
};

export default FaceEnrollmentModal;
