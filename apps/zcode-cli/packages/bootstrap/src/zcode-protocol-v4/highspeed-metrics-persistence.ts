import type {
  HighspeedMessageMetadata,
  SessionEvent,
  SessionEventStorePort,
  SessionStorePort,
} from "@zcode/contracts";

/** Ycode stub: Highspeed metrics persistence removed; keep typed surface for call sites. */
export interface PersistHighspeedMetricsInput {
  sessionStore: SessionStorePort;
  eventStore: SessionEventStorePort;
  sessionId: string;
  messageId: string;
  entityId: string;
  metrics: {
    regularTps: number;
    outputTokens: number;
    durationMs: number;
    highspeedTps: number;
    savedDurationMs: number;
    modelDurationMs?: number;
    toolDurationMs?: number;
    otherDurationMs?: number;
  };
  traceId: string;
  now?: () => number;
  onPersistedEvent(event: SessionEvent): void;
  onLiveProjectionError?(error: unknown): void;
}

export interface PersistHighspeedTimingInput {
  sessionStore: SessionStorePort;
  eventStore: SessionEventStorePort;
  sessionId: string;
  sourceCommandId: string;
  timing: {
    modelDurationMs: number;
    toolDurationMs: number;
    otherDurationMs: number;
  };
  outputTokens?: number;
  durationMs?: number;
  fallbackAt?: number;
  fallbackReason?: HighspeedMessageMetadata["fallbackReason"];
  traceId: string;
  now?: () => number;
  onPersistedEvent(event: SessionEvent): void;
  onLiveProjectionError?(error: unknown): void;
}

export async function persistHighspeedMetrics(_input: PersistHighspeedMetricsInput): Promise<void> {}
export async function persistHighspeedTiming(_input: PersistHighspeedTimingInput): Promise<void> {}
export function loadHighspeedMetrics(): null {
  return null;
}
