import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ReportsPage } from '../pages/ReportsPage';
import { AppLayout } from '../layouts/AppLayout';
import { ToastProvider } from '../components/ToastContext';
import { reportsApi } from '../api/reports.api';
import { residentsApi } from '../api/residents.api';

let currentUser = {
  id: 'user-warden-1',
  username: 'warden_h1',
  fullName: 'Warden H1',
  role: 'WARDEN' as 'ADMIN' | 'WARDEN' | 'GUARD',
  organizationId: 'org-1',
  hostelId: 'hostel-1',
  status: 'ACTIVE' as const,
};

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: currentUser,
    token: 'mock_jwt_token',
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('../api/reports.api', () => ({
  reportsApi: {
    getAttendanceSessions: vi.fn(),
    getSessionRoster: vi.fn(),
    getAttendanceTrend: vi.fn(),
    getResidentAttendance: vi.fn(),
    getMovements: vi.fn(),
    getResidentMovements: vi.fn(),
    getPresence: vi.fn(),
    getCurrentlyOutside: vi.fn(),
    getResidentSummary: vi.fn(),
    downloadAttendanceCsv: vi.fn(),
    downloadMovementCsv: vi.fn(),
  },
}));

vi.mock('../api/residents.api', () => ({
  residentsApi: {
    getResidents: vi.fn(),
    getSummary: vi.fn(),
  },
}));

describe('Reports presence and movement workflow', () => {
  const movements = [
    {
      id: 'mov-1',
      timestamp: '2026-09-30T22:42:00.000Z',
      residentId: 'res-1',
      residentCode: 'R001',
      fullName: 'Rahul Patil',
      roomGroup: 'A-101',
      direction: 'IN' as const,
      gateName: 'Main Gate',
      source: 'FACE_RECOGNITION',
      isCorrection: false,
    },
    {
      id: 'mov-2',
      timestamp: '2026-09-30T22:31:00.000Z',
      residentId: 'res-2',
      residentCode: 'R002',
      fullName: 'Amit Kale',
      roomGroup: 'A-102',
      direction: 'OUT' as const,
      gateName: 'Main Gate',
      source: 'GUARD_CONFIRMATION',
      isCorrection: true,
    },
  ];

  const presence = {
    hostelId: 'hostel-1',
    hostelName: 'Main Hostel',
    totalResidents: 100,
    insideCount: 82,
    outsideCount: 18,
    insideRate: 82,
    outsideRate: 18,
  };

  const residentSummary = {
    id: 'res-1',
    residentCode: 'R001',
    fullName: 'Rahul Patil',
    roomGroup: 'A-101',
    contactPhone: '9876543210',
    contactEmail: 'rahul@example.com',
    status: 'ACTIVE',
    hostelId: 'hostel-1',
    hostelName: 'Main Hostel',
    currentPresence: 'IN' as const,
    lastMovementTime: '2026-09-30T22:42:00.000Z',
    lastMovementGate: 'Main Gate',
    lastMovementDirection: 'IN' as const,
    recentMovements: [movements[0]],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      id: 'user-warden-1',
      username: 'warden_h1',
      fullName: 'Warden H1',
      role: 'WARDEN',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      status: 'ACTIVE',
    };

    (reportsApi.getMovements as any).mockResolvedValue({
      data: movements,
      total: 2,
      page: 1,
      pageSize: 15,
      totalPages: 1,
    });
    (reportsApi.getPresence as any).mockResolvedValue(presence);
    (reportsApi.getCurrentlyOutside as any).mockResolvedValue({
      data: [
        {
          residentId: 'res-2',
          residentCode: 'R002',
          fullName: 'Amit Kale',
          roomGroup: 'A-102',
          lastMovementTime: '2026-09-30T22:31:00.000Z',
        },
      ],
    });
    (reportsApi.getResidentSummary as any).mockResolvedValue(residentSummary);
    (reportsApi.downloadMovementCsv as any).mockResolvedValue(undefined);
    (residentsApi.getResidents as any).mockResolvedValue({ data: [] });
  });

  const renderReports = () =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

  it('keeps Reports in the staff navigation', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <AppLayout />
        </ToastProvider>
      </MemoryRouter>
    );

    expect(screen.getByRole('link', { name: /reports/i })).toBeInTheDocument();
  });

  it('opens directly on Presence & Movement without a legacy Attendance tab', async () => {
    renderReports();

    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /presence & movement/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /^residents$/i })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /^attendance$/i })).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText('Currently Inside')).toBeInTheDocument();
      expect(screen.getByText('82')).toBeInTheDocument();
      expect(screen.getByText('Currently Outside')).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
      expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
      expect(screen.getByText('Amit Kale')).toBeInTheDocument();
    });
  });

  it('uses clear, prominent resident actions on the presence cards', async () => {
    renderReports();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /browse residents/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /view outside residents/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /view outside residents/i }));

    await waitFor(() => {
      expect(reportsApi.getCurrentlyOutside).toHaveBeenCalled();
    });
  });

  it('shows human movement wording and correction status', async () => {
    renderReports();

    await waitFor(() => {
      expect(screen.getByText('Entered')).toBeInTheDocument();
      expect(screen.getByText('Left')).toBeInTheDocument();
      expect(screen.getByText('Verified')).toBeInTheDocument();
      expect(screen.getByText('Corrected')).toBeInTheDocument();
    });
  });

  it('reloads movement data when the date range changes', async () => {
    renderReports();

    await waitFor(() => {
      expect(reportsApi.getMovements).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Last 7 Days' }));

    await waitFor(() => {
      expect(reportsApi.getMovements).toHaveBeenCalledTimes(2);
    });
  });

  it('exports the visible movement report', async () => {
    renderReports();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /export csv/i }));

    await waitFor(() => {
      expect(reportsApi.downloadMovementCsv).toHaveBeenCalled();
    });
  });

  it('allows Warden/Admin to search and inspect a resident movement summary', async () => {
    (residentsApi.getResidents as any).mockResolvedValue({
      data: [
        {
          id: 'res-1',
          residentCode: 'R001',
          fullName: 'Rahul Patil',
          roomGroup: 'A-101',
        },
      ],
    });

    renderReports();
    fireEvent.click(screen.getByRole('tab', { name: /^residents$/i }));

    const input = screen.getByPlaceholderText('Type name or resident code...');
    fireEvent.change(input, { target: { value: 'Rahul' } });

    await waitFor(() => {
      expect(residentsApi.getResidents).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Rahul' })
      );
      expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('option', { name: /Rahul Patil/i }));

    await waitFor(() => {
      expect(reportsApi.getResidentSummary).toHaveBeenCalledWith('res-1');
      expect(screen.getByText('Inside Hostel')).toBeInTheDocument();
      expect(screen.getByText('Movement Timeline')).toBeInTheDocument();
      expect(screen.queryByText('Attendance History')).not.toBeInTheDocument();
    });
  });

  it('keeps technical AI jargon out of the normal reports experience', async () => {
    const { container } = renderReports();

    await waitFor(() => {
      expect(screen.getByText('Movement History')).toBeInTheDocument();
    });

    const text = container.textContent?.toLowerCase() || '';
    for (const term of [
      'neural analysis',
      'ai insights',
      'confidence score',
      'biometric score',
      'face vector',
      'template embedding',
      'behavior prediction',
      'command center',
      'anomaly detection',
    ]) {
      expect(text).not.toContain(term);
    }
  });
});
