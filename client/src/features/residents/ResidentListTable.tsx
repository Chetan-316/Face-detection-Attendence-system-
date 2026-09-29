import React from 'react';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { SafeResident } from '../../types/resident.types';
import {
  Edit2,
  UserMinus,
  UserCheck,
  Eye,
  UserX,
  Phone,
  Mail,
  PlusCircle,
} from 'lucide-react';

interface ResidentListTableProps {
  residents: SafeResident[];
  isLoading: boolean;
  onSelect: (resident: SafeResident) => void;
  onEdit: (resident: SafeResident) => void;
  onDeactivate: (resident: SafeResident) => void;
  onReactivate: (resident: SafeResident) => void;
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
              <th>Resident Code</th>
              <th>Full Name</th>
              <th>Room / Group</th>
              <th>Current Status</th>
              <th>Face Enrollment</th>
              <th>Account Status</th>
              <th>Contact</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {[...Array(6)].map((_, i) => (
              <tr key={i} className="skeleton-row">
                <td><span className="skeleton-cell w-20" /></td>
                <td><span className="skeleton-cell w-36" /></td>
                <td><span className="skeleton-cell w-24" /></td>
                <td><span className="skeleton-cell w-20" /></td>
                <td><span className="skeleton-cell w-28" /></td>
                <td><span className="skeleton-cell w-16" /></td>
                <td><span className="skeleton-cell w-32" /></td>
                <td className="text-right"><span className="skeleton-cell w-20 ml-auto" /></td>
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
            <th scope="col">Resident Code</th>
            <th scope="col">Full Name</th>
            <th scope="col">Room / Group</th>
            <th scope="col">Current Status</th>
            <th scope="col">Face Enrollment</th>
            <th scope="col">Account Status</th>
            <th scope="col">Contact</th>
            <th scope="col" className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {residents.map((resident) => {
            const isCurrentlyIn = resident.presence?.currentState === 'IN';
            return (
              <tr
                key={resident.id}
                className="table-row-interactive"
                onClick={() => onSelect(resident)}
              >
                {/* Resident Code */}
                <td className="font-mono font-medium text-primary">
                  {resident.residentCode}
                </td>

                {/* Full Name */}
                <td>
                  <button
                    type="button"
                    className="table-link-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(resident);
                    }}
                  >
                    {resident.fullName}
                  </button>
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

                {/* Contact */}
                <td className="text-xs text-secondary">
                  {resident.contactPhone || resident.contactEmail ? (
                    <div className="contact-cell">
                      {resident.contactPhone && (
                        <span className="flex items-center gap-1">
                          <Phone size={11} className="text-muted" />
                          <span>{resident.contactPhone}</span>
                        </span>
                      )}
                      {resident.contactEmail && (
                        <span className="flex items-center gap-1 text-muted">
                          <Mail size={11} />
                          <span>{resident.contactEmail}</span>
                        </span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>

                {/* Actions */}
                <td
                  className="table-actions-cell text-right"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="table-actions-group">
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
