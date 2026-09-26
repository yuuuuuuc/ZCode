import {
  ProviderConfigService,
  type ProviderConfigLayerSnapshot,
  type ProviderConfigLayerUpdate,
} from "@zcode/provider";
import { NodeZCodeBuiltinProviderConfigSource } from "./zcode-builtin-provider-config-source.js";
import {
  NodePersonalProviderConfigRepository,
  type PersonalProviderConfigRecoveryEvent,
} from "./personal-provider-config-repository.js";

export interface NodeProviderConfigRuntimeOptions {
  readonly zcodeBuiltinFilePath: string;
  readonly zcodeBuiltinActiveFilePath?: string;
  readonly onPersonalConfigRecovery?: (event: PersonalProviderConfigRecoveryEvent) => void;
  readonly onPersonalConfigPollingError?: (error: unknown) => void;
  readonly personalFilePath: string;
  readonly personalPollingIntervalMs?: number | false;
  readonly importLegacy?: (
    zcodeBuiltin: ProviderConfigLayerSnapshot,
  ) => Promise<ProviderConfigLayerUpdate | null>;
  readonly watch?: boolean;
}

/**
 * 组装一个 Node.js 进程内共享的 ZCode Built-in/Personal Config 运行边界。
 * Built-in 只读取随包基线（Active 仅作为本机可丢弃缓存），不做任何远端刷新。
 */
export class NodeProviderConfigRuntime {
  readonly configService: ProviderConfigService;
  readonly #zcodeBuiltinSource: NodeZCodeBuiltinProviderConfigSource;
  readonly #personalRepository: NodePersonalProviderConfigRepository;
  #startPromise: Promise<void> | null = null;
  #disposed = false;
  readonly #checkListeners = new Set<() => Promise<void>>();
  #checkTimer: ReturnType<typeof setInterval> | null = null;
  #checkInFlight: Promise<unknown> | null = null;

  constructor(options: NodeProviderConfigRuntimeOptions) {
    this.#zcodeBuiltinSource = new NodeZCodeBuiltinProviderConfigSource({
      bundledFilePath: options.zcodeBuiltinFilePath,
      activeFilePath: options.zcodeBuiltinActiveFilePath,
      watch: options.watch,
    });
    this.#personalRepository = new NodePersonalProviderConfigRepository({
      filePath: options.personalFilePath,
      onRecovery: options.onPersonalConfigRecovery,
      onPollingError: options.onPersonalConfigPollingError,
      pollingIntervalMs: options.personalPollingIntervalMs,
      ...(options.importLegacy
        ? {
            importLegacy: async () => options.importLegacy!(await this.#zcodeBuiltinSource.read()),
          }
        : {}),
    });
    this.configService = new ProviderConfigService({
      zcodeBuiltinSource: this.#zcodeBuiltinSource,
      personalRepository: this.#personalRepository,
    });
  }

  resolveZCodeBuiltinActiveFilePath(): Promise<string> {
    return Promise.resolve(this.#zcodeBuiltinSource.activeFilePath);
  }

  get personalRepository(): import("@zcode/provider").PersonalProviderConfigRepository {
    return this.#personalRepository;
  }

  /** 同一周期检查中恢复未对齐依赖，不被失败挡住。 */
  onDidCheckZCodeBuiltin(listener: () => Promise<void>): () => void {
    this.#checkListeners.add(listener);
    return () => this.#checkListeners.delete(listener);
  }

  start(): Promise<void> {
    if (this.#disposed) throw new Error("NodeProviderConfigRuntime 已 dispose");
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.configService.read().then(() => {
      if (this.#disposed) return;
      void this.#checkBackground();
      // 没有恢复 owner 时不建立周期任务。
      if (this.#checkListeners.size > 0) {
        this.#checkTimer = setInterval(() => {
          void this.#checkBackground();
        }, 60_000);
        this.#checkTimer.unref?.();
      }
    });
    this.#startPromise = startPromise;
    void startPromise.catch(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    return startPromise;
  }

  #checkBackground(): Promise<unknown> {
    if (this.#disposed) return Promise.resolve();
    if (this.#checkInFlight) return this.#checkInFlight;
    const check = Promise.allSettled(
      [...this.#checkListeners].map((listener) => Promise.resolve().then(listener)),
    ).finally(() => {
      if (this.#checkInFlight === check) this.#checkInFlight = null;
    });
    this.#checkInFlight = check;
    return check;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#checkTimer) clearInterval(this.#checkTimer);
    this.#checkTimer = null;
    this.#checkListeners.clear();
    this.configService.dispose();
    this.#personalRepository.dispose();
    this.#zcodeBuiltinSource.dispose();
  }
}

export function createNodeProviderConfigRuntime(
  options: NodeProviderConfigRuntimeOptions,
): NodeProviderConfigRuntime {
  return new NodeProviderConfigRuntime(options);
}
