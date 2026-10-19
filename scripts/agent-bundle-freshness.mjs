import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

// 构建产物与依赖目录不算源码；它们的 mtime 会随每次构建刷新，计入后 dist 永远显得陈旧。
const SKIPPED_DIRECTORY_NAMES = new Set(["node_modules", "dist"]);

/** bundle 不存在一律视为不新鲜；找不到任何源码时无从比较，视为新鲜。 */
export function isAgentBundleFresh({ bundleMtimeMs, sourceMtimeMs }) {
  if (bundleMtimeMs === undefined) return false;
  if (sourceMtimeMs === undefined) return true;
  return bundleMtimeMs >= sourceMtimeMs;
}

async function latestMtimeInDirectory(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
  const mtimes = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        return SKIPPED_DIRECTORY_NAMES.has(entry.name) ? undefined : latestMtimeInDirectory(path);
      }
      return entry.isFile() ? (await stat(path)).mtimeMs : undefined;
    }),
  );
  let latest;
  for (const mtime of mtimes) {
    if (mtime !== undefined && (latest === undefined || mtime > latest)) latest = mtime;
  }
  return latest;
}

/** 取 `<packagesRoot>/<pkg>/src/**` 的最新 mtime。 */
export async function latestCliSourceMtimeMs(packagesRoot) {
  const packages = await readdir(packagesRoot, { withFileTypes: true });
  const mtimes = await Promise.all(
    packages
      .filter((entry) => entry.isDirectory())
      .map((entry) => latestMtimeInDirectory(join(packagesRoot, entry.name, "src"))),
  );
  let latest;
  for (const mtime of mtimes) {
    if (mtime !== undefined && (latest === undefined || mtime > latest)) latest = mtime;
  }
  return latest;
}

export async function readAgentBundleFreshness({ bundlePath, packagesRoot }) {
  let bundleMtimeMs;
  try {
    bundleMtimeMs = (await stat(bundlePath)).mtimeMs;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (bundleMtimeMs === undefined) return { exists: false, fresh: false };
  const sourceMtimeMs = await latestCliSourceMtimeMs(packagesRoot);
  return { exists: true, fresh: isAgentBundleFresh({ bundleMtimeMs, sourceMtimeMs }) };
}
