import React from 'react';
import { Search, X } from 'lucide-react';
import { FaceEnrollmentStatus, PresenceState, ResidentStatus } from '../../types/resident.types';

interface ResidentFilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  hostels?: Array<{ id: string; code: string; name: string }>;
  hostelId?: string;
  onHostelChange?: (value: string) => void;
  status: ResidentStatus | '';
  onStatusChange: (value: ResidentStatus | '') => void;
  presence: PresenceState | '';
  onPresenceChange: (value: PresenceState | '') => void;
  faceEnrollmentStatus: FaceEnrollmentStatus | '';
  onFaceEnrollmentChange: (value: FaceEnrollmentStatus | '') => void;
  roomGroup: string;
  onRoomGroupChange: (value: string) => void;
  onReset: () => void;
  isFiltered: boolean;
}

export const ResidentFilterBar: React.FC<ResidentFilterBarProps> = ({
  search,
  onSearchChange,
  hostels = [],
  hostelId = '',
  onHostelChange,
  status,
  onStatusChange,
  presence,
  onPresenceChange,
  faceEnrollmentStatus,
  onFaceEnrollmentChange,
  roomGroup,
  onRoomGroupChange,
  onReset,
  isFiltered,
}) => {
  return (
    <div className="filter-bar-card">
      <div className="filter-bar-row">
        {/* Search input with debounce support from parent */}
        <div className="filter-search-wrap">
          <Search size={16} className="filter-search-icon" aria-hidden="true" />
          <input
            type="text"
            className="filter-search-input"
            placeholder="Search code or full name..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search residents by name or code"
          />
          {search && (
            <button
              type="button"
              className="filter-search-clear"
              onClick={() => onSearchChange('')}
              aria-label="Clear search query"
            >
              <X size={14} />
            </button>
          )}
        </div>

        {hostels.length > 1 && onHostelChange && (
          <div className="filter-item">
            <select
              className="filter-select"
              value={hostelId}
              onChange={(e) => onHostelChange(e.target.value)}
              aria-label="Filter by hostel"
            >
              <option value="">All hostels</option>
              {hostels.map((hostel) => (
                <option key={hostel.id} value={hostel.id}>
                  {hostel.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Room / Group Search Filter */}
        <div className="filter-item">
          <input
            type="text"
            className="filter-select"
            placeholder="Room / group"
            value={roomGroup}
            onChange={(e) => onRoomGroupChange(e.target.value)}
            aria-label="Filter by room or group"
          />
        </div>

        {/* Presence Filter */}
        <div className="filter-item">
          <select
            className="filter-select"
            value={presence}
            onChange={(e) => onPresenceChange(e.target.value as PresenceState | '')}
            aria-label="Filter by presence"
          >
            <option value="">All presence</option>
            <option value="IN">Inside hostel</option>
            <option value="OUT">Outside hostel</option>
          </select>
        </div>

        {/* Face Status Filter */}
        <div className="filter-item">
          <select
            className="filter-select"
            value={faceEnrollmentStatus}
            onChange={(e) => onFaceEnrollmentChange(e.target.value as FaceEnrollmentStatus | '')}
            aria-label="Filter by face enrollment"
          >
            <option value="">All enrollment</option>
            <option value="ENROLLED">Face enrolled</option>
            <option value="NOT_ENROLLED">Needs enrollment</option>
            <option value="NEEDS_REENROLLMENT">Re-enrollment required</option>
            <option value="REVOKED">Enrollment revoked</option>
          </select>
        </div>

        {/* Account Status Filter */}
        <div className="filter-item">
          <select
            className="filter-select"
            value={status}
            onChange={(e) => onStatusChange(e.target.value as ResidentStatus | '')}
            aria-label="Filter by account status"
          >
            <option value="">All resident status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="ARCHIVED">Archived</option>
          </select>
        </div>

        {/* Reset Filter Button */}
        {isFiltered && (
          <button
            type="button"
            className="btn-filter-reset"
            onClick={onReset}
            title="Clear all filters"
          >
            <X size={14} />
            <span>Clear filters</span>
          </button>
        )}
      </div>
    </div>
  );
};
