import { z } from "zod";

/** Ycode stub: 上游 Highspeed 加速卡已移除，仅保留协议兼容的空 schema。 */
export const highspeedMessageMetaSchema = z.object({}).passthrough();
export type HighspeedMessageMeta = z.infer<typeof highspeedMessageMetaSchema>;
export type HighspeedCardSnapshot = null;

export function isHighspeedProviderId(_id?: string): boolean { return false; }
