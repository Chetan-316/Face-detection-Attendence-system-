import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResidentsPage } from '../pages/ResidentsPage';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ToastContext';
import { residentsApi } from '../api/residents.api';
import { authApi } from '../api/auth.api';
import { SafeResident } from '../types/resident.types';

vi.mock('../api/residents.api', () => ({
  residentsApi: {
    listResidents: vi.fn(),
    createResident: vi.fn(),
    updateResident: vi.fn(),
    deactivateResident: vi.fn(),
    reactivateResident: vi.fn(),
    getResident: vi.fn(),
    getSummary: vi.fn(),
    getProfilePhotoUrl: vi.fn((id: string) => `/api/v1/residents/${id}/profile-photo`),
  },
}));

vi.mock('../api/auth.api', () => ({
  authApi: {
    login: vi.fn(),
    getMe: vi.fn(),
  },
}));

const mockResident: SafeResident = {
  id: 'res-1',
  organizationId: 'org-1',
  hostelId: 'hostel-1',
  residentCode: 'R001',
  fullName: 'Alex Kumar',
  roomGroup: 'Room 101',
  contactPhone: null,
  contactEmail: null,
  status: 'ACTIVE',
  faceEnrollmentStatus: 'NOT_ENROLLED',
  presence: {
    currentState: 'IN',
    lastMovementType: null,
    lastMovementTime: null,
    updatedAt: '2026-09-29T00:00:00Z',
  },
  createdAt: '2026-09-29T00:00:00Z',
  updatedAt: '2026-09-29T00:00:00Z',
};

describe('Role-Aware UI Permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('pravahax_access_token', 'valid-token');
    (residentsApi.listResidents as any).mockResolvedValue({
      data: [mockResident],
      pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 },
    });
  });

  it('allows WARDEN to see "Add Resident", Edit, and Deactivate buttons', async () => {
    (authApi.getMe as any).mockResolvedValueOnce({
      user: {
        id: 'warden-1',
        username: 'warden',
        fullName: 'Facility Warden',
        role: 'WARDEN',
        organizationId: 'org-1',
        hostelId: 'hostel-1',
        status: 'ACTIVE',
      },
    });

    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <ResidentsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add resident/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /edit alex kumar/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /deactivate alex kumar/i })).toBeInTheDocument();
    });
  });

  it('restricts GUARD: does NOT show "Add Resident" or mutation buttons', async () => {
    (authApi.getMe as any).mockResolvedValueOnce({
      user: {
        id: 'guard-1',
        username: 'guard',
        fullName: 'Gate Guard',
        role: 'GUARD',
        organizationId: 'org-1',
        hostelId: 'hostel-1',
        status: 'ACTIVE',
      },
    });

    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <ResidentsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Alex Kumar')).toBeInTheDocument();
    });

    // Guard MUST NOT see Add Resident button
    expect(screen.queryByRole('button', { name: /add resident/i })).not.toBeInTheDocument();

    // Guard MUST NOT see Edit or Deactivate buttons
    expect(screen.queryByRole('button', { name: /edit alex kumar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /deactivate alex kumar/i })).not.toBeInTheDocument();
  });
});
