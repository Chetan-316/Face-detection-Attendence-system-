import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { residentsApi } from '../api/residents.api';
import {
  SafeResident,
  ResidentStatus,
  PresenceState,
  FaceEnrollmentStatus,
  ResidentSummary,
} from '../types/resident.types';
import { useAuth } from '../auth/AuthContext';
import { useDebounce } from '../hooks/useDebounce';
import { useToast } from '../components/ToastContext';
import { PageHeader } from '../components/PageHeader';
import { Button } from '../components/Button';
import { Pagination } from '../components/Pagination';
import { ResidentFilterBar } from '../features/residents/ResidentFilterBar';
import { ResidentListTable } from '../features/residents/ResidentListTable';
import { ResidentCreateModal } from '../features/residents/ResidentCreateModal';
import { FaceEnrollmentModal } from '../features/residents/FaceEnrollmentModal';
import { Plus, RefreshCw, AlertCircle } from 'lucide-react';

export const ResidentsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { error: toastError } = useToast();

  const canManage = user?.role === 'ADMIN' || user?.role === 'WARDEN';

  // Data state
  const [residents, setResidents] = useState<SafeResident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Pagination state
  const [page, setPage] = useState(1);
  const [pageSize] = useState(15);
  const [totalItems, setTotalItems] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [summary, setSummary] = useState<ResidentSummary | null>(null);

  // Filter & Search state
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<ResidentStatus | ''>('');
  const [presenceFilter, setPresenceFilter] = useState<PresenceState | ''>('');
  const [faceStatusFilter, setFaceStatusFilter] = useState<FaceEnrollmentStatus | ''>('');
  const [roomGroupFilter, setRoomGroupFilter] = useState('');
  const [hostelFilter, setHostelFilter] = useState('');
  const [hostels, setHostels] = useState<Array<{ id: string; code: string; name: string }>>([]);

  // Debounced search term (300ms)
  const debouncedSearch = useDebounce(searchInput, 300);
  const debouncedRoomGroup = useDebounce(roomGroupFilter, 300);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedResident, setSelectedResident] = useState<SafeResident | null>(null);
  const [isFaceEnrollOpen, setIsFaceEnrollOpen] = useState(false);

  useEffect(() => {
    if (user?.role !== 'ADMIN') return;
    residentsApi
      .listHostels()
      .then((res) => setHostels(res.data || []))
      .catch(() => setHostels([]));
  }, [user?.role]);

  // Fetch residents from real backend API
  const fetchResidents = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    try {
      const response = await residentsApi.listResidents({
        page,
        pageSize,
        search: debouncedSearch.trim() || undefined,
        status: statusFilter || undefined,
        presence: presenceFilter || undefined,
        faceEnrollmentStatus: faceStatusFilter || undefined,
        roomGroup: debouncedRoomGroup.trim() || undefined,
        hostelId: user?.role === 'ADMIN' ? hostelFilter || undefined : undefined,
      });

      setResidents(response.data);
      setTotalItems(response.pagination.total);
      setTotalPages(response.pagination.totalPages);

      if (user?.role === 'GUARD') {
        residentsApi.getSummary()
          .then(setSummary)
          .catch(() => setSummary(null));
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Unable to fetch resident records');
      toastError(err.message || 'Error communicating with resident service');
    } finally {
      setIsLoading(false);
    }
  }, [
    page,
    pageSize,
    debouncedSearch,
    statusFilter,
    presenceFilter,
    faceStatusFilter,
    debouncedRoomGroup,
    hostelFilter,
    user?.role,
    toastError,
  ]);

  // Refetch when filters or pagination change
  useEffect(() => {
    fetchResidents();
  }, [fetchResidents]);

  // Reset page to 1 when filters change
  const handleFilterChange = (setter: (val: any) => void) => (val: any) => {
    setPage(1);
    setter(val);
  };

  const handleResetFilters = () => {
    setSearchInput('');
    setStatusFilter('');
    setPresenceFilter('');
    setFaceStatusFilter('');
    setRoomGroupFilter('');
    setHostelFilter('');
    setPage(1);
  };

  const isFiltered = Boolean(
    searchInput.trim() ||
      statusFilter ||
      presenceFilter ||
      faceStatusFilter ||
      roomGroupFilter.trim() ||
      hostelFilter
  );

  // Callback after adding resident
  const handleResidentCreated = (newResident: SafeResident) => {
    setPage(1);
    fetchResidents();
  };

  // Callback after editing resident
  const handleResidentUpdated = (updatedResident: SafeResident) => {
    setResidents((prev) =>
      prev.map((r) => (r.id === updatedResident.id ? updatedResident : r))
    );
    if (selectedResident?.id === updatedResident.id) {
      setSelectedResident(updatedResident);
    }
  };

  return (
    <div className="residents-page">
      <PageHeader
        title="Residents"
        subtitle={
          user?.role === 'GUARD'
            ? 'Search your hostel directory and check who is currently inside or outside.'
            : 'Search residents, check current presence, and complete face enrollment.'
        }
        actions={
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="md"
              onClick={fetchResidents}
              isLoading={isLoading}
              leftIcon={<RefreshCw size={16} />}
            >
              Refresh
            </Button>

            {/* Add Resident Button ONLY visible to Admin / Warden */}
            {canManage && (
              <Button
                variant="primary"
                size="md"
                onClick={() => setIsCreateOpen(true)}
                leftIcon={<Plus size={18} />}
              >
                Add Resident
              </Button>
            )}
          </div>
        }
      />

      {user?.role === 'GUARD' && (
        <div className="metric-grid metric-grid-3 mb-4" aria-label="Resident presence summary">
          <div className="metric-card">
            <span className="metric-label">Total Residents</span>
            <strong className="metric-value">{summary?.total ?? totalItems}</strong>
            <span className="metric-support">Assigned to this hostel</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Inside Hostel</span>
            <strong className="metric-value">{summary?.currentlyIn ?? '—'}</strong>
            <span className="metric-support">Currently recorded inside</span>
          </div>
          <div className="metric-card">
            <span className="metric-label">Outside Hostel</span>
            <strong className="metric-value">{summary?.currentlyOut ?? '—'}</strong>
            <span className="metric-support">Currently recorded outside</span>
          </div>
        </div>
      )}

      {errorMessage && (
        <div className="alert-banner alert-banner-error mb-4" role="alert">
          <AlertCircle size={18} className="alert-icon" />
          <span>{errorMessage}</span>
          <Button size="sm" variant="outline" className="ml-auto" onClick={fetchResidents}>
            Retry
          </Button>
        </div>
      )}

      {/* Filter and Search Bar */}
      <ResidentFilterBar
        search={searchInput}
        onSearchChange={handleFilterChange(setSearchInput)}
        hostels={user?.role === 'ADMIN' ? hostels : []}
        hostelId={hostelFilter}
        onHostelChange={handleFilterChange(setHostelFilter)}
        status={statusFilter}
        onStatusChange={handleFilterChange(setStatusFilter)}
        presence={presenceFilter}
        onPresenceChange={handleFilterChange(setPresenceFilter)}
        faceEnrollmentStatus={faceStatusFilter}
        onFaceEnrollmentChange={handleFilterChange(setFaceStatusFilter)}
        roomGroup={roomGroupFilter}
        onRoomGroupChange={handleFilterChange(setRoomGroupFilter)}
        onReset={handleResetFilters}
        isFiltered={isFiltered}
      />

      {/* Residents Table */}
      <div className="mt-4">
        <ResidentListTable
          residents={residents}
          isLoading={isLoading}
          onSelect={(resident: SafeResident) => {
            if (canManage) {
              navigate(`/residents/${resident.id}`);
            }
          }}
          onEnrollFace={(resident: SafeResident) => {
            setSelectedResident(resident);
            setIsFaceEnrollOpen(true);
          }}
          canManage={canManage}
          canViewDetails={canManage}
          hasActiveFilters={isFiltered}
          onOpenAdd={() => setIsCreateOpen(true)}
        />
      </div>

      {/* Pagination Controls */}
      <Pagination
        currentPage={page}
        totalPages={totalPages}
        totalItems={totalItems}
        pageSize={pageSize}
        onPageChange={(newPage: number) => setPage(newPage)}
        isLoading={isLoading}
        itemLabel="residents"
      />

      {/* Add Resident Modal */}
      {canManage && (
        <ResidentCreateModal
          isOpen={isCreateOpen}
          onClose={() => setIsCreateOpen(false)}
          onResidentCreated={(newRes: SafeResident, shouldEnroll?: boolean) => {
            handleResidentCreated(newRes);
            if (shouldEnroll) {
              setSelectedResident(newRes);
              setIsFaceEnrollOpen(true);
            }
          }}
        />
      )}

      {/* Face Enrollment Modal */}
      {canManage && (
        <FaceEnrollmentModal
          isOpen={isFaceEnrollOpen}
          resident={selectedResident}
          onClose={() => setIsFaceEnrollOpen(false)}
          onSuccess={handleResidentUpdated}
        />
      )}

    </div>
  );
};
