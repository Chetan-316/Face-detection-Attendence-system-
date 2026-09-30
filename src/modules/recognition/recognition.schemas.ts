import { z } from 'zod';

export const startRecognitionSchema = z.object({
  cameraId: z.string().uuid({ message: 'Invalid camera ID format' }).optional(),
});
