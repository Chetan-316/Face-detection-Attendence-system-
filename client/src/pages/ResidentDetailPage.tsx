import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
import { AuthenticatedImage } from '../components/AuthenticatedImage';
import { reportsApi } from '../api/reports.api';
import { movementsApi } from '../api/movements.api';
import { MovementReportItem } from '../types/reports.types';
import { SafeResident } from '../types/resident.types';
import { useAuth } from '../auth/AuthContext';
import { useToast } from '../components/ToastContext';
import { PageHeader } from '../components/PageHeader';
import { Card } from '../components/Card';
import { Badge } from '../components/Badge';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { ResidentEditModal } from '../features/residents/ResidentEditModal';
import { ResidentDeactivateModal } from '../features/residents/ResidentDeactivateModal';
import { ResidentReactivateModal } from '../features/residents/ResidentReactivateModal';
import { FaceEnrollmentModal } from '../features/residents/FaceEnrollmentModal';
import { FaceRevokeModal } from '../features/residents/FaceRevokeModal';
import { formatDateTime } from '../utils/formatters';
import {
  ArrowLeft,
  User,
  Clock,
  Shield,
  ScanFace,
  Edit2,
  UserMinus,
  UserCheck,
  AlertCircle,
  CheckCircle2,
  XCircle,
  RefreshCw,
} from 'lucide-react';

export const ResidentDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  const [resident, setResident] = useState<SafeResident | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [recentMovements, setRecentMovements] = useState<MovementReportItem[]>([]);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isReactivateOpen, setIsReactivateOpen] = useState(false);
  const [isFaceEnrollOpen, setIsFaceEnrollOpen] = useState(false);
  const [isFaceRevokeOpen, setIsFaceRevokeOpen] = useState(false);
  const [isCorrectionOpen, setIsCorrectionOpen] = useState(false);
  const [correctionTime, setCorrectionTime] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [correctionError, setCorrectionError] = useState<string | null>(null);
  const [isCorrecting, setIsCorrecting] = useState(false);

  const canManage = user?.role === 'ADMIN' || user?.role === 'WARDEN';

  const openPresenceCorrection = () => {
    const now = new Date();
    const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
    setCorrectionTime(localIso);
    setCorrectionReason('');
    setCorrectionError(null);
    setIsCorrectionOpen(true);
  };

  const fetchResident = useCallback(async () => {
    if (!id) return;
    setIsLoading(true);
    setError(null);

    try {
      const [data, movementRes] = await Promise.all([
        residentsApi.getResident(id),
        reportsApi.getResidentMovements(id, 8).catch(() => ({ data: [] })),
      ]);
      setResident(data);
      setRecentMovements(movementRes.data || []);
    } catch (err: any) {
      setError(err.message || 'Resident record not found or inaccessible under current scope');
    } finally {
      setIsLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchResident();
  }, [fetchResident]);

  const handlePresenceCorrection = async () => {
    if (!resident) return;

    const reason = correctionReason.trim();
    if (!reason) {
      setCorrectionError('Please enter the reason for this correction.');
      return;
    }
    if (!correctionTime) {
      setCorrectionError('Please choose when the missed movement happened.');
      return;
    }

    const targetState = resident.presence?.currentState === 'IN' ? 'OUT' : 'IN';

    try {
      setIsCorrecting(true);
      setCorrectionError(null);
      await movementsApi.correctPresence({
        residentId: resident.id,
        targetState,
        effectiveTimestamp: new Date(correctionTime).toISOString(),
        reason,
      });
      setIsCorrectionOpen(false);
      await fetchResident();
      success(`Presence corrected to ${targetState === 'IN' ? 'Inside hostel' : 'Outside hostel'}.`);
    } catch (err: any) {
      const message = err.message || 'Unable to correct resident presence.';
      setCorrectionError(message);
      toastError(message);
    } finally {
      setIsCorrecting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="resident-detail-page resident-detail-stack" aria-busy="true">
        <div className="skeleton-line resident-skeleton-title" />
        <div className="skeleton-card resident-skeleton-body" />
      </div>
    );
  }

  if (error || !resident) {
    return (
      <div className="resident-detail-page">
        <Link to="/residents" className="btn-back">
          <ArrowLeft size={16} /> Back to Residents
        </Link>
        <div className="alert-banner alert-banner-error resident-error-alert" role="alert">
          <AlertCircle size={20} className="alert-icon" />
          <span>{error || 'Resident not found'}</span>
        </div>
      </div>
    );
  }

  const isCurrentlyIn = resident.presence?.currentState === 'IN';
  const hasProfilePhoto = Boolean(resident.profilePhotoPath);
  const isFaceEnrolled = resident.faceEnrollmentStatus === 'ENROLLED';

  return (
    <div className="resident-detail-page resident-detail-stack">
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
            <div className="page-header-actions">
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
          <span className="presence-hero-caption">CURRENT PRESENCE</span>
          <h2 className="presence-hero-state">
            {isCurrentlyIn ? 'Currently Inside Hostel' : 'Currently Outside Hostel'}
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

      {canManage && (
        <div className="resident-correct-row">
          <Button
            variant="outline"
            size="sm"
            onClick={openPresenceCorrection}
            leftIcon={<RefreshCw size={14} />}
          >
            Correct Presence
          </Button>
        </div>
      )}

      {/* Onboarding Checklist Summary */}
      <section className="resident-status-panel" aria-label="Resident profile status">
        <h2 className="section-heading">Resident Profile Status</h2>
        <div className="resident-status-grid">
          <div className="resident-status-item">
            <CheckCircle2 size={18} className="resident-status-icon is-positive" aria-hidden="true" />
            <div>
              <span className="resident-status-label">Personal Details</span>
              <span className="resident-status-value is-positive">Complete</span>
            </div>
          </div>

          <div className="resident-status-item">
            {hasProfilePhoto ? (
              <CheckCircle2 size={18} className="resident-status-icon is-positive" aria-hidden="true" />
            ) : (
              <XCircle size={18} className="resident-status-icon is-warning" aria-hidden="true" />
            )}
            <div>
              <span className="resident-status-label">Profile Photo</span>
              <span className={`resident-status-value ${hasProfilePhoto ? 'is-positive' : 'is-warning'}`}>
                {hasProfilePhoto ? 'Photo Attached' : 'Missing Photo'}
              </span>
            </div>
          </div>

          <div className="resident-status-item">
            {isFaceEnrolled ? (
              <CheckCircle2 size={18} className="resident-status-icon is-positive" aria-hidden="true" />
            ) : (
              <XCircle size={18} className="resident-status-icon is-muted" aria-hidden="true" />
            )}
            <div>
              <span className="resident-status-label">Face Enrollment</span>
              <span className={`resident-status-value ${isFaceEnrolled ? 'is-positive' : 'is-muted'}`}>
                {isFaceEnrolled ? 'Enrolled' : 'Not Enrolled'}
              </span>
            </div>
          </div>
        </div>
      </section>

      <div className="overview-details-grid resident-detail-grid">
        {/* Profile Card */}
        <Card title="Resident Information" subtitle="Primary identity and hostel assignment">
          <div className="resident-identity">
            <div className="resident-photo">
              <AuthenticatedImage
                src={typeof residentsApi.getProfilePhotoUrl === 'function' ? residentsApi.getProfilePhotoUrl(resident.id) : `/api/v1/residents/${resident.id}/profile-photo`}
                alt={resident.fullName}
                className="resident-photo-img"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <User size={32} className="resident-photo-placeholder" aria-hidden="true" />
            </div>

            <div className="resident-identity-text">
              <span className="resident-field-label">Full Name</span>
              <h3 className="resident-name">{resident.fullName}</h3>
              <span className="resident-code">{resident.residentCode}</span>
              <div className="resident-identity-status">
                <Badge type="status" value={resident.status} />
              </div>
            </div>
          </div>

          <div className="detail-dl">
            <div className="detail-row">
              <span className="detail-dt">Room / Group</span>
              <span className="detail-dd">{resident.roomGroup}</span>
            </div>
            <div className="detail-row">
              <span className="detail-dt">Hostel</span>
              <span className="detail-dd">
                {resident.hostel?.name ? `${resident.hostel.name} (${resident.hostel.code})` : 'Assigned Hostel'}
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
        <Card title="Face Enrollment" subtitle="Resident recognition setup">
          <div className="biometric-status-card">
            <div className="biometric-status-header">
              <div className="biometric-status-label">
                <ScanFace size={18} className="biometric-status-icon" aria-hidden="true" />
                <span className="biometric-status-title">Enrollment Status</span>
              </div>
              <Badge type="enrollment" value={resident.faceEnrollmentStatus} />
            </div>
            {canManage && (
              <div className="biometric-actions-row">
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
          </div>

          <div className="detail-timestamp-bar">
            <div className="detail-timestamp-item">
              <Clock size={13} aria-hidden="true" />
              <span>Created: {formatDateTime(resident.createdAt)}</span>
            </div>
            <div className="detail-timestamp-item">
              <Shield size={13} aria-hidden="true" />
              <span>Updated: {formatDateTime(resident.updatedAt)}</span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Recent Movement History" subtitle="Latest verified hostel entry and exit events">
        {recentMovements.length === 0 ? (
          <div className="state-panel state-panel-compact">
            <p className="state-panel-text">No movement history recorded yet.</p>
          </div>
        ) : (
          <div className="resident-movement-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date & Time</th>
                  <th>Movement</th>
                  <th>Gate</th>
                  <th>Record</th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="cell-secondary cell-nowrap">
                      {formatDateTime(movement.timestamp)}
                    </td>
                    <td>
                      <span className={`badge badge-sm ${
                        movement.direction === 'IN' ? 'badge-presence-in' : 'badge-presence-out'
                      }`}>
                        <span className="badge-dot" aria-hidden="true" />
                        <span>{movement.direction === 'IN' ? 'Entered' : 'Left'}</span>
                      </span>
                    </td>
                    <td className="cell-secondary">{movement.gateName || 'Gate'}</td>
                    <td>
                      {movement.isCorrection ? (
                        <span className="badge badge-sm badge-correction">Corrected</span>
                      ) : (
                        <span className="badge badge-sm badge-neutral">Verified</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        isOpen={isCorrectionOpen}
        onClose={() => !isCorrecting && setIsCorrectionOpen(false)}
        title="Correct Resident Presence"
        subtitle={`${resident.fullName} • currently ${isCurrentlyIn ? 'Inside hostel' : 'Outside hostel'}`}
        size="sm"
        footer={
          <div className="modal-actions-bar">
            <Button
              variant="outline"
              onClick={() => setIsCorrectionOpen(false)}
              disabled={isCorrecting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handlePresenceCorrection}
              isLoading={isCorrecting}
              disabled={isCorrecting}
            >
              Apply Correction
            </Button>
          </div>
        }
      >
        <div className="modal-form-stack">
          <div className="alert-banner alert-banner-warning">
            Use this only when a genuine gate IN / OUT movement was missed. The correction is added to the audit history; existing movement records are not deleted.
          </div>

          <div className="modal-note">
            <span className="modal-note-label">Correct presence to</span>
            <span className="modal-note-value">
              {isCurrentlyIn ? 'Outside hostel' : 'Inside hostel'}
            </span>
          </div>

          <div className="form-group">
            <label htmlFor="correction-time" className="form-label">
              When did the missed movement happen?
            </label>
            <input
              id="correction-time"
              type="datetime-local"
              className="form-control"
              value={correctionTime}
              max={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
              onChange={(e) => setCorrectionTime(e.target.value)}
            />
          </div>

          <div className="form-group">
            <label htmlFor="correction-reason" className="form-label">
              Reason
            </label>
            <textarea
              id="correction-reason"
              className="form-control correction-reason-input"
              placeholder="Example: Resident returned through the gate but the camera event was missed."
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
            />
          </div>

          {correctionError && (
            <div className="alert-banner alert-banner-error" role="alert">
              {correctionError}
            </div>
          )}
        </div>
      </Modal>

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

export default ResidentDetailPage;
