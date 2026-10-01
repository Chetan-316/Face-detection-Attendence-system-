import React, { useState, useEffect } from 'react';
import { Modal } from '../../components/Modal';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { Button } from '../../components/Button';
import { residentsApi } from '../../api/residents.api';
import { useToast } from '../../components/ToastContext';
import { PresenceState, SafeResident } from '../../types/resident.types';
import { useAuth } from '../../auth/AuthContext';
import { AlertCircle } from 'lucide-react';

interface ResidentCreateModalProps {
  isOpen: boolean;
  onClose: () => void;
  onResidentCreated: (resident: SafeResident, shouldEnroll?: boolean) => void;
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
  const [hostels, setHostels] = useState<Array<{ id: string; code: string; name: string }>>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [enrollAfterSave, setEnrollAfterSave] = useState(false);

  // Load hostels for Admin dropdown if not assigned to specific hostel
  useEffect(() => {
    if (isOpen && user?.role === 'ADMIN' && !user.hostelId) {
      residentsApi
        .listHostels()
        .then((res) => {
          setHostels(res.data || []);
          if (res.data.length > 0 && !hostelId) {
            setHostelId(res.data[0].id);
          }
        })
        .catch(() => {});
    }
  }, [isOpen, user?.role, user?.hostelId, hostelId]);

  const resetAll = () => {
    setResidentCode('');
    setFullName('');
    setRoomGroup('');
    setContactPhone('');
    setContactEmail('');
    setInitialPresence('OUT');
    setHostelId(user?.hostelId || '');
    setFieldErrors({});
    setFormError(null);
    setIsSubmitting(false);
    setEnrollAfterSave(false);
  };

  const handleClose = () => {
    resetAll();
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
        hostelId: hostelId || undefined,
      });

      success(`Resident ${created.fullName} registered successfully.`);
      const shouldEnroll = enrollAfterSave;
      handleClose();
      if (shouldEnroll) {
        onResidentCreated(created, true);
      } else {
        onResidentCreated(created);
      }
    } catch (err: any) {
      if (err.status === 409) {
        setFormError(err.message || 'A resident with this code already exists in your organization.');
      } else {
        setFormError(err.message || 'Failed to create resident. Please check inputs and retry.');
        toastError(err.message || 'Failed to create resident');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Resident"
      subtitle="Register a new student or hostel resident"
      size="md"
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4" noValidate>
        {formError && (
          <div className="p-3 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-sm rounded border border-red-200 dark:border-red-800 flex items-center gap-2">
            <AlertCircle size={16} className="shrink-0" />
            <span>{formError}</span>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Resident Code"
            id="residentCode"
            name="residentCode"
            placeholder="e.g. STU-02"
            value={residentCode}
            onChange={(e) => {
              setResidentCode(e.target.value);
              if (fieldErrors.residentCode) setFieldErrors((prev) => ({ ...prev, residentCode: '' }));
            }}
            error={fieldErrors.residentCode}
            required
            autoFocus
          />

          <Input
            label="Full Name"
            id="fullName"
            name="fullName"
            placeholder="e.g. Chetan Agrawal"
            value={fullName}
            onChange={(e) => {
              setFullName(e.target.value);
              if (fieldErrors.fullName) setFieldErrors((prev) => ({ ...prev, fullName: '' }));
            }}
            error={fieldErrors.fullName}
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {user?.role === 'ADMIN' && !user.hostelId && hostels.length > 0 ? (
            <Select
              label="Assigned Hostel"
              id="hostelId"
              name="hostelId"
              value={hostelId}
              onChange={(e) => setHostelId(e.target.value)}
              options={hostels.map((h) => ({ value: h.id, label: `${h.name} (${h.code})` }))}
              required
            />
          ) : (
            <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
              <span className="text-xs text-slate-500 block font-medium">Assigned Hostel</span>
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Assigned to your operational hostel
              </span>
            </div>
          )}

          <Input
            label="Room / Group"
            id="roomGroup"
            name="roomGroup"
            placeholder="e.g. Room 101"
            value={roomGroup}
            onChange={(e) => {
              setRoomGroup(e.target.value);
              if (fieldErrors.roomGroup) setFieldErrors((prev) => ({ ...prev, roomGroup: '' }));
            }}
            error={fieldErrors.roomGroup}
            required
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Contact Phone"
            id="contactPhone"
            name="contactPhone"
            type="tel"
            placeholder="Optional"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />

          <Input
            label="Contact Email"
            id="contactEmail"
            name="contactEmail"
            type="email"
            placeholder="Optional"
            value={contactEmail}
            onChange={(e) => {
              setContactEmail(e.target.value);
              if (fieldErrors.contactEmail) setFieldErrors((prev) => ({ ...prev, contactEmail: '' }));
            }}
            error={fieldErrors.contactEmail}
          />
        </div>

        <Select
          label="Initial Presence State"
          id="initialPresence"
          name="initialPresence"
          value={initialPresence}
          onChange={(e) => setInitialPresence(e.target.value as PresenceState)}
          options={[
            { value: 'OUT', label: 'Outside Hostel (OUT)' },
            { value: 'IN', label: 'Inside Hostel (IN)' },
          ]}
        />

        <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200 dark:border-slate-700">
          <Button type="button" variant="outline" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="outline"
            aria-label="Create Resident"
            onClick={() => setEnrollAfterSave(false)}
            isLoading={isSubmitting && !enrollAfterSave}
            disabled={isSubmitting}
          >
            Save Resident
          </Button>
          <Button
            type="submit"
            variant="primary"
            onClick={() => setEnrollAfterSave(true)}
            isLoading={isSubmitting && enrollAfterSave}
            disabled={isSubmitting}
          >
            Save & Enroll Face
          </Button>
        </div>
      </form>
    </Modal>
  );
};
