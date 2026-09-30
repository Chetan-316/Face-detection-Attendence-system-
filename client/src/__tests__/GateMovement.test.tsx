import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RecognitionPage } from '../pages/RecognitionPage';
import { ToastProvider } from '../components/ToastContext';
import { camerasApi } from '../api/cameras.api';
import { recognitionApi } from '../api/recognition.api';
import { movementsApi } from '../api/movements.api';

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
    getStreamToken: vi.fn().mockResolvedValue({ streamToken: 'mock_stream_token_123', expiresIn: 60 }),
    getEventsStreamUrl: vi.fn((id: string, st?: string) => `http://mock-api/cameras/${id}/recognition/events?streamToken=${st || ''}`),
  },
}));

vi.mock('../api/movements.api', () => ({
  movementsApi: {
    getMovements: vi.fn().mockResolvedValue({
      data: [
        {
          id: 'mov-1',
          residentId: 'res-1',
          hostelId: 'hostel-1',
          movementType: 'IN',
          source: 'FACE_RECOGNITION',
          effectiveTimestamp: new Date().toISOString(),
          resident: { fullName: 'Rahul Patil', residentCode: 'R001' },
          camera: { name: 'Main Ingress Gate' },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 15,
      totalPages: 1,
    }),
    getAutomationStatus: vi.fn().mockResolvedValue({
      globalAutomationEnabled: true,
      minTransitionIntervalMs: 5000,
    }),
    getPresenceCounts: vi.fn().mockResolvedValue({
      totalResidents: 100,
      currentlyIn: 82,
      currentlyOut: 18,
    }),
  },
}));

describe('Step 07: Frontend Gate Movement & Automation Interface Tests', () => {
  const mockCameras = [
    {
      id: 'cam-in-01',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      name: 'Main Ingress Gate',
      sourceType: 'WEBCAM',
      role: 'IN',
      isEnabled: true,
      healthStatus: 'ONLINE',
      configMetadata: { movementAutomationEnabled: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: 'cam-out-01',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      name: 'Main Egress Gate',
      sourceType: 'WEBCAM',
      role: 'OUT',
      isEnabled: true,
      healthStatus: 'ONLINE',
      configMetadata: { movementAutomationEnabled: true },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();

    (camerasApi.listCameras as any).mockResolvedValue({
      data: mockCameras,
      count: 2,
    });

    (recognitionApi.getStatus as any).mockResolvedValue({
      sessionId: 'sess-123',
      cameraId: 'cam-in-01',
      hostelId: 'hostel-1',
      state: 'RUNNING',
      startedAt: new Date().toISOString(),
      framesProcessed: 50,
      facesDetected: 10,
      matches: 5,
      uncertains: 1,
      unknowns: 2,
      qualityInsufficients: 1,
      lastProcessedAt: new Date().toISOString(),
      lastError: null,
      eligibleTemplates: 15,
      processingFps: 12.5,
      configuredMaxFps: 15,
    });
  });

  const renderComponent = () =>
    render(
      <ToastProvider>
        <RecognitionPage />
      </ToastProvider>
    );

  it('renders IN camera role and active movement automation indicator', async () => {
    (recognitionApi.getResults as any).mockResolvedValue({ results: [] });

    renderComponent();

    await waitFor(() => {
      expect(screen.getAllByText(/Main Ingress Gate/).length).toBeGreaterThan(0);
      expect(screen.getAllByText('IN').length).toBeGreaterThan(0);
      expect(screen.getByTestId('movement-automation-indicator')).toHaveTextContent(
        'Movement automation: ENABLED'
      );
    });
  });

  it('displays accurate hostel presence counts (Inside & Outside)', async () => {
    (recognitionApi.getResults as any).mockResolvedValue({ results: [] });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Inside hostel:')).toBeInTheDocument();
      expect(screen.getByText('82')).toBeInTheDocument();
      expect(screen.getByText('Outside hostel:')).toBeInTheDocument();
      expect(screen.getByText('18')).toBeInTheDocument();
    });
  });

  it('renders MOVEMENT: IN RECORDED for successful transition', async () => {
    const mockObs = [
      {
        id: 'obs-match-1',
        faceId: 'track-1',
        cameraId: 'cam-in-01',
        classification: 'MATCH' as const,
        resident: { id: 'res-1', residentCode: 'R001', fullName: 'Rahul Patil' },
        similarity: 0.88,
        bbox: { x: 50, y: 50, width: 100, height: 100 },
        qualityUsable: true,
        detectedAt: new Date().toISOString(),
        movementDecision: {
          status: 'MOVEMENT_CREATED' as const,
          direction: 'IN' as const,
          movementEventId: 'mov-1',
          currentPresence: 'IN' as const,
          cameraId: 'cam-in-01',
          timestamp: new Date().toISOString(),
        },
      },
    ];

    (recognitionApi.getResults as any).mockResolvedValue({ results: mockObs });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
      expect(screen.getByText(/IN RECORDED/i)).toBeInTheDocument();
    });
  });

  it('renders "Already IN — duplicate suppressed" when resident is already IN', async () => {
    const mockObs = [
      {
        id: 'obs-match-dup',
        faceId: 'track-1',
        cameraId: 'cam-in-01',
        classification: 'MATCH' as const,
        resident: { id: 'res-1', residentCode: 'R001', fullName: 'Rahul Patil' },
        similarity: 0.88,
        bbox: { x: 50, y: 50, width: 100, height: 100 },
        qualityUsable: true,
        detectedAt: new Date().toISOString(),
        movementDecision: {
          status: 'ALREADY_IN' as const,
          currentPresence: 'IN' as const,
          cameraId: 'cam-in-01',
          timestamp: new Date().toISOString(),
        },
      },
    ];

    (recognitionApi.getResults as any).mockResolvedValue({ results: mockObs });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Already IN — duplicate suppressed/i)).toBeInTheDocument();
    });
  });

  it('renders "UNKNOWN No movement action" for non-enrolled person', async () => {
    const mockObs = [
      {
        id: 'obs-unknown-1',
        faceId: 'track-99',
        cameraId: 'cam-in-01',
        classification: 'UNKNOWN' as const,
        resident: null,
        bbox: { x: 50, y: 50, width: 100, height: 100 },
        qualityUsable: true,
        detectedAt: new Date().toISOString(),
      },
    ];

    (recognitionApi.getResults as any).mockResolvedValue({ results: mockObs });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/UNKNOWN No movement action/i)).toBeInTheDocument();
    });
  });

  it('renders "UNCERTAIN No movement action" for ambiguous face detection', async () => {
    const mockObs = [
      {
        id: 'obs-uncertain-1',
        faceId: 'track-55',
        cameraId: 'cam-in-01',
        classification: 'UNCERTAIN' as const,
        resident: null,
        bbox: { x: 50, y: 50, width: 100, height: 100 },
        qualityUsable: true,
        detectedAt: new Date().toISOString(),
      },
    ];

    (recognitionApi.getResults as any).mockResolvedValue({ results: mockObs });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/UNCERTAIN No movement action/i)).toBeInTheDocument();
    });
  });

  it('renders "QUALITY INSUFFICIENT No movement action" for low quality face detection', async () => {
    const mockObs = [
      {
        id: 'obs-qual-1',
        faceId: 'track-44',
        cameraId: 'cam-in-01',
        classification: 'QUALITY_INSUFFICIENT' as const,
        resident: null,
        bbox: { x: 50, y: 50, width: 100, height: 100 },
        qualityUsable: false,
        qualityReason: 'TOO_BLURRY',
        detectedAt: new Date().toISOString(),
      },
    ];

    (recognitionApi.getResults as any).mockResolvedValue({ results: mockObs });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/QUALITY INSUFFICIENT No movement action/i)).toBeInTheDocument();
    });
  });

  it('renders "Movement automation disabled" when automation switch is off', async () => {
    const mockObs = [
      {
        id: 'obs-match-auto-off',
        faceId: 'track-1',
        cameraId: 'cam-in-01',
        classification: 'MATCH' as const,
        resident: { id: 'res-1', residentCode: 'R001', fullName: 'Rahul Patil' },
        similarity: 0.88,
        bbox: { x: 50, y: 50, width: 100, height: 100 },
        qualityUsable: true,
        detectedAt: new Date().toISOString(),
        movementDecision: {
          status: 'AUTOMATION_DISABLED' as const,
          cameraId: 'cam-in-01',
          timestamp: new Date().toISOString(),
        },
      },
    ];

    (recognitionApi.getResults as any).mockResolvedValue({ results: mockObs });

    renderComponent();

    await waitFor(() => {
      expect(screen.getByText(/Movement automation disabled — No movement recorded/i)).toBeInTheDocument();
    });
  });

  it('strictly verifies biometric vectors and raw embeddings are NEVER rendered in the DOM', async () => {
    const mockObs = [
      {
        id: 'obs-match-safe',
        faceId: 'track-1',
        cameraId: 'cam-in-01',
        classification: 'MATCH' as const,
        resident: { id: 'res-1', residentCode: 'R001', fullName: 'Rahul Patil' },
        similarity: 0.88,
        bbox: { x: 50, y: 50, width: 100, height: 100 },
        qualityUsable: true,
        detectedAt: new Date().toISOString(),
        movementDecision: {
          status: 'MOVEMENT_CREATED' as const,
          direction: 'IN' as const,
          movementEventId: 'mov-1',
          currentPresence: 'IN' as const,
          cameraId: 'cam-in-01',
          timestamp: new Date().toISOString(),
        },
      },
    ];

    (recognitionApi.getResults as any).mockResolvedValue({ results: mockObs });

    const { container } = renderComponent();

    await waitFor(() => {
      expect(screen.getByText('Rahul Patil')).toBeInTheDocument();
    });

    const domHtml = container.innerHTML;
    expect(domHtml).not.toContain('vector');
    expect(domHtml).not.toContain('embedding');
    expect(domHtml).not.toContain('templateReference');
  });
});
