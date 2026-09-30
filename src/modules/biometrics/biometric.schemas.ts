import { z } from 'zod';

export const startEnrollmentSchema = z
  .object({
    cameraId: z.string().optional(),
  })
  .optional()
  .default({});

export const captureFrameSchema = z
  .object({
    frameBase64: z.string().optional(),
    mockOverride: z.any().optional(),
  })
  .optional()
  .default({});

export const revokeEnrollmentSchema = z.object({
  reason: z.string().min(1, 'Reason is mandatory for revoking biometric enrollment'),
});

export const invalidateEnrollmentSchema = z.object({
  reason: z.string().min(1, 'Reason is mandatory for setting re-enrollment requirement'),
});
