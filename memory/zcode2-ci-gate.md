---
name: zcode2-ci-gate
description: zcode2 的门禁分工——本地 pre-push 只跑静态快检，全量单测交给 GitHub Actions；含三个「CI 里会骗人」的坑
metadata:
  type: project
---

2026-10-11 加 CI（`.github/workflows/ci.yml`，`windows-latest` 单 job）。之前仓里**完全没有 CI**。

**为什么搬**：本地钩子原先跑 `pnpm verify:pre-push`，最后一步 `test:unit:affected` 有一条保守分支——只要推送范围里有**被删除的代码文件**就退回全量单测（1871 文件 / 约 13.5 分钟），而删除文件正是「去遥测」改造的常规操作，于是每次推送都被卡。现在本地钩子跑 `pnpm verify:static`（lint / typecheck / `architecture:check --changed` / 两条护栏，热缓存约 20 秒、冷 typecheck 约 110 秒），全量由 CI 承担。`verify:pre-push` = `verify:static` + `test:unit:affected` 保留为手动入口。

**三个「CI 里会骗人」的坑**（照抄 `verify:pre-push` 就会踩）：

1. **`architecture:check --changed` 在 CI 里恒为空转**。`scripts/architecture/index.mjs` 的 `changedFilesFromGit()` 读的是工作区未提交改动（`git diff HEAD` + `git ls-files --others`），干净 checkout 两者都空 → 违规集空 → 恒退出 0。CI 必须跑不带 `--changed` 的全量。
2. **`test:unit:affected` 不能进 CI**。detached HEAD 下 `@{upstream}` 不存在、`fetch-depth: 1` 时 `origin/main` 也不存在 → 有时全量、有时全跳过；更糟的是 diff 为空时它**直接返回 0**，绿勾可能代表一个测试都没跑。CI 用 `pnpm test:unit`。
3. **`pnpm typecheck` 原先不在任何门禁里**（AGENTS.md 却要求必跑）。已补进 `verify:static` 和 CI。

**为什么是 windows runner**：与发布平台一致；Windows 专属用例只有 8 个（真 NSIS 安装脚本 ×2、真 `powershell.exe` ×2、实时 WMI 自扫描等），Linux 上会静默 skip，而 POSIX 专属有 58 个。另外 `pnpm install` 在 Windows 上走 node-pty 预编译直接跳过，**Linux runner 会触发 `electron-rebuild -o node-pty`**（要 C++ 工具链 + 下载 Electron headers），是最大的失败风险点。

**其它已核实的事实**：干净 checkout **不需要** `bootstrap`（workspace 包导出 `src` 不是 `dist`，单测直接跑源码）；**不需要**任何 `.env` 或凭据（`vitest.setup.ts` 自带默认值）；但**必须**设 `ELECTRON_MIRROR`（只在 `mise.toml` 的 `[env]` 里，Actions runner 没有，缺了 `electron@41` postinstall 会直连 GitHub 超时）；3 个安装器用例会经 `app-builder-lib` 现场下载 NSIS 二进制到 `%LOCALAPPDATA%\electron-builder\Cache`，已加缓存。

**Why:** 门禁位置变了，但「不许 `--no-verify` 绕过」没变——CI 只是把全量从本地挪走，不是取消检查。**How to apply:** 改 `.github/workflows/ci.yml` 或 `verify:*` 脚本前先读那三个坑；本地提交前 `pnpm verify:static`，发版前以 CI 绿为准。相关：[[ycode-wiring-guardrails]]、[[zcode2-fresh-branch-plan]]、[[local-machine-ipv6-blocked]]
