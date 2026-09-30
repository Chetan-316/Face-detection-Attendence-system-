import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AttendancePage } from '../pages/AttendancePage';
import { ToastProvider } from '../components/ToastContext';
import * as attendanceApi from '../api/attendance.api';
import { camerasApi } from '../api/cameras.api';

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

vi.mock('../api/cameras.api', () => ({
  camerasApi: {
    listCameras: vi.fn(),
  },
}));

vi.mock('../api/attendance.api', () => ({
  getAttendanceSessions: vi.fn(),
  getActiveAttendanceSession: vi.fn(),
  getAttendanceRoster: vi.fn(),
  createAttendanceSession: vi.fn(),
  startAttendanceSession: vi.fn(),
  closeAttendanceSession: vi.fn(),
  correctAttendanceRecord: vi.fn(),
}));

describe('Step 08: Frontend Hostel Attendance Interface Tests', () => {
  const mockSession = {
    id: 'session-1',
    organizationId: 'org-1',
    hostelId: 'hostel-1',
    sessionType: 'NIGHT' as const,
    title: 'Night Attendance',
    attendanceDate: new Date('2026-09-30T00:00:00Z').toISOString(),
    status: 'ACTIVE' as const,
    startTime: new Date('2026-09-30T21:00:00Z').toISOString(),
    endTime: new Date('2026-09-30T22:00:00Z').toISOString(),
    createdByUserId: 'user-warden-1',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    camera: { id: 'cam-att-1', name: 'Hostel Entry Camera', role: 'ATTENDANCE' },
  };

  const mockStats = {
    expectedResidents: 100,
    presentCount: 73,
    remainingCount: 27,
    absentCount: 0,
    notRecordedCount: 27,
  };

  const mockRoster = [
    {
      residentId: 'res-1',
      residentCode: 'R001',
      fullName: 'Rahul Patil',
      roomGroup: 'Room 101',
      faceEnrollmentStatus: 'ENROLLED',
      status: 'PRESENT' as const,
      markedAt: '2026-09-30T21:07:00Z',
      markMethod: 'FACE_RECOGNITION' as const,
      recordId: 'rec-1',
      correctionReason: null,
      notes: null,
    },
    {
      residentId: 'res-2',
      residentCode: 'R002',
      fullName: 'Amit Kale',
      roomGroup: 'Room 103',
      faceEnrollmentStatus: 'ENROLLED',
      status: 'PRESENT' as const,
      markedAt: '2026-09-30T21:10:00Z',
      markMethod: 'FACE_RECOGNITION' as const,
      recordId: 'rec-2',
      correctionReason: null,
      notes: null,
    },
    {
      residentId: 'res-3',
      residentCode: 'R003',
      fullName: 'Rohan More',
      roomGroup: 'Room 105',
      faceEnrollmentStatus: 'NOT_ENROLLED',
      status: 'NOT_RECORDED' as const,
      markedAt: null,
      markMethod: null,
      recordId: null,
      correctionReason: null,
      notes: null,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser.role = 'WARDEN';

    vi.mocked(attendanceApi.getAttendanceSessions).mockResolvedValue({
      sessions: [mockSession],
    });
    vi.mocked(attendanceApi.getActiveAttendanceSession).mockResolvedValue({
      activeSession: mockSession,
      stats: mockStats,
    });
    vi.mocked(attendanceApi.getAttendanceRoster).mockResolvedValue({
      session: mockSession,
      stats: mockStats,
      roster: mockRoster,
    });
    vi.mocked(camerasApi.listCameras).mockResolvedValue({
      data: [{ id: 'cam-att-1', name: 'Hostel Entry Camera', role: 'ATTENDANCE' } as any],
      count: 1,
    });
  });

  const renderComponent = () =>
    render(
      <MemoryRouter>
        <ToastProvider>
          <AttendancePage />
        </ToastProvider>
      </MemoryRouter>
    );

  it('renders Hostel Attendance page title, session summary, and professional metrics', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Hostel Attendance' })).toBeInTheDocument();
      expect(screen.getAllByText('Night Attendance').length).toBeGreaterThanOrEqual(1);
    });

    // Metric cards
    expect(screen.getByText('Expected')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getAllByText('Present').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('73')).toBeInTheDocument();
    expect(screen.getByText('Remaining')).toBeInTheDocument();
    expect(screen.getByText('27')).toBeInTheDocument();
  });

  it('renders resident roster with resident codes, room groups, and attendance badges', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
      expect(screen.getByText('R001')).toBeInTheDocument();
      expect(screen.getByText('Room 101')).toBeInTheDocument();

      expect(screen.getByText('Amit Kale')).toBeInTheDocument();
      expect(screen.getByText('R002')).toBeInTheDocument();
      expect(screen.getByText('Room 103')).toBeInTheDocument();

      expect(screen.getByText('Rohan More')).toBeInTheDocument();
      expect(screen.getByText('R003')).toBeInTheDocument();
      expect(screen.getByText('Room 105')).toBeInTheDocument();
    });

    // Verification of status badges
    const presentBadges = screen.getAllByText('Present');
    expect(presentBadges.length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Not Recorded').length).toBeGreaterThanOrEqual(1);
  });

  it('opens Create Attendance modal and creates session with default title Night Attendance', async () => {
    vi.mocked(attendanceApi.createAttendanceSession).mockResolvedValue({
      session: { ...mockSession, id: 'session-2', title: 'Night Attendance' },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /create attendance/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /create attendance/i }));

    // Modal opens
    expect(screen.getByText('Attendance Name')).toBeInTheDocument();
    const titleInput = screen.getByLabelText(/attendance name/i);
    expect(titleInput).toBeInTheDocument();

    // Submit form
    const submitBtn = screen.getAllByRole('button', { name: /create attendance/i })[1];
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(attendanceApi.createAttendanceSession).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Night Attendance',
          sessionType: 'NIGHT',
        })
      );
    });
  });

  it('opens Close Attendance confirmation dialog and shows unmarked count warning', async () => {
    vi.mocked(attendanceApi.closeAttendanceSession).mockResolvedValue({
      session: { ...mockSession, status: 'CLOSED' },
      stats: { ...mockStats, absentCount: 27, remainingCount: 0 },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close attendance/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /close attendance/i }));

    // Confirmation dialog
    expect(screen.getByText('Close Night Attendance?')).toBeInTheDocument();
    expect(screen.getByText(/residents not marked will be recorded as absent/i)).toBeInTheDocument();

    // Confirm close
    const confirmBtn = screen.getAllByRole('button', { name: /close attendance/i })[1];
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(attendanceApi.closeAttendanceSession).toHaveBeenCalledWith('session-1');
    });
  });

  it('allows Warden to open manual correction modal and requires mandatory reason', async () => {
    vi.mocked(attendanceApi.correctAttendanceRecord).mockResolvedValue({
      record: { id: 'rec-3', status: 'PRESENT' },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: /correct/i }).length).toBeGreaterThan(0);
    });

    // Click Correct on Rohan More
    const correctBtns = screen.getAllByRole('button', { name: /correct/i });
    fireEvent.click(correctBtns[2]);

    expect(screen.getByText('Change attendance')).toBeInTheDocument();
    expect(screen.getByText(/Resident:/)).toBeInTheDocument();

    // Enter reason
    const reasonInput = screen.getByPlaceholderText(/explain why this attendance record is being changed/i);
    fireEvent.change(reasonInput, {
      target: { value: 'Verified resident in room by Warden' },
    });

    // Save correction
    fireEvent.click(screen.getByRole('button', { name: /save correction/i }));

    await waitFor(() => {
      expect(attendanceApi.correctAttendanceRecord).toHaveBeenCalledWith(
        'session-1',
        'res-3',
        expect.objectContaining({
          status: 'PRESENT',
          reason: 'Verified resident in room by Warden',
        })
      );
    });
  });

  it('strictly enforces Guard read-only behavior (no Create, Start, Close, or Correct buttons)', async () => {
    currentUser.role = 'GUARD';
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Hostel Attendance' })).toBeInTheDocument();
    });

    // Guard can see roster and counts
    expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();

    // Guard CANNOT see operational action buttons
    expect(screen.queryByRole('button', { name: /create attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /close attendance/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /start session/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /correct/i })).not.toBeInTheDocument();
  });

  it('strictly verifies NO AI or biometric engineering terminology appears in standard interface', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'Hostel Attendance' })).toBeInTheDocument();
    });

    const pageText = document.body.textContent || '';

    // Check that engineering / AI jargon is not present
    expect(pageText).not.toContain('Embedding match');
    expect(pageText).not.toContain('Cosine similarity');
    expect(pageText).not.toContain('Neural recognition');
    expect(pageText).not.toContain('Inference complete');
    expect(pageText).not.toContain('AI attendance engine');
    expect(pageText).not.toContain('Biometric Command Center');
    expect(pageText).not.toContain('YuNet');
    expect(pageText).not.toContain('SFace');
  });
});
