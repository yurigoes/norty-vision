import { z } from "zod";

export const OrganizationCreateInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  name: z.string().min(2).max(120),
  legalName: z.string().max(200).optional(),
  document: z.string().max(20).optional(),
  documentType: z.enum(["cnpj", "cpf"]).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().max(30).optional(),
  defaultLocale: z.string().default("pt-BR"),
  defaultTimezone: z.string().default("America/Sao_Paulo"),
});
export type OrganizationCreateInput = z.infer<typeof OrganizationCreateInput>;

export const StoreCreateInput = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,40}$/),
  name: z.string().min(2).max(120),
  document: z.string().max(20).optional(),
  city: z.string().max(80).optional(),
  state: z.string().length(2).optional(),
  timezone: z.string().default("America/Sao_Paulo"),
  whatsappInstanceId: z.string().max(120).optional(),
});
export type StoreCreateInput = z.infer<typeof StoreCreateInput>;

export const MembershipInviteInput = z.object({
  email: z.string().email(),
  storeId: z.string().uuid().nullable(),
  roleSlug: z.string().regex(/^[a-z0-9-]{2,40}$/),
});
export type MembershipInviteInput = z.infer<typeof MembershipInviteInput>;
