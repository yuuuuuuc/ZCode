---
name: windows-license-lockfile-graph
description: Windows 上 licenses 生产依赖图必须解析 pnpm-lock.yaml，不能 spawn pnpm ls
metadata:
  type: project
---

本机 `pnpm -r ls` 会 EMFILE（进程大约 8192 个打开文件后失败），`wsl -l -v` 只有 Stopped 的 docker-desktop，没有可用 Linux。`scripts/third-party-npm.mjs` 的 `readWorkspaceProductionGraph` 改为顺序解析 `pnpm-lock.yaml`。`scanInstalledPackages` 仍是顺序 readdir，没有改。

锁文件 snapshot 键是 `<name>@<version>(peer@x)`。`@` 同时出现在 scope 和 peer 后缀里，必须从 scope 后的第一个 `@` 切开（`indexOf("@", key.startsWith("@") ? 1 : 0)`），再用 `split("(")[0]` 去掉 peer。`lastIndexOf("@")` 会切到 peer 上。闭包图有环，展开必须用显式栈加 seen，不能递归。`yaml@2.9.0` 是根 `devDependencies` 里的显式依赖。

**Why:** 2026-09-26 合并 v3.14.3 时 `node scripts/licenses.mjs notices` 两次死在 `pnpm ls`。
**How to apply:** 改生产依赖图时保持锁文件解析，不要改回 spawn `pnpm ls`，也不要再用 `lastIndexOf("@")` 或递归展开。
