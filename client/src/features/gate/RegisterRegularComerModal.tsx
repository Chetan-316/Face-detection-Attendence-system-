import React, { useState } from 'react';
import { Modal } from '../../components/Modal';
import { Button } from '../../components/Button';
import { Input } from '../../components/Input';
import { Select } from '../../components/Select';
import { residentsApi } from '../../api/residents.api';
import { SafeResident } from '../../types/resident.types';
import { useToast } from '../../components/ToastContext';
import { UserPlus, Camera, CheckSquare, Shield } from 'lucide-react';

interface RegisterRegularComerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (newPerson: SafeResident, shouldEnrollFace: boolean) => void;
  hostelId?: string;
}

const CATEGORY_OPTIONS = [
  { value: 'Delivery / Courier', label: 'Delivery / Courier (Swiggy, Zomato, Amazon, etc.)' },
  { value: 'Daily Vendor', label: 'Daily Vendor (Milk, Newspaper, Laundry, Food)' },
  { value: 'Maintenance / Staff', label: 'Maintenance / Contractor / Housekeeping' },
  { value: 'Regular Visitor', label: 'Regular Visitor / Family' },
  { value: 'Official Guest', label: 'Official Guest / External Personnel' },
  { value: 'Other Non-Resident', label: 'Other Regular Comer' },
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
  const [code, setCode] = useState('');
  const [markInNow, setMarkInNow] = useState(true);
  const [enrollFaceNow, setEnrollFaceNow] = useState(false);

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
        code: code.trim() || undefined,
        markInNow,
        hostelId,
      });

      success(`${newPerson.fullName} registered successfully${markInNow ? ' and marked IN' : ''}.`);
      onSuccess(newPerson, enrollFaceNow);
      handleClose();
    } catch (err: any) {
      toastError(err.message || 'Failed to register regular comer');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setFullName('');
    setCategory('Delivery / Courier');
    setContactPhone('');
    setCode('');
    setMarkInNow(true);
    setEnrollFaceNow(false);
    setFormErrors({});
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Register Regular Visitor / Non-Resident"
      subtitle="Quick-register frequent gate visitors (delivery, vendors, maintenance, guests)"
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
            Register & Confirm Entry
          </Button>
        </div>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-start gap-2.5 text-xs text-blue-800">
          <Shield size={16} className="text-blue-600 shrink-0 mt-0.5" />
          <div>
            <strong>Gate Visitor Log:</strong> This person will be registered as an authorized regular non-resident.
            Their entry is recorded immediately upon registration.
          </div>
        </div>

        <Input
          label="Full Name *"
          placeholder="e.g. Ramesh Kumar (Milk Delivery)"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={formErrors.fullName}
          autoFocus
        />

        <Select
          label="Visitor Category *"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={CATEGORY_OPTIONS}
        />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Mobile Number"
            placeholder="e.g. 9876543210"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
            error={formErrors.contactPhone}
          />

          <Input
            label="Visitor Code (Optional)"
            placeholder="Auto-generated (e.g. VIS-4021)"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </div>

        <div className="pt-2 border-t border-slate-200 flex flex-col gap-3">
          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={markInNow}
              onChange={(e) => setMarkInNow(e.target.checked)}
              className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
            />
            <span className="font-medium">Mark IN immediately upon registration</span>
          </label>

          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={enrollFaceNow}
              onChange={(e) => setEnrollFaceNow(e.target.checked)}
              className="w-4 h-4 text-emerald-600 rounded border-slate-300 focus:ring-emerald-500"
            />
            <span className="font-medium flex items-center gap-1.5 text-emerald-800">
              <Camera size={16} className="text-emerald-600" />
              Enroll Face Biometrics now via Gate Camera (for automatic identification on future visits)
            </span>
          </label>
        </div>
      </form>
    </Modal>
  );
};
