import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ResidentDetailModal } from '../features/residents/ResidentDetailModal';
import { FaceEnrollmentModal } from '../features/residents/FaceEnrollmentModal';
import { FaceRevokeModal } from '../features/residents/FaceRevokeModal';
import { AuthProvider } from '../auth/AuthContext';
import { ToastProvider } from '../components/ToastContext';
import { authApi } from '../api/auth.api';
import { camerasApi } from '../api/cameras.api';
import { biometricsApi } from '../api/biometrics.api';
import { SafeResident } from '../types/resident.types';

vi.mock('../api/auth.api', () => ({
  authApi: {
    getMe: vi.fn(),
    login: vi.fn(),
  },
}));

vi.mock('../api/cameras.api', () => ({
  camerasApi: {
    listCameras: vi.fn(),
    startCamera: vi.fn(),
    getPreviewStreamUrl: vi.fn().mockReturnValue('http://localhost:3000/api/v1/cameras/cam-1/preview?token=xyz'),
  },
}));

vi.mock('../api/biometrics.api', () => ({
  biometricsApi: {
    startEnrollment: vi.fn(),
    getStatus: vi.fn(),
    captureFrame: vi.fn(),
    completeEnrollment: vi.fn(),
    cancelEnrollment: vi.fn(),
    revokeEnrollment: vi.fn(),
  },
}));

const mockResidentNotEnrolled: SafeResident = {
  id: 'res-not-enrolled',
  organizationId: 'org-1',
  hostelId: 'hostel-1',
  residentCode: 'R001',
  fullName: 'Aarav Sharma',
  roomGroup: 'Room 101',
  status: 'ACTIVE',
  faceEnrollmentStatus: 'NOT_ENROLLED',
  presence: { currentState: 'IN', lastMovementType: null, lastMovementTime: null, updatedAt: '2026-09-29T10:00:00Z' },
  createdAt: '2026-09-29T10:00:00Z',
  updatedAt: '2026-09-29T10:00:00Z',
};

const mockResidentEnrolled: SafeResident = {
  ...mockResidentNotEnrolled,
  id: 'res-enrolled',
  residentCode: 'R002',
  fullName: 'Kabir Verma',
  faceEnrollmentStatus: 'ENROLLED',
};

const savedOverrides: Array<[object, string, PropertyDescriptor | undefined]> = [];

function override(target: object, key: string, descriptor: PropertyDescriptor) {
  savedOverrides.push([target, key, Object.getOwnPropertyDescriptor(target, key)]);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
}

function restoreOverrides() {
  while (savedOverrides.length > 0) {
    const [target, key, descriptor] = savedOverrides.pop()!;
    if (descriptor) Object.defineProperty(target, key, descriptor);
    else delete (target as unknown as Record<string, unknown>)[key];
  }
}

function stubBrowserCamera() {
  const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
  override(navigator, 'mediaDevices', { value: { getUserMedia: vi.fn().mockResolvedValue(stream) } });
  override(HTMLVideoElement.prototype, 'videoWidth', { get: () => 640 });
  override(HTMLVideoElement.prototype, 'videoHeight', { get: () => 480 });
  override(HTMLMediaElement.prototype, 'play', { value: vi.fn().mockResolvedValue(undefined) });
  override(HTMLCanvasElement.prototype, 'getContext', { value: vi.fn().mockReturnValue({ drawImage: vi.fn() }) });
  override(HTMLCanvasElement.prototype, 'toDataURL', { value: vi.fn().mockReturnValue('data:image/jpeg;base64,AAAA') });
}

describe('Step 05: Face Enrollment & Revocation Frontend UI Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    localStorage.setItem('pravahax_access_token', 'test-token');

    (camerasApi.listCameras as any).mockResolvedValue({
      data: [
        {
          id: 'cam-webcam-1',
          name: 'Laptop Webcam',
          sourceType: 'WEBCAM',
          isEnabled: true,
          healthStatus: 'ONLINE',
        },
      ],
      count: 1,
    });

    (camerasApi.startCamera as any).mockResolvedValue({ data: { isActive: true } });
  });

  describe('1. Role-Aware Permission Display in Resident Details', () => {
    it('displays "Enroll Face" button for WARDEN or ADMIN when resident is NOT_ENROLLED', async () => {
      (authApi.getMe as any).mockResolvedValue({
        user: {
          id: 'u-warden',
          role: 'WARDEN',
          hostelId: 'hostel-1',
          organizationId: 'org-1',
        },
      });

      render(
        <MemoryRouter>
          <AuthProvider>
            <ToastProvider>
              <ResidentDetailModal
                isOpen={true}
                resident={mockResidentNotEnrolled}
                onClose={vi.fn()}
              />
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Enroll Face/i })).toBeInTheDocument();
      });

      // Revoke button should NOT be present since resident is NOT_ENROLLED
      expect(screen.queryByRole('button', { name: /Revoke Face Enrollment/i })).not.toBeInTheDocument();
    });

    it('displays "Re-enroll Face" and "Revoke Face Enrollment" buttons when resident is ENROLLED', async () => {
      (authApi.getMe as any).mockResolvedValue({
        user: {
          id: 'u-warden',
          role: 'WARDEN',
          hostelId: 'hostel-1',
          organizationId: 'org-1',
        },
      });

      render(
        <MemoryRouter>
          <AuthProvider>
            <ToastProvider>
              <ResidentDetailModal
                isOpen={true}
                resident={mockResidentEnrolled}
                onClose={vi.fn()}
              />
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Re-enroll Face/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Revoke Face Enrollment/i })).toBeInTheDocument();
      });
    });

    it('hides all biometric enrollment and revocation actions when user is GUARD', async () => {
      (authApi.getMe as any).mockResolvedValue({
        user: {
          id: 'u-guard',
          role: 'GUARD',
          hostelId: 'hostel-1',
          organizationId: 'org-1',
        },
      });

      render(
        <MemoryRouter>
          <AuthProvider>
            <ToastProvider>
              <ResidentDetailModal
                isOpen={true}
                resident={mockResidentNotEnrolled}
                onClose={vi.fn()}
              />
            </ToastProvider>
          </AuthProvider>
        </MemoryRouter>
      );

      await waitFor(() => {
        expect(screen.getByText('Face Recognition Status')).toBeInTheDocument();
      });

      expect(screen.queryByRole('button', { name: /Enroll Face/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Re-enroll Face/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /Revoke Face Enrollment/i })).not.toBeInTheDocument();
    });
  });

  describe('2. Face Enrollment Modal Lifecycle & Quality Gates', () => {
    afterEach(() => {
      restoreOverrides();
    });

    it('opens enrollment modal on the first angle with zero progress and starts an enrollment session', async () => {
      (biometricsApi.startEnrollment as any).mockResolvedValue({
        data: {
          sessionId: 'enr-test-1',
          residentId: mockResidentNotEnrolled.id,
          cameraId: 'cam-webcam-1',
          status: 'CAPTURING',
          requiredSamples: 7,
          acceptedSamples: 0,
          rejectedSamples: 0,
          progressPercentage: 0,
          isReady: false,
          lastQuality: null,
          expiresAt: '2026-09-30T10:00:00Z',
        },
      });

      (biometricsApi.captureFrame as any).mockResolvedValue({
        data: {
          sessionStatus: {
            sessionId: 'enr-test-1',
            residentId: mockResidentNotEnrolled.id,
            cameraId: 'cam-webcam-1',
            status: 'CAPTURING',
            requiredSamples: 7,
            acceptedSamples: 2,
            rejectedSamples: 1,
            progressPercentage: 29,
            isReady: false,
            lastQuality: {
              is_valid: true,
              rejection_reason: null,
              message: 'Good quality face sample detected',
              face_count: 1,
            },
            expiresAt: '2026-09-30T10:00:00Z',
          },
          quality: {
            is_valid: true,
            rejection_reason: null,
            message: 'Good quality face sample detected',
            face_count: 1,
          },
          sampleAccepted: true,
        },
      });

      render(
        <MemoryRouter>
          <ToastProvider>
            <FaceEnrollmentModal
              isOpen={true}
              resident={mockResidentNotEnrolled}
              onClose={vi.fn()}
              onSuccess={vi.fn()}
            />
          </ToastProvider>
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { name: /Enroll Face — Aarav Sharma/i })).toBeInTheDocument();
      expect(screen.getByText('Look straight at the camera')).toBeInTheDocument();
      expect(screen.getByText('Angle 1 of 5')).toBeInTheDocument();
      expect(screen.getByText('0 of 5 angles captured')).toBeInTheDocument();
      expect(screen.getByRole('progressbar', { name: /Angles captured/i })).toHaveAttribute('aria-valuenow', '0');

      await waitFor(() => {
        expect(biometricsApi.startEnrollment).toHaveBeenCalledWith(mockResidentNotEnrolled.id, 'cam-webcam-1');
      });

      // Verify biometric embedding values are NEVER rendered in the DOM
      expect(screen.queryByText(/0\.\d{5}/)).not.toBeInTheDocument();
      expect(screen.queryByText(/embedding/i)).not.toBeInTheDocument();
    });

    it('shows operator-readable feedback when a real Capture Front click is rejected for multiple faces', async () => {
      (biometricsApi.startEnrollment as any).mockResolvedValue({
        data: {
          sessionId: 'enr-test-1',
          residentId: mockResidentNotEnrolled.id,
          cameraId: 'cam-webcam-1',
          status: 'CAPTURING',
          requiredSamples: 7,
          acceptedSamples: 0,
          rejectedSamples: 0,
          progressPercentage: 0,
          isReady: false,
          lastQuality: null,
          expiresAt: '2026-09-30T10:00:00Z',
        },
      });

      (biometricsApi.captureFrame as any).mockResolvedValue({
        data: {
          sessionStatus: {
            sessionId: 'enr-test-1',
            residentId: mockResidentNotEnrolled.id,
            cameraId: 'cam-webcam-1',
            status: 'CAPTURING',
            requiredSamples: 7,
            acceptedSamples: 0,
            rejectedSamples: 1,
            progressPercentage: 0,
            isReady: false,
            lastQuality: {
              is_valid: false,
              rejection_reason: 'MULTIPLE_FACES',
              message: 'Multiple faces detected',
              face_count: 2,
            },
            expiresAt: '2026-09-30T10:00:00Z',
          },
          quality: {
            is_valid: false,
            rejection_reason: 'MULTIPLE_FACES',
            message: 'Multiple faces detected',
            face_count: 2,
          },
          sampleAccepted: false,
        },
      });

      stubBrowserCamera();

      render(
        <MemoryRouter>
          <ToastProvider>
            <FaceEnrollmentModal
              isOpen={true}
              resident={mockResidentNotEnrolled}
              onClose={vi.fn()}
              onSuccess={vi.fn()}
            />
          </ToastProvider>
        </MemoryRouter>
      );

      const captureButton = await screen.findByRole('button', { name: /Capture Front/i });
      await waitFor(() => expect(captureButton).toBeEnabled());
      fireEvent.click(captureButton);

      await waitFor(() => {
        expect(biometricsApi.captureFrame).toHaveBeenCalledWith(
          mockResidentNotEnrolled.id,
          'FRONT',
          'data:image/jpeg;base64,AAAA'
        );
      });

      expect(await screen.findByRole('alert')).toHaveTextContent(/Only one person should be visible/i);
      expect(screen.getByText('0 of 5 angles captured')).toBeInTheDocument();
    });

    it('cancels enrollment cleanly on Cancel button click', async () => {
      const onCloseMock = vi.fn();
      (biometricsApi.startEnrollment as any).mockResolvedValue({
        data: {
          sessionId: 'enr-test-1',
          residentId: mockResidentNotEnrolled.id,
          cameraId: 'cam-webcam-1',
          status: 'CAPTURING',
          requiredSamples: 7,
          acceptedSamples: 0,
          rejectedSamples: 0,
          progressPercentage: 0,
          isReady: false,
          lastQuality: null,
          expiresAt: '2026-09-30T10:00:00Z',
        },
      });

      render(
        <MemoryRouter>
          <ToastProvider>
            <FaceEnrollmentModal
              isOpen={true}
              resident={mockResidentNotEnrolled}
              onClose={onCloseMock}
              onSuccess={vi.fn()}
            />
          </ToastProvider>
        </MemoryRouter>
      );

      const cancelBtn = screen.getByRole('button', { name: /^Cancel$/i });
      fireEvent.click(cancelBtn);

      await waitFor(() => {
        expect(onCloseMock).toHaveBeenCalled();
        expect(biometricsApi.cancelEnrollment).toHaveBeenCalledWith(mockResidentNotEnrolled.id);
      });
    });
  });

  describe('3. Face Revocation Modal Workflow', () => {
    it('requires mandatory revocation reason and triggers revocation API', async () => {
      (biometricsApi.revokeEnrollment as any).mockResolvedValue({
        data: {
          message: 'Face enrollment revoked successfully',
          residentId: mockResidentEnrolled.id,
          status: 'REVOKED',
        },
      });

      const onSuccessMock = vi.fn();
      const onCloseMock = vi.fn();

      render(
        <MemoryRouter>
          <ToastProvider>
            <FaceRevokeModal
              isOpen={true}
              resident={mockResidentEnrolled}
              onClose={onCloseMock}
              onSuccess={onSuccessMock}
            />
          </ToastProvider>
        </MemoryRouter>
      );

      expect(screen.getByRole('heading', { name: /Revoke Face Enrollment/i })).toBeInTheDocument();
      expect(screen.getByText(/Privacy & Security Safeguard:/i)).toBeInTheDocument();

      const textarea = screen.getByLabelText(/Reason/i);
      const submitBtn = screen.getByRole('button', { name: /Confirm Revocation/i });

      // Enter reason and submit
      fireEvent.change(textarea, { target: { value: 'Student requested biometric removal upon hostel exit' } });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(biometricsApi.revokeEnrollment).toHaveBeenCalledWith(
          mockResidentEnrolled.id,
          'Student requested biometric removal upon hostel exit'
        );
        expect(onSuccessMock).toHaveBeenCalledWith(
          expect.objectContaining({ faceEnrollmentStatus: 'REVOKED' })
        );
        expect(onCloseMock).toHaveBeenCalled();
      });
    });
  });
});
