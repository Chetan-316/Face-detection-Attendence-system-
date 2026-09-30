import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { CamerasPage } from '../pages/CamerasPage';
import { AuthContext } from '../auth/AuthContext';
import { ToastProvider } from '../components/ToastContext';
import { camerasApi } from '../api/cameras.api';

// Mock auth context
const mockAdminUser = {
  id: 'user-admin-1',
  username: 'admin',
  fullName: 'System Administrator',
  email: 'admin@pravahax.demo',
  role: 'ADMIN' as const,
  organizationId: 'org-1',
  hostelId: null,
  status: 'ACTIVE' as const,
};

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: mockAdminUser,
    token: 'mock_jwt',
    login: vi.fn(),
    logout: vi.fn(),
    isAuthenticated: true,
    isLoading: false,
  }),
}));

// Mock cameras API
vi.mock('../api/cameras.api', () => ({
  camerasApi: {
    listCameras: vi.fn(),
    getCamera: vi.fn(),
    createCamera: vi.fn(),
    startCamera: vi.fn(),
    stopCamera: vi.fn(),
    getCameraHealth: vi.fn(),
    captureSnapshot: vi.fn(),
    getPreviewStreamUrl: vi.fn((id: string) => `/api/v1/cameras/${id}/preview?token=mock_jwt`),
  },
}));

describe('Step 04: Cameras & Gate Live Preview Interface', () => {
  const mockAdminUser = {
    id: 'user-admin-1',
    username: 'admin',
    fullName: 'System Administrator',
    email: 'admin@pravahax.demo',
    role: 'ADMIN' as const,
    organizationId: 'org-1',
    hostelId: null,
    status: 'ACTIVE' as const,
  };

  const mockCamerasList = [
    {
      id: 'cam-laptop-1',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      name: 'Laptop Builtin Webcam',
      sourceType: 'WEBCAM' as const,
      role: 'GENERAL' as const,
      isEnabled: true,
      healthStatus: 'OFFLINE' as const,
      lastSeenAt: null,
      configMetadata: { deviceIndex: 0, fps: 15 },
      createdAt: '2026-09-29T10:00:00Z',
      updatedAt: '2026-09-29T10:00:00Z',
    },
    {
      id: 'cam-gate-2',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      name: 'Main Gate Turnstile A',
      sourceType: 'RTSP' as const,
      role: 'IN' as const,
      isEnabled: true,
      healthStatus: 'ONLINE' as const,
      lastSeenAt: '2026-09-29T10:30:00Z',
      configMetadata: { rtspUrl: 'rtsp://gate1:554/live' },
      createdAt: '2026-09-29T10:00:00Z',
      updatedAt: '2026-09-29T10:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    (camerasApi.listCameras as any).mockResolvedValue({
      data: mockCamerasList,
      count: 2,
    });
    (camerasApi.getCameraHealth as any).mockResolvedValue({
      data: {
        cameraId: 'cam-laptop-1',
        sourceType: 'WEBCAM',
        isStreaming: false,
        healthStatus: 'OFFLINE',
        fps: 0,
        totalFramesCaptured: 0,
        lastSeenAt: null,
        lastError: null,
        capabilities: {
          supportsLiveStreaming: true,
          supportsSnapshot: true,
          supportsHardwareRecognition: false,
          maxFps: 15,
        },
      },
    });
  });

  const renderComponent = () => {
    return render(
      <BrowserRouter>
        <ToastProvider>
          <CamerasPage />
        </ToastProvider>
      </BrowserRouter>
    );
  };

  it('renders operational cameras header and configured camera cards without developer banners', async () => {
    renderComponent();

    expect(screen.getByRole('heading', { level: 1, name: 'Cameras' })).toBeInTheDocument();
    expect(screen.getByText('Manage hostel cameras and live feeds.')).toBeInTheDocument();
    expect(screen.queryByText(/STEP 04 CAMERA ABSTRACTION/i)).not.toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getAllByText('Laptop Builtin Webcam').length).toBeGreaterThan(0);
      expect(screen.getByText('Main Gate Turnstile A')).toBeInTheDocument();
    });
  });

  it('allows starting camera stream and displays live MJPEG image HUD', async () => {
    (camerasApi.startCamera as any).mockResolvedValue({
      data: {
        cameraId: 'cam-laptop-1',
        sourceType: 'WEBCAM',
        isActive: true,
        healthStatus: 'ONLINE',
        fps: 15,
        totalFramesCaptured: 45,
        lastSeenAt: new Date().toISOString(),
        lastError: null,
      },
      message: 'Started live stream',
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Laptop Builtin Webcam').length).toBeGreaterThan(0);
    });

    // Camera is initially offline; placeholder button "Start Live Preview" is visible
    const startButtons = screen.getAllByRole('button', { name: /start live preview/i });
    expect(startButtons.length).toBeGreaterThan(0);

    fireEvent.click(startButtons[0]);

    await waitFor(() => {
      expect(camerasApi.startCamera).toHaveBeenCalledWith('cam-laptop-1');
    });
  });

  it('captures snapshot still frame and opens preview dialog', async () => {
    (camerasApi.captureSnapshot as any).mockResolvedValue({
      data: {
        timestamp: new Date().toISOString(),
        format: 'image/jpeg',
        width: 640,
        height: 480,
        dataBase64: 'fakeBase64JpegData==',
      },
    });

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText('Laptop Builtin Webcam').length).toBeGreaterThan(0);
    });

    const snapshotBtn = screen.getByRole('button', { name: /capture snapshot/i });
    fireEvent.click(snapshotBtn);

    await waitFor(() => {
      expect(camerasApi.captureSnapshot).toHaveBeenCalledWith('cam-laptop-1');
      expect(screen.getByText('Camera Frame Snapshot')).toBeInTheDocument();
      expect(screen.getByText(/640 × 480/)).toBeInTheDocument();
    });
  });

  it('allows Admin to open camera registration modal', async () => {
    renderComponent();

    const registerBtn = screen.getByRole('button', { name: /register camera/i });
    fireEvent.click(registerBtn);

    expect(screen.getByText('Register Camera Device')).toBeInTheDocument();
    expect(screen.getByLabelText(/camera name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/source type/i)).toBeInTheDocument();
  });

  it('verifies that face recognition and enrollment are decoupled from camera page', () => {
    renderComponent();

    // Verify negative constraints (Step 04 strictly prohibits Step 05 face recognition logic)
    expect(screen.queryByText(/enroll face profile/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/arcface embeddings/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/yolo detection/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/mark attendance from face/i)).not.toBeInTheDocument();
  });
});
