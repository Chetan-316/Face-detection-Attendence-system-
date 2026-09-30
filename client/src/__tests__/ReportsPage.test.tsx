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

describe('Step 09: Frontend Reports & Operational History Tests', () => {
  const mockAttendanceSessions = [
    {
      id: 'session-1',
      hostelId: 'hostel-1',
      hostelName: 'Main Hostel',
      sessionType: 'NIGHT',
      title: 'Night Attendance',
      attendanceDate: '2026-09-30T00:00:00.000Z',
      status: 'CLOSED',
      startTime: '2026-09-30T21:00:00.000Z',
      endTime: '2026-09-30T22:00:00.000Z',
      expectedResidents: 100,
      presentCount: 92,
      absentCount: 8,
      remainingCount: 0,
      attendanceRate: 92,
      isFinalized: true,
    },
  ];

  const mockMovements = [
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
      source: 'FACE_RECOGNITION',
      isCorrection: false,
    },
  ];

  const mockPresence = {
    hostelId: 'hostel-1',
    hostelName: 'Main Hostel',
    totalResidents: 100,
    insideCount: 82,
    outsideCount: 18,
    insideRate: 82,
    outsideRate: 18,
  };

  const mockResidentSummary = {
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
    totalAttendanceSessions: 30,
    presentSessions: 27,
    absentSessions: 3,
    attendanceRate: 90,
    recentAttendance: [
      {
        sessionId: 'session-1',
        sessionTitle: 'Night Attendance',
        sessionDate: '2026-09-30T00:00:00.000Z',
        sessionStatus: 'CLOSED',
        status: 'PRESENT',
        markedAt: '2026-09-30T21:08:00.000Z',
        markMethod: 'FACE_RECOGNITION',
        isCorrected: false,
      },
    ],
    recentMovements: [
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
    ],
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

    (reportsApi.getAttendanceSessions as any).mockResolvedValue({
      data: mockAttendanceSessions,
      total: 1,
      page: 1,
      pageSize: 50,
      totalPages: 1,
    });

    (reportsApi.getAttendanceTrend as any).mockResolvedValue({
      data: [
        {
          date: '2026-09-30',
          attendanceRate: 92,
          presentCount: 92,
          expectedCount: 100,
          sessionCount: 1,
          status: 'CLOSED',
          sessionTitles: ['Night Attendance'],
        },
      ],
    });

    (reportsApi.getMovements as any).mockResolvedValue({
      data: mockMovements,
      total: 2,
      page: 1,
      pageSize: 15,
      totalPages: 1,
    });

    (reportsApi.getPresence as any).mockResolvedValue(mockPresence);
    (reportsApi.getResidentSummary as any).mockResolvedValue(mockResidentSummary);
    (reportsApi.downloadAttendanceCsv as any).mockResolvedValue(undefined);
    (reportsApi.downloadMovementCsv as any).mockResolvedValue(undefined);
  });

  // 1. Navigation item visible in AppLayout
  it('1. renders Reports link in navigation sidebar', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ToastProvider>
          <AppLayout />
        </ToastProvider>
      </MemoryRouter>
    );

    const reportsNavLink = screen.getByRole('link', { name: /reports/i });
    expect(reportsNavLink).toBeInTheDocument();
  });

  // 2. Attendance Tab Loads
  it('2. renders Attendance report tab with metrics cards, trend chart, and sessions table', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /attendance/i })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('Night Attendance').length).toBeGreaterThan(0);
      expect(screen.getAllByText('92%').length).toBeGreaterThan(0);
      expect(screen.getByText('Total Present')).toBeInTheDocument();
      expect(screen.getByText('Total Absent')).toBeInTheDocument();
    });
  });

  // 3. Movement Tab Loads
  it('3. renders Movement report tab with presence summary and movement history', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

    const movementTab = screen.getByRole('button', { name: /movement/i });
    fireEvent.click(movementTab);

    await waitFor(() => {
      expect(screen.getByText('Currently Inside')).toBeInTheDocument();
      expect(screen.getByText('82')).toBeInTheDocument();
      expect(screen.getByText('Currently Outside')).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
      expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
      expect(screen.getByText('Amit Kale')).toBeInTheDocument();
    });
  });

  // 4. Resident Summary Tab Loads
  it('4. allows searching and inspecting resident summary report', async () => {
    (residentsApi.getResidents as any).mockResolvedValue({
      data: [{ id: 'res-1', residentCode: 'R001', fullName: 'Rahul Patil', roomGroup: 'A-101' }],
    });

    render(
      <MemoryRouter>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

    const residentTab = screen.getByRole('button', { name: /residents/i });
    fireEvent.click(residentTab);

    expect(screen.getByPlaceholderText('Type name or resident code...')).toBeInTheDocument();

    // Type in search
    const input = screen.getByPlaceholderText('Type name or resident code...');
    fireEvent.change(input, { target: { value: 'Rahul' } });

    await waitFor(() => {
      expect(residentsApi.getResidents).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Rahul' })
      );
      expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
    });

    // Click suggestion
    fireEvent.click(screen.getByText('Rahul Patil'));

    await waitFor(() => {
      expect(reportsApi.getResidentSummary).toHaveBeenCalledWith('res-1');
      expect(screen.getByText('90%')).toBeInTheDocument();
      expect(screen.getByText('Inside Hostel')).toBeInTheDocument();
      expect(screen.getByText('Attendance History')).toBeInTheDocument();
      expect(screen.getByText('Movement Timeline')).toBeInTheDocument();
    });
  });

  // 5. Date Filters Work
  it('5. triggers data reload with updated date range when clicking filter buttons', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(reportsApi.getAttendanceSessions).toHaveBeenCalled();
    });

    const last30Btn = screen.getByRole('button', { name: 'Last 30 Days' });
    fireEvent.click(last30Btn);

    await waitFor(() => {
      expect(reportsApi.getAttendanceSessions).toHaveBeenCalledTimes(2);
    });
  });

  // 6. Export Button Invokes CSV Endpoint
  it('6. invokes downloadAttendanceCsv when Export CSV button is clicked', async () => {
    render(
      <MemoryRouter>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument();
    });

    const exportBtn = screen.getByRole('button', { name: /export csv/i });
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(reportsApi.downloadAttendanceCsv).toHaveBeenCalled();
    });
  });

  // 7. Session Roster Modal Opens & Filters Work
  it('7. opens Session Roster modal and filters roster', async () => {
    (reportsApi.getSessionRoster as any).mockResolvedValue({
      session: mockAttendanceSessions[0],
      roster: [
        {
          residentId: 'res-1',
          residentCode: 'R001',
          fullName: 'Rahul Patil',
          roomGroup: 'A-101',
          status: 'PRESENT',
          markedAt: '2026-09-30T21:08:00.000Z',
          markMethod: 'FACE_RECOGNITION',
          isCorrected: false,
        },
      ],
      stats: {
        expectedResidents: 100,
        presentCount: 92,
        absentCount: 8,
        remainingCount: 0,
        attendanceRate: 92,
      },
    });

    render(
      <MemoryRouter>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /view roster/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /view roster/i }));

    await waitFor(() => {
      expect(reportsApi.getSessionRoster).toHaveBeenCalledWith('session-1', expect.anything());
      expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
      expect(screen.getByText('A-101')).toBeInTheDocument();
    });
  });

  // 8. Guard Role Restrictions
  it('8. restricts Guard from exporting CSV and viewing resident historical summaries', async () => {
    currentUser.role = 'GUARD';

    render(
      <MemoryRouter>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

    // Guard cannot see Export CSV button on attendance tab
    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument();

    // Guard on resident tab sees restriction banner
    const residentTab = screen.getByRole('button', { name: /residents/i });
    fireEvent.click(residentTab);

    expect(screen.getByText('Resident Reports Access Restricted')).toBeInTheDocument();
  });

  // 9. Clean Product Language (No AI / Biometric jargon in normal report UI)
  it('9. strictly adheres to professional ERP wording without AI/biometric jargon', async () => {
    const { container } = render(
      <MemoryRouter>
        <ToastProvider>
          <ReportsPage />
        </ToastProvider>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText('Reports')).toBeInTheDocument();
    });

    const pageText = container.textContent?.toLowerCase() || '';

    const forbiddenTerms = [
      'neural analysis',
      'ai insights',
      'confidence score',
      'biometric score',
      'face vector',
      'template embedding',
      'behavior prediction',
      'command center',
      'anomaly detection',
    ];

    for (const term of forbiddenTerms) {
      expect(pageText).not.toContain(term);
    }
  });
});
