import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { SafeResident } from '../../types/resident.types';
import { biometricsApi } from '../../api/biometrics.api';
import { useToast } from '../../components/ToastContext';
import { AlertTriangle, ShieldAlert } from 'lucide-react';

interface FaceRevokeModalProps {
  isOpen: boolean;
  resident: SafeResident | null;
  onClose: () => void;
  onSuccess: (updated: SafeResident) => void;
}

export const FaceRevokeModal: React.FC<FaceRevokeModalProps> = ({
  isOpen,
  resident,
  onClose,
  onSuccess,
}) => {
  const { success, error: toastError } = useToast();
  const [reason, setReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!isOpen || !resident) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErrorMsg('A valid revocation reason is required');
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      await biometricsApi.revokeEnrollment(resident.id, reason.trim());
      success(`Biometric face profile revoked for ${resident.fullName}`);
      const updated: SafeResident = {
        ...resident,
        faceEnrollmentStatus: 'REVOKED',
      };
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to revoke biometric profile');
      toastError(err.message || 'Failed to revoke biometric profile');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Revoke Face Profile"
      subtitle={`Code: ${resident.residentCode} • ${resident.fullName}`}
      size="md"
    >
      <form onSubmit={handleSubmit} className="face-revoke-modal-form">
        <div className="alert-banner alert-banner-warning mb-4">
          <ShieldAlert size={20} className="shrink-0 text-amber-500" />
          <div className="text-xs">
            <strong className="block mb-1">Privacy & Security Safeguard:</strong>
            Revoking this enrollment will immediately deactivate face recognition for this resident and permanently remove the stored biometric template from active matching.
          </div>
        </div>

        {errorMsg && (
          <div className="alert-banner alert-banner-error mb-4" role="alert">
            <AlertTriangle size={16} />
            <span>{errorMsg}</span>
          </div>
        )}

        <div className="form-group mb-4">
          <label htmlFor="revoke-reason" className="form-label font-medium text-sm">
            Reason for Revocation <span className="text-danger">*</span>
          </label>
          <textarea
            id="revoke-reason"
            className="form-textarea w-full p-2.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-amber-500"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g., Requested resident biometric reset, template quality concern, or manual security revocation"
            required
            disabled={isSubmitting}
          />
        </div>

        <div className="modal-actions-bar">
          <Button variant="outline" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            variant="danger"
            type="submit"
            disabled={isSubmitting || !reason.trim()}
          >
            {isSubmitting ? 'Revoking...' : 'Confirm Revocation'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
