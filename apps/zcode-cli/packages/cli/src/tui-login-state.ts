import type { CommandCenterApp } from "./command-center.js";

/** Registry already applies provider availability, including personal providers. */
export function createTuiModelAvailabilityChecker(
  getApp: () => Promise<CommandCenterApp>,
): () => Promise<boolean> {
  return async () => {
    const app = await getApp();
    return ((await app.listModels?.()) ?? []).some((model) => !model.disabledReason);
  };
}
