import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const mockResidents: SafeResident[] = [
  {
    id: 'res-1',
    organizationId: 'org-1',
    hostelId: 'hostel-1',
    residentCode: 'R001',
    fullName: 'Alex Kumar',
    roomGroup: 'Room 101',
    contactPhone: '555-0101',
    contactEmail: 'alex@example.com',
    status: 'ACTIVE',
    faceEnrollmentStatus: 'NOT_ENROLLED',
    presence: {
      currentState: 'IN',
      lastMovementType: 'IN',
      lastMovementTime: '2026-09-29T08:00:00Z',
      updatedAt: '2026-09-29T08:00:00Z',
    },
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: '2026-09-29T00:00:00Z',
  },
  {
    id: 'res-2',
    organizationId: 'org-1',
    hostelId: 'hostel-1',
    residentCode: 'R002',
    fullName: 'Jordan Sharma',
    roomGroup: 'Room 102',
    contactPhone: null,
    contactEmail: null,
    status: 'INACTIVE',
    faceEnrollmentStatus: 'ENROLLED',
    presence: {
      currentState: 'OUT',
      lastMovementType: 'OUT',
      lastMovementTime: '2026-09-29T07:00:00Z',
      updatedAt: '2026-09-29T07:00:00Z',
    },
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: '2026-09-29T00:00:00Z',
  },
];

describe('Residents List & Management Feature', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('pravahax_access_token', 'valid-token');

    (authApi.getMe as any).mockResolvedValue({
      user: {
        id: 'user-1',
        username: 'warden',
        fullName: 'Hostel Warden',
        role: 'WARDEN',
        organizationId: 'org-1',
        hostelId: 'hostel-1',
        status: 'ACTIVE',
      },
    });
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <AuthProvider>
            <ResidentsPage />
          </AuthProvider>
        </ToastProvider>
      </MemoryRouter>
    );

  it('renders resident roster with status badges and codes', async () => {
    (residentsApi.listResidents as any).mockResolvedValueOnce({
      data: mockResidents,
      pagination: { page: 1, pageSize: 15, total: 2, totalPages: 1 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Alex Kumar')).toBeInTheDocument();
      expect(screen.getByText('R001')).toBeInTheDocument();
      expect(screen.getByText('Jordan Sharma')).toBeInTheDocument();
      expect(screen.getByText('R002')).toBeInTheDocument();
    });

    expect(screen.getAllByText('IN HOSTEL').length).toBeGreaterThan(0);
    expect(screen.getAllByText('OUTSIDE').length).toBeGreaterThan(0);
  });

  it('displays empty state when no residents match or database is empty', async () => {
    (residentsApi.listResidents as any).mockResolvedValueOnce({
      data: [],
      pagination: { page: 1, pageSize: 15, total: 0, totalPages: 0 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/no residents registered in facility/i)).toBeInTheDocument();
    });
  });

  it('triggers debounced backend search query when user types in search bar', async () => {
    const user = userEvent.setup();
    (residentsApi.listResidents as any).mockResolvedValue({
      data: [mockResidents[0]],
      pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 },
    });

    renderComponent();

    await waitFor(() => {
      expect(residentsApi.listResidents).toHaveBeenCalled();
    });

    const searchInput = screen.getByPlaceholderText(/search code or full name/i);
    await user.type(searchInput, 'Alex');

    await waitFor(() => {
      expect(residentsApi.listResidents).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Alex' })
      );
    });
  });

  it('applies presence and status filters and passes them to backend API', async () => {
    const user = userEvent.setup();
    (residentsApi.listResidents as any).mockResolvedValue({
      data: [mockResidents[0]],
      pagination: { page: 1, pageSize: 15, total: 1, totalPages: 1 },
    });

    renderComponent();

    await waitFor(() => {
      expect(residentsApi.listResidents).toHaveBeenCalled();
    });

    const presenceSelect = screen.getByLabelText(/filter by presence/i);
    await user.selectOptions(presenceSelect, 'IN');

    await waitFor(() => {
      expect(residentsApi.listResidents).toHaveBeenCalledWith(
        expect.objectContaining({ presence: 'IN' })
      );
    });
  });

  it('handles pagination next and previous controls', async () => {
    const user = userEvent.setup();
    (residentsApi.listResidents as any).mockResolvedValue({
      data: mockResidents,
      pagination: { page: 1, pageSize: 2, total: 4, totalPages: 2 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/page 1 of 2/i)).toBeInTheDocument();
    });

    const nextBtn = screen.getByRole('button', { name: /next/i });
    expect(nextBtn).toBeEnabled();
    await user.click(nextBtn);

    await waitFor(() => {
      expect(residentsApi.listResidents).toHaveBeenCalledWith(
        expect.objectContaining({ page: 2 })
      );
    });
  });
});
