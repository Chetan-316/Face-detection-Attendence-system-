import React, { useCallback, useEffect, useState } from 'react';
import { facilitiesApi, Facility, FacilityLocation } from '../api/facilities.api';
import { useAuth } from '../auth/AuthContext';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Modal } from '../components/Modal';
import { Input } from '../components/Input';
import { Badge } from '../components/Badge';
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
      toastError(err.message || 'Unable to load hostels');
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

  const handleLocationStatus = async (location: FacilityLocation) => {
    if (!locationFacility) return;
    try {
      await facilitiesApi.updateLocation(locationFacility.id, location.id, {
        isActive: !location.isActive,
      });
      const res = await facilitiesApi.listLocations(locationFacility.id);
      setLocations(res.data || []);
      success(`${location.name} ${location.isActive ? 'deactivated' : 'reactivated'}.`);
    } catch (err: any) {
      setLocationError(err.message || 'Unable to update location.');
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
        subtitle="Create hostels, set return deadlines, and manage gates and locations."
        actions={
          <div className="page-header-actions">
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

      <div className="metric-grid metric-grid-3">
        <div className="metric-card">
          <span className="metric-label">Active hostels</span>
          <strong className="metric-value">{activeCount}</strong>
          <span className="metric-support">Currently available for residents and staff</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Residents</span>
          <strong className="metric-value">{residentCount}</strong>
          <span className="metric-support">Across all configured hostels</span>
        </div>
        <div className="metric-card">
          <span className="metric-label">Staff</span>
          <strong className="metric-value">{staffCount}</strong>
          <span className="metric-support">Wardens and guards assigned to hostels</span>
        </div>
      </div>

      {isLoading ? (
        <div className="card state-panel" role="status">
          <span className="spinner-inline" aria-hidden="true" />
          <p className="state-panel-text">Loading hostels...</p>
        </div>
      ) : facilities.length === 0 ? (
        <div className="card state-panel">
          <span className="state-panel-icon" aria-hidden="true">
            <Building2 size={38} />
          </span>
          <h3 className="state-panel-title">No hostels yet</h3>
          <p className="state-panel-text">
            Add the first hostel before creating staff, cameras, or residents.
          </p>
        </div>
      ) : (
        <div className="hostel-grid">
          {facilities.map((facility) => (
            <article key={facility.id} className="hostel-card">
              <header className="hostel-card-header">
                <div className="min-w-0">
                  <h3 className="hostel-card-title">{facility.name}</h3>
                  <span className="hostel-card-code">{facility.code}</span>
                </div>
                <Badge type="status" value={facility.isActive ? 'ACTIVE' : 'INACTIVE'} />
              </header>

              <div className="hostel-card-deadline">
                <span className="font-medium">Return deadline</span>
                <span className="font-semibold">
                  {new Date(`1970-01-01T${minutesToTime(facility.returnDeadlineMinutes)}:00`).toLocaleTimeString([], {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </span>
              </div>

              <div className="hostel-card-stats">
                <div className="hostel-stat">
                  <span className="hostel-stat-label">
                    <Users size={14} aria-hidden="true" />
                    Residents
                  </span>
                  <span className="hostel-stat-value">{facility.residentCount || 0}</span>
                </div>
                <div className="hostel-stat">
                  <span className="hostel-stat-label">
                    <Shield size={14} aria-hidden="true" />
                    Staff
                  </span>
                  <span className="hostel-stat-value">{facility.staffCount || 0}</span>
                </div>
                <div className="hostel-stat">
                  <span className="hostel-stat-label">
                    <Camera size={14} aria-hidden="true" />
                    Cameras
                  </span>
                  <span className="hostel-stat-value">{facility.cameraCount || 0}</span>
                </div>
              </div>

              <div className="hostel-card-actions">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openLocations(facility)}
                  className="hostel-card-wide"
                  leftIcon={<MapPin size={14} />}
                >
                  Gates & Locations
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openEdit(facility)}
                  className="hostel-card-action"
                >
                  Edit Hostel
                </Button>
                <Button
                  variant={facility.isActive ? 'ghost' : 'secondary'}
                  size="sm"
                  onClick={() => setStatusFacility(facility)}
                  className="hostel-card-action"
                >
                  {facility.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </div>
            </article>
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
          <div className="modal-actions-bar">
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
          <div className="alert-banner alert-banner-error" role="alert">
            {formError}
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!locationFacility}
        onClose={() => !isSubmitting && setLocationFacility(null)}
        title="Gates & Locations"
        subtitle={locationFacility ? locationFacility.name : undefined}
        size="lg"
        footer={
          <div className="modal-actions-bar">
            <Button variant="outline" onClick={() => setLocationFacility(null)} disabled={isSubmitting}>
              Close
            </Button>
          </div>
        }
      >
        <div className="hostel-locations-layout">
          <section>
            <h3 className="section-heading">Configured Locations</h3>
            {isLoadingLocations ? (
              <div className="state-panel" role="status">
                <span className="spinner-inline" aria-hidden="true" />
                <p className="state-panel-text">Loading locations...</p>
              </div>
            ) : locations.length === 0 ? (
              <div className="state-panel state-panel-compact">
                <p className="state-panel-text">No gates or locations have been configured yet.</p>
              </div>
            ) : (
              <ul className="location-list">
                {locations.map((location) => (
                  <li key={location.id} className="location-row">
                    <div className="min-w-0">
                      <div className="location-name">{location.name}</div>
                      <div className="location-type">
                        {location.code} • {location.locationType.replaceAll('_', ' ')}
                      </div>
                    </div>
                    <Button
                      variant={location.isActive ? 'ghost' : 'secondary'}
                      size="sm"
                      onClick={() => handleLocationStatus(location)}
                    >
                      {location.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h3 className="section-heading">Add Gate / Location</h3>
            <div className="location-add-panel">
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
                <div className="alert-banner alert-banner-error location-add-alert" role="alert">
                  {locationError}
                </div>
              )}

              <Button
                variant="primary"
                onClick={handleCreateLocation}
                isLoading={isSubmitting}
                className="location-add-submit"
                leftIcon={<Plus size={15} />}
              >
                Add Location
              </Button>
            </div>
          </section>
        </div>
      </Modal>

      <Modal
        isOpen={!!statusFacility}
        onClose={() => !isSubmitting && setStatusFacility(null)}
        title={statusFacility?.isActive ? 'Deactivate Hostel' : 'Reactivate Hostel'}
        subtitle={statusFacility?.name}
        size="sm"
        footer={
          <div className="modal-actions-bar">
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
        <div className={`alert-banner ${statusFacility?.isActive ? 'alert-banner-warning' : 'alert-banner-info'}`}>
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
          <div className="modal-actions-bar">
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
          <div className="alert-banner alert-banner-error" role="alert">
            {formError}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default FacilitiesPage;
