import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResidentCreateModal } from '../features/residents/ResidentCreateModal';
import { ResidentEditModal } from '../features/residents/ResidentEditModal';
import { ResidentDeactivateModal } from '../features/residents/ResidentDeactivateModal';
import { ResidentReactivateModal } from '../features/residents/ResidentReactivateModal';
import { ToastProvider } from '../components/ToastContext';
import { AuthProvider } from '../auth/AuthContext';
import { residentsApi } from '../api/residents.api';
import { authApi } from '../api/auth.api';
import { ApiError } from '../api/client';
import { SafeResident } from '../types/resident.types';

vi.mock('../api/residents.api', () => ({
  residentsApi: {
    listResidents: vi.fn(),
    createResident: vi.fn(),
    updateResident: vi.fn(),
    deactivateResident: vi.fn(),
    reactivateResident: vi.fn(),
  },
}));

vi.mock('../api/auth.api', () => ({
  authApi: {
    login: vi.fn(),
    getMe: vi.fn(),
  },
}));

const mockActiveResident: SafeResident = {
  id: 'res-active-1',
  organizationId: 'org-1',
  hostelId: 'hostel-1',
  residentCode: 'R101',
  fullName: 'Morgan Patel',
  roomGroup: 'Room 201',
  contactPhone: '555-0201',
  contactEmail: 'morgan@example.com',
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

const mockInactiveResident: SafeResident = {
  ...mockActiveResident,
  id: 'res-inactive-2',
  status: 'INACTIVE',
};

describe('Resident Operations & Modals', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('pravahax_access_token', 'valid-token');
    (authApi.getMe as any).mockResolvedValue({
      user: {
        id: 'warden-1',
        username: 'warden',
        fullName: 'Hostel Warden',
        role: 'WARDEN',
        organizationId: 'org-1',
        hostelId: 'hostel-1',
        status: 'ACTIVE',
      },
    });
  });

  const wrapWithProviders = (component: React.ReactElement) => (
    <ToastProvider>
      <AuthProvider>{component}</AuthProvider>
    </ToastProvider>
  );

  describe('Create Resident Workflow', () => {
    it('validates mandatory fields and blocks submission when empty', async () => {
      const user = userEvent.setup();
      const onCreated = vi.fn();
      render(wrapWithProviders(
        <ResidentCreateModal isOpen={true} onClose={vi.fn()} onResidentCreated={onCreated} />
      ));

      await user.click(screen.getByRole('button', { name: /create resident/i }));

      expect(screen.getByText(/resident code is required/i)).toBeInTheDocument();
      expect(screen.getByText(/full name is required/i)).toBeInTheDocument();
      expect(screen.getByText(/room or group designation is required/i)).toBeInTheDocument();
      expect(residentsApi.createResident).not.toHaveBeenCalled();
    });

    it('displays backend 409 conflict when resident code already exists in organization', async () => {
      const user = userEvent.setup();
      (residentsApi.createResident as any).mockRejectedValueOnce(
        new ApiError(409, 'Resident with code R101 already exists in this organization', 'CONFLICT')
      );

      render(wrapWithProviders(
        <ResidentCreateModal isOpen={true} onClose={vi.fn()} onResidentCreated={vi.fn()} />
      ));

      await user.type(screen.getByLabelText(/resident code/i), 'R101');
      await user.type(screen.getByLabelText(/room \/ group/i), 'Room 101');
      await user.type(screen.getByLabelText(/full name/i), 'Duplicate Test');
      await user.click(screen.getByRole('button', { name: /create resident/i }));

      await waitFor(() => {
        expect(screen.getByText(/already exists in this organization/i)).toBeInTheDocument();
      });
    });

    it('submits valid data to POST /api/v1/residents and invokes callback', async () => {
      const user = userEvent.setup();
      const onCreated = vi.fn();
      (residentsApi.createResident as any).mockResolvedValueOnce(mockActiveResident);

      render(wrapWithProviders(
        <ResidentCreateModal isOpen={true} onClose={vi.fn()} onResidentCreated={onCreated} />
      ));

      await user.type(screen.getByLabelText(/resident code/i), 'R101');
      await user.type(screen.getByLabelText(/room \/ group/i), 'Room 201');
      await user.type(screen.getByLabelText(/full name/i), 'Morgan Patel');
      await user.type(screen.getByLabelText(/contact phone/i), '555-0201');
      await user.type(screen.getByLabelText(/contact email/i), 'morgan@example.com');

      await user.click(screen.getByRole('button', { name: /create resident/i }));

      await waitFor(() => {
        expect(residentsApi.createResident).toHaveBeenCalledWith(
          expect.objectContaining({
            residentCode: 'R101',
            fullName: 'Morgan Patel',
            roomGroup: 'Room 201',
            contactPhone: '555-0201',
            contactEmail: 'morgan@example.com',
            initialPresence: 'OUT',
          })
        );
        expect(onCreated).toHaveBeenCalledWith(mockActiveResident);
      });
    });
  });

  describe('Edit Resident Workflow', () => {
    it('populates editable fields and ensures forbidden fields are absent from form', () => {
      render(wrapWithProviders(
        <ResidentEditModal
          isOpen={true}
          resident={mockActiveResident}
          onClose={vi.fn()}
          onResidentUpdated={vi.fn()}
        />
      ));

      expect(screen.getByLabelText(/resident code/i)).toHaveValue('R101');
      expect(screen.getByLabelText(/full name/i)).toHaveValue('Morgan Patel');
      expect(screen.getByLabelText(/room \/ group/i)).toHaveValue('Room 201');
      expect(screen.getByLabelText(/contact phone/i)).toHaveValue('555-0201');
      expect(screen.getByLabelText(/contact email/i)).toHaveValue('morgan@example.com');

      // Requirement 17: Forbidden fields must NOT be editable in this form
      expect(screen.queryByLabelText(/hostel facility/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/presence status/i)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/face enrollment/i)).not.toBeInTheDocument();
    });

    it('submits updated values to PATCH /api/v1/residents/:id', async () => {
      const user = userEvent.setup();
      const onUpdated = vi.fn();
      const updatedMock = { ...mockActiveResident, fullName: 'Morgan Patel Modified' };
      (residentsApi.updateResident as any).mockResolvedValueOnce(updatedMock);

      render(wrapWithProviders(
        <ResidentEditModal
          isOpen={true}
          resident={mockActiveResident}
          onClose={vi.fn()}
          onResidentUpdated={onUpdated}
        />
      ));

      const nameInput = screen.getByLabelText(/full name/i);
      await user.clear(nameInput);
      await user.type(nameInput, 'Morgan Patel Modified');
      await user.click(screen.getByRole('button', { name: /save changes/i }));

      await waitFor(() => {
        expect(residentsApi.updateResident).toHaveBeenCalledWith(
          'res-active-1',
          expect.objectContaining({
            fullName: 'Morgan Patel Modified',
          })
        );
        expect(onUpdated).toHaveBeenCalledWith(updatedMock);
      });
    });
  });

  describe('Deactivate Resident Workflow', () => {
    it('requires a mandatory reason before deactivation submission', async () => {
      const user = userEvent.setup();
      render(wrapWithProviders(
        <ResidentDeactivateModal
          isOpen={true}
          resident={mockActiveResident}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      ));

      await user.click(screen.getByRole('button', { name: /confirm deactivation/i }));

      expect(screen.getByText(/mandatory deactivation reason is required/i)).toBeInTheDocument();
      expect(residentsApi.deactivateResident).not.toHaveBeenCalled();
    });

    it('submits reason and calls POST /api/v1/residents/:id/deactivate', async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      (residentsApi.deactivateResident as any).mockResolvedValueOnce(mockInactiveResident);

      render(wrapWithProviders(
        <ResidentDeactivateModal
          isOpen={true}
          resident={mockActiveResident}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />
      ));

      const reasonInput = screen.getByLabelText(/mandatory reason/i);
      await user.type(reasonInput, 'Resident graduated and checked out');
      await user.click(screen.getByRole('button', { name: /confirm deactivation/i }));

      await waitFor(() => {
        expect(residentsApi.deactivateResident).toHaveBeenCalledWith(
          'res-active-1',
          'Resident graduated and checked out'
        );
        expect(onSuccess).toHaveBeenCalledWith(mockInactiveResident);
      });
    });
  });

  describe('Reactivate Resident Workflow', () => {
    it('requires a mandatory reason before reactivation submission', async () => {
      const user = userEvent.setup();
      render(wrapWithProviders(
        <ResidentReactivateModal
          isOpen={true}
          resident={mockInactiveResident}
          onClose={vi.fn()}
          onSuccess={vi.fn()}
        />
      ));

      await user.click(screen.getByRole('button', { name: /confirm reactivation/i }));

      expect(screen.getByText(/mandatory reactivation reason is required/i)).toBeInTheDocument();
      expect(residentsApi.reactivateResident).not.toHaveBeenCalled();
    });

    it('submits reason and calls POST /api/v1/residents/:id/reactivate', async () => {
      const user = userEvent.setup();
      const onSuccess = vi.fn();
      (residentsApi.reactivateResident as any).mockResolvedValueOnce(mockActiveResident);

      render(wrapWithProviders(
        <ResidentReactivateModal
          isOpen={true}
          resident={mockInactiveResident}
          onClose={vi.fn()}
          onSuccess={onSuccess}
        />
      ));

      const reasonInput = screen.getByLabelText(/mandatory reason/i);
      await user.type(reasonInput, 'Student resumed hostel residency for next semester');
      await user.click(screen.getByRole('button', { name: /confirm reactivation/i }));

      await waitFor(() => {
        expect(residentsApi.reactivateResident).toHaveBeenCalledWith(
          'res-inactive-2',
          'Student resumed hostel residency for next semester'
        );
        expect(onSuccess).toHaveBeenCalledWith(mockActiveResident);
      });
    });
  });
});
