import React from 'react';
import { Modal } from '../../components/Modal';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { SafeResident } from '../../types/resident.types';
import { useAuth } from '../../auth/AuthContext';
import { formatDateTime } from '../../utils/formatters';
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
} from 'lucide-react';

interface ResidentDetailModalProps {
  isOpen: boolean;
  resident: SafeResident | null;
  onClose: () => void;
  onEdit?: (resident: SafeResident) => void;
  onDeactivate?: (resident: SafeResident) => void;
  onReactivate?: (resident: SafeResident) => void;
}

export const ResidentDetailModal: React.FC<ResidentDetailModalProps> = ({
  isOpen,
  resident,
  onClose,
  onEdit,
  onDeactivate,
  onReactivate,
}) => {
  const { user } = useAuth();

  if (!resident) return null;

  const canManage = user?.role === 'ADMIN' || user?.role === 'WARDEN';
  const isCurrentlyIn = resident.presence?.currentState === 'IN';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Resident Profile"
      subtitle={`Code: ${resident.residentCode}`}
      size="lg"
    >
      <div className="resident-detail-modal-body">
        {/* Large Prominent Presence Banner */}
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

        {/* Detailed Information Grid */}
        <div className="detail-sections-grid mt-4">
          <div className="detail-section-card">
            <h4 className="detail-section-title">
              <User size={16} /> Personal Information
            </h4>
            <div className="detail-dl">
              <div className="detail-row">
                <span className="detail-dt">Full Name</span>
                <span className="detail-dd font-semibold">{resident.fullName}</span>
              </div>
              <div className="detail-row">
                <span className="detail-dt">Resident Code</span>
                <span className="detail-dd font-mono">{resident.residentCode}</span>
              </div>
              <div className="detail-row">
                <span className="detail-dt">Account Status</span>
                <span className="detail-dd">
                  <Badge type="status" value={resident.status} />
                </span>
              </div>
            </div>
          </div>

          <div className="detail-section-card">
            <h4 className="detail-section-title">
              <Home size={16} /> Facility & Contact
            </h4>
            <div className="detail-dl">
              <div className="detail-row">
                <span className="detail-dt">Room / Group</span>
                <span className="detail-dd font-semibold">{resident.roomGroup}</span>
              </div>
              <div className="detail-row">
                <span className="detail-dt">Hostel Facility</span>
                <span className="detail-dd">
                  {resident.hostel?.name ? `${resident.hostel.name} (${resident.hostel.code})` : 'Assigned Hostel'}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-dt">Phone Contact</span>
                <span className="detail-dd">
                  {resident.contactPhone ? (
                    <span className="flex items-center gap-1">
                      <Phone size={13} className="text-muted" /> {resident.contactPhone}
                    </span>
                  ) : (
                    '—'
                  )}
                </span>
              </div>
              <div className="detail-row">
                <span className="detail-dt">Email Address</span>
                <span className="detail-dd">
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

        {/* Biometric Face Status Banner (Phase 03 Strict Deferred Message) */}
        <div className="biometric-status-card mt-4">
          <div className="biometric-status-header">
            <div className="flex items-center gap-2">
              <ScanFace size={18} className="text-purple-600" />
              <span className="font-semibold text-sm">Face Recognition Status</span>
            </div>
            <Badge type="enrollment" value={resident.faceEnrollmentStatus} />
          </div>
          <p className="biometric-deferral-notice mt-2">
            Face enrollment will be configured in the next system phase (Step 04). Hardware camera capture and embedding extraction pipelines are currently deferred.
          </p>
        </div>

        {/* Registration Audit Timestamp */}
        <div className="detail-timestamp-bar mt-4">
          <div className="flex items-center gap-1 text-xs text-muted">
            <Clock size={13} />
            <span>Registered: {formatDateTime(resident.createdAt)}</span>
          </div>
          <div className="flex items-center gap-1 text-xs text-muted">
            <Shield size={13} />
            <span>Last Modified: {formatDateTime(resident.updatedAt)}</span>
          </div>
        </div>

        {/* Actions Bar */}
        <div className="modal-actions-bar mt-6">
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
