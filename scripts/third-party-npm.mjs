import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { join, relative } from "node:path";
import { parse as parseYaml } from "yaml";

export const hashBytes = (bytes) => createHash("sha256").update(bytes).digest("hex");
const unsupportedCanvas = new Set([
  "@napi-rs/canvas-android-arm64",
  "@napi-rs/canvas-linux-arm-gnueabihf",
  "@napi-rs/canvas-linux-riscv64-gnu",
]);
const noticeName =
  /(?:^|[._-])(?:licen[sc]es?|copying|notice|copyright|unlicense|third.party|ofl)(?:[._-]|$)/iu;

export async function readPackageNotices(directory) {
  const files = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (["node_modules", ".git", "test", "tests", "fixtures"].includes(entry.name)) continue;
      // Chromium 聚合许可由打包流程经 resources/licenses/electron 单独分发，不进 npm 通知。
      if (entry.isFile() && entry.name === "LICENSES.chromium.html") continue;
      const full = join(path, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && noticeName.test(entry.name)) {
        const bytes = await readFile(full);
        if (bytes.includes(0) || bytes.length === 0) continue;
        files.push({ member: relative(directory, full).replaceAll("\\", "/"), bytes });
      } else if (entry.isFile() && /^readme(?:\.[^/]*)?$/iu.test(entry.name)) {
        const text = await readFile(full, "utf8");
        const match = /^(?:#{1,6}\s+licen[sc]e[^\n]*\n|licen[sc]e\s*\n[=-]+\n)/imu.exec(text);
        if (match) {
          const section = text.slice(match.index).split(/\n(?=#{1,6}\s)/u)[0];
          files.push({
            member: `${relative(directory, full).replaceAll("\\", "/")} (license section)`,
            bytes: Buffer.from(section),
          });
        }
      }
    }
  }
  await visit(directory);
  return files.sort((a, b) => a.member.localeCompare(b.member, "en"));
}

function productionPackages(projects) {
  const own = new Set(projects.map((project) => project.name));
  const required = new Map();
  function dependencies(deps) {
    for (const [alias, info] of Object.entries(deps ?? {})) {
      const name = info.name ?? alias;
      if (!own.has(name) && !name.startsWith("@zcode/") && !info.version.startsWith("link:")) {
        required.set(`${name}@${info.version}`, { name, version: info.version });
      }
      dependencies(info.dependencies);
      dependencies(info.optionalDependencies);
    }
  }
  for (const project of projects) {
    dependencies(project.dependencies);
    dependencies(project.optionalDependencies);
  }
  return required;
}

export function assertProductionGraphs(lockedProjects, installedProjects) {
  const locked = productionPackages(lockedProjects);
  const installed = productionPackages(installedProjects);
  const missing = [...locked].filter(
    ([key, item]) => !installed.has(key) && !unsupportedCanvas.has(item.name),
  );
  const stale = [...installed.keys()].filter((key) => !locked.has(key));
  if (missing.length || stale.length) {
    throw new Error(
      `Installed production graph differs from pnpm-lock.yaml. Run pnpm install --frozen-lockfile.\nMissing: ${missing.map(([key]) => key).join(", ")}\nStale: ${stale.join(", ")}`,
    );
  }
  return locked;
}

// pnpm-lock.yaml 里 `packages` / `snapshots` 的键是 `<name>@<version>`，版本后面可能再跟
// 若干 peer 后缀（`1.2.3(react@19.2.7)`），而 `@` 在 scope 名与 peer 后缀里都会出现，
// 所以不能用 lastIndexOf("@") 找分隔符——它可能落在 peer 文本内部。
function splitSnapshotKey(key) {
  const separator = key.indexOf("@", key.startsWith("@") ? 1 : 0);
  return { name: key.slice(0, separator), version: key.slice(separator + 1).split("(")[0] };
}

/**
 * 从 pnpm-lock.yaml 还原 workspace 的生产依赖图。
 *
 * 原来这里并行跑两次 `pnpm -r ls --prod --json --depth Infinity`（一次 --lockfile-only、
 * 一次读安装快照）再比对。Windows 上 pnpm 自身的依赖枚举会撞 EMFILE（本进程句柄上限约
 * 8192），连 `--lockfile-only --depth 0` 都打不开，pnpm 的 graceful-fs 重试也救不回来。
 *
 * 锁文件已经是生产图的权威来源：importers 给出每个 workspace 项目声明的直接依赖，
 * snapshots 给出传递闭包。这里顺序读取两者，自行按精确版本展开生产图，不再 spawn pnpm，
 * 也就不再受句柄上限影响。
 */
async function readWorkspaceProductionProjects(root) {
  const lock = parseYaml(await readFile(join(root, "pnpm-lock.yaml"), "utf8"));
  const snapshots = lock.snapshots ?? {};
  const projects = [];
  const required = new Map();
  const own = new Set();
  for (const [projectPath, importer] of Object.entries(lock.importers ?? {})) {
    const directory = join(root, projectPath);
    const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    own.add(manifest.name);
    projects.push({ path: directory, name: manifest.name, dependencies: importer.dependencies });
  }
  // 迭代遍历闭包图：snapshots 里同一 key 会被多条路径共享，甚至互相引用，
  // 递归展开会栈溢出，所以用显式栈 + seen 去重。
  const seen = new Set();
  const stack = [];
  const push = (alias, version) => {
    const resolved = String(version);
    if (resolved.startsWith("link:")) return;
    stack.push(`${alias}@${resolved}`);
  };
  for (const project of projects) {
    for (const [alias, entry] of Object.entries(project.dependencies ?? {})) {
      push(alias, entry.version);
    }
  }
  while (stack.length) {
    const key = stack.pop();
    if (seen.has(key)) continue;
    seen.add(key);
    const { name, version } = splitSnapshotKey(key);
    if (!own.has(name) && !name.startsWith("@zcode/"))
      required.set(`${name}@${version}`, { name, version });
    for (const [alias, version] of Object.entries({
      ...snapshots[key]?.dependencies,
      ...snapshots[key]?.optionalDependencies,
    })) {
      push(alias, version);
    }
  }
  return { required, projects };
}

export async function readWorkspaceProductionGraph(root) {
  root = await realpath(root);
  const { required, projects } = await readWorkspaceProductionProjects(root);
  return { required, projects };
}

export async function scanInstalledPackages(root, projects) {
  // pnpm hoisted 布局的 ls.path 仍可能指向不存在的 .pnpm 路径；按真实安装目录和精确版本匹配。
  const installed = new Map();
  const visited = new Set();
  async function scanNodeModules(directory) {
    let actual;
    try {
      actual = await realpath(directory);
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    if (visited.has(actual)) return;
    visited.add(actual);
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const path = join(directory, entry.name);
      if (entry.name.startsWith("@")) {
        for (const scoped of await readdir(path)) await scanPackage(join(path, scoped));
      } else await scanPackage(path);
    }
  }
  async function scanPackage(directory) {
    let pkg;
    try {
      pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    } catch (error) {
      if (["ENOENT", "ENOTDIR"].includes(error.code)) return;
      throw error;
    }
    if (pkg.name && pkg.version) installed.set(`${pkg.name}@${pkg.version}`, { pkg, directory });
    await scanNodeModules(join(directory, "node_modules"));
  }
  for (const project of projects) await scanNodeModules(join(project.path, "node_modules"));
  await scanNodeModules(join(root, "node_modules"));
  await scanNodeModules(join(root, "apps/zcode-cli/node_modules"));
  return installed;
}

export function missingProductionPackages(required, installed) {
  const missing = [...required].filter(([key]) => !installed.has(key)).map(([, item]) => item);
  for (const item of missing) {
    if (!unsupportedCanvas.has(item.name))
      throw new Error(`Missing installed dependency: ${item.name}@${item.version}`);
  }
  return missing;
}

export async function collectNpmNotices(root, overrides) {
  root = await realpath(root);
  const { required, projects } = await readWorkspaceProductionGraph(root);
  // 修复：标识门禁和声明生成必须扫描同一安装集合，避免嵌套版本只进声明、不进门禁。
  const installed = await scanInstalledPackages(root, projects);
  const packages = [];
  const missing = [];
  const notInstalled = missingProductionPackages(required, installed);
  for (const [key, item] of [...required].sort(([a], [b]) => a.localeCompare(b, "en"))) {
    const installedPackage = installed.get(key);
    if (!installedPackage) {
      continue;
    }
    const { pkg, directory } = installedPackage;
    const notices = await readPackageNotices(directory);
    const override = overrides.find((record) => record.package === key);
    if (override?.file) {
      const bytes = await readFile(join(root, override.file));
      if (hashBytes(bytes) !== override.sha256) throw new Error(`Changed upstream notice: ${key}`);
      notices.push({ member: override.source, bytes });
    }
    // README 中仅有 MIT 等标签不能冒充完整许可文件；这种包仍需要版本固定的补充材料。
    if (
      !notices.some(({ member }) => !member.endsWith(" (license section)")) &&
      !override?.acceptedMissingNotice
    )
      missing.push(key);
    packages.push({
      ...item,
      license:
        pkg.license ??
        pkg.licenses?.map((item) => (typeof item === "string" ? item : item.type)).join(" OR ") ??
        override?.license ??
        "(not declared)",
      repository: typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url,
      ...(override?.acceptedMissingNotice
        ? { acceptedMissingNotice: override.acceptedMissingNotice }
        : {}),
      notices,
    });
  }
  if (missing.length) throw new Error(`Missing complete upstream notices:\n${missing.join("\n")}`);
  return {
    packages,
    notInstalled,
    workspaceManifests: projects.map((project) =>
      relative(root, join(project.path, "package.json")).replaceAll("\\", "/"),
    ),
  };
}
