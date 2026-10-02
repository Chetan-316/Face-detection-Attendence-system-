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
            <span className="presence-hero-caption">Current Real-Time Status</span>
            <h3 className="presence-hero-state">
              {isCurrentlyIn ? 'Currently Inside Hostel' : 'Currently Outside Hostel'}
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
        <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-sm font-semibold text-slate-700 block mb-3">
            Onboarding Checklist
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white border border-slate-200 shadow-sm">
              <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              <div>
                <span className="font-semibold block text-slate-800">Details</span>
                <span className="text-emerald-700 font-medium">Complete</span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white border border-slate-200 shadow-sm">
              {hasProfilePhoto ? (
                <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              ) : (
                <XCircle size={18} className="text-amber-600 shrink-0" />
              )}
              <div>
                <span className="font-semibold block text-slate-800">Profile Photo</span>
                <span className={hasProfilePhoto ? 'text-emerald-700 font-medium' : 'text-amber-700 font-medium'}>
                  {hasProfilePhoto ? 'Attached' : 'Missing'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white border border-slate-200 shadow-sm">
              {isFaceEnrolled ? (
                <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
              ) : (
                <XCircle size={18} className="text-slate-400 shrink-0" />
              )}
              <div>
                <span className="font-semibold block text-slate-800">Face Biometrics</span>
                <span className={isFaceEnrolled ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                  {isFaceEnrolled ? 'Enrolled' : 'Not Enrolled'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Information Grid */}
        <div className="detail-sections-grid grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="detail-section-card p-5 rounded-xl border border-slate-200 bg-white">
            <h4 className="detail-section-title font-semibold text-sm mb-3 flex items-center gap-2 text-slate-900">
              <User size={16} /> Personal Information
            </h4>
            <div className="flex items-start gap-3 mb-3">
              {/* Photo Box */}
              <div className="w-16 h-16 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shrink-0 flex items-center justify-center">
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
                <span className="font-bold text-[15px] text-slate-900 block truncate">
                  {resident.fullName}
                </span>
                <span className="text-xs font-mono text-blue-600 font-medium block mt-0.5">
                  {resident.residentCode}
                </span>
              </div>
            </div>

            <div className="detail-dl space-y-2 text-sm">
              <div className="detail-row flex justify-between items-center py-1 border-t border-slate-100">
                <span className="detail-dt text-slate-500">Account Status</span>
                <span className="detail-dd">
                  <Badge type="status" value={resident.status} />
                </span>
              </div>
            </div>
          </div>

          <div className="detail-section-card p-5 rounded-xl border border-slate-200 bg-white">
            <h4 className="detail-section-title font-semibold text-sm mb-3 flex items-center gap-2 text-slate-900">
              <Home size={16} /> Facility & Contact
            </h4>
            <div className="detail-dl space-y-2 text-sm">
              <div className="detail-row flex justify-between items-center py-1">
                <span className="detail-dt text-slate-500">Room / Group</span>
                <span className="detail-dd font-semibold text-slate-800">{resident.roomGroup}</span>
              </div>
              <div className="detail-row flex justify-between items-center py-1 border-t border-slate-100">
                <span className="detail-dt text-slate-500">Hostel Facility</span>
                <span className="detail-dd text-slate-800">
                  {resident.hostel?.name ? `${resident.hostel.name} (${resident.hostel.code})` : 'Assigned Hostel'}
                </span>
              </div>
              <div className="detail-row flex justify-between items-center py-1 border-t border-slate-100">
                <span className="detail-dt text-slate-500">Phone Contact</span>
                <span className="detail-dd text-slate-800">
                  {resident.contactPhone ? (
                    <span className="flex items-center gap-1">
                      <Phone size={13} className="text-slate-400" /> {resident.contactPhone}
                    </span>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
              <div className="detail-row flex justify-between items-center py-1 border-t border-slate-100">
                <span className="detail-dt text-slate-500">Email Address</span>
                <span className="detail-dd text-slate-800">
                  {resident.contactEmail ? (
                    <span className="flex items-center gap-1">
                      <Mail size={13} className="text-slate-400" /> {resident.contactEmail}
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
        <div className="biometric-status-card p-5 rounded-xl border border-slate-200 bg-white">
          <div className="biometric-status-header flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ScanFace size={18} className="text-blue-600" />
              <span className="font-semibold text-sm text-slate-900">Face Recognition Status</span>
            </div>
            <Badge type="enrollment" value={resident.faceEnrollmentStatus} />
          </div>
          {canManage && (
            <div className="biometric-actions-row flex items-center gap-2 mt-3 pt-3 border-t border-slate-200">
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
        <div className="detail-timestamp-bar flex items-center justify-between text-xs text-slate-500 pt-2 border-t border-slate-200">
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
        <div className="modal-actions-bar flex justify-between items-center pt-4 border-t border-slate-200">
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
