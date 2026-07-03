import { z } from "zod";

export const SlotCreateInput = z.object({
  professionalId: z.string().uuid(),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  capacity: z.number().int().min(1).max(50).default(1),
  durationMinutes: z.number().int().min(5).max(480).default(15),
  label: z.string().max(80).optional(),
});
export type SlotCreateInput = z.infer<typeof SlotCreateInput>;

export const AppointmentBookInput = z.object({
  slotId: z.string().uuid(),
  customerId: z.string().uuid(),
  serviceName: z.string().max(120).optional(),
  notes: z.string().max(2000).optional(),
});
export type AppointmentBookInput = z.infer<typeof AppointmentBookInput>;

export const AppointmentConfirmByShortCode = z.object({
  shortCode: z.string().regex(/^[0-9A-Z]{6,10}$/),
  action: z.enum(["confirm", "reschedule", "cancel"]),
});
export type AppointmentConfirmByShortCode = z.infer<typeof AppointmentConfirmByShortCode>;
