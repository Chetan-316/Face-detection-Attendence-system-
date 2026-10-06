import React, { useCallback, useEffect, useState } from 'react';
import { facilitiesApi, Facility, FacilityLocation } from '../api/facilities.api';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Input } from '../components/Input';
import { useToast } from '../components/ToastContext';
import { Building2, Camera, MapPin, Plus, RefreshCw, Shield, Users } from 'lucide-react';

export const FacilitiesPage: React.FC = () => {
  const { user } = useAuth();
  const { success, error: toastError } = useToast();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Facility | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusFacility, setStatusFacility] = useState<Facility | null>(null);
  const [locationFacility, setLocationFacility] = useState<Facility | null>(null);
  const [statusLocation, setStatusLocation] = useState<FacilityLocation | null>(null);
  const [locations, setLocations] = useState<FacilityLocation[]>([]);
  const [isLoadingLocations, setIsLoadingLocations] = useState(false);
  const [locationName, setLocationName] = useState('');
  const [locationCode, setLocationCode] = useState('');
  const [locationType, setLocationType] = useState<FacilityLocation['locationType']>('GATE');
  const [locationError, setLocationError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [returnDeadlineTime, setReturnDeadlineTime] = useState('21:00');


  const minutesToTime = (minutes = 1260) => {
    const safeMinutes = Math.min(Math.max(minutes, 0), 1439);
    const hours = Math.floor(safeMinutes / 60);
    const mins = safeMinutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
  };

  const timeToMinutes = (value: string) => {
    const [hours, minutes] = value.split(':').map(Number);
    return hours * 60 + minutes;
  };

  const fetchFacilities = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await facilitiesApi.listFacilities();
      setFacilities(res.data || []);
    } catch (err: any) {
      toastError(err.message || 'Unable to load facilities');
    } finally {
      setIsLoading(false);
    }
  }, [toastError]);

  useEffect(() => {
    fetchFacilities();
  }, [fetchFacilities]);

  const resetForm = () => {
    setName('');
    setCode('');
    setReturnDeadlineTime('21:00');
    setFormError(null);
  };

  const openEdit = (facility: Facility) => {
    setEditing(facility);
    setName(facility.name);
    setCode(facility.code);
    setReturnDeadlineTime(minutesToTime(facility.returnDeadlineMinutes));
    setFormError(null);
  };

  const handleCreate = async () => {
    if (!name.trim() || !code.trim()) {
      setFormError('Hostel name and code are required.');
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await facilitiesApi.createFacility({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        returnDeadlineMinutes: timeToMinutes(returnDeadlineTime),
      });
      setIsCreateOpen(false);
      resetForm();
      await fetchFacilities();
      success('Hostel created successfully.');
    } catch (err: any) {
      setFormError(err.message || 'Unable to create hostel.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleUpdate = async () => {
    if (!editing) return;
    if (!name.trim() || !code.trim()) {
      setFormError('Hostel name and code are required.');
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);
      await facilitiesApi.updateFacility(editing.id, {
        name: name.trim(),
        code: code.trim().toUpperCase(),
        returnDeadlineMinutes: timeToMinutes(returnDeadlineTime),
      });
      setEditing(null);
      resetForm();
      await fetchFacilities();
      success('Hostel updated successfully.');
    } catch (err: any) {
      setFormError(err.message || 'Unable to update hostel.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const openLocations = async (facility: Facility) => {
    setLocationFacility(facility);
    setIsLoadingLocations(true);
    setLocationError(null);
    try {
      const res = await facilitiesApi.listLocations(facility.id);
      setLocations(res.data || []);
    } catch (err: any) {
      setLocationError(err.message || 'Unable to load gate locations.');
    } finally {
      setIsLoadingLocations(false);
    }
  };

  const handleCreateLocation = async () => {
    if (!locationFacility) return;
    if (!locationName.trim() || !locationCode.trim()) {
      setLocationError('Location name and code are required.');
      return;
    }

    try {
      setIsSubmitting(true);
      setLocationError(null);
      await facilitiesApi.createLocation(locationFacility.id, {
        name: locationName.trim(),
        code: locationCode.trim().toUpperCase(),
        locationType,
      });
      setLocationName('');
      setLocationCode('');
      setLocationType('GATE');
      const res = await facilitiesApi.listLocations(locationFacility.id);
      setLocations(res.data || []);
      success('Gate / location added successfully.');
    } catch (err: any) {
      setLocationError(err.message || 'Unable to add gate / location.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleLocationStatus = async () => {
    if (!locationFacility || !statusLocation) return;
    try {
      setIsSubmitting(true);
      setLocationError(null);
      await facilitiesApi.updateLocation(locationFacility.id, statusLocation.id, {
        isActive: !statusLocation.isActive,
      });
      const res = await facilitiesApi.listLocations(locationFacility.id);
      setLocations(res.data || []);
      success(`${statusLocation.name} ${statusLocation.isActive ? 'deactivated' : 'reactivated'}.`);
      setStatusLocation(null);
    } catch (err: any) {
      setLocationError(err.message || 'Unable to update location.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = async () => {
    if (!statusFacility) return;

    const nextState = !statusFacility.isActive;
    const action = nextState ? 'reactivate' : 'deactivate';

    try {
      setIsSubmitting(true);
      await facilitiesApi.updateFacility(statusFacility.id, { isActive: nextState });
      setStatusFacility(null);
      await fetchFacilities();
      success(`Hostel ${action}d successfully.`);
    } catch (err: any) {
      toastError(err.message || `Unable to ${action} hostel.`);
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeCount = facilities.filter((facility) => facility.isActive).length;
  const residentCount = facilities.reduce((sum, facility) => sum + (facility.residentCount || 0), 0);
  const staffCount = facilities.reduce((sum, facility) => sum + (facility.staffCount || 0), 0);

  return (
    <div className="facilities-page">
      <PageHeader
        title="Hostels"
        subtitle="Create hostels, set return deadlines, and manage gates and locations from one place."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={fetchFacilities}
              isLoading={isLoading}
              leftIcon={<RefreshCw size={16} />}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                resetForm();
                setIsCreateOpen(true);
              }}
              leftIcon={<Plus size={16} />}
            >
              Add Hostel
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <span className="text-sm text-slate-500">Active hostels</span>
          <div className="text-3xl font-bold text-slate-900 mt-1">{activeCount}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <span className="text-sm text-slate-500">Residents</span>
          <div className="text-3xl font-bold text-slate-900 mt-1">{residentCount}</div>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
          <span className="text-sm text-slate-500">Staff</span>
          <div className="text-3xl font-bold text-slate-900 mt-1">{staffCount}</div>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-slate-500">
          Loading hostels...
        </div>
      ) : facilities.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-10 text-center">
          <Building2 size={38} className="text-slate-400 mx-auto mb-3" />
          <h3 className="text-lg font-bold text-slate-900">No hostels yet</h3>
          <p className="text-sm text-slate-500 mt-1">
            Add the first hostel before creating staff, cameras, or residents.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {facilities.map((facility) => (
            <div
              key={facility.id}
              className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm flex flex-col gap-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-lg font-bold text-slate-900 truncate">{facility.name}</h3>
                  <span className="text-sm font-mono text-blue-700">{facility.code}</span>
                </div>
                <span
                  className={`inline-flex px-2.5 py-1 rounded-md text-xs font-semibold border ${
                    facility.isActive
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-slate-50 text-slate-600 border-slate-200'
                  }`}
                >
                  {facility.isActive ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 flex items-center justify-between text-sm">
                <span className="text-blue-800 font-medium">Return deadline</span>
                <span className="font-bold text-blue-900">
                  {new Date(`1970-01-01T${minutesToTime(facility.returnDeadlineMinutes)}:00`).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div className="rounded-lg bg-slate-50 p-3">
                  <Users size={16} className="text-slate-500 mb-1.5" />
                  <div className="font-bold text-slate-900">{facility.residentCount || 0}</div>
                  <div className="text-xs text-slate-500">Residents</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <Shield size={16} className="text-slate-500 mb-1.5" />
                  <div className="font-bold text-slate-900">{facility.staffCount || 0}</div>
                  <div className="text-xs text-slate-500">Staff</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <Camera size={16} className="text-slate-500 mb-1.5" />
                  <div className="font-bold text-slate-900">{facility.cameraCount || 0}</div>
                  <div className="text-xs text-slate-500">Cameras</div>
                </div>
              </div>

              <div className="pt-1 space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openLocations(facility)}
                  className="w-full justify-center"
                  leftIcon={<MapPin size={14} />}
                >
                  Gates & Locations
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openEdit(facility)}
                    className="w-full justify-center"
                  >
                    Edit Hostel
                  </Button>
                  <Button
                    variant={facility.isActive ? 'ghost' : 'secondary'}
                    size="sm"
                    onClick={() => setStatusFacility(facility)}
                    className="w-full justify-center"
                  >
                    {facility.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        isOpen={isCreateOpen}
        onClose={() => !isSubmitting && setIsCreateOpen(false)}
        title="Add Hostel"
        subtitle="Create a new hostel and set its default return deadline."
        size="sm"
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
            <Button variant="primary" onClick={handleCreate} isLoading={isSubmitting}>
              Create Hostel
            </Button>
          </div>
        }
      >
        <Input
          label="Hostel Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Example: Girls Hostel A"
          required
        />
        <Input
          label="Hostel Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          placeholder="Example: GHA"
          hint="Use a short unique code, for example GHA or BOYS-A."
          required
        />
        <Input
          label="Return Deadline"
          type="time"
          value={returnDeadlineTime}
          onChange={(e) => setReturnDeadlineTime(e.target.value)}
          hint="Residents still outside after this time appear as Not Returned."
          required
        />
        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!locationFacility}
        onClose={() => {
          if (!isSubmitting) {
            setStatusLocation(null);
            setLocationFacility(null);
          }
        }}
        title="Gates & Locations"
        subtitle={locationFacility ? locationFacility.name : undefined}
        size="lg"
        footer={
          <div className="flex justify-end w-full">
            <Button variant="outline" onClick={() => setLocationFacility(null)} disabled={isSubmitting}>
              Close
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div>
            <h3 className="text-base font-bold text-slate-900 mb-3">Configured Locations</h3>
            {statusLocation && (
              <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <div className="text-sm font-semibold text-amber-900">
                  {statusLocation.isActive ? 'Deactivate' : 'Reactivate'} {statusLocation.name}?
                </div>
                <p className="text-sm text-amber-800 mt-1">
                  {statusLocation.isActive
                    ? 'Cameras assigned to this location must be disabled or reassigned before it can be deactivated.'
                    : 'This location will become available again for camera assignment.'}
                </p>
                <div className="flex items-center gap-2 mt-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setStatusLocation(null)}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant={statusLocation.isActive ? 'danger' : 'primary'}
                    size="sm"
                    onClick={handleLocationStatus}
                    isLoading={isSubmitting}
                  >
                    {statusLocation.isActive ? 'Deactivate' : 'Reactivate'}
                  </Button>
                </div>
              </div>
            )}
            {isLoadingLocations ? (
              <div className="text-sm text-slate-500 py-4">Loading locations...</div>
            ) : locations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-500">
                No gates or locations have been configured yet.
              </div>
            ) : (
              <div className="space-y-2">
                {locations.map((location) => (
                  <div
                    key={location.id}
                    className="rounded-lg border border-slate-200 bg-white p-3 flex items-center justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-900">{location.name}</div>
                      <div className="text-xs text-slate-500 mt-0.5">
                        {location.code} • {location.locationType.replaceAll('_', ' ')}
                      </div>
                    </div>
                    <Button
                      variant={location.isActive ? 'ghost' : 'secondary'}
                      size="sm"
                      onClick={() => setStatusLocation(location)}
                    >
                      {location.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
            <h3 className="text-base font-bold text-slate-900 mb-3">Add Gate / Location</h3>
            <Input
              label="Name"
              value={locationName}
              onChange={(e) => setLocationName(e.target.value)}
              placeholder="Example: Main Gate"
            />
            <Input
              label="Code"
              value={locationCode}
              onChange={(e) => setLocationCode(e.target.value.toUpperCase())}
              placeholder="Example: MAIN-GATE"
            />
            <div className="form-group">
              <label className="form-label" htmlFor="location-type">Type</label>
              <select
                id="location-type"
                className="form-select"
                value={locationType}
                onChange={(e) => setLocationType(e.target.value as FacilityLocation['locationType'])}
              >
                <option value="GATE">Gate</option>
                <option value="ENTRANCE">Entrance</option>
                <option value="COMMON_AREA">Common Area</option>
              </select>
            </div>

            {locationError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 mb-3">
                {locationError}
              </div>
            )}

            <Button
              variant="primary"
              onClick={handleCreateLocation}
              isLoading={isSubmitting}
              className="w-full justify-center"
              leftIcon={<Plus size={15} />}
            >
              Add Location
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={!!statusFacility}
        onClose={() => !isSubmitting && setStatusFacility(null)}
        title={statusFacility?.isActive ? 'Deactivate Hostel' : 'Reactivate Hostel'}
        subtitle={statusFacility?.name}
        size="sm"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button
              variant="outline"
              onClick={() => setStatusFacility(null)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              variant={statusFacility?.isActive ? 'danger' : 'primary'}
              onClick={handleStatusChange}
              isLoading={isSubmitting}
            >
              {statusFacility?.isActive ? 'Deactivate Hostel' : 'Reactivate Hostel'}
            </Button>
          </div>
        }
      >
        <div className={`rounded-lg border px-4 py-3 text-sm ${
          statusFacility?.isActive
            ? 'border-amber-200 bg-amber-50 text-amber-900'
            : 'border-blue-200 bg-blue-50 text-blue-900'
        }`}>
          {statusFacility?.isActive
            ? 'A hostel can be deactivated only after active residents and staff are moved or deactivated and enabled cameras are handled.'
            : 'Reactivating this hostel makes it available again for resident, staff, and camera assignment.'}
        </div>
      </Modal>

      <Modal
        isOpen={!!editing}
        onClose={() => !isSubmitting && setEditing(null)}
        title="Edit Hostel"
        subtitle={editing ? `${editing.name} • ${editing.code}` : undefined}
        size="sm"
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button
              variant="outline"
              onClick={() => {
                setEditing(null);
                resetForm();
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button variant="primary" onClick={handleUpdate} isLoading={isSubmitting}>
              Save Changes
            </Button>
          </div>
        }
      >
        <Input
          label="Hostel Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <Input
          label="Hostel Code"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          required
        />
        <Input
          label="Return Deadline"
          type="time"
          value={returnDeadlineTime}
          onChange={(e) => setReturnDeadlineTime(e.target.value)}
          hint="Used by the automatic return-status dashboard."
          required
        />
        {formError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {formError}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default FacilitiesPage;
