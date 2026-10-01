import React from 'react';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { SafeResident } from '../../types/resident.types';
import { useAuth } from '../../auth/AuthContext';
import { formatDateTime } from '../../utils/formatters';
import { residentsApi } from '../../api/residents.api';
import {
  User,
  Phone,
  Mail,
  Home,
  Shield,
  Clock,
  ScanFace,
  Edit2,
  UserMinus,
  UserCheck,
  CheckCircle2,
  XCircle,
  Camera,
} from 'lucide-react';

interface ResidentDetailModalProps {
  isOpen: boolean;
  resident: SafeResident | null;
  onClose: () => void;
  onEdit?: (resident: SafeResident) => void;
  onDeactivate?: (resident: SafeResident) => void;
  onReactivate?: (resident: SafeResident) => void;
  onEnrollFace?: (resident: SafeResident) => void;
  onRevokeFace?: (resident: SafeResident) => void;
}

export const ResidentDetailModal: React.FC<ResidentDetailModalProps> = ({
  isOpen,
  resident,
  onClose,
  onEdit,
  onDeactivate,
  onReactivate,
  onEnrollFace,
  onRevokeFace,
}) => {
  const { user } = useAuth();

  if (!resident) return null;

  const canManage = user?.role === 'ADMIN' || user?.role === 'WARDEN';
  const isCurrentlyIn = resident.presence?.currentState === 'IN';
  const hasProfilePhoto = Boolean(resident.profilePhotoPath);
  const isFaceEnrolled = resident.faceEnrollmentStatus === 'ENROLLED';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resident Profile"
      subtitle={`Code: ${resident.residentCode}`}
      size="lg"
    >
      <div className="resident-detail-modal-body space-y-4">
        {/* Presence Hero Banner */}
        <div className={`presence-hero-banner ${isCurrentlyIn ? 'is-in' : 'is-out'}`}>
          <div className="presence-hero-content">
            <span className="presence-hero-caption">CURRENT REAL-TIME STATUS</span>
            <h3 className="presence-hero-state">
              {isCurrentlyIn ? 'CURRENTLY IN HOSTEL' : 'CURRENTLY OUTSIDE HOSTEL'}
            </h3>
            <p className="presence-hero-meta">
              {resident.presence?.lastMovementTime
                ? `Last registered movement: ${formatDateTime(resident.presence.lastMovementTime)} (${resident.presence.lastMovementType || 'RECORDED'})`
                : 'Initial registered presence state'}
            </p>
          </div>
          <div className="presence-hero-badge">
            <Badge type="presence" value={resident.presence?.currentState || 'OUT'} size="md" />
          </div>
        </div>

        {/* Onboarding Checklist Summary */}
        <div className="p-3 bg-slate-50 dark:bg-slate-800/80 rounded-xl border border-slate-200 dark:border-slate-700">
          <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block mb-2">
            Onboarding Checklist
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
            <div className="flex items-center gap-2 p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
              <div>
                <span className="font-semibold block text-slate-800 dark:text-slate-200">Details</span>
                <span className="text-emerald-600 dark:text-emerald-400">Complete</span>
              </div>
            </div>

            <div className="flex items-center gap-2 p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              {hasProfilePhoto ? (
                <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
              ) : (
                <XCircle size={16} className="text-amber-500 shrink-0" />
              )}
              <div>
                <span className="font-semibold block text-slate-800 dark:text-slate-200">Profile Photo</span>
                <span className={hasProfilePhoto ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                  {hasProfilePhoto ? 'Attached' : 'Missing'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 p-2 rounded bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              {isFaceEnrolled ? (
                <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
              ) : (
                <XCircle size={16} className="text-slate-400 shrink-0" />
              )}
              <div>
                <span className="font-semibold block text-slate-800 dark:text-slate-200">Face Biometrics</span>
                <span className={isFaceEnrolled ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>
                  {isFaceEnrolled ? 'Enrolled' : 'Not Enrolled'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Information Grid */}
        <div className="detail-sections-grid grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="detail-section-card p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <h4 className="detail-section-title font-semibold text-sm mb-3 flex items-center gap-2 text-slate-900 dark:text-white">
              <User size={16} /> Personal Information
            </h4>
            <div className="flex items-start gap-3 mb-3">
              {/* Photo Box */}
              <div className="w-16 h-16 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0 flex items-center justify-center">
                <img
                  src={typeof residentsApi.getProfilePhotoUrl === 'function' ? residentsApi.getProfilePhotoUrl(resident.id) : `/api/v1/residents/${resident.id}/profile-photo`}
                  alt={resident.fullName}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <User size={24} className="text-slate-400" />
              </div>

              <div className="flex-1 min-w-0">
                <span className="text-xs text-slate-500 block">Full Name</span>
                <span className="font-bold text-sm text-slate-900 dark:text-white block truncate">
                  {resident.fullName}
                </span>
                <span className="text-xs font-mono text-primary font-medium block mt-0.5">
                  {resident.residentCode}
                </span>
              </div>
            </div>

            <div className="detail-dl space-y-2 text-xs">
              <div className="detail-row flex justify-between items-center py-1 border-t border-slate-100 dark:border-slate-800">
                <span className="detail-dt text-slate-500">Account Status</span>
                <span className="detail-dd">
                  <Badge type="status" value={resident.status} />
                </span>
              </div>
            </div>
          </div>

          <div className="detail-section-card p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <h4 className="detail-section-title font-semibold text-sm mb-3 flex items-center gap-2 text-slate-900 dark:text-white">
              <Home size={16} /> Facility & Contact
            </h4>
            <div className="detail-dl space-y-2 text-xs">
              <div className="detail-row flex justify-between items-center py-1">
                <span className="detail-dt text-slate-500">Room / Group</span>
                <span className="detail-dd font-semibold text-slate-800 dark:text-slate-200">{resident.roomGroup}</span>
              </div>
              <div className="detail-row flex justify-between items-center py-1 border-t border-slate-100 dark:border-slate-800">
                <span className="detail-dt text-slate-500">Hostel Facility</span>
                <span className="detail-dd text-slate-800 dark:text-slate-200">
                  {resident.hostel?.name ? `${resident.hostel.name} (${resident.hostel.code})` : 'Assigned Hostel'}
                </span>
              </div>
              <div className="detail-row flex justify-between items-center py-1 border-t border-slate-100 dark:border-slate-800">
                <span className="detail-dt text-slate-500">Phone Contact</span>
                <span className="detail-dd text-slate-800 dark:text-slate-200">
                  {resident.contactPhone ? (
                    <span className="flex items-center gap-1">
                      <Phone size={13} className="text-muted" /> {resident.contactPhone}
                    </span>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
              <div className="detail-row flex justify-between items-center py-1 border-t border-slate-100 dark:border-slate-800">
                <span className="detail-dt text-slate-500">Email Address</span>
                <span className="detail-dd text-slate-800 dark:text-slate-200">
                  {resident.contactEmail ? (
                    <span className="flex items-center gap-1">
                      <Mail size={13} className="text-muted" /> {resident.contactEmail}
                    </span>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Biometric Face Status Banner */}
        <div className="biometric-status-card p-4 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <div className="biometric-status-header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScanFace size={18} className="text-purple-600" />
              <span className="font-semibold text-sm text-slate-900 dark:text-white">Face Recognition Status</span>
            </div>
            <Badge type="enrollment" value={resident.faceEnrollmentStatus} />
          </div>
          {canManage && (
            <div className="biometric-actions-row flex items-center gap-2 mt-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  onClose();
                  onEnrollFace?.(resident);
                }}
                leftIcon={<ScanFace size={14} />}
              >
                {resident.faceEnrollmentStatus === 'ENROLLED' ? 'Re-enroll Face' : 'Enroll Face'}
              </Button>
              {resident.faceEnrollmentStatus === 'ENROLLED' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onClose();
                    onRevokeFace?.(resident);
                  }}
                  leftIcon={<Shield size={14} />}
                >
                  Revoke Face Enrollment
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Registration Audit Timestamp */}
        <div className="detail-timestamp-bar flex items-center justify-between text-xs text-muted pt-2 border-t border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-1">
            <Clock size={13} />
            <span>Registered: {formatDateTime(resident.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Shield size={13} />
            <span>Last Modified: {formatDateTime(resident.updatedAt)}</span>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="modal-actions-bar flex justify-between items-center pt-4 border-t border-slate-200 dark:border-slate-700">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>

          {canManage && (
            <div className="flex items-center gap-2">
              {resident.status === 'ACTIVE' ? (
                <Button
                  variant="danger"
                  size="md"
                  onClick={() => {
                    onClose();
                    onDeactivate?.(resident);
                  }}
                  leftIcon={<UserMinus size={15} />}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => {
                    onClose();
                    onReactivate?.(resident);
                  }}
                  leftIcon={<UserCheck size={15} />}
                >
                  Reactivate
                </Button>
              )}

              <Button
                variant="primary"
                size="md"
                onClick={() => {
                  onClose();
                  onEdit?.(resident);
                }}
                leftIcon={<Edit2 size={15} />}
              >
                Edit Resident
              </Button>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};
