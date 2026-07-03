import { z } from "zod";

export const LoginInput = z.object({
  email: z.string().email().max(320).trim().toLowerCase(),
  password: z.string().min(8).max(256),
  mfaCode: z.string().regex(/^\d{6}$/).optional(),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const SignupInput = z.object({
  email: z.string().email().max(320).trim().toLowerCase(),
  name: z.string().min(2).max(120).trim(),
  password: z
    .string()
    .min(12, "Senha precisa ter no minimo 12 caracteres")
    .max(256)
    .refine((v) => /[a-z]/.test(v), "Inclua letra minuscula")
    .refine((v) => /[A-Z]/.test(v), "Inclua letra maiuscula")
    .refine((v) => /\d/.test(v), "Inclua numero"),
  organizationSlug: z.string().regex(/^[a-z0-9-]{3,40}$/).optional(),
});
export type SignupInput = z.infer<typeof SignupInput>;

export const TechSpecUnlockInput = z.object({
  accessPassword: z.string().min(8).max(256),
});
export type TechSpecUnlockInput = z.infer<typeof TechSpecUnlockInput>;
