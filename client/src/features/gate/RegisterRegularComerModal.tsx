import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { residentsApi } from '../../api/residents.api';
import { SafeResident } from '../../types/resident.types';
import { useToast } from '../../components/ToastContext';
import { UserPlus, Shield, DoorOpen } from 'lucide-react';

interface RegisterRegularComerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newPerson: SafeResident) => void;
  hostelId?: string;
}

const CATEGORY_OPTIONS = [
  { value: 'Delivery / Courier', label: 'Delivery / Courier' },
  { value: 'Vendor / Service', label: 'Vendor / Service' },
  { value: 'Maintenance / Contractor', label: 'Maintenance / Contractor' },
  { value: 'Family / Guest', label: 'Family / Guest' },
  { value: 'Official Visitor', label: 'Official Visitor' },
  { value: 'Other Visitor', label: 'Other' },
];

export const RegisterRegularComerModal: React.FC<RegisterRegularComerModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  hostelId,
}) => {
  const { success, error: toastError } = useToast();

  const [fullName, setFullName] = useState('');
  const [category, setCategory] = useState('Delivery / Courier');
  const [contactPhone, setContactPhone] = useState('');
  const [markInNow, setMarkInNow] = useState(true);

  const [isLoading, setIsLoading] = useState(false);
  const [formErrors, setFormErrors] = useState<{ fullName?: string; contactPhone?: string }>({});

  const validate = () => {
    const errors: { fullName?: string; contactPhone?: string } = {};
    if (!fullName.trim()) {
      errors.fullName = 'Full name is required';
    }
    if (contactPhone.trim() && !/^[0-9+ -]{7,20}$/.test(contactPhone.trim())) {
      errors.contactPhone = 'Please enter a valid phone number';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    try {
      setIsLoading(true);
      const newPerson = await residentsApi.registerRegularComer({
        fullName: fullName.trim(),
        category,
        contactPhone: contactPhone.trim() || undefined,
        markInNow,
        hostelId,
      });

      success(`${newPerson.fullName} recorded successfully${markInNow ? ' and marked inside' : ''}.`);
      onSuccess(newPerson);
      handleClose();
    } catch (err: any) {
      toastError(err.message || 'Failed to record gate visitor');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFullName('');
    setCategory('Delivery / Courier');
    setContactPhone('');
    setMarkInNow(true);
    setFormErrors({});
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Visitor / Gate Exception"
      subtitle="Record a non-resident person entering through the gate."
      size="md"
      footer={
        <div className="flex items-center justify-end gap-3 w-full">
          <Button variant="secondary" onClick={handleClose} disabled={isLoading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            isLoading={isLoading}
            leftIcon={<UserPlus size={18} />}
          >
            Record Visitor
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2.5 text-sm text-blue-800">
          <Shield size={16} className="text-blue-600 shrink-0 mt-0.5" />
          <div>
            Use this when the person is not an enrolled resident. Keep the entry simple and record only the details needed at the gate.
          </div>
        </div>

        <Input
          label="Full Name *"
          placeholder="Enter visitor name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={formErrors.fullName}
          autoFocus
        />

        <Select
          label="Visit Type *"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={CATEGORY_OPTIONS}
        />

        <Input
          label="Mobile Number (Optional)"
          placeholder="Enter mobile number"
          value={contactPhone}
          onChange={(e) => setContactPhone(e.target.value)}
          error={formErrors.contactPhone}
        />

        <div className="pt-2 border-t border-slate-200">
          <label className="flex items-start gap-3 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={markInNow}
              onChange={(e) => setMarkInNow(e.target.checked)}
              className="w-4 h-4 mt-0.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
            />
            <span>
              <span className="font-semibold flex items-center gap-1.5">
                <DoorOpen size={15} className="text-blue-600" />
                Visitor is entering now
              </span>
              <span className="text-xs text-slate-500 block mt-0.5">
                Keep this selected to record the visitor as currently inside.
              </span>
            </span>
          </label>
        </div>
      </form>
    </Modal>
  );
};
