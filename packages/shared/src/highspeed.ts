import { z } from "zod";

/** Ycode stub: 上游 Highspeed 加速卡已移除；保留最小字段以兼容渲染类型。 */
export const highspeedMessageMetaSchema = z
  .object({
    cardId: z.string().optional(),
    expiresAt: z.number().optional(),
    savedDurationMs: z.number().optional(),
    outputTokens: z.number().optional(),
    highspeedTps: z.number().optional(),
    regularTps: z.number().optional(),
    durationMs: z.number().optional(),
  })
  .passthrough();
export type HighspeedMessageMeta = z.infer<typeof highspeedMessageMetaSchema>;
export type HighspeedCardSnapshot = null;

export function isHighspeedProviderId(_id?: string): boolean {
  return false;
}
