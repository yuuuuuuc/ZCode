import type { ProviderConfigObject } from "@zcode/provider";

/** 是否展示原生视觉徽标。 */
export function shouldShowModelVisionBadge(
  modelId: string,
  supportsImage: boolean | null | undefined,
  access?: ProviderConfigObject["access"],
): boolean {
  if (supportsImage !== true) return false;
  // 旧内置供应商已整体退出；不再存在服务端桥接视觉的展示例外。
  void access;
  return true;
}
