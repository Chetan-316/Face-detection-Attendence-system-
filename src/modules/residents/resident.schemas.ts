import { z } from 'zod';
import { PresenceState, ResidentStatus, FaceEnrollmentStatus } from '@prisma/client';

export const createResidentSchema = z.object({
  residentCode: z
    .string()
    .trim()
    .min(1, 'Resident code is required')
    .max(50, 'Resident code must be at most 50 characters'),
  fullName: z
    .string()
    .trim()
    .min(1, 'Resident full name is required')
    .max(100, 'Resident full name must be at most 100 characters'),
  roomGroup: z
    .string()
    .trim()
    .min(1, 'Room/group is required')
    .max(50, 'Room/group must be at most 50 characters'),
  contactPhone: z
    .string()
    .trim()
    .max(25, 'Contact phone must be at most 25 characters')
    .optional()
    .nullable(),
  contactEmail: z
    .string()
    .trim()
    .email('Invalid contact email format')
    .optional()
    .nullable()
    .or(z.literal('')),
  initialPresence: z
    .nativeEnum(PresenceState)
    .optional()
    .default(PresenceState.OUT),
  hostelId: z.string().trim().optional(),
});

export const registerRegularComerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, 'Full name is required')
    .max(100, 'Full name must be at most 100 characters'),
  category: z
    .string()
    .trim()
    .max(50, 'Category must be at most 50 characters')
    .optional()
    .default('Regular Visitor'),
  contactPhone: z
    .string()
    .trim()
    .max(25, 'Contact phone must be at most 25 characters')
    .optional()
    .nullable(),
  code: z
    .string()
    .trim()
    .max(50, 'Code must be at most 50 characters')
    .optional(),
  markInNow: z
    .boolean()
    .optional()
    .default(true),
  hostelId: z.string().trim().optional(),
});

export type RegisterRegularComerDTO = z.infer<typeof registerRegularComerSchema>;

export const updateResidentSchema = z
  .object({
    residentCode: z
      .string()
      .trim()
      .min(1, 'Resident code cannot be empty')
      .max(50, 'Resident code must be at most 50 characters')
      .optional(),
    fullName: z
      .string()
      .trim()
      .min(1, 'Full name cannot be empty')
      .max(100, 'Full name must be at most 100 characters')
      .optional(),
    roomGroup: z
      .string()
      .trim()
      .min(1, 'Room/group cannot be empty')
      .max(50, 'Room/group must be at most 50 characters')
      .optional(),
    contactPhone: z
      .string()
      .trim()
      .max(25, 'Contact phone must be at most 25 characters')
      .optional()
      .nullable(),
    contactEmail: z
      .string()
      .trim()
      .email('Invalid contact email format')
      .optional()
      .nullable()
      .or(z.literal('')),
  })
  .strict()
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'At least one field must be provided to update' }
  );

export const deactivateResidentSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Reason is mandatory for resident deactivation')
    .max(500, 'Reason must be at most 500 characters'),
});

export const reactivateResidentSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, 'Reason is mandatory for resident reactivation')
    .max(500, 'Reason must be at most 500 characters'),
});

export const listResidentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  pageSize: z.coerce.number().int().min(1, 'Page size must be at least 1').max(100, 'Page size cannot exceed 100').default(20),
  search: z.string().trim().optional(),
  status: z.nativeEnum(ResidentStatus).optional(),
  presence: z.nativeEnum(PresenceState).optional(),
  faceEnrollmentStatus: z.nativeEnum(FaceEnrollmentStatus).optional(),
  roomGroup: z.string().trim().optional(),
  hostelId: z.string().trim().optional(),
});

export type CreateResidentDTO = z.infer<typeof createResidentSchema>;
export type UpdateResidentDTO = z.infer<typeof updateResidentSchema>;
export type DeactivateResidentDTO = z.infer<typeof deactivateResidentSchema>;
export type ReactivateResidentDTO = z.infer<typeof reactivateResidentSchema>;
export type ListResidentsQueryDTO = z.infer<typeof listResidentsQuerySchema>;
