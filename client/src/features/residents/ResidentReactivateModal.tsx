import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { residentsApi } from '../../api/residents.api';
import { useToast } from '../../components/ToastContext';
import { SafeResident } from '../../types/resident.types';
import { RotateCcw } from 'lucide-react';

interface ResidentReactivateModalProps {
  isOpen: boolean;
  resident: SafeResident | null;
  onClose: () => void;
  onSuccess: (updated: SafeResident) => void;
}

export const ResidentReactivateModal: React.FC<ResidentReactivateModalProps> = ({
  isOpen,
  resident,
  onClose,
  onSuccess,
}) => {
  const { success } = useToast();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!resident) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setError('A mandatory reactivation reason is required for audit logs.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const updated = await residentsApi.reactivateResident(resident.id, reason.trim());
      success(`Resident ${resident.fullName} has been reactivated to ACTIVE status.`);
      onSuccess(updated);
      setReason('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to reactivate resident');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        setReason('');
        setError(null);
        onClose();
      }}
      title="Reactivate Resident"
      subtitle="Audit-logged status restoration"
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="alert-banner alert-banner-info mb-4">
          <RotateCcw size={20} className="alert-icon" />
          <div className="alert-body">
            <p className="font-semibold">Reactivate {resident.fullName} ({resident.residentCode})</p>
            <p className="text-xs mt-1">
              Restoring this resident to active status returns them to normal resident, presence, and movement workflows.
            </p>
          </div>
        </div>

        {error && (
          <div className="alert-banner alert-banner-error mb-4" role="alert">
            <span>{error}</span>
          </div>
        )}

        <Input
          label="Mandatory Reason for Reactivation"
          id="reactivateReason"
          name="reason"
          placeholder="e.g. Student re-enrolled for academic term, returned from leave"
          value={reason}
          onChange={(e) => {
            setReason(e.target.value);
            if (error) setError(null);
          }}
          required
          disabled={isSubmitting}
        />

        <div className="modal-actions-bar mt-6">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setReason('');
              setError(null);
              onClose();
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Confirm Reactivation
          </Button>
        </div>
      </form>
    </Modal>
  );
};
