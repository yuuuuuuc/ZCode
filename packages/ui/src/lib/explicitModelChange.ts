import type { ModelSelection } from "@zcode/shared";

/** 判断新选择是否与上一次选择构成显式模型变更。 */
export function hasExplicitModelChanged(
  previous: ModelSelection | null | undefined,
  next: ModelSelection | null | undefined,
): next is ModelSelection {
  return Boolean(
    next && (previous?.providerId !== next.providerId || previous.modelId !== next.modelId),
  );
}
