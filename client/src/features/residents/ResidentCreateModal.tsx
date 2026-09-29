import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { residentsApi } from '../../api/residents.api';
import { useToast } from '../../components/ToastContext';
import { PresenceState, SafeResident } from '../../types/resident.types';
import { useAuth } from '../../auth/AuthContext';

interface ResidentCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResidentCreated: (resident: SafeResident) => void;
}

export const ResidentCreateModal: React.FC<ResidentCreateModalProps> = ({
  isOpen,
  onClose,
  onResidentCreated,
}) => {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();

  const [residentCode, setResidentCode] = useState('');
  const [fullName, setFullName] = useState('');
  const [roomGroup, setRoomGroup] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [initialPresence, setInitialPresence] = useState<PresenceState>('OUT');
  const [hostelId, setHostelId] = useState(user?.hostelId || '');

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetForm = () => {
    setResidentCode('');
    setFullName('');
    setRoomGroup('');
    setContactPhone('');
    setContactEmail('');
    setInitialPresence('OUT');
    setHostelId(user?.hostelId || '');
    setFieldErrors({});
    setFormError(null);
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!residentCode.trim()) {
      errors.residentCode = 'Resident code is required (e.g. R001)';
    }

    if (!fullName.trim()) {
      errors.fullName = 'Full name is required';
    }

    if (!roomGroup.trim()) {
      errors.roomGroup = 'Room or group designation is required (e.g. Room 101)';
    }

    if (contactEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())) {
      errors.contactEmail = 'Please provide a valid email address';
    }

    if (!user?.hostelId && !hostelId.trim()) {
      errors.hostelId = 'Hostel ID is required for organization-level administrators';
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
      const created = await residentsApi.createResident({
        residentCode: residentCode.trim(),
        fullName: fullName.trim(),
        roomGroup: roomGroup.trim(),
        contactPhone: contactPhone.trim() || undefined,
        contactEmail: contactEmail.trim() || undefined,
        initialPresence,
        hostelId: user?.hostelId || hostelId.trim() || undefined,
      });

      success(`Resident ${created.fullName} (${created.residentCode}) registered successfully.`);
      onResidentCreated(created);
      handleClose();
    } catch (err: any) {
      if (err.status === 409) {
        setFieldErrors((prev) => ({
          ...prev,
          residentCode: 'Resident code already exists in this organization',
        }));
      } else if (err.status === 400 && err.details?.fields) {
        setFieldErrors(err.details.fields);
      } else {
        setFormError(err.message || 'Failed to create resident');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add New Resident"
      subtitle="Register an enrolled student/resident into hostel records."
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
            id="residentCode"
            name="residentCode"
            placeholder="e.g. R001, STU-102"
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
            id="roomGroup"
            name="roomGroup"
            placeholder="e.g. Room 101, Block B-12"
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
          id="fullName"
          name="fullName"
          placeholder="e.g. Alex Kumar"
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
            id="contactPhone"
            name="contactPhone"
            placeholder="+1 555-0199"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            disabled={isSubmitting}
          />

          <Input
            label="Contact Email"
            id="contactEmail"
            name="contactEmail"
            type="email"
            placeholder="resident@example.com"
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

        {!user?.hostelId && (
          <Input
            label="Hostel Facility ID"
            id="hostelId"
            name="hostelId"
            placeholder="Enter UUID of assigned hostel"
            value={hostelId}
            onChange={(e) => {
              setHostelId(e.target.value);
              if (fieldErrors.hostelId) {
                setFieldErrors((prev) => ({ ...prev, hostelId: undefined as any }));
              }
            }}
            error={fieldErrors.hostelId}
            required
            hint="Required for organization-level admin"
            disabled={isSubmitting}
          />
        )}

        <Select
          label="Initial Presence Status"
          id="initialPresence"
          name="initialPresence"
          value={initialPresence}
          onChange={(e) => setInitialPresence(e.target.value as PresenceState)}
          options={[
            { value: 'OUT', label: 'OUTSIDE (Default - not physically in hostel)' },
            { value: 'IN', label: 'IN HOSTEL (Currently physically inside)' },
          ]}
          hint="Select IN only if the resident is physically inside the hostel at registration."
          disabled={isSubmitting}
        />

        <div className="modal-actions-bar mt-6">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" isLoading={isSubmitting}>
            Create Resident
          </Button>
        </div>
      </form>
    </Modal>
  );
};
