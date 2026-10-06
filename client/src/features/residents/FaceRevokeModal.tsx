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
      success(`Face enrollment removed for ${resident.fullName}.`);
      const updated: SafeResident = {
        ...resident,
        faceEnrollmentStatus: 'REVOKED',
      };
      onSuccess(updated);
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to remove face enrollment');
      toastError(err.message || 'Failed to remove face enrollment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Remove Face Enrollment"
      subtitle={`Code: ${resident.residentCode} • ${resident.fullName}`}
      size="md"
    >
      <form onSubmit={handleSubmit} className="face-revoke-modal-form">
        <div className="alert-banner alert-banner-warning mb-4">
          <ShieldAlert size={20} className="shrink-0 text-amber-500" />
          <div className="text-xs">
            <strong className="block mb-1">Before you continue</strong>
            Removing this enrollment stops automatic face matching for this resident. The resident can be enrolled again later if needed.
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
            Reason for Removal <span className="required">*</span>
          </label>
          <textarea
            id="revoke-reason"
            className="form-textarea"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Example: resident requested a reset, enrollment needs to be redone, or access was withdrawn"
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
            {isSubmitting ? 'Removing...' : 'Remove Enrollment'}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
