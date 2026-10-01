import React from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { SafeResident } from '../../types/resident.types';
import { residentsApi } from '../../api/residents.api';
import {
  Edit2,
  UserMinus,
  UserCheck,
  Eye,
  UserX,
  ScanFace,
  PlusCircle,
  User as UserIcon,
} from 'lucide-react';

interface ResidentListTableProps {
  residents: SafeResident[];
  isLoading: boolean;
  onSelect: (resident: SafeResident) => void;
  onEdit: (resident: SafeResident) => void;
  onDeactivate: (resident: SafeResident) => void;
  onReactivate: (resident: SafeResident) => void;
  onEnrollFace?: (resident: SafeResident) => void;
  canManage: boolean;
  hasActiveFilters: boolean;
  onOpenAdd?: () => void;
}

export const ResidentListTable: React.FC<ResidentListTableProps> = ({
  residents,
  isLoading,
  onSelect,
  onEdit,
  onDeactivate,
  onReactivate,
  onEnrollFace,
  canManage,
  hasActiveFilters,
  onOpenAdd,
}) => {
  if (isLoading) {
    return (
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th className="w-12">Photo</th>
              <th>Full Name</th>
              <th>Resident Code</th>
              <th>Room / Group</th>
              <th>Presence</th>
              <th>Face Biometrics</th>
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...Array(6)].map((_, i) => (
              <tr key={i} className="skeleton-row">
                <td><span className="skeleton-cell w-9 h-9 rounded-full" /></td>
                <td><span className="skeleton-cell w-36" /></td>
                <td><span className="skeleton-cell w-20" /></td>
                <td><span className="skeleton-cell w-24" /></td>
                <td><span className="skeleton-cell w-20" /></td>
                <td><span className="skeleton-cell w-28" /></td>
                <td><span className="skeleton-cell w-16" /></td>
                <td className="text-right"><span className="skeleton-cell w-24 ml-auto" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (residents.length === 0) {
    return (
      <div className="table-empty-state">
        <div className="empty-state-icon">
          <UserX size={44} />
        </div>
        <h3 className="empty-state-title">
          {hasActiveFilters ? 'No matching residents found' : 'No residents registered in facility'}
        </h3>
        <p className="empty-state-text">
          {hasActiveFilters
            ? 'Try adjusting your search criteria or resetting filters to view all residents.'
            : 'Get started by creating the first resident profile in this hostel.'}
        </p>
        {!hasActiveFilters && canManage && onOpenAdd && (
          <div className="empty-state-action mt-4">
            <Button
              variant="primary"
              size="md"
              onClick={onOpenAdd}
              leftIcon={<PlusCircle size={16} />}
            >
              Add Your First Resident
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="table-container">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="w-12">Photo</th>
            <th scope="col">Full Name</th>
            <th scope="col">Resident Code</th>
            <th scope="col">Room / Group</th>
            <th scope="col">Presence</th>
            <th scope="col">Face Biometrics</th>
            <th scope="col">Status</th>
            <th scope="col" className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {residents.map((resident) => {
            return (
              <tr
                key={resident.id}
                className="table-row-interactive"
                onClick={() => onSelect(resident)}
              >
                {/* Photo Thumbnail */}
                <td className="py-2" onClick={(e) => e.stopPropagation()}>
                  <div className="w-9 h-9 rounded-full overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                    <img
                      src={typeof residentsApi.getProfilePhotoUrl === 'function' ? residentsApi.getProfilePhotoUrl(resident.id) : `/api/v1/residents/${resident.id}/profile-photo`}
                      alt={resident.fullName}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                    <UserIcon size={16} className="text-slate-400" />
                  </div>
                </td>

                {/* Full Name */}
                <td className="font-semibold text-slate-900 dark:text-white">
                  <button
                    type="button"
                    className="table-link-btn font-semibold text-left"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(resident);
                    }}
                  >
                    {resident.fullName}
                  </button>
                </td>

                {/* Resident Code */}
                <td className="font-mono font-medium text-primary">
                  {resident.residentCode}
                </td>

                {/* Room / Group */}
                <td className="text-secondary">{resident.roomGroup}</td>

                {/* Current Presence Status */}
                <td>
                  <Badge
                    type="presence"
                    value={resident.presence?.currentState || 'OUT'}
                  />
                </td>

                {/* Face Enrollment */}
                <td>
                  <Badge
                    type="enrollment"
                    value={resident.faceEnrollmentStatus}
                  />
                </td>

                {/* Account / Resident Status */}
                <td>
                  <Badge
                    type="status"
                    value={resident.status}
                  />
                </td>

                {/* Actions */}
                <td
                  className="table-actions-cell text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="table-actions-group flex items-center justify-end gap-1">
                    <button
                      type="button"
                      className="btn-icon-table"
                      title="View Profile Details"
                      onClick={() => onSelect(resident)}
                      aria-label={`View details for ${resident.fullName}`}
                    >
                      <Eye size={15} />
                    </button>

                    {/* Management controls ONLY for Admin / Warden */}
                    {canManage && (
                      <>
                        <button
                          type="button"
                          className="btn-icon-table"
                          title="Edit Resident"
                          onClick={() => onEdit(resident)}
                          aria-label={`Edit ${resident.fullName}`}
                        >
                          <Edit2 size={15} />
                        </button>

                        <button
                          type="button"
                          className="btn-icon-table text-purple-600 hover:text-purple-700"
                          title="Enroll Face Biometrics"
                          onClick={() => onEnrollFace?.(resident)}
                          aria-label={`Enroll face for ${resident.fullName}`}
                        >
                          <ScanFace size={15} />
                        </button>

                        {resident.status === 'ACTIVE' ? (
                          <button
                            type="button"
                            className="btn-icon-table btn-icon-danger"
                            title="Deactivate Resident"
                            onClick={() => onDeactivate(resident)}
                            aria-label={`Deactivate ${resident.fullName}`}
                          >
                            <UserMinus size={15} />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn-icon-table btn-icon-success"
                            title="Reactivate Resident"
                            onClick={() => onReactivate(resident)}
                            aria-label={`Reactivate ${resident.fullName}`}
                          >
                            <UserCheck size={15} />
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default ResidentListTable;
