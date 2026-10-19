import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import { GatePage } from '../pages/GatePage';
import { ToastProvider } from '../components/ToastContext';
import { camerasApi } from '../api/cameras.api';
import { recognitionApi } from '../api/recognition.api';
import { movementsApi } from '../api/movements.api';
import { ApiError } from '../api/client';
import type { RecognitionObservation, RecognitionSessionStatus } from '../types/recognition.types';

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 'user-guard-1',
      username: 'guard_h1',
      fullName: 'Guard H1',
      role: 'GUARD',
      organizationId: 'org-1',
      hostelId: 'hostel-1',
      status: 'ACTIVE',
    },
    token: 'mock_jwt_token',
    isAuthenticated: true,
    isLoading: false,
  }),
}));

vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => vi.fn(),
}));

vi.mock('../hooks/usePreviewStreamUrl', () => ({
  usePreviewStreamUrl: () => '',
}));

vi.mock('../components/AuthenticatedImage', () => ({
  AuthenticatedImage: () => null,
}));

vi.mock('../api/cameras.api', () => ({
  camerasApi: { listCameras: vi.fn() },
}));

vi.mock('../api/recognition.api', () => ({
  recognitionApi: {
    getStreamToken: vi.fn(),
    getStatus: vi.fn(),
    getEventsStreamUrl: vi.fn((id: string) => `http://mock-api/cameras/${id}/recognition/events`),
    getResults: vi.fn(),
    processFrame: vi.fn(),
  },
}));

vi.mock('../api/movements.api', () => ({
  movementsApi: {
    getPresenceCounts: vi.fn(),
    getMovements: vi.fn(),
    getResidentPresence: vi.fn(),
    confirmMovement: vi.fn(),
  },
}));

vi.mock('../api/residents.api', () => ({
  residentsApi: { getProfilePhotoUrl: (id: string) => `http://mock-api/residents/${id}/photo` },
}));

const CAMERA_ID = 'cam-gate-in';
const RESIDENT = { id: 'res-1', residentCode: 'R001', fullName: 'Rahul Patil', roomGroup: 'Room-101' };

class MockEventSource {
  static instances: MockEventSource[] = [];
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, (event: MessageEvent) => void>();

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, listener);
  }

  close() {}

  emit(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) } as MessageEvent);
  }
}

function observation(overrides: Partial<RecognitionObservation> = {}): RecognitionObservation {
  return {
    id: 'rec_obs_1',
    faceId: 'face-1',
    cameraId: CAMERA_ID,
    classification: 'MATCH',
    resident: RESIDENT,
    bbox: { x: 0, y: 0, width: 10, height: 10 },
    qualityUsable: true,
    detectedAt: new Date().toISOString(),
    isStable: true,
    shouldEmitEvent: true,
    ...overrides,
  } as RecognitionObservation;
}

function movementCreated(direction: 'IN' | 'OUT' = 'IN') {
  return {
    status: 'MOVEMENT_CREATED',
    direction,
    currentPresence: direction,
    previousPresence: direction === 'IN' ? 'OUT' : 'IN',
    movementEventId: 'mv-1',
    residentId: RESIDENT.id,
    cameraId: CAMERA_ID,
    timestamp: new Date().toISOString(),
  } as RecognitionObservation['movementDecision'];
}

function runningStatus(): RecognitionSessionStatus {
  return {
    sessionId: 'sess-1',
    cameraId: CAMERA_ID,
    hostelId: 'hostel-1',
    state: 'RUNNING',
    startedAt: new Date().toISOString(),
    framesProcessed: 0,
    facesDetected: 0,
    matches: 0,
    uncertains: 0,
    unknowns: 0,
    qualityInsufficients: 0,
    lastProcessedAt: null,
    lastError: null,
    eligibleTemplates: 1,
    processingFps: 0,
    configuredMaxFps: 10,
  } as RecognitionSessionStatus;
}

function renderGate() {
  return render(
    <ToastProvider>
      <GatePage />
    </ToastProvider>
  );
}

async function deliver(observationPayload: RecognitionObservation) {
  const source = MockEventSource.instances.at(-1)!;
  await act(async () => {
    source.emit('observation', observationPayload);
  });
}

describe('GatePage observation dedupe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);

    vi.mocked(camerasApi.listCameras).mockResolvedValue({
      data: [
        {
          id: CAMERA_ID,
          organizationId: 'org-1',
          hostelId: 'hostel-1',
          name: 'Main Gate IN',
          sourceType: 'RTSP',
          role: 'IN',
          isEnabled: true,
          healthStatus: 'ONLINE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      count: 1,
    } as any);
    vi.mocked(recognitionApi.getStreamToken).mockResolvedValue({ streamToken: 'st', expiresIn: 60 } as any);
    vi.mocked(recognitionApi.getStatus).mockResolvedValue(runningStatus());
    vi.mocked(recognitionApi.getResults).mockResolvedValue({ results: [] } as any);
    vi.mocked(movementsApi.getPresenceCounts).mockResolvedValue({
      totalResidents: 1,
      currentlyIn: 0,
      currentlyOut: 1,
    });
    vi.mocked(movementsApi.getMovements).mockResolvedValue({ data: [] } as any);
    vi.mocked(movementsApi.getResidentPresence).mockResolvedValue({ currentState: 'OUT' } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function openStream() {
    renderGate();
    await waitFor(() => expect(MockEventSource.instances.length).toBe(1));
    await waitFor(() => expect(movementsApi.getMovements).toHaveBeenCalled());
    return vi.mocked(movementsApi.getMovements).mock.calls.length;
  }

  it('shows the automatic record when the movement decision arrives after the identity', async () => {
    const baseline = await openStream();
    await deliver(observation());
    expect(await screen.findByText('Resident identified')).toBeInTheDocument();
    expect(movementsApi.getMovements).toHaveBeenCalledTimes(baseline);

    await deliver(observation({ movementDecision: movementCreated('IN') }));
    expect(await screen.findByText('ENTRY RECORDED')).toBeInTheDocument();
    expect(screen.getByText('Recorded automatically. No guard action is needed.')).toBeInTheDocument();
    expect(movementsApi.getMovements).toHaveBeenCalledTimes(baseline + 1);
  });

  it('ignores identical re-deliveries of an observation already shown', async () => {
    const baseline = await openStream();
    await deliver(observation());
    await screen.findByText('Resident identified');
    await deliver(observation());
    await deliver(observation());

    expect(screen.getByText('Resident identified')).toBeInTheDocument();
    expect(movementsApi.getResidentPresence).toHaveBeenCalledTimes(1);
    expect(movementsApi.getMovements).toHaveBeenCalledTimes(baseline);
  });

  it('does not re-open the recorded result or refresh movements for repeated or stale deliveries', async () => {
    const baseline = await openStream();
    await deliver(observation());
    await screen.findByText('Resident identified');
    await deliver(observation({ movementDecision: movementCreated('IN') }));
    await screen.findByText('ENTRY RECORDED');
    const afterDecision = vi.mocked(movementsApi.getMovements).mock.calls.length;
    expect(afterDecision).toBe(baseline + 1);

    await deliver(observation({ movementDecision: movementCreated('IN') }));
    await deliver(observation());

    expect(screen.getByText('ENTRY RECORDED')).toBeInTheDocument();
    expect(screen.queryByText('Resident identified')).not.toBeInTheDocument();
    expect(movementsApi.getMovements).toHaveBeenCalledTimes(afterDecision);
  });

  it('does not record a second movement for the same resident while the first result is held', async () => {
    const baseline = await openStream();
    await deliver(observation({ id: 'rec_first', movementDecision: movementCreated('IN') }));
    await screen.findByText('ENTRY RECORDED');
    const afterFirst = vi.mocked(movementsApi.getMovements).mock.calls.length;
    expect(afterFirst).toBe(baseline + 1);

    await deliver(observation({ id: 'rec_second', movementDecision: movementCreated('OUT') }));

    expect(screen.getByText('ENTRY RECORDED')).toBeInTheDocument();
    expect(screen.queryByText('EXIT RECORDED')).not.toBeInTheDocument();
    expect(movementsApi.getMovements).toHaveBeenCalledTimes(afterFirst);
  });

  it('refreshes movements but does not reopen a dismissed card when its decision arrives late', async () => {
    const baseline = await openStream();
    await deliver(observation());
    await screen.findByText('Resident identified');
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    await screen.findByText('Ready for next resident');

    await deliver(observation({ movementDecision: movementCreated('IN') }));

    expect(screen.queryByText('ENTRY RECORDED')).not.toBeInTheDocument();
    expect(screen.getByText('Ready for next resident')).toBeInTheDocument();
    expect(movementsApi.getMovements).toHaveBeenCalledTimes(baseline + 1);
  });
});

describe('GatePage recognition readiness', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockEventSource.instances = [];
    vi.stubGlobal('EventSource', MockEventSource);

    vi.mocked(camerasApi.listCameras).mockResolvedValue({
      data: [
        {
          id: CAMERA_ID,
          organizationId: 'org-1',
          hostelId: 'hostel-1',
          name: 'Main Gate IN',
          sourceType: 'RTSP',
          role: 'IN',
          isEnabled: true,
          healthStatus: 'ONLINE',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      count: 1,
    } as any);
    vi.mocked(recognitionApi.getStreamToken).mockResolvedValue({ streamToken: 'st', expiresIn: 60 } as any);
    vi.mocked(recognitionApi.getResults).mockResolvedValue({ results: [] } as any);
    vi.mocked(recognitionApi.getStatus).mockResolvedValue(runningStatus());
    vi.mocked(movementsApi.getPresenceCounts).mockResolvedValue({
      totalResidents: 1,
      currentlyIn: 0,
      currentlyOut: 1,
    });
    vi.mocked(movementsApi.getMovements).mockResolvedValue({ data: [] } as any);
    vi.mocked(movementsApi.getResidentPresence).mockResolvedValue({ currentState: 'OUT' } as any);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not show Ready when the recognition engine is unavailable', async () => {
    vi.mocked(recognitionApi.getStatus).mockRejectedValue(
      new ApiError(503, 'Biometric inference engine is unavailable', 'BIOMETRIC_WORKER_UNAVAILABLE')
    );
    renderGate();

    expect(
      await screen.findByText('The recognition engine is unavailable. Entries and exits are not recorded until it is back.')
    ).toBeInTheDocument();
    expect(screen.getByText('Recognition is not running')).toBeInTheDocument();
    expect(screen.queryByText('Ready for next resident')).not.toBeInTheDocument();
  });

  it('does not show Ready when the session is stopped', async () => {
    vi.mocked(recognitionApi.getStatus).mockResolvedValue({ ...runningStatus(), state: 'STOPPED' });
    renderGate();

    expect(await screen.findByText('Recognition is not running')).toBeInTheDocument();
    expect(screen.queryByText('Ready for next resident')).not.toBeInTheDocument();
  });

  it('does not show Ready when the status cannot be read for any other reason', async () => {
    vi.mocked(recognitionApi.getStatus).mockRejectedValue(new TypeError('Failed to fetch'));
    renderGate();

    expect(await screen.findByText('Recognition is not running')).toBeInTheDocument();
    expect(screen.queryByText('Ready for next resident')).not.toBeInTheDocument();
  });

  it('shows Ready once the session reports RUNNING', async () => {
    renderGate();

    expect(await screen.findByText('Ready for next resident')).toBeInTheDocument();
    expect(screen.queryByText('Recognition is not running')).not.toBeInTheDocument();
  });
});
