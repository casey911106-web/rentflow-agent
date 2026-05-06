/**
 * Zod schemas shared between API DTOs and web-app forms / API client.
 * Keeping them here avoids drift between client + server validation.
 */
import { z } from 'zod';

export const phoneE164Schema = z
  .string()
  .regex(/^\+\d{6,15}$/, 'Phone must be E.164 (e.g. +971501234567)');

export const propertyTypeSchema = z.enum([
  'bed_space',
  'shared_room',
  'partition',
  'master_room',
  'studio',
  'one_bedroom',
  'two_bedroom',
  'three_bedroom',
  'villa',
  'other',
]);

export const propertyStatusSchema = z.enum([
  'draft',
  'available',
  'pending_owner_confirmation',
  'rented',
  'blocked',
  'unavailable',
  'archived',
  'needs_media',
  'needs_price_confirmation',
  'not_ready_to_post',
]);

export const leadStatusSchema = z.enum([
  'new',
  'contacted',
  'qualifying',
  'qualified',
  'options_sent',
  'viewing_requested',
  'viewing_scheduled',
  'viewing_completed',
  'negotiating',
  'won',
  'lost',
  'cold',
  'opted_out',
]);

export const viewingStatusSchema = z.enum([
  'requested',
  'confirmed',
  'assigned',
  'rescheduled',
  'cancelled',
  'no_show',
  'completed',
  'converted',
  'lost',
]);

// ----- DTOs ------------------------------------------------------------------

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});
export type LoginDto = z.infer<typeof loginSchema>;

export const createPropertySchema = z.object({
  name: z.string().min(2).max(120),
  type: propertyTypeSchema,
  area: z.string().optional(),
  priceAed: z.number().positive().optional(),
  depositAed: z.number().positive().optional(),
  description: z.string().optional(),
  ownerId: z.string().uuid().optional(),
  occupancyMax: z.number().int().positive().optional(),
});
export type CreatePropertyDto = z.infer<typeof createPropertySchema>;

export const generatePostPackageSchema = z.object({
  propertyId: z.string().uuid(),
  campaignId: z.string().uuid().optional(),
  channelId: z.string().uuid().optional(),
});
export type GeneratePostPackageDto = z.infer<typeof generatePostPackageSchema>;

export const markPublishedSchema = z.object({
  channelId: z.string().uuid().optional(),
  channelName: z.string().min(1).optional(),
  url: z.string().url().optional(),
});
export type MarkPublishedDto = z.infer<typeof markPublishedSchema>;

export const scheduleViewingSchema = z.object({
  leadId: z.string().uuid(),
  propertyId: z.string().uuid(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().positive().default(30),
  fieldAgentId: z.string().uuid().optional(),
});
export type ScheduleViewingDto = z.infer<typeof scheduleViewingSchema>;

export const updateViewingStatusSchema = z.object({
  status: viewingStatusSchema,
  notes: z.string().optional(),
});
export type UpdateViewingStatusDto = z.infer<typeof updateViewingStatusSchema>;

export const createDealSchema = z.object({
  leadId: z.string().uuid(),
  rentAmount: z.number().positive().optional(),
  depositAmount: z.number().positive().optional(),
  commissionAmount: z.number().positive().optional(),
  commissionPaidBy: z.enum(['tenant', 'owner', 'split']).optional(),
  moveInDate: z.string().datetime().optional(),
  rentalDurationMonths: z.number().int().positive().optional(),
});
export type CreateDealDto = z.infer<typeof createDealSchema>;
