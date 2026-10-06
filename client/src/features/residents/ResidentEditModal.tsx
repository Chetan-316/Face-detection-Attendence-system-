import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Button } from '../../components/Button';
import { residentsApi } from '../../api/residents.api';
import { useToast } from '../../components/ToastContext';
import { SafeResident } from '../../types/resident.types';

interface ResidentEditModalProps {
  isOpen: boolean;
  resident: SafeResident | null;
  onClose: () => void;
  onResidentUpdated: (updated: SafeResident) => void;
}

export const ResidentEditModal: React.FC<ResidentEditModalProps> = ({
  isOpen,
  resident,
  onClose,
  onResidentUpdated,
}) => {
  const { success } = useToast();

  const [residentCode, setResidentCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [roomGroup, setRoomGroup] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (resident) {
      setResidentCode(resident.residentCode || '');
      setFullName(resident.fullName || '');
      setRoomGroup(resident.roomGroup || '');
      setContactPhone(resident.contactPhone || '');
      setContactEmail(resident.contactEmail || '');
      setFieldErrors({});
      setFormError(null);
    }
  }, [resident]);

  if (!resident) return null;

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!residentCode.trim()) {
      errors.residentCode = 'Resident code is required';
    }

    if (!fullName.trim()) {
      errors.fullName = 'Full name is required';
    }

    if (!roomGroup.trim()) {
      errors.roomGroup = 'Room or group designation is required';
    }

    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      errors.contactEmail = 'Please provide a valid email address';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!validate()) {
      return;
    }

    setIsSubmitting(true);

    try {
      const updated = await residentsApi.updateResident(resident.id, {
        residentCode: residentCode.trim(),
        fullName: fullName.trim(),
        roomGroup: roomGroup.trim(),
        contactPhone: contactPhone.trim() || null,
        contactEmail: contactEmail.trim() || null,
      });

      success(`Resident ${updated.fullName} updated successfully.`);
      onResidentUpdated(updated);
      onClose();
    } catch (err: any) {
      if (err.status === 409) {
        setFieldErrors((prev) => ({
          ...prev,
          residentCode: err.message || 'Resident code already in use',
        }));
      } else {
        setFormError(err.message || 'Failed to update resident details');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Edit Resident"
      subtitle={`Updating profile for ${resident.fullName} (${resident.residentCode})`}
      size="md"
    >
      <form onSubmit={handleSubmit} noValidate>
        {formError && (
          <div className="alert-banner alert-banner-error mb-4" role="alert">
            <span>{formError}</span>
          </div>
        )}

        <div className="form-grid-2">
          <Input
            label="Resident Code"
            id="edit-residentCode"
            value={residentCode}
            onChange={(e) => {
              setResidentCode(e.target.value);
              if (fieldErrors.residentCode) {
                setFieldErrors((prev) => ({ ...prev, residentCode: undefined as any }));
              }
            }}
            error={fieldErrors.residentCode}
            required
            disabled={isSubmitting}
          />

          <Input
            label="Room / Group"
            id="edit-roomGroup"
            value={roomGroup}
            onChange={(e) => {
              setRoomGroup(e.target.value);
              if (fieldErrors.roomGroup) {
                setFieldErrors((prev) => ({ ...prev, roomGroup: undefined as any }));
              }
            }}
            error={fieldErrors.roomGroup}
            required
            disabled={isSubmitting}
          />
        </div>

        <Input
          label="Full Name"
          id="edit-fullName"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value);
            if (fieldErrors.fullName) {
              setFieldErrors((prev) => ({ ...prev, fullName: undefined as any }));
            }
          }}
          error={fieldErrors.fullName}
          required
          disabled={isSubmitting}
        />

        <div className="form-grid-2">
          <Input
            label="Contact Phone"
            id="edit-contactPhone"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            disabled={isSubmitting}
          />

          <Input
            label="Contact Email"
            id="edit-contactEmail"
            type="email"
            value={contactEmail}
            onChange={(e) => {
              setContactEmail(e.target.value);
              if (fieldErrors.contactEmail) {
                setFieldErrors((prev) => ({ ...prev, contactEmail: undefined as any }));
              }
            }}
            error={fieldErrors.contactEmail}
            disabled={isSubmitting}
          />
        </div>

        <div className="immutable-fields-notice mt-4">
          <p className="text-xs text-muted">
            Hostel assignment, current presence, and face enrollment are managed through their dedicated workflows rather than this profile form.
          </p>
        </div>

        <div className="modal-actions-bar mt-6">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Save Changes
          </Button>
        </div>
      </form>
    </Modal>
  );
};
