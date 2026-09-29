import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { OverviewPage } from '../pages/OverviewPage';
import { ResidentDetailPage } from '../pages/ResidentDetailPage';
import { ResidentDetailModal } from '../features/residents/ResidentDetailModal';
import { AppLayout } from '../layouts/AppLayout';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ToastContext';
import { residentsApi } from '../api/residents.api';
import { authApi } from '../api/auth.api';
import { SafeResident } from '../types/resident.types';

vi.mock('../api/residents.api', () => ({
  residentsApi: {
    getSummary: vi.fn(),
    getResident: vi.fn(),
    listResidents: vi.fn(),
  },
}));

vi.mock('../api/auth.api', () => ({
  authApi: {
    getMe: vi.fn(),
    login: vi.fn(),
  },
}));

const mockResident: SafeResident = {
  id: 'res-test-1',
  organizationId: 'org-1',
  hostelId: 'hostel-1',
  residentCode: 'R101',
  fullName: 'Morgan Patel',
  roomGroup: 'Room 302',
  contactPhone: '9876543210',
  contactEmail: 'morgan@pravahax.demo',
  status: 'ACTIVE',
  faceEnrollmentStatus: 'NOT_ENROLLED',
  presence: {
    currentState: 'IN',
    lastMovementType: null,
    lastMovementTime: null,
    updatedAt: '2026-09-29T10:00:00Z',
  },
  createdAt: '2026-09-29T10:00:00Z',
  updatedAt: '2026-09-29T10:00:00Z',
};

describe('Product Wording and Phase Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('pravahax_access_token', 'valid-test-token');

    (authApi.getMe as any).mockResolvedValue({
      id: 'user-admin',
      username: 'admin',
      fullName: 'System Administrator',
      role: 'ADMIN',
      hostelId: null,
      organizationId: 'org-1',
    });

    (residentsApi.getSummary as any).mockResolvedValue({
      total: 50,
      active: 48,
      inactive: 2,
      currentlyIn: 35,
      currentlyOut: 15,
      faceEnrolled: 0,
      notEnrolled: 50,
      needsReEnrollment: 0,
    });

    (residentsApi.getResident as any).mockResolvedValue(mockResident);
  });

  it('renders OverviewPage with product-clean wording and future-safe pipeline status', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <OverviewPage />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    // Verify System Status header without development milestone wording
    await waitFor(() => {
      expect(screen.getByText('System Status')).toBeInTheDocument();
      expect(screen.getByText('Current platform capabilities')).toBeInTheDocument();
    });

    // Verify engineering milestone wording is NOT present
    expect(screen.queryByText(/Step 03/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 04/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Verified platform foundation/i)).not.toBeInTheDocument();

    // Verify updated pipeline card & status note
    expect(screen.getByText('Camera & Biometric Pipeline')).toBeInTheDocument();
    expect(screen.getByText('PLANNED FOR UPCOMING PHASES')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Camera integration, face enrollment, and face recognition are intentionally deferred to upcoming implementation phases.'
      )
    ).toBeInTheDocument();

    // Verify Face Enrollment metric footer
    expect(screen.getByText('Pending biometric enrollment setup')).toBeInTheDocument();
    expect(screen.getByText('Face Enrolled')).toBeInTheDocument();
    expect(screen.getByText('Not Enrolled')).toBeInTheDocument();

    // Verify no fake action buttons exist
    expect(screen.queryByText(/scan face/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/start recognition/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/enroll now/i)).not.toBeInTheDocument();
  });

  it('renders AppLayout sidebar with product operational indicator', async () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <AppLayout />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('System Operational')).toBeInTheDocument();
    });

    expect(screen.queryByText(/Step 03 UI Verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase:/i)).not.toBeInTheDocument();
  });

  it('renders ResidentDetailModal with future-safe deferral notice and no fake controls', () => {
    render(
      <MemoryRouter>
        <AuthProvider>
          <ToastProvider>
            <ResidentDetailModal
              isOpen={true}
              resident={mockResident}
              onClose={vi.fn()}
            />
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Face Recognition Status')).toBeInTheDocument();
    expect(screen.getByText('NOT ENROLLED')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Camera integration, face enrollment, and face recognition are intentionally deferred to upcoming implementation phases.'
      )
    ).toBeInTheDocument();

    expect(screen.queryByText(/Step 04/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 04/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/scan face/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/start recognition/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/enroll now/i)).not.toBeInTheDocument();
  });

  it('renders ResidentDetailPage with future-safe deferral notice', async () => {
    render(
      <MemoryRouter initialEntries={['/residents/res-test-1']}>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/residents/:id" element={<ResidentDetailPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getAllByText('Morgan Patel').length).toBeGreaterThanOrEqual(1);
    });

    expect(
      screen.getByText(
        'Camera integration, face enrollment, and face recognition are intentionally deferred to upcoming implementation phases.'
      )
    ).toBeInTheDocument();

    expect(screen.queryByText(/Step 04/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 04/i)).not.toBeInTheDocument();
  });
});
