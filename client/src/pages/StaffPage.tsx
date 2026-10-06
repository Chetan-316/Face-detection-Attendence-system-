import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { staffApi, StaffAccount } from '../api/staff.api';
import { residentsApi } from '../api/residents.api';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { Badge } from '../components/Badge';
import { useToast } from '../components/ToastContext';
import { Edit2, KeyRound, Plus, RefreshCw, Users, ShieldCheck } from 'lucide-react';

type HostelOption = { id: string; code: string; name: string };

export const StaffPage: React.FC = () => {
  const { success, error: toastError } = useToast();
  const [staff, setStaff] = useState<StaffAccount[]>([]);
  const [hostels, setHostels] = useState<HostelOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editing, setEditing] = useState<StaffAccount | null>(null);
  const [resettingPasswordFor, setResettingPasswordFor] = useState<StaffAccount | null>(null);
  const [newPassword, setNewPassword] = useState('');

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'WARDEN' | 'GUARD'>('WARDEN');
  const [hostelId, setHostelId] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [staffRes, hostelRes] = await Promise.all([
        staffApi.listStaff(),
        residentsApi.listHostels(),
      ]);
      setStaff(staffRes.data || []);
      setHostels(hostelRes.data || []);
      setHostelId((current) => current || hostelRes.data?.[0]?.id || '');
    } catch (err: any) {
      toastError(err.message || 'Unable to load staff accounts');
    } finally {
      setIsLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const hostelOptions = useMemo(
    () => hostels.map((h) => ({ value: h.id, label: `${h.name} (${h.code})` })),
    [hostels]
  );

  const resetForm = () => {
    setFullName('');
    setUsername('');
    setEmail('');
    setPassword('');
    setRole('WARDEN');
    setHostelId(hostels[0]?.id || '');
    setFormError(null);
  };

  const openEdit = (member: StaffAccount) => {
    setEditing(member);
    setFullName(member.fullName);
    setEmail(member.email || '');
    setRole(member.role as 'WARDEN' | 'GUARD');
    setHostelId(member.hostelId || hostels[0]?.id || '');
    setFormError(null);
  };

  const handleUpdate = async () => {
    if (!editing) return;
    if (!fullName.trim() || !hostelId) {
      setFormError('Name and hostel are required.');
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await staffApi.updateStaff(editing.id, {
        fullName: fullName.trim(),
        email: email.trim() || undefined,
        role,
        hostelId,
      });
      setEditing(null);
      resetForm();
      await fetchData();
      success('Staff account updated successfully.');
    } catch (err: any) {
      setFormError(err.message || 'Unable to update staff account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async (member: StaffAccount) => {
    const nextStatus = member.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    try {
      await staffApi.updateStaff(member.id, { status: nextStatus });
      await fetchData();
      success(`${member.fullName} is now ${nextStatus === 'ACTIVE' ? 'active' : 'inactive'}.`);
    } catch (err: any) {
      toastError(err.message || 'Unable to update staff status.');
    }
  };

  const handleResetPassword = async () => {
    if (!resettingPasswordFor) return;
    if (newPassword.length < 8) {
      setFormError('Temporary password must be at least 8 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await staffApi.resetPassword(resettingPasswordFor.id, newPassword);
      success(`Temporary password updated for ${resettingPasswordFor.fullName}.`);
      setResettingPasswordFor(null);
      setNewPassword('');
    } catch (err: any) {
      setFormError(err.message || 'Unable to reset password.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!fullName.trim() || !username.trim() || !password || !hostelId) {
      setFormError('Name, username, password, and hostel are required.');
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await staffApi.createStaff({
        fullName: fullName.trim(),
        username: username.trim(),
        email: email.trim() || undefined,
        password,
        role,
        hostelId,
      });
      setIsCreateOpen(false);
      resetForm();
      await fetchData();
      success('Staff account created successfully.');
    } catch (err: any) {
      setFormError(err.message || 'Unable to create staff account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="staff-page">
      <PageHeader
        title="Staff"
        subtitle="Create Warden and Guard accounts, assign hostels, and manage staff access."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={fetchData}
              isLoading={isLoading}
              leftIcon={<RefreshCw size={16} />}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              onClick={() => setIsCreateOpen(true)}
              leftIcon={<Plus size={16} />}
            >
              Add Staff
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <span className="text-sm text-slate-500">Total staff</span>
          <div className="text-3xl font-bold text-slate-900 mt-1">{staff.length}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <span className="text-sm text-slate-500">Wardens</span>
          <div className="text-3xl font-bold text-slate-900 mt-1">
            {staff.filter((s) => s.role === 'WARDEN').length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <span className="text-sm text-slate-500">Guards</span>
          <div className="text-3xl font-bold text-slate-900 mt-1">
            {staff.filter((s) => s.role === 'GUARD').length}
          </div>
        </div>
      </div>

      <div className="table-container bg-white border border-slate-200 rounded-xl shadow-sm overflow-x-auto">
        {isLoading ? (
          <div className="p-8 text-center text-slate-500">Loading staff accounts...</div>
        ) : staff.length === 0 ? (
          <div className="p-10 text-center">
            <Users size={34} className="text-slate-400 mx-auto mb-3" />
            <h3 className="text-lg font-bold text-slate-900">No staff accounts yet</h3>
            <p className="text-sm text-slate-500 mt-1">Add a Warden or Guard to get started.</p>
          </div>
        ) : (
          <table className="data-table w-full">
            <thead>
              <tr>
                <th>Staff Member</th>
                <th>Role</th>
                <th>Hostel</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {staff.map((member) => (
                <tr key={member.id}>
                  <td>
                    <div className="font-semibold text-slate-900">{member.fullName}</div>
                    <div className="text-sm text-slate-500 mt-0.5">
                      @{member.username}{member.email ? ` • ${member.email}` : ''}
                    </div>
                  </td>
                  <td>
                    <Badge type="role" value={member.role} />
                  </td>
                  <td className="text-slate-700">
                    {member.hostel?.name || 'All hostels'}
                  </td>
                  <td>
                    <Badge type="status" value={member.status} />
                  </td>
                  <td className="text-right">
                    <div className="staff-row-actions">
                      <Button variant="outline" size="sm" onClick={() => openEdit(member)} leftIcon={<Edit2 size={14} />}>
                        Edit
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => {
                        setResettingPasswordFor(member);
                        setNewPassword('');
                        setFormError(null);
                      }} leftIcon={<KeyRound size={14} />}>
                        Reset Password
                      </Button>
                      <Button
                        variant={member.status === 'ACTIVE' ? 'ghost' : 'secondary'}
                        size="sm"
                        onClick={() => handleStatusChange(member)}
                      >
                        {member.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal
        isOpen={!!editing}
        onClose={() => !isSubmitting && setEditing(null)}
        title="Edit Staff Member"
        subtitle={editing ? `@${editing.username}` : undefined}
        size="md"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="outline" onClick={() => {
              setEditing(null);
              resetForm();
            }} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleUpdate} isLoading={isSubmitting}>
              Save Changes
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <Input
            label="Email (Optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'WARDEN' | 'GUARD')}
            options={[
              { value: 'WARDEN', label: 'Warden' },
              { value: 'GUARD', label: 'Guard' },
            ]}
            required
          />
          <Select
            label="Hostel"
            value={hostelId}
            onChange={(e) => setHostelId(e.target.value)}
            options={hostelOptions}
            required
          />
        </div>
        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!resettingPasswordFor}
        onClose={() => !isSubmitting && setResettingPasswordFor(null)}
        title="Reset Temporary Password"
        subtitle={resettingPasswordFor ? resettingPasswordFor.fullName : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="outline" onClick={() => setResettingPasswordFor(null)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleResetPassword} isLoading={isSubmitting}>
              Update Password
            </Button>
          </div>
        }
      >
        <Input
          label="New Temporary Password"
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          placeholder="Minimum 8 characters"
          hint="Share this temporary password securely with the staff member."
          required
        />
        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={isCreateOpen}
        onClose={() => !isSubmitting && setIsCreateOpen(false)}
        title="Add Staff Member"
        subtitle="Create a Warden or Guard account for a hostel."
        size="md"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button
              variant="outline"
              onClick={() => {
                setIsCreateOpen(false);
                resetForm();
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleCreate}
              isLoading={isSubmitting}
              leftIcon={<ShieldCheck size={16} />}
            >
              Create Account
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Enter staff member name"
            required
          />
          <Input
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Choose a username"
            required
          />
          <Input
            label="Email (Optional)"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@example.com"
          />
          <Input
            label="Temporary Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
            required
          />
          <Select
            label="Role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'WARDEN' | 'GUARD')}
            options={[
              { value: 'WARDEN', label: 'Warden' },
              { value: 'GUARD', label: 'Guard' },
            ]}
            required
          />
          <Select
            label="Hostel"
            value={hostelId}
            onChange={(e) => setHostelId(e.target.value)}
            options={hostelOptions}
            required
          />
        </div>

        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 mt-2">
          Wardens can manage residents and reports. Guards are limited to the Gate workflow.
        </div>

        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 mt-3">
            {formError}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default StaffPage;
