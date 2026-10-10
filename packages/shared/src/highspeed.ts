import { z } from "zod";

/** Ycode: Highspeed product UI/card flow remains disabled; schema matches contracts for typecheck. */
export const HIGHSPEED_CARD_EXPIRED_PROVIDER_ERROR_CODE = "3402";

export const highspeedMessageMetaSchema = z
  .object({
    schemaVersion: z.literal(1),
    cardId: z.string().min(1),
    taskId: z.string().min(1),
    provider: z.string().min(1),
    model: z.string().min(1),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    regularTps: z.number().positive().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    durationMs: z.number().nonnegative().optional(),
    highspeedTps: z.number().positive().optional(),
    savedDurationMs: z.number().nonnegative().optional(),
    modelDurationMs: z.number().nonnegative().optional(),
    toolDurationMs: z.number().nonnegative().optional(),
    otherDurationMs: z.number().nonnegative().optional(),
    fallbackAt: z.number().int().nonnegative().optional(),
    fallbackReason: z
      .enum(["highspeed_card_expired", "highspeed_request_failed"])
      .optional(),
  })
  .strict();

export type HighspeedMessageMeta = z.infer<typeof highspeedMessageMetaSchema>;
export type HighspeedCardSnapshot = null;

export function isHighspeedProviderId(_id?: string): boolean {
  return false;
}

export function resolveHighspeedProviderId(_family: "zai" | "bigmodel"): string {
  return "account:disabled-highspeed-card";
}

export function resolveHighspeedDrawProviderId(_providerId: string): string | null {
  return null;
}
