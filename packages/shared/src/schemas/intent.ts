import { z } from "zod";
import { IntentClass } from "../enums";

export const IntentKeywordCreate = z.object({
  intent: z.nativeEnum(IntentClass),
  keyword: z.string().min(1).max(120),
  matchType: z.enum(["exact", "contains", "regex", "starts_with"]).default("contains"),
  weight: z.number().min(0).max(1).default(1),
});
export type IntentKeywordCreate = z.infer<typeof IntentKeywordCreate>;

export const ClassifyMessageInput = z.object({
  text: z.string().min(1).max(4000),
  appointmentShortCode: z.string().optional(),
  customerId: z.string().uuid().optional(),
});
export type ClassifyMessageInput = z.infer<typeof ClassifyMessageInput>;

export const ClassifyMessageResult = z.object({
  intent: z.nativeEnum(IntentClass),
  score: z.number().min(0).max(1),
  source: z.enum(["exact", "keywords", "llm", "manual"]),
  matchedKeywords: z.array(z.string()).optional(),
  alternates: z
    .array(z.object({ intent: z.nativeEnum(IntentClass), score: z.number() }))
    .optional(),
});
export type ClassifyMessageResult = z.infer<typeof ClassifyMessageResult>;
