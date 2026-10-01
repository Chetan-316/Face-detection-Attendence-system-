import React, { useState, useEffect, useRef } from 'react';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { residentsApi } from '../../api/residents.api';
import { camerasApi } from '../../api/cameras.api';
import { biometricsApi, EnrollmentStatusData, EnrollmentPose } from '../../api/biometrics.api';
import { useToast } from '../../components/ToastContext';
import { PresenceState, SafeResident } from '../../types/resident.types';
import { CameraEntity } from '../../types/camera.types';
import { useAuth } from '../../auth/AuthContext';
import {
  Check,
  CheckCircle2,
  AlertCircle,
  Camera as CameraIcon,
  Upload,
  RefreshCw,
  User,
  ArrowRight,
  ArrowLeft,
  ArrowUp,
  ArrowDown,
  Focus,
  Circle,
  X,
} from 'lucide-react';

interface ResidentCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResidentCreated: (resident: SafeResident) => void;
}

const REQUIRED_POSES: {
  key: EnrollmentPose;
  label: string;
  instruction: string;
}[] = [
  { key: 'FRONT', label: 'Front', instruction: 'Look straight at the camera.' },
  { key: 'LEFT', label: 'Left', instruction: 'Turn your head slightly left.' },
  { key: 'RIGHT', label: 'Right', instruction: 'Turn your head slightly right.' },
  { key: 'UP', label: 'Up', instruction: 'Look slightly up.' },
  { key: 'DOWN', label: 'Down', instruction: 'Look slightly down.' },
];

export const ResidentCreateModal: React.FC<ResidentCreateModalProps> = ({
  isOpen,
  onClose,
  onResidentCreated,
}) => {
  const { user } = useAuth();
  const { success, error: toastError, info } = useToast();

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // Step 1: Resident Details
  const [residentCode, setResidentCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [roomGroup, setRoomGroup] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [initialPresence, setInitialPresence] = useState<PresenceState>('OUT');
  const [hostelId, setHostelId] = useState(user?.hostelId || '');
  const [hostels, setHostels] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Created Resident instance
  const [createdResident, setCreatedResident] = useState<SafeResident | null>(null);

  // Step 2: Profile Photo
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string | null>(null);
  const [isPhotoLoading, setIsPhotoLoading] = useState(false);
  const [cameras, setCameras] = useState<CameraEntity[]>([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Step 3: Face Enrollment
  const [session, setSession] = useState<EnrollmentStatusData | null>(null);
  const [isEnrollCapturing, setIsEnrollCapturing] = useState(false);
  const [enrollFeedback, setEnrollFeedback] = useState('Look straight at the camera.');
  const [lastQuality, setLastQuality] = useState<EnrollmentStatusData['lastQuality']>(null);
  const [isEnrolled, setIsEnrolled] = useState(false);
  const [isEnrollFinishing, setIsEnrollFinishing] = useState(false);
  const captureIntervalRef = useRef<any>(null);

  // Load hostels for Admin dropdown
  useEffect(() => {
    if (isOpen && user?.role === 'ADMIN' && !user.hostelId) {
      residentsApi.listHostels().then((res) => {
        setHostels(res.data || []);
        if (res.data.length > 0 && !hostelId) {
          setHostelId(res.data[0].id);
        }
      }).catch(() => {});
    }
  }, [isOpen, user?.role, user?.hostelId, hostelId]);

  // Load cameras for photo & enrollment
  useEffect(() => {
    if (isOpen) {
      camerasApi.listCameras(user?.hostelId || undefined).then((res) => {
        const list = res.data || [];
        setCameras(list);
        if (list.length > 0) {
          const webcam = list.find((c) => c.sourceType === 'WEBCAM' && c.isEnabled);
          setSelectedCameraId(webcam ? webcam.id : list[0].id);
        }
      }).catch(() => {});
    }
  }, [isOpen, user?.hostelId]);

  const resetAll = () => {
    setStep(1);
    setResidentCode('');
    setFullName('');
    setRoomGroup('');
    setContactPhone('');
    setContactEmail('');
    setInitialPresence('OUT');
    setHostelId(user?.hostelId || '');
    setFieldErrors({});
    setFormError(null);
    setCreatedResident(null);
    setProfilePhotoUrl(null);
    setSession(null);
    setIsEnrolled(false);
    setIsEnrollCapturing(false);
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }
  };

  const handleClose = () => {
    resetAll();
    onClose();
  };

  const validateStep1 = (): boolean => {
    const errors: Record<string, string> = {};

    if (!residentCode.trim()) {
      errors.residentCode = 'Resident code is required (e.g. R001)';
    }

    if (!fullName.trim()) {
      errors.fullName = 'Full name is required';
    }

    if (!roomGroup.trim()) {
      errors.roomGroup = 'Room or group designation is required (e.g. Room 101)';
    }

    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      errors.contactEmail = 'Please provide a valid email address';
    }

    if (!user?.hostelId && !hostelId.trim()) {
      errors.hostelId = 'Hostel is required';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmitStep1 = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validateStep1()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const created = await residentsApi.createResident({
        residentCode: residentCode.trim(),
        fullName: fullName.trim(),
        roomGroup: roomGroup.trim(),
        contactPhone: contactPhone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        initialPresence,
        hostelId: user?.hostelId || hostelId.trim() || undefined,
      });

      setCreatedResident(created);
      onResidentCreated(created);
      success(`Resident ${created.fullName} (${created.residentCode}) registered.`);
      setStep(2);
    } catch (err: any) {
      setFormError(err.message || 'Failed to create resident');
      toastError(err.message || 'Failed to create resident');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Step 2: Upload or Capture Profile Photo
  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!createdResident || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    const reader = new FileReader();

    setIsPhotoLoading(true);
    reader.onload = async () => {
      try {
        const base64Str = reader.result as string;
        await residentsApi.uploadProfilePhoto(createdResident.id, base64Str);
        setProfilePhotoUrl(residentsApi.getProfilePhotoUrl(createdResident.id));
        success('Profile photo uploaded successfully.');
      } catch (err: any) {
        toastError(err.message || 'Failed to upload profile photo');
      } finally {
        setIsPhotoLoading(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleCapturePhoto = async () => {
    if (!createdResident || !selectedCameraId) return;
    setIsPhotoLoading(true);
    try {
      await residentsApi.captureProfilePhoto(createdResident.id, selectedCameraId);
      setProfilePhotoUrl(residentsApi.getProfilePhotoUrl(createdResident.id));
      success('Profile photo captured from camera.');
    } catch (err: any) {
      toastError(err.message || 'Failed to capture photo from camera');
    } finally {
      setIsPhotoLoading(false);
    }
  };

  const handleDeletePhoto = async () => {
    if (!createdResident) return;
    setIsPhotoLoading(true);
    try {
      await residentsApi.deleteProfilePhoto(createdResident.id);
      setProfilePhotoUrl(null);
      info('Profile photo removed.');
    } catch (err: any) {
      toastError(err.message || 'Failed to remove profile photo');
    } finally {
      setIsPhotoLoading(false);
    }
  };

  // Step 3: Start Face Enrollment
  const startEnrollmentSession = async () => {
    if (!createdResident || !selectedCameraId) return;
    try {
      try {
        await camerasApi.startCamera(selectedCameraId);
      } catch (e) {}

      const sessionRes = await biometricsApi.startEnrollment(createdResident.id, selectedCameraId);
      setSession(sessionRes.data);
      setIsEnrollCapturing(true);
      setEnrollFeedback('Look straight at the camera.');
    } catch (err: any) {
      toastError(err.message || 'Failed to start face enrollment');
    }
  };

  useEffect(() => {
    if (step === 3 && createdResident && selectedCameraId && !session && !isEnrolled) {
      startEnrollmentSession();
    }
  }, [step, createdResident, selectedCameraId]);

  // Step 3 capture loop
  useEffect(() => {
    if (step !== 3 || !isEnrollCapturing || !createdResident || isEnrollFinishing) return;

    captureIntervalRef.current = setInterval(async () => {
      try {
        const res = await biometricsApi.captureFrame(createdResident.id);
        const { sessionStatus, quality, sampleAccepted } = res.data;

        setSession(sessionStatus);
        setLastQuality(quality);

        if (sampleAccepted) {
          const completed = sessionStatus.completedPoses?.length || sessionStatus.acceptedSamples;
          info(`Pose ${completed} of 5 completed!`);

          if (sessionStatus.currentPose) {
            const nextDef = REQUIRED_POSES.find((p) => p.key === sessionStatus.currentPose);
            if (nextDef) setEnrollFeedback(nextDef.instruction);
          }
        } else if (quality?.rejection_reason) {
          switch (quality.rejection_reason) {
            case 'WRONG_POSE':
              setEnrollFeedback(quality.message || 'Turn your head to match the required direction.');
              break;
            case 'NO_FACE':
              setEnrollFeedback('No face detected. Please face the camera directly.');
              break;
            case 'MULTIPLE_FACES':
              setEnrollFeedback('Only one person should be visible.');
              break;
            case 'FACE_TOO_SMALL':
              setEnrollFeedback('Move closer to the camera.');
              break;
            case 'FACE_OFF_CENTER':
              setEnrollFeedback('Center your face inside the guide.');
              break;
            case 'TOO_BLURRY':
              setEnrollFeedback('Hold still for a moment.');
              break;
            case 'TOO_DARK':
              setEnrollFeedback('Lighting is too low. Move to a well-lit area.');
              break;
            default:
              setEnrollFeedback(quality.message || 'Adjusting face position...');
          }
        }

        if (
          sessionStatus.status === 'READY' ||
          (sessionStatus.completedPoses && sessionStatus.completedPoses.length >= 5)
        ) {
          clearInterval(captureIntervalRef.current);
          captureIntervalRef.current = null;
          handleFinishEnrollment();
        }
      } catch (e) {}
    }, 600);

    return () => {
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
        captureIntervalRef.current = null;
      }
    };
  }, [step, isEnrollCapturing, createdResident, isEnrollFinishing, info]);

  const handleFinishEnrollment = async () => {
    if (!createdResident || isEnrollFinishing) return;
    setIsEnrollFinishing(true);
    setEnrollFeedback('Saving face enrollment...');

    try {
      await biometricsApi.completeEnrollment(createdResident.id);
      setIsEnrolled(true);
      success('Face enrollment complete.');
      setStep(4);
    } catch (err: any) {
      toastError(err.message || 'Failed to complete face enrollment');
    } finally {
      setIsEnrollFinishing(false);
    }
  };

  const getStepTitle = () => {
    switch (step) {
      case 1:
        return 'Resident Onboarding — Step 1 of 4: Resident Details';
      case 2:
        return 'Resident Onboarding — Step 2 of 4: Profile Photo';
      case 3:
        return 'Resident Onboarding — Step 3 of 4: Face Enrollment';
      case 4:
        return 'Resident Onboarding — Step 4 of 4: Review & Finish';
    }
  };

  const currentPoseKey: EnrollmentPose = session?.currentPose || 'FRONT';
  const completedPoses: EnrollmentPose[] = session?.completedPoses || [];
  const completedCount = completedPoses.length;
  const currentPoseDef = REQUIRED_POSES.find((p) => p.key === currentPoseKey) || REQUIRED_POSES[0];

  const getPoseIcon = (pose: EnrollmentPose) => {
    switch (pose) {
      case 'LEFT':
        return <ArrowLeft size={16} />;
      case 'RIGHT':
        return <ArrowRight size={16} />;
      case 'UP':
        return <ArrowUp size={16} />;
      case 'DOWN':
        return <ArrowDown size={16} />;
      case 'FRONT':
      default:
        return <Focus size={16} />;
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={getStepTitle()}
      subtitle={createdResident ? `${createdResident.fullName} • ${createdResident.residentCode}` : 'Register a new resident'}
      size={step === 3 ? 'md' : 'lg'}
    >
      <div className="w-full max-w-xl mx-auto flex flex-col gap-5 text-slate-800 dark:text-slate-200">
        {/* Simple Enterprise Step Progress Bar */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3 text-xs">
          <div className={`flex items-center gap-1.5 ${step === 1 ? 'font-semibold text-blue-600 dark:text-blue-400' : step > 1 ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${step === 1 ? 'bg-blue-600 text-white' : step > 1 ? 'bg-green-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600'}`}>
              {step > 1 ? <Check size={12} /> : '1'}
            </span>
            <span>Details</span>
          </div>
          <span className="text-slate-300 dark:text-slate-600">—</span>
          <div className={`flex items-center gap-1.5 ${step === 2 ? 'font-semibold text-blue-600 dark:text-blue-400' : step > 2 ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${step === 2 ? 'bg-blue-600 text-white' : step > 2 ? 'bg-green-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600'}`}>
              {step > 2 ? <Check size={12} /> : '2'}
            </span>
            <span>Photo</span>
          </div>
          <span className="text-slate-300 dark:text-slate-600">—</span>
          <div className={`flex items-center gap-1.5 ${step === 3 ? 'font-semibold text-blue-600 dark:text-blue-400' : step > 3 ? 'text-green-600 dark:text-green-400' : 'text-slate-400'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${step === 3 ? 'bg-blue-600 text-white' : step > 3 ? 'bg-green-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600'}`}>
              {step > 3 ? <Check size={12} /> : '3'}
            </span>
            <span>Face Enrollment</span>
          </div>
          <span className="text-slate-300 dark:text-slate-600">—</span>
          <div className={`flex items-center gap-1.5 ${step === 4 ? 'font-semibold text-blue-600 dark:text-blue-400' : 'text-slate-400'}`}>
            <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${step === 4 ? 'bg-blue-600 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600'}`}>
              4
            </span>
            <span>Finish</span>
          </div>
        </div>

        {/* STEP 1: RESIDENT DETAILS */}
        {step === 1 && (
          <form onSubmit={handleSubmitStep1} noValidate className="flex flex-col gap-4">
            {formError && (
              <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 border border-red-200 dark:border-red-900 rounded text-sm flex items-center gap-2">
                <AlertCircle size={16} className="shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Resident Code"
                id="residentCode"
                name="residentCode"
                placeholder="e.g. STU-02 or R001"
                value={residentCode}
                onChange={(e) => {
                  setResidentCode(e.target.value);
                  if (fieldErrors.residentCode) setFieldErrors((prev) => ({ ...prev, residentCode: '' }));
                }}
                error={fieldErrors.residentCode}
                required
              />

              <Input
                label="Full Name"
                id="fullName"
                name="fullName"
                placeholder="e.g. Chetan Agrawal"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  if (fieldErrors.fullName) setFieldErrors((prev) => ({ ...prev, fullName: '' }));
                }}
                error={fieldErrors.fullName}
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {user?.role === 'ADMIN' && !user.hostelId ? (
                <div>
                  <label htmlFor="hostelId" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                    Hostel <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="hostelId"
                    className="w-full px-3 py-2 border rounded-md bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={hostelId}
                    onChange={(e) => {
                      setHostelId(e.target.value);
                      if (fieldErrors.hostelId) setFieldErrors((prev) => ({ ...prev, hostelId: '' }));
                    }}
                  >
                    {hostels.map((h) => (
                      <option key={h.id} value={h.id}>
                        {h.name} ({h.code})
                      </option>
                    ))}
                  </select>
                  {fieldErrors.hostelId && (
                    <span className="text-xs text-red-500 mt-1 block">{fieldErrors.hostelId}</span>
                  )}
                </div>
              ) : (
                <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                  <span className="text-xs text-slate-500 block">Hostel Assignment</span>
                  <span className="text-sm font-medium text-slate-900 dark:text-white">
                    Assigned to your operational hostel
                  </span>
                </div>
              )}

              <Input
                label="Room / Group"
                id="roomGroup"
                name="roomGroup"
                placeholder="e.g. Room 101"
                value={roomGroup}
                onChange={(e) => {
                  setRoomGroup(e.target.value);
                  if (fieldErrors.roomGroup) setFieldErrors((prev) => ({ ...prev, roomGroup: '' }));
                }}
                error={fieldErrors.roomGroup}
                required
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Input
                label="Contact Phone"
                id="contactPhone"
                name="contactPhone"
                type="tel"
                placeholder="Optional"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
              />

              <Input
                label="Contact Email"
                id="contactEmail"
                name="contactEmail"
                type="email"
                placeholder="Optional"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                error={fieldErrors.contactEmail}
              />
            </div>

            <Select
              label="Initial Presence State"
              id="initialPresence"
              name="initialPresence"
              value={initialPresence}
              onChange={(e) => setInitialPresence(e.target.value as PresenceState)}
              options={[
                { value: 'OUT', label: 'Outside Hostel (OUT)' },
                { value: 'IN', label: 'Inside Hostel (IN)' },
              ]}
            />

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" isLoading={isSubmitting}>
                Create Resident
              </Button>
            </div>
          </form>
        )}

        {/* STEP 2: PROFILE PHOTO */}
        {step === 2 && createdResident && (
          <div className="flex flex-col gap-4">
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 rounded border border-blue-200 dark:border-blue-900 text-xs">
              This photo is for visual identification by staff and gate monitors. It is strictly visual identity and never used as a biometric matching template.
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
              {/* Photo Preview Box */}
              <div className="w-36 h-36 rounded-lg bg-slate-100 dark:bg-slate-800 border-2 border-dashed border-slate-300 dark:border-slate-700 flex flex-col items-center justify-center overflow-hidden shrink-0 relative">
                {profilePhotoUrl ? (
                  <img
                    src={profilePhotoUrl}
                    alt={createdResident.fullName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="flex flex-col items-center text-slate-400 gap-1 text-xs">
                    <User size={36} />
                    <span>No photo</span>
                  </div>
                )}
                {isPhotoLoading && (
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs">
                    <RefreshCw className="animate-spin" size={20} />
                  </div>
                )}
              </div>

              {/* Photo Upload / Capture Controls */}
              <div className="flex-1 flex flex-col gap-3 w-full">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handlePhotoUpload}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                />

                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isPhotoLoading}
                    leftIcon={<Upload size={14} />}
                  >
                    Upload Photo
                  </Button>

                  {cameras.length > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCapturePhoto}
                      disabled={isPhotoLoading || !selectedCameraId}
                      leftIcon={<CameraIcon size={14} />}
                    >
                      Capture from Camera
                    </Button>
                  )}

                  {profilePhotoUrl && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleDeletePhoto}
                      disabled={isPhotoLoading}
                      leftIcon={<X size={14} />}
                    >
                      Remove
                    </Button>
                  )}
                </div>

                {cameras.length > 0 && (
                  <div className="text-xs text-slate-500">
                    <span>Camera: </span>
                    <select
                      className="bg-transparent border-b border-slate-300 dark:border-slate-700 py-0.5 text-xs text-slate-700 dark:text-slate-300 font-medium"
                      value={selectedCameraId}
                      onChange={(e) => setSelectedCameraId(e.target.value)}
                    >
                      {cameras.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-slate-700">
              <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                Save & Finish Later
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setStep(3)}>
                  Skip Photo
                </Button>
                <Button type="button" variant="primary" size="sm" onClick={() => setStep(3)}>
                  Continue to Face Enrollment
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: GUIDED FACE ENROLLMENT */}
        {step === 3 && createdResident && (
          <div className="flex flex-col gap-4">
            {/* Live Camera Preview */}
            <div className="relative bg-slate-900 rounded-lg overflow-hidden aspect-[4/3] flex items-center justify-center border border-slate-300 dark:border-slate-700">
              {selectedCameraId ? (
                <img
                  src={camerasApi.getPreviewStreamUrl(selectedCameraId)}
                  alt="Face Enrollment Live Preview"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-slate-400 text-sm flex flex-col items-center gap-2">
                  <RefreshCw className="animate-spin" size={20} />
                  <span>Connecting to camera...</span>
                </div>
              )}

              {/* Clean Framing Box */}
              <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
                <div className="w-48 h-60 border-2 border-dashed border-white/70 rounded-2xl flex flex-col justify-between items-center py-2 px-1">
                  <span className="text-[11px] text-white/90 bg-black/60 px-2 py-0.5 rounded font-medium">
                    Position Face Here
                  </span>
                  <span className="text-[10px] text-white/70 bg-black/40 px-1.5 py-0.5 rounded">
                    Keep Head Centered
                  </span>
                </div>
              </div>
            </div>

            {/* Current Instruction */}
            <div className="p-3 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 flex items-center gap-3">
              <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900/60 text-blue-700 dark:text-blue-300 flex items-center justify-center shrink-0">
                {getPoseIcon(currentPoseKey)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-xs uppercase tracking-wide text-slate-500 font-semibold">
                  Instruction
                </div>
                <div className="text-sm font-medium text-slate-900 dark:text-white">
                  {currentPoseDef.instruction}
                </div>
                {enrollFeedback !== currentPoseDef.instruction && (
                  <div className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                    {enrollFeedback}
                  </div>
                )}
              </div>
            </div>

            {/* 5-Pose Step Progress List */}
            <div className="border border-slate-200 dark:border-slate-700 rounded divide-y divide-slate-200 dark:divide-slate-700 text-sm">
              {REQUIRED_POSES.map((pose) => {
                const isDone = completedPoses.includes(pose.key);
                const isCurrent = pose.key === currentPoseKey && !isDone;

                return (
                  <div
                    key={pose.key}
                    className={`flex items-center justify-between px-3 py-1.5 ${
                      isCurrent ? 'bg-blue-50/60 dark:bg-blue-950/20 font-medium' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-4 text-slate-500">{getPoseIcon(pose.key)}</span>
                      <span>{pose.label}</span>
                    </div>
                    <div>
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-700 dark:text-green-400 font-medium">
                          <Check size={13} /> Done
                        </span>
                      ) : isCurrent ? (
                        <span className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-400 font-semibold">
                          <Circle size={8} className="fill-blue-600" /> Current
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">Pending</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
              <Button type="button" variant="outline" size="sm" onClick={handleClose}>
                Save & Finish Later
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setStep(4)}>
                  Skip Enrollment
                </Button>
                {completedCount >= 5 && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={handleFinishEnrollment}
                    isLoading={isEnrollFinishing}
                  >
                    Continue to Review
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 4: REVIEW & FINISH */}
        {step === 4 && createdResident && (
          <div className="flex flex-col gap-5">
            <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 flex flex-col sm:flex-row items-center gap-5">
              <div className="w-24 h-24 rounded-lg bg-slate-200 dark:bg-slate-700 overflow-hidden flex items-center justify-center shrink-0">
                {profilePhotoUrl ? (
                  <img
                    src={profilePhotoUrl}
                    alt={createdResident.fullName}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User size={36} className="text-slate-400" />
                )}
              </div>

              <div className="flex-1 text-center sm:text-left">
                <h3 className="text-lg font-semibold text-slate-900 dark:text-white">
                  {createdResident.fullName}
                </h3>
                <div className="text-sm text-slate-500 font-medium">
                  {createdResident.residentCode} • {createdResident.roomGroup}
                </div>
                <div className="text-xs text-slate-400 mt-1">
                  Status: Active • Presence: {createdResident.presence?.currentState || initialPresence}
                </div>
              </div>
            </div>

            {/* Onboarding Checklist Summary */}
            <div className="border border-slate-200 dark:border-slate-700 rounded divide-y divide-slate-200 dark:divide-slate-700 text-sm">
              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
                  <span>Resident Details</span>
                </div>
                <span className="text-xs font-semibold text-green-700 dark:text-green-400">Complete</span>
              </div>

              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  {profilePhotoUrl ? (
                    <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertCircle size={16} className="text-amber-500" />
                  )}
                  <span>Profile Photo</span>
                </div>
                <span className={`text-xs font-semibold ${profilePhotoUrl ? 'text-green-700 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {profilePhotoUrl ? 'Uploaded' : 'Missing'}
                </span>
              </div>

              <div className="flex items-center justify-between p-3">
                <div className="flex items-center gap-2">
                  {isEnrolled ? (
                    <CheckCircle2 size={16} className="text-green-600 dark:text-green-400" />
                  ) : (
                    <AlertCircle size={16} className="text-amber-500" />
                  )}
                  <span>Face Enrollment</span>
                </div>
                <span className={`text-xs font-semibold ${isEnrolled ? 'text-green-700 dark:text-green-400' : 'text-amber-600 dark:text-amber-400'}`}>
                  {isEnrolled ? 'Enrolled (5 Poses)' : 'Not Enrolled'}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <Button type="button" variant="primary" onClick={handleClose}>
                Finish Onboarding
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};
