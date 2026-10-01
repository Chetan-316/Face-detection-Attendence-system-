import React, { useState, useEffect, useCallback } from 'react';
import { residentsApi } from '../api/residents.api';
import {
  SafeResident,
  ResidentStatus,
  PresenceState,
  FaceEnrollmentStatus,
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
import { ResidentEditModal } from '../features/residents/ResidentEditModal';
import { ResidentDeactivateModal } from '../features/residents/ResidentDeactivateModal';
import { ResidentReactivateModal } from '../features/residents/ResidentReactivateModal';
import { ResidentDetailModal } from '../features/residents/ResidentDetailModal';
import { FaceEnrollmentModal } from '../features/residents/FaceEnrollmentModal';
import { FaceRevokeModal } from '../features/residents/FaceRevokeModal';
import { Plus, RefreshCw, AlertCircle } from 'lucide-react';

export const ResidentsPage: React.FC = () => {
  const { user } = useAuth();
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

  // Filter & Search state
  const [searchInput, setSearchInput] = useState('');
  const [statusFilter, setStatusFilter] = useState<ResidentStatus | ''>('');
  const [presenceFilter, setPresenceFilter] = useState<PresenceState | ''>('');
  const [faceStatusFilter, setFaceStatusFilter] = useState<FaceEnrollmentStatus | ''>('');
  const [roomGroupFilter, setRoomGroupFilter] = useState('');

  // Debounced search term (300ms)
  const debouncedSearch = useDebounce(searchInput, 300);
  const debouncedRoomGroup = useDebounce(roomGroupFilter, 300);

  // Modals state
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedResident, setSelectedResident] = useState<SafeResident | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [isReactivateOpen, setIsReactivateOpen] = useState(false);
  const [isFaceEnrollOpen, setIsFaceEnrollOpen] = useState(false);
  const [isFaceRevokeOpen, setIsFaceRevokeOpen] = useState(false);

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
      });

      setResidents(response.data);
      setTotalItems(response.pagination.total);
      setTotalPages(response.pagination.totalPages);
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
    setPage(1);
  };

  const isFiltered = Boolean(
    searchInput.trim() ||
      statusFilter ||
      presenceFilter ||
      faceStatusFilter ||
      roomGroupFilter.trim()
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
        subtitle="Manage resident roster, room allocation, presence, and face enrollment."
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
            setSelectedResident(resident);
            setIsDetailOpen(true);
          }}
          onEdit={(resident: SafeResident) => {
            setSelectedResident(resident);
            setIsEditOpen(true);
          }}
          onDeactivate={(resident: SafeResident) => {
            setSelectedResident(resident);
            setIsDeactivateOpen(true);
          }}
          onReactivate={(resident: SafeResident) => {
            setSelectedResident(resident);
            setIsReactivateOpen(true);
          }}
          onEnrollFace={(resident: SafeResident) => {
            setSelectedResident(resident);
            setIsFaceEnrollOpen(true);
          }}
          canManage={canManage}
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

      {/* Edit Resident Modal */}
      {canManage && (
        <ResidentEditModal
          isOpen={isEditOpen}
          resident={selectedResident}
          onClose={() => {
            setIsEditOpen(false);
          }}
          onResidentUpdated={handleResidentUpdated}
        />
      )}

      {/* Deactivate Confirmation Modal */}
      {canManage && (
        <ResidentDeactivateModal
          isOpen={isDeactivateOpen}
          resident={selectedResident}
          onClose={() => {
            setIsDeactivateOpen(false);
          }}
          onSuccess={handleResidentUpdated}
        />
      )}

      {/* Reactivate Confirmation Modal */}
      {canManage && (
        <ResidentReactivateModal
          isOpen={isReactivateOpen}
          resident={selectedResident}
          onClose={() => {
            setIsReactivateOpen(false);
          }}
          onSuccess={handleResidentUpdated}
        />
      )}

      {/* Detail Modal */}
      <ResidentDetailModal
        isOpen={isDetailOpen}
        resident={selectedResident}
        onClose={() => setIsDetailOpen(false)}
        onEdit={(r: SafeResident) => {
          setSelectedResident(r);
          setIsEditOpen(true);
        }}
        onDeactivate={(r: SafeResident) => {
          setSelectedResident(r);
          setIsDeactivateOpen(true);
        }}
        onReactivate={(r: SafeResident) => {
          setSelectedResident(r);
          setIsReactivateOpen(true);
        }}
        onEnrollFace={(r: SafeResident) => {
          setSelectedResident(r);
          setIsFaceEnrollOpen(true);
        }}
        onRevokeFace={(r: SafeResident) => {
          setSelectedResident(r);
          setIsFaceRevokeOpen(true);
        }}
      />

      {/* Face Enrollment Modal */}
      {canManage && (
        <FaceEnrollmentModal
          isOpen={isFaceEnrollOpen}
          resident={selectedResident}
          onClose={() => setIsFaceEnrollOpen(false)}
          onSuccess={handleResidentUpdated}
        />
      )}

      {/* Face Revoke Modal */}
      {canManage && (
        <FaceRevokeModal
          isOpen={isFaceRevokeOpen}
          resident={selectedResident}
          onClose={() => setIsFaceRevokeOpen(false)}
          onSuccess={handleResidentUpdated}
        />
      )}
    </div>
  );
};
