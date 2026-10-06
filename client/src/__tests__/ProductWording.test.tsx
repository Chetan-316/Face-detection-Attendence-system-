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
import { camerasApi } from '../api/cameras.api';
import { movementsApi } from '../api/movements.api';
import { reportsApi } from '../api/reports.api';
import { facilitiesApi } from '../api/facilities.api';
import { authApi } from '../api/auth.api';
import { SafeResident } from '../types/resident.types';

vi.mock('../api/residents.api', () => ({
  residentsApi: {
    getSummary: vi.fn(),
    getResident: vi.fn(),
    listResidents: vi.fn(),
    listHostels: vi.fn(),
    getProfilePhotoUrl: vi.fn((id: string) => `/api/v1/residents/${id}/profile-photo`),
  },
}));

vi.mock('../api/cameras.api', () => ({
  camerasApi: {
    listCameras: vi.fn(),
    getPreviewStreamUrl: vi.fn((id: string) => `/api/v1/cameras/${id}/preview`),
  },
}));

vi.mock('../api/movements.api', () => ({
  movementsApi: {
    getPresenceCounts: vi.fn(),
    correctPresence: vi.fn(),
  },
}));

vi.mock('../api/reports.api', () => ({
  reportsApi: {
    getAttendanceSessions: vi.fn(),
    getMovements: vi.fn(),
    getResidentMovements: vi.fn(),
  },
}));

vi.mock('../api/facilities.api', () => ({
  facilitiesApi: {
    getOperationalSettings: vi.fn(),
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

describe('Product Wording and Clean Operational Interface Verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('pravahax_access_token', 'valid-test-token');

    (authApi.getMe as any).mockResolvedValue({
      user: {
        id: 'user-admin',
        username: 'admin',
        fullName: 'System Administrator',
        email: null,
        role: 'ADMIN',
        hostelId: null,
        organizationId: 'org-1',
        status: 'ACTIVE',
      },
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

    (movementsApi.getPresenceCounts as any).mockResolvedValue({
      currentlyIn: 35,
      currentlyOut: 15,
      totalTracked: 50,
    });

    (reportsApi.getAttendanceSessions as any).mockResolvedValue({
      data: [],
      count: 0,
    });

    (reportsApi.getMovements as any).mockResolvedValue({
      data: [],
      count: 0,
    });

    (reportsApi.getResidentMovements as any).mockResolvedValue({
      data: [],
    });

    (facilitiesApi.getOperationalSettings as any).mockResolvedValue({
      data: { hostelId: null, returnDeadlineMinutes: 1260, scoped: false },
    });

    (camerasApi.listCameras as any).mockResolvedValue({
      data: [],
      count: 0,
    });

    (residentsApi.listHostels as any).mockResolvedValue([
      { id: 'hostel-1', name: 'Main Hostel', code: 'H1' },
    ]);

    (residentsApi.getResident as any).mockResolvedValue(mockResident);
  });

  it('renders OverviewPage with product-clean wording and no stale deferral notices', async () => {
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

    // Verify stale deferral notices are NOT present
    expect(screen.queryByText(/PLANNED FOR UPCOMING PHASES/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/intentionally deferred/i)).not.toBeInTheDocument();

    // Verify active operational capabilities are displayed
    expect(screen.getByText('Gate Recognition & Cameras')).toBeInTheDocument();
    expect(screen.getByText('Biometric Engine')).toBeInTheDocument();
    expect(screen.getAllByText('OPERATIONAL').length).toBeGreaterThanOrEqual(1);

    // Verify metrics
    expect(screen.getByText('Face Enrolled')).toBeInTheDocument();
  });

  it('renders AppLayout sidebar with product operational navigation and no development milestones', async () => {
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
      expect(screen.getByText('PRAVAHAx')).toBeInTheDocument();
    });

    expect(screen.getByText('Residents')).toBeInTheDocument();
    expect(screen.getByText('Cameras')).toBeInTheDocument();
    expect(screen.getByText('Staff')).toBeInTheDocument();
    expect(screen.getByText('Hostels')).toBeInTheDocument();
    expect(screen.queryByText('Attendance')).not.toBeInTheDocument();
    expect(screen.getByText('Reports')).toBeInTheDocument();

    expect(screen.queryByText(/Step 03 UI Verified/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase:/i)).not.toBeInTheDocument();
  });

  it('renders ResidentDetailModal with clean operational status and no stale deferral notice', () => {
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
    expect(screen.getByText('Onboarding Checklist')).toBeInTheDocument();

    // Verify stale deferral notices are NOT present
    expect(screen.queryByText(/intentionally deferred/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PLANNED FOR UPCOMING PHASES/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Step 04/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 04/i)).not.toBeInTheDocument();
  });

  it('renders ResidentDetailPage with clean operational status and no stale deferral notice', async () => {
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

    expect(screen.getByText('Enrollment Status')).toBeInTheDocument();
    expect(screen.getByText('Resident Profile Status')).toBeInTheDocument();

    // Verify stale deferral notices are NOT present
    expect(screen.queryByText(/intentionally deferred/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/PLANNED FOR UPCOMING PHASES/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Step 04/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 04/i)).not.toBeInTheDocument();
  });
});
