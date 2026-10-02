import React from 'react';
import { Badge } from '../../components/Badge';
import { SafeResident } from '../../types/resident.types';
import { residentsApi } from '../../api/residents.api';
import {
  UserX,
  PlusCircle,
  User as UserIcon,
} from 'lucide-react';
import { Button } from '../../components/Button';

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
      <div className="table-container bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
        <table className="data-table w-full">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 text-left text-sm font-semibold">
              <th className="px-6 py-4">Resident</th>
              <th className="px-6 py-4">Room</th>
              <th className="px-6 py-4">Presence</th>
              <th className="px-6 py-4">Face</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {[...Array(6)].map((_, i) => (
              <tr key={i} className="h-16 border-b border-slate-100">
                <td className="px-6 py-4"><span className="skeleton-cell w-36 h-5 rounded" /></td>
                <td className="px-6 py-4"><span className="skeleton-cell w-20 h-5 rounded" /></td>
                <td className="px-6 py-4"><span className="skeleton-cell w-20 h-5 rounded" /></td>
                <td className="px-6 py-4"><span className="skeleton-cell w-24 h-5 rounded" /></td>
                <td className="px-6 py-4"><span className="skeleton-cell w-16 h-5 rounded" /></td>
                <td className="px-6 py-4 text-right"><span className="skeleton-cell w-16 h-5 rounded ml-auto" /></td>
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
          {hasActiveFilters ? 'No matching residents found' : 'No residents registered in facility'}
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
    <div className="table-container bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
      <table className="data-table w-full text-left border-collapse text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/70 text-slate-600 font-semibold text-sm">
            <th scope="col" className="px-6 py-4">Resident</th>
            <th scope="col" className="px-6 py-4">Room</th>
            <th scope="col" className="px-6 py-4">Presence</th>
            <th scope="col" className="px-6 py-4">Face</th>
            <th scope="col" className="px-6 py-4">Status</th>
            <th scope="col" className="px-6 py-4 text-right">Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {residents.map((resident) => {
            return (
              <tr
                key={resident.id}
                className="hover:bg-slate-50/80 transition-colors h-18"
              >
                {/* Resident (Photo + Name + Code) */}
                <td className="px-6 py-3.5">
                  <div className="flex items-center gap-3.5">
                    <div className="w-11 h-11 rounded-full overflow-hidden bg-slate-100 border border-slate-200 shrink-0 flex items-center justify-center">
                      <img
                        src={typeof residentsApi.getProfilePhotoUrl === 'function' ? residentsApi.getProfilePhotoUrl(resident.id) : `/api/v1/residents/${resident.id}/profile-photo`}
                        alt=""
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                      <UserIcon size={20} className="text-slate-400" />
                    </div>

                    <div className="flex flex-col min-w-0">
                      <button
                        type="button"
                        className="font-semibold text-slate-900 text-left hover:text-blue-600 truncate text-15px"
                        onClick={() => onSelect(resident)}
                      >
                        {resident.fullName}
                      </button>
                      <span className="font-mono text-13px text-slate-500 mt-0.5">{resident.residentCode}</span>
                    </div>
                  </div>
                </td>

                {/* Room */}
                <td className="px-6 py-3.5 text-slate-700 font-medium text-15px">
                  {resident.roomGroup}
                </td>

                {/* Presence */}
                <td className="px-6 py-3.5">
                  <Badge
                    type="presence"
                    value={resident.presence?.currentState || 'OUT'}
                  />
                </td>

                {/* Face Enrollment */}
                <td className="px-6 py-3.5">
                  <Badge
                    type="enrollment"
                    value={resident.faceEnrollmentStatus}
                  />
                </td>

                {/* Status */}
                <td className="px-6 py-3.5">
                  <Badge
                    type="status"
                    value={resident.status}
                  />
                </td>

                {/* Action */}
                <td className="px-6 py-3.5 text-right">
                  <div className="inline-flex items-center justify-end gap-2">
                    <button
                      type="button"
                      className="px-3.5 py-1.5 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 focus:outline-none transition"
                      onClick={() => onSelect(resident)}
                      aria-label={`View details for ${resident.fullName}`}
                    >
                      View
                    </button>

                    {canManage && (
                      <>
                        <button
                          type="button"
                          className="px-3 py-1.5 text-sm font-medium text-slate-600 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:text-slate-900 transition"
                          onClick={() => onEdit(resident)}
                          aria-label={`Edit ${resident.fullName}`}
                        >
                          Edit
                        </button>

                        {resident.status === 'ACTIVE' ? (
                          <button
                            type="button"
                            className="px-3 py-1.5 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition"
                            onClick={() => onDeactivate(resident)}
                            aria-label={`Deactivate ${resident.fullName}`}
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="px-3 py-1.5 text-sm font-medium text-emerald-700 bg-white border border-emerald-200 rounded-lg hover:bg-emerald-50 transition"
                            onClick={() => onReactivate(resident)}
                            aria-label={`Reactivate ${resident.fullName}`}
                          >
                            Reactivate
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
