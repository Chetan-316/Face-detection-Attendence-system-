import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { residentsApi } from '../../api/residents.api';
import { useToast } from '../../components/ToastContext';
import { SafeResident } from '../../types/resident.types';
import { AlertTriangle } from 'lucide-react';

interface ResidentDeactivateModalProps {
  isOpen: boolean;
  resident: SafeResident | null;
  onClose: () => void;
  onSuccess: (updated: SafeResident) => void;
}

export const ResidentDeactivateModal: React.FC<ResidentDeactivateModalProps> = ({
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
      setError('A mandatory deactivation reason is required for audit logs.');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const updated = await residentsApi.deactivateResident(resident.id, reason.trim());
      success(`Resident ${resident.fullName} has been deactivated.`);
      onSuccess(updated);
      setReason('');
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate resident');
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
      title="Deactivate Resident"
      subtitle="Audit-logged status modification"
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate>
        <div className="alert-banner alert-banner-warning mb-4">
          <AlertTriangle size={20} className="alert-icon" />
          <div className="alert-body">
            <p className="font-semibold">Confirm deactivation for {resident.fullName} ({resident.residentCode})</p>
            <p className="text-xs mt-1">
              Deactivated residents are flagged as INACTIVE. They will be excluded from active roll-calls until reactivated. This action is permanently recorded in the institutional audit log.
            </p>
          </div>
        </div>

        {error && (
          <div className="alert-banner alert-banner-error mb-4" role="alert">
            <span>{error}</span>
          </div>
        )}

        <Input
          label="Mandatory Reason for Deactivation"
          id="deactivateReason"
          name="reason"
          placeholder="e.g. Resident completed hostel stay, transferred, or withdrew"
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
          <Button type="submit" variant="danger" isLoading={isSubmitting}>
            Confirm Deactivation
          </Button>
        </div>
      </form>
    </Modal>
  );
};
