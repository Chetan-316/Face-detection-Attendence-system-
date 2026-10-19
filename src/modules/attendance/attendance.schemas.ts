import { z } from 'zod';
import { AttendanceSessionType } from '@prisma/client';

const optionalDateString = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Must be a valid date')
  .optional()
  .nullable();

export const createAttendanceSessionSchema = z.object({
  hostelId: z.string().trim().max(100).optional().nullable(),
  title: z.string().trim().max(100, 'Title must be at most 100 characters').optional().nullable(),
  sessionType: z.nativeEnum(AttendanceSessionType).optional().nullable(),
  attendanceDate: optionalDateString,
  startTime: optionalDateString,
  endTime: optionalDateString,
  cameraId: z.string().trim().max(100).optional().nullable(),
  locationId: z.string().trim().max(100).optional().nullable(),
});
