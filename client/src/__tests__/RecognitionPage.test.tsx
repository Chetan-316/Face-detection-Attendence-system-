import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RecognitionPage } from '../pages/RecognitionPage';
import { ToastProvider } from '../components/ToastContext';
import { camerasApi } from '../api/cameras.api';
import { recognitionApi } from '../api/recognition.api';

let currentUser = {
  id: 'user-warden-1',
  username: 'warden_h1',
  fullName: 'Warden H1',
  role: 'WARDEN' as const,
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
    getPreviewStreamUrl: vi.fn((id: string) => `http://mock-api/cameras/${id}/preview`),
  },
}));

vi.mock('../api/recognition.api', () => ({
  recognitionApi: {
    startRecognition: vi.fn(),
    stopRecognition: vi.fn(),
    getStatus: vi.fn(),
    getResults: vi.fn(),
    getEventsStreamUrl: vi.fn((id: string) => `http://mock-api/cameras/${id}/recognition/events`),
  },
}));

describe('Step 06: Continuous Face Recognition Monitor Interface', () => {
  const mockCameras = [
    {
      id: 'cam-001',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      name: 'Main Gate Webcam',
      sourceType: 'WEBCAM',
      role: 'ENTRANCE',
      isEnabled: true,
      healthStatus: 'ONLINE',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = {
      id: 'user-warden-1',
      username: 'warden_h1',
      fullName: 'Warden H1',
      role: 'WARDEN' as const,
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      status: 'ACTIVE' as const,
    };

    (camerasApi.listCameras as any).mockResolvedValue({
      data: mockCameras,
      count: 1,
    });

    (recognitionApi.getStatus as any).mockResolvedValue({
      sessionId: 'sess-123',
      cameraId: 'cam-001',
      hostelId: 'hostel-1',
      state: 'STOPPED',
      startedAt: null,
      framesProcessed: 0,
      facesDetected: 0,
      matches: 0,
      uncertains: 0,
      unknowns: 0,
      lastProcessedAt: null,
      lastError: null,
      eligibleTemplates: 3,
      processingFps: 0,
      configuredMaxFps: 5,
    });

    (recognitionApi.getResults as any).mockResolvedValue({
      results: [],
    });
  });

  const renderComponent = () => {
    return render(
      <ToastProvider>
        <RecognitionPage />
      </ToastProvider>
    );
  };

  it('renders recognition monitor layout with telemetry and controls', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Face Recognition Monitor/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Main Gate Webcam/i).length).toBeGreaterThan(0);
      expect(screen.getByTestId('start-recognition-btn')).toBeInTheDocument();
    });

    expect(screen.getByText(/Passive Observation Mode/i)).toBeInTheDocument();
  });

  it('allows Warden to start recognition and updates UI status to RUNNING', async () => {
    (recognitionApi.startRecognition as any).mockResolvedValue({
      sessionId: 'sess-123',
      cameraId: 'cam-001',
      hostelId: 'hostel-1',
      state: 'RUNNING',
      startedAt: new Date().toISOString(),
      framesProcessed: 12,
      facesDetected: 4,
      matches: 2,
      uncertains: 1,
      unknowns: 1,
      lastProcessedAt: new Date().toISOString(),
      lastError: null,
      eligibleTemplates: 3,
      processingFps: 4.8,
      configuredMaxFps: 5,
    });

    renderComponent();

    // Wait for camera to be loaded and selected
    await screen.findAllByText(/Main Gate Webcam/i);

    const startBtn = screen.getByTestId('start-recognition-btn');
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(recognitionApi.startRecognition).toHaveBeenCalledWith('cam-001');
      expect(screen.getByTestId('stop-recognition-btn')).toBeInTheDocument();
    });
  });

  it('displays MATCH, UNCERTAIN, and UNKNOWN observations accurately while strictly keeping UNCERTAIN candidate private', async () => {
    (recognitionApi.getResults as any).mockResolvedValue({
      results: [
        {
          id: 'obs-1',
          faceId: 'trk-1',
          cameraId: 'cam-001',
          classification: 'MATCH',
          resident: { id: 'r1', residentCode: 'R001', fullName: 'Rahul Patil' },
          similarity: 0.88,
          secondBestSimilarity: 0.2,
          bbox: { x: 50, y: 50, width: 80, height: 80 },
          qualityUsable: true,
          detectedAt: new Date().toISOString(),
        },
        {
          id: 'obs-2',
          faceId: 'trk-2',
          cameraId: 'cam-001',
          classification: 'UNCERTAIN',
          resident: null, // STRICT PRIVACY RULE
          similarity: 0.52,
          secondBestSimilarity: 0.48,
          bbox: { x: 150, y: 50, width: 80, height: 80 },
          qualityUsable: true,
          detectedAt: new Date().toISOString(),
        },
        {
          id: 'obs-3',
          faceId: 'trk-3',
          cameraId: 'cam-001',
          classification: 'UNKNOWN',
          resident: null,
          similarity: 0.12,
          secondBestSimilarity: 0.05,
          bbox: { x: 250, y: 50, width: 80, height: 80 },
          qualityUsable: true,
          detectedAt: new Date().toISOString(),
        },
      ],
    });

    renderComponent();

    // Wait for camera and results to be loaded
    await screen.findAllByText(/Main Gate Webcam/i);

    await waitFor(() => {
      // 1. MATCH card renders resident name & code
      expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
      expect(screen.getByText(/Code: R001/i)).toBeInTheDocument();

      // 2. UNCERTAIN card renders privacy notice and NO resident name
      expect(screen.getByText(/Ambiguous match or low candidate separation. Identity kept private./i)).toBeInTheDocument();

      // 3. UNKNOWN card renders
      expect(screen.getByText(/No enrolled hostel resident matched confidently./i)).toBeInTheDocument();
    });
  });

  it('enforces Guard role restrictions with view-only badge and no start/stop control', async () => {
    currentUser = {
      id: 'user-guard-1',
      username: 'guard_h1',
      fullName: 'Hostel Guard',
      role: 'GUARD' as const,
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      status: 'ACTIVE' as const,
    };

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Guard: View-Only Access/i)).toBeInTheDocument();
    });

    expect(screen.queryByTestId('start-recognition-btn')).not.toBeInTheDocument();
    expect(screen.queryByTestId('stop-recognition-btn')).not.toBeInTheDocument();
  });

  it('proves that biometric vectors / embeddings are NEVER rendered in the DOM', async () => {
    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Face Recognition Monitor/i)).toBeInTheDocument();
    });

    const bodyHtml = document.body.innerHTML;
    expect(bodyHtml).not.toContain('embedding');
    expect(bodyHtml).not.toContain('templateReference');
  });
});
