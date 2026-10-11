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

**换成全量架构检查后立刻暴露的第一个缺口**：`packages/services/src/gen-ui/` 声明为受治理模块（`module.ts` 与上游逐字节一致），治理规则要求 managed 模块具备 `module.ts` / `contract.ts` / `contract.example.ts` / **`contract.test.ts`** / `CONTRACT.md` 五件套，而这个模块缺 `contract.test.ts`——**上游 v3.15.1 原样就缺**（`packages/{shared,ui}/src/gen-ui/` 都有，唯独 services 那个没有），所以上游跑全量同样是红的。已按治理文档自己的处方补上 `contract.test.ts`（断言描述符频道名、登记请求过 host→main 的 strict schema 及其 gen-ui provenance refine、无沙箱时失败关闭），架构基线保持为空。**教训：`--changed` 只检查工作区未提交改动，存量缺口永远看不见；换全量才会露出来。**

**干净检出要先建 CLI 包**（2026-10-11 首批全量单测才暴露）：根 workspace 的 `packages/*` 确实导出 `src`，但 `apps/zcode-cli/packages/*` 导出的是 `dist/*`，而 `dist/` 被 gitignore。`packages/desktop/test/storagePreparationProtocol.test.ts` 直接 import CLI 源码，链上的 `@zcode/adapters` 解析不到就整文件 `ERR_MODULE_NOT_FOUND: Cannot find package '@zcode/adapters/storage'`。CI 已补 `pnpm --filter "@zcode/adapters..." build`（7 项目 / 约 20 秒，实测只建这个闭包就够，不必整仓构建）。本机永远看不出来——dist 早就构建过。

**其它已核实的事实**：**不需要**任何 `.env` 或凭据（`vitest.setup.ts` 自带默认值）；但**必须**设 `ELECTRON_MIRROR`（只在 `mise.toml` 的 `[env]` 里，Actions runner 没有，缺了 `electron@41` postinstall 会直连 GitHub 超时）；3 个安装器用例会经 `app-builder-lib` 现场下载 NSIS 二进制到 `%LOCALAPPDATA%\electron-builder\Cache`，已加缓存。

**runner 的环境差异会在本地骗人**：GitHub Actions 的 Windows runner 上 `os.tmpdir()` 是 8.3 短名 `C:\Users\RUNNER~1\...`，而 `realpath`/Shell 回长名 `C:\Users\runneradmin\...`。本机用户名短（`Yuuc`，4 字符）没有 8.3 别名，两种字形相同 → 本地全绿、只有 CI 红；首批 7 个失败里有 4 个是这个。复现手法：把 `TEMP`/`TMP` 指向一个 8.3 短名目录。规则见 `docs/windows-test-compatibility.md`「临时路径必须收敛成规范长名」。

**Why:** 门禁位置变了，但「不许 `--no-verify` 绕过」没变——CI 只是把全量从本地挪走，不是取消检查。**How to apply:** 改 `.github/workflows/ci.yml` 或 `verify:*` 脚本前先读那三个坑；本地提交前 `pnpm verify:static`，发版前以 CI 绿为准。相关：[[ycode-wiring-guardrails]]、[[zcode2-fresh-branch-plan]]、[[local-machine-ipv6-blocked]]
