import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { CamerasPage } from '../pages/CamerasPage';
import { ToastProvider } from '../components/ToastContext';
import { camerasApi } from '../api/cameras.api';
import { facilitiesApi } from '../api/facilities.api';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-admin-1',
      username: 'admin',
      fullName: 'System Administrator',
      email: 'admin@pravahax.demo',
      role: 'ADMIN',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      status: 'ACTIVE',
    },
    token: 'mock_jwt',
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('../api/cameras.api', () => ({
  camerasApi: {
    listCameras: vi.fn(),
    getCamera: vi.fn(),
    createCamera: vi.fn(),
    updateCamera: vi.fn(),
    startCamera: vi.fn(),
    stopCamera: vi.fn(),
    testCameraConnection: vi.fn(),
    testConnection: vi.fn(),
    getCameraHealth: vi.fn(),
    captureSnapshot: vi.fn(),
    getPreviewStreamUrl: vi.fn((id: string) => `/api/v1/cameras/${id}/preview?token=mock_jwt`),
  },
}));

vi.mock('../api/facilities.api', () => ({
  facilitiesApi: {
    listFacilities: vi.fn(),
    listLocations: vi.fn(),
  },
}));

describe('Cameras page product workflow', () => {
  const cameras = [
    {
      id: 'cam-laptop-1',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      locationId: 'loc-main',
      location: { id: 'loc-main', code: 'MAIN', name: 'Main Gate' },
      name: 'Laptop Webcam',
      sourceType: 'WEBCAM' as const,
      role: 'IN' as const,
      isEnabled: true,
      healthStatus: 'OFFLINE' as const,
      lastSeenAt: null,
      configMetadata: { deviceIndex: 0, movementAutomationEnabled: true },
      createdAt: '2026-09-29T10:00:00Z',
      updatedAt: '2026-09-29T10:00:00Z',
    },
    {
      id: 'cam-gate-2',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      locationId: 'loc-main',
      location: { id: 'loc-main', code: 'MAIN', name: 'Main Gate' },
      name: 'Main Gate IP Camera',
      sourceType: 'RTSP' as const,
      role: 'OUT' as const,
      isEnabled: true,
      healthStatus: 'ONLINE' as const,
      lastSeenAt: '2026-09-29T10:30:00Z',
      configMetadata: { rtspUrl: 'rtsp://gate1:554/live', transport: 'tcp' },
      createdAt: '2026-09-29T10:00:00Z',
      updatedAt: '2026-09-29T10:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    (facilitiesApi.listFacilities as any).mockResolvedValue({
      data: [
        {
          id: 'hostel-1',
          code: 'H1',
          name: 'Demo Hostel A',
          isActive: true,
        },
      ],
    });
    (facilitiesApi.listLocations as any).mockResolvedValue({
      data: [
        {
          id: 'loc-main',
          hostelId: 'hostel-1',
          code: 'MAIN',
          name: 'Main Gate',
          locationType: 'GATE',
          isActive: true,
        },
      ],
    });

    (camerasApi.listCameras as any).mockResolvedValue({
      data: cameras,
      count: cameras.length,
    });
    (camerasApi.getCameraHealth as any).mockResolvedValue({
      data: {
        cameraId: 'cam-laptop-1',
        sourceType: 'WEBCAM',
        isStreaming: false,
        healthStatus: 'OFFLINE',
        fps: 0,
        totalFramesCaptured: 0,
        resolution: null,
        lastSeenAt: null,
        lastError: null,
      },
    });
  });

  const renderComponent = () =>
    render(
      <BrowserRouter>
        <ToastProvider>
          <CamerasPage />
        </ToastProvider>
      </BrowserRouter>
    );

  it('renders a clean camera setup page with practical guidance', async () => {
    renderComponent();

    expect(screen.getByRole('heading', { level: 1, name: 'Cameras' })).toBeInTheDocument();
    expect(
      screen.getByText('Connect gate cameras, check their status, and confirm the live view.')
    ).toBeInTheDocument();
    expect(screen.getByText(/Camera setup is simple:/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('Laptop Webcam').length).toBeGreaterThan(0);
      expect(screen.getByText('Main Gate IP Camera')).toBeInTheDocument();
    });

    expect(screen.queryByText(/STEP 04/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/embedding/i)).not.toBeInTheDocument();
  });

  it('shows only the laptop-camera preview action for a webcam', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Laptop Webcam').length).toBeGreaterThan(0);
    });

    expect(screen.getAllByRole('button', { name: /use laptop camera/i }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^start live preview$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /test connection/i })).not.toBeInTheDocument();
  });

  it('shows network-camera actions when an IP camera is selected', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Main Gate IP Camera')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Main Gate IP Camera'));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /start live preview/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /test connection/i })).toBeInTheDocument();
    });

    expect(screen.queryByRole('button', { name: /use laptop camera/i })).not.toBeInTheDocument();
  });

  it('opens a readable Add Camera workflow with facility and gate assignment', async () => {
    renderComponent();

    fireEvent.click(screen.getByRole('button', { name: /^add camera$/i }));

    expect(screen.getByRole('heading', { name: 'Add Camera' })).toBeInTheDocument();
    expect(screen.getByText(/Facilities → Gates & Locations/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/camera name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^facility/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/gate \/ location/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/camera type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/camera purpose/i)).toBeInTheDocument();
  });

  it('keeps technical recognition terminology out of the normal camera UI', () => {
    const { container } = renderComponent();
    const text = container.textContent?.toLowerCase() || '';

    expect(text).not.toContain('arcface');
    expect(text).not.toContain('embedding');
    expect(text).not.toContain('yolo detection');
    expect(text).not.toContain('confidence score');
  });
});
