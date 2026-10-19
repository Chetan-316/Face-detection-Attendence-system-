import React from 'react';
import { Badge } from '../../components/Badge';
import { SafeResident } from '../../types/resident.types';
import { residentsApi } from '../../api/residents.api';
import { AuthenticatedImage } from '../../components/AuthenticatedImage';
import { UserX, PlusCircle, User as UserIcon } from 'lucide-react';
import { Button } from '../../components/Button';

interface ResidentListTableProps {
  residents: SafeResident[];
  isLoading: boolean;
  onSelect: (resident: SafeResident) => void;
  onEnrollFace?: (resident: SafeResident) => void;
  canManage: boolean;
  canOpenProfile?: boolean;
  hasActiveFilters: boolean;
  onOpenAdd?: () => void;
}

// Fixed column widths keep every row aligned and the table inside 1366px.
// The Resident column (no width) takes the remaining space.
const COLUMNS = (
  <colgroup>
    <col />
    <col style={{ width: 120 }} />
    <col style={{ width: 116 }} />
    <col style={{ width: 200 }} />
    <col style={{ width: 124 }} />
    <col style={{ width: 256 }} />
  </colgroup>
);

const HEADERS = (
  <tr>
    <th scope="col">Resident</th>
    <th scope="col">Room</th>
    <th scope="col">Presence</th>
    <th scope="col">Face</th>
    <th scope="col">Status</th>
    <th scope="col" className="col-actions">Actions</th>
  </tr>
);

export const ResidentListTable: React.FC<ResidentListTableProps> = ({
  residents,
  isLoading,
  onSelect,
  onEnrollFace,
  canManage,
  canOpenProfile = true,
  hasActiveFilters,
  onOpenAdd,
}) => {
  if (isLoading) {
    return (
      <div className="table-container">
        <table className="data-table residents-table" aria-label="Residents">
          {COLUMNS}
          <thead>{HEADERS}</thead>
          <tbody>
            {[...Array(6)].map((_, i) => (
              <tr key={i}>
                <td><span className="skeleton-cell w-36 h-5 rounded" /></td>
                <td><span className="skeleton-cell w-20 h-5 rounded" /></td>
                <td><span className="skeleton-cell w-20 h-5 rounded" /></td>
                <td><span className="skeleton-cell w-24 h-5 rounded" /></td>
                <td><span className="skeleton-cell w-16 h-5 rounded" /></td>
                <td className="col-actions"><span className="skeleton-cell w-16 h-5 rounded ml-auto" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (residents.length === 0) {
    return (
      <div className="table-empty-state bg-white border border-slate-200 rounded-xl p-12 text-center shadow-sm">
        <div className="w-14 h-14 rounded-full bg-slate-50 text-slate-400 flex items-center justify-center mx-auto mb-4 border border-slate-200">
          <UserX size={32} />
        </div>
        <h3 className="text-xl font-bold text-slate-900 mb-2">
          {hasActiveFilters ? 'No matching residents found' : 'No residents registered yet'}
        </h3>
        <p className="text-sm text-slate-500 max-w-sm mx-auto mb-6">
          {hasActiveFilters
            ? 'Try adjusting your search criteria or resetting filters to view all residents.'
            : 'Get started by creating the first resident profile in this hostel.'}
        </p>
        {!hasActiveFilters && canManage && onOpenAdd && (
          <Button
            variant="primary"
            size="md"
            className="h-11 px-6 font-semibold"
            onClick={onOpenAdd}
            leftIcon={<PlusCircle size={16} />}
          >
            Add Resident
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="table-container">
      <table className="data-table residents-table" aria-label="Residents">
        {COLUMNS}
        <thead>{HEADERS}</thead>
        <tbody>
          {residents.map((resident) => {
            const needsEnrollment =
              canManage &&
              resident.status === 'ACTIVE' &&
              resident.faceEnrollmentStatus !== 'ENROLLED' &&
              Boolean(onEnrollFace);

            return (
              <tr key={resident.id}>
                {/* Resident (photo, name, code) */}
                <td>
                  <div className="resident-cell">
                    <div className="resident-avatar">
                      <AuthenticatedImage
                        src={
                          typeof residentsApi.getProfilePhotoUrl === 'function'
                            ? residentsApi.getProfilePhotoUrl(resident.id)
                            : `/api/v1/residents/${resident.id}/profile-photo`
                        }
                        alt=""
                        className="resident-avatar-img"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <UserIcon size={18} aria-hidden="true" />
                    </div>

                    <div className="resident-text">
                      {canOpenProfile ? (
                        <button
                          type="button"
                          className="resident-name"
                          onClick={() => onSelect(resident)}
                        >
                          {resident.fullName}
                        </button>
                      ) : (
                        <span className="resident-name">{resident.fullName}</span>
                      )}
                      <span className="resident-code">{resident.residentCode}</span>
                    </div>
                  </div>
                </td>

                {/* Room */}
                <td>{resident.roomGroup}</td>

                {/* Presence */}
                <td>
                  <Badge type="presence" value={resident.presence?.currentState || 'OUT'} />
                </td>

                {/* Face enrollment */}
                <td>
                  <Badge type="enrollment" value={resident.faceEnrollmentStatus} />
                </td>

                {/* Account status */}
                <td>
                  <Badge type="status" value={resident.status} />
                </td>

                {/* Actions: at most one primary action per row */}
                <td className="col-actions">
                  <div className="resident-actions">
                    {canOpenProfile ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onSelect(resident)}
                        aria-label={`View details for ${resident.fullName}`}
                      >
                        Open Profile
                      </Button>
                    ) : (
                      <span className="resident-readonly">Read only</span>
                    )}

                    {needsEnrollment && onEnrollFace && (
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => onEnrollFace(resident)}
                        aria-label={`Enroll face for ${resident.fullName}`}
                      >
                        {resident.faceEnrollmentStatus === 'NEEDS_REENROLLMENT'
                          ? 'Re-enroll Face'
                          : 'Enroll Face'}
                      </Button>
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
