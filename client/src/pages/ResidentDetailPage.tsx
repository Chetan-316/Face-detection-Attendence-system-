import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
import { SafeResident } from '../types/resident.types';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { ResidentEditModal } from '../features/residents/ResidentEditModal';
import { ResidentDeactivateModal } from '../features/residents/ResidentDeactivateModal';
import { ResidentReactivateModal } from '../features/residents/ResidentReactivateModal';
import { FaceEnrollmentModal } from '../features/residents/FaceEnrollmentModal';
import { FaceRevokeModal } from '../features/residents/FaceRevokeModal';
import { formatDateTime } from '../utils/formatters';
import {
  ArrowLeft,
  User,
  Home,
  Phone,
  Mail,
  Clock,
  Shield,
  ScanFace,
  Edit2,
  UserMinus,
  UserCheck,
  AlertCircle,
} from 'lucide-react';

export const ResidentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [resident, setResident] = useState<SafeResident | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isReactivateOpen, setIsReactivateOpen] = useState(false);
  const [isFaceEnrollOpen, setIsFaceEnrollOpen] = useState(false);
  const [isFaceRevokeOpen, setIsFaceRevokeOpen] = useState(false);

  const canManage = user?.role === 'ADMIN' || user?.role === 'WARDEN';

  const fetchResident = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);

    try {
      const data = await residentsApi.getResident(id);
      setResident(data);
    } catch (err: any) {
      setError(err.message || 'Resident record not found or inaccessible under current scope');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchResident();
  }, [fetchResident]);

  if (isLoading) {
    return (
      <div className="resident-detail-page">
        <div className="skeleton-line w-40 mb-4" />
        <div className="skeleton-card h-64" />
      </div>
    );
  }

  if (error || !resident) {
    return (
      <div className="resident-detail-page">
        <Link to="/residents" className="btn-back">
          <ArrowLeft size={16} /> Back to Residents
        </Link>
        <div className="alert-banner alert-banner-error mt-4" role="alert">
          <AlertCircle size={20} className="alert-icon" />
          <span>{error || 'Resident not found'}</span>
        </div>
      </div>
    );
  }

  const isCurrentlyIn = resident.presence?.currentState === 'IN';

  return (
    <div className="resident-detail-page">
      <PageHeader
        breadcrumb={
          <Link to="/residents" className="btn-back">
            <ArrowLeft size={14} /> Back to Resident Roster
          </Link>
        }
        title={`${resident.fullName}`}
        subtitle={`Resident Code: ${resident.residentCode}`}
        actions={
          canManage && (
            <div className="flex items-center gap-2">
              {resident.status === 'ACTIVE' ? (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => setIsDeactivateOpen(true)}
                  leftIcon={<UserMinus size={14} />}
                >
                  Deactivate
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setIsReactivateOpen(true)}
                  leftIcon={<UserCheck size={14} />}
                >
                  Reactivate
                </Button>
              )}
              <Button
                variant="primary"
                size="sm"
                onClick={() => setIsEditOpen(true)}
                leftIcon={<Edit2 size={14} />}
              >
                Edit Profile
              </Button>
            </div>
          )
        }
      />

      {/* Prominent Hero Status Card */}
      <div className={`presence-hero-banner ${isCurrentlyIn ? 'is-in' : 'is-out'}`}>
        <div className="presence-hero-content">
          <span className="presence-hero-caption">CURRENT REAL-TIME PRESENCE</span>
          <h2 className="presence-hero-state">
            {isCurrentlyIn ? 'CURRENTLY IN HOSTEL' : 'CURRENTLY OUTSIDE HOSTEL'}
          </h2>
          <p className="presence-hero-meta">
            {resident.presence?.lastMovementTime
              ? `Last gate activity recorded: ${formatDateTime(resident.presence.lastMovementTime)}`
              : 'Initial registered status'}
          </p>
        </div>
        <div className="presence-hero-badge">
          <Badge type="presence" value={resident.presence?.currentState || 'OUT'} size="md" />
        </div>
      </div>

      <div className="overview-details-grid mt-6">
        {/* Profile Card */}
        <Card title="Resident Information" subtitle="Primary identity and facility allocation">
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
              <span className="detail-dt">Room / Group</span>
              <span className="detail-dd">{resident.roomGroup}</span>
            </div>
            <div className="detail-row">
              <span className="detail-dt">Facility Assigned</span>
              <span className="detail-dd">
                {resident.hostel?.name ? `${resident.hostel.name} (${resident.hostel.code})` : 'Assigned Hostel'}
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-dt">Account Status</span>
              <span className="detail-dd">
                <Badge type="status" value={resident.status} />
              </span>
            </div>
            <div className="detail-row">
              <span className="detail-dt">Contact Phone</span>
              <span className="detail-dd">{resident.contactPhone || '—'}</span>
            </div>
            <div className="detail-row">
              <span className="detail-dt">Contact Email</span>
              <span className="detail-dd">{resident.contactEmail || '—'}</span>
            </div>
          </div>
        </Card>

        {/* Biometrics and Security Scope */}
        <Card title="Biometrics & Enrollment" subtitle="Face recognition capability tracking">
          <div className="biometric-status-card">
            <div className="biometric-status-header">
              <div className="flex items-center gap-2">
                <ScanFace size={18} className="text-purple-600" />
                <span className="font-semibold text-sm">Face Recognition Status</span>
              </div>
              <Badge type="enrollment" value={resident.faceEnrollmentStatus} />
            </div>
            {canManage && (
              <div className="biometric-actions-row flex items-center gap-2 mt-4 pt-3 border-t border-slate-200 dark:border-slate-700">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setIsFaceEnrollOpen(true)}
                  leftIcon={<ScanFace size={14} />}
                >
                  {resident.faceEnrollmentStatus === 'ENROLLED' ? 'Re-enroll Face' : 'Enroll Face'}
                </Button>
                {resident.faceEnrollmentStatus === 'ENROLLED' && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsFaceRevokeOpen(true)}
                    leftIcon={<Shield size={14} />}
                  >
                    Revoke Face Enrollment
                  </Button>
                )}
              </div>
            )}
            <p className="biometric-deferral-notice mt-3">
              Camera integration, face enrollment, and face recognition are intentionally deferred to upcoming implementation phases.
            </p>
          </div>

          <div className="detail-timestamp-bar mt-6">
            <div className="flex items-center gap-1 text-xs text-muted">
              <Clock size={13} />
              <span>Created: {formatDateTime(resident.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted">
              <Shield size={13} />
              <span>Updated: {formatDateTime(resident.updatedAt)}</span>
            </div>
          </div>
        </Card>
      </div>

      {/* Modals */}
      {canManage && (
        <>
          <ResidentEditModal
            isOpen={isEditOpen}
            resident={resident}
            onClose={() => setIsEditOpen(false)}
            onResidentUpdated={(u) => setResident(u)}
          />
          <ResidentDeactivateModal
            isOpen={isDeactivateOpen}
            resident={resident}
            onClose={() => setIsDeactivateOpen(false)}
            onSuccess={(u) => setResident(u)}
          />
          <ResidentReactivateModal
            isOpen={isReactivateOpen}
            resident={resident}
            onClose={() => setIsReactivateOpen(false)}
            onSuccess={(u) => setResident(u)}
          />
          <FaceEnrollmentModal
            isOpen={isFaceEnrollOpen}
            resident={resident}
            onClose={() => setIsFaceEnrollOpen(false)}
            onSuccess={(u) => setResident(u)}
          />
          <FaceRevokeModal
            isOpen={isFaceRevokeOpen}
            resident={resident}
            onClose={() => setIsFaceRevokeOpen(false)}
            onSuccess={(u) => setResident(u)}
          />
        </>
      )}
    </div>
  );
};
