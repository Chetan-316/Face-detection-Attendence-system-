import React, { useEffect, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
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
  const hasProfilePhoto = Boolean(resident.profilePhotoPath);
  const isFaceEnrolled = resident.faceEnrollmentStatus === 'ENROLLED';

  return (
    <div className="resident-detail-page space-y-6">
      <PageHeader
        breadcrumb={
          <Link to="/residents" className="btn-back flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800">
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
        <div className="flex justify-end -mt-3">
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
      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
        <span className="text-sm font-semibold text-slate-700 block mb-3">
          Resident Profile Status
        </span>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
          <div className="flex items-center gap-2.5 p-3 rounded-lg bg-white border border-slate-200 shadow-sm">
            <CheckCircle2 size={18} className="text-emerald-600 shrink-0" />
            <div>
              <span className="font-semibold block text-slate-800">Personal Details</span>
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
                {hasProfilePhoto ? 'Photo Attached' : 'Missing Photo'}
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
              <span className="font-semibold block text-slate-800">Face Enrollment</span>
              <span className={isFaceEnrolled ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                {isFaceEnrolled ? 'Enrolled' : 'Not Enrolled'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="overview-details-grid grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Profile Card */}
        <Card title="Resident Information" subtitle="Primary identity and hostel assignment">
          <div className="flex items-start gap-4 mb-4">
            <div className="w-20 h-20 rounded-lg overflow-hidden border border-slate-200 bg-slate-100 shrink-0 flex items-center justify-center">
              <img
                src={typeof residentsApi.getProfilePhotoUrl === 'function' ? residentsApi.getProfilePhotoUrl(resident.id) : `/api/v1/residents/${resident.id}/profile-photo`}
                alt={resident.fullName}
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              <User size={32} className="text-slate-400" />
            </div>

            <div className="flex-1 min-w-0">
              <span className="text-xs text-slate-500 block">Full Name</span>
              <h3 className="font-bold text-base text-slate-900 truncate">
                {resident.fullName}
              </h3>
              <span className="text-xs font-mono text-blue-600 font-medium block mt-0.5">
                {resident.residentCode}
              </span>
              <div className="mt-1">
                <Badge type="status" value={resident.status} />
              </div>
            </div>
          </div>

          <div className="detail-dl space-y-2 text-sm">
            <div className="detail-row flex justify-between py-1 border-t border-slate-100">
              <span className="detail-dt text-slate-500">Room / Group</span>
              <span className="detail-dd font-medium">{resident.roomGroup}</span>
            </div>
            <div className="detail-row flex justify-between py-1 border-t border-slate-100">
              <span className="detail-dt text-slate-500">Hostel</span>
              <span className="detail-dd">
                {resident.hostel?.name ? `${resident.hostel.name} (${resident.hostel.code})` : 'Assigned Hostel'}
              </span>
            </div>
            <div className="detail-row flex justify-between py-1 border-t border-slate-100">
              <span className="detail-dt text-slate-500">Contact Phone</span>
              <span className="detail-dd">{resident.contactPhone || '—'}</span>
            </div>
            <div className="detail-row flex justify-between py-1 border-t border-slate-100">
              <span className="detail-dt text-slate-500">Contact Email</span>
              <span className="detail-dd">{resident.contactEmail || '—'}</span>
            </div>
          </div>
        </Card>

        {/* Biometrics and Security Scope */}
        <Card title="Face Enrollment" subtitle="Resident recognition setup">
          <div className="biometric-status-card p-4 rounded-xl border border-slate-200 bg-white">
            <div className="biometric-status-header flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ScanFace size={18} className="text-blue-600" />
                <span className="font-semibold text-sm text-slate-900">Enrollment Status</span>
              </div>
              <Badge type="enrollment" value={resident.faceEnrollmentStatus} />
            </div>
            {canManage && (
              <div className="biometric-actions-row flex items-center gap-2 mt-4 pt-3 border-t border-slate-200">
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

          <div className="detail-timestamp-bar mt-6 pt-3 border-t border-slate-200 flex justify-between items-center text-xs text-slate-500">
            <div className="flex items-center gap-1">
              <Clock size={13} />
              <span>Created: {formatDateTime(resident.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1">
              <Shield size={13} />
              <span>Updated: {formatDateTime(resident.updatedAt)}</span>
            </div>
          </div>
        </Card>
      </div>

      <Card title="Recent Movement History" subtitle="Latest verified hostel entry and exit events">
        {recentMovements.length === 0 ? (
          <p className="text-sm text-slate-500 py-4">No movement history recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-left text-slate-500">
                  <th className="py-3 pr-4 font-semibold">Date & Time</th>
                  <th className="py-3 pr-4 font-semibold">Movement</th>
                  <th className="py-3 pr-4 font-semibold">Gate</th>
                  <th className="py-3 font-semibold">Record</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentMovements.map((movement) => (
                  <tr key={movement.id}>
                    <td className="py-3 pr-4 text-slate-600">
                      {formatDateTime(movement.timestamp)}
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex px-2.5 py-1 rounded-md text-xs font-semibold ${
                        movement.direction === 'IN'
                          ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                          : 'bg-amber-50 text-amber-800 border border-amber-200'
                      }`}>
                        {movement.direction === 'IN' ? 'Entered' : 'Left'}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-slate-700">{movement.gateName || 'Gate'}</td>
                    <td className="py-3">
                      {movement.isCorrection ? (
                        <span className="text-xs font-semibold text-blue-700">Corrected</span>
                      ) : (
                        <span className="text-xs font-semibold text-slate-500">Verified</span>
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
          <div className="flex justify-end gap-2 w-full">
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
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Use this only when a genuine gate IN / OUT movement was missed. The correction is added to the audit history; existing movement records are not deleted.
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <span className="block text-xs font-semibold text-slate-500 mb-1">Correct presence to</span>
            <span className="font-bold text-slate-900">
              {isCurrentlyIn ? 'Outside hostel' : 'Inside hostel'}
            </span>
          </div>

          <div>
            <label htmlFor="correction-time" className="block text-sm font-semibold text-slate-700 mb-1.5">
              When did the missed movement happen?
            </label>
            <input
              id="correction-time"
              type="datetime-local"
              className="form-control w-full"
              value={correctionTime}
              max={new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)}
              onChange={(e) => setCorrectionTime(e.target.value)}
            />
          </div>

          <div>
            <label htmlFor="correction-reason" className="block text-sm font-semibold text-slate-700 mb-1.5">
              Reason
            </label>
            <textarea
              id="correction-reason"
              className="form-control w-full min-h-24"
              placeholder="Example: Resident returned through the gate but the camera event was missed."
              value={correctionReason}
              onChange={(e) => setCorrectionReason(e.target.value)}
            />
          </div>

          {correctionError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
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
