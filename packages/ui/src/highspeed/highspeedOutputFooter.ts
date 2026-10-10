export type HighspeedOutputFooterTarget = {
  cardId: string;
  metrics: {
    outputTokens?: number;
    durationMs?: number;
    regularTps?: number;
    highspeedTps?: number;
    savedDurationMs?: number;
  };
};

/** 由 footer 收口逻辑写回渲染单元的标记字段，宿主类型只需声明这两个可选字段。 */
export interface HighspeedOutputFooterMark {
  showHighspeedOutputFooter?: true;
  highspeedOutputFooterTarget?: HighspeedOutputFooterTarget;
}

/** Ycode stub: Highspeed footer marking is a no-op. */
export function markHighspeedOutputFooterUnits<T>(
  units: readonly T[],
  _nowMs?: number,
): T[] {
  return [...units];
}
