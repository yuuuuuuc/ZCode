/** Ycode stub: Highspeed turn store removed. */
export type HighspeedShareMetrics = {
  outputTokens?: number;
  durationMs?: number;
  regularTps?: number;
  highspeedTps?: number;
  savedDurationMs?: number;
};

export type HighspeedTurn = {
  card: { cardId: string; expiresAt: number };
  metrics?: HighspeedShareMetrics;
  metricsPersistedAt?: number;
};

export function aggregateHighspeedCardMetrics(_cardId?: string): HighspeedShareMetrics {
  return {};
}

export function getHighspeedTurnByCommandId(_commandId?: string): HighspeedTurn | null {
  return null;
}

export function getHighspeedTurnVersion(): number {
  return 0;
}

export function subscribeHighspeedTurns(_listener: () => void): () => void {
  return () => {};
}
