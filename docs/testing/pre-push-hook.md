# Pre-push Hook

仓库现在通过 Husky 接管 Git 的 `pre-push`。

- 安装依赖后会执行根脚本 `pnpm prepare`，自动完成 Husky 安装。
- `pre-push` 会执行 `pnpm run verify:static`（lint / typecheck / 架构检查 / 两条漏接线护栏）。
- 根 `pnpm test` 现在只跑单测，不再误把桌面端 `packages/desktop/test/e2e` 当成 Vitest 用例。
- Bugfix：单测脚本里的 E2E exclude glob 必须加引号；否则 shell 会先把 `packages/desktop/test/e2e/**/*.test.ts` 展开成真实文件列表，导致 Vitest 把多余文件当成 filters，同时又被 exclude 排除，最终报 `No test files found` 并阻止 push。
- 任一步失败都会直接阻止 push。

**全量单测不在这里跑，由 CI 承担**（[`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)）。

原先钩子跑的是 `pnpm run verify:pre-push`，最后一步 `test:unit:affected` 有一条保守分支：只要推送范围里有**被删除的代码文件**，就放弃反向依赖分析、直接退回全量单测（本机约 13.5 分钟 / 1871 个测试文件）。而删除文件正是「去遥测」这类改造的常规操作，于是这个代价反复出现，且恰好卡在推送那一刻。

现在的分工：

| 位置 | 跑什么 | 耗时 |
| --- | --- | --- |
| 本地 `pre-push` 钩子（`pnpm verify:static`） | lint / typecheck / `architecture:check --changed` / 两条护栏 | 热缓存约 40 秒，冷 typecheck 约 110 秒 |
| CI（`.github/workflows/ci.yml`，`windows-latest`） | 上面全部 + **全量 `pnpm test:unit`** | 首次 run 冷缓存较久，之后以 pnpm store 缓存为主 |

`pnpm verify:pre-push`（= `verify:static` + `test:unit:affected`）保留为**手动入口**：想在推送前只跑受影响的那批单测时用它，它仍然需要 git 从 stdin 传入的 push ref 来算 base（钩子已不再传，手动执行时按下面的 base 选择顺序回落）。

同时保留 `pnpm test:e2e` 作为桌面端 E2E 的独立入口（E2E 不进 CI）。

## 开发环境与版本管理工具

pre-push 直接使用当前 `PATH` 中的 pnpm / Node，不强制依赖 mise。此前 hook 外层的
`mise exec` 虽能选择指定版本，却使已用 nvm 等方式准备好环境的开发者也必须安装 mise，
否则检查尚未开始就会失败。

```text
开发者准备 Node / pnpm（mise、nvm 或其他方式）
    → Git hook 清理 Git local env
    → pnpm run verify:static
    → lint / typecheck / 架构检查 / 两条漏接线护栏
```

- 仓库负责声明工具版本和执行检查；个人环境负责让合适的 Node / pnpm 可被 Git 找到。
- mise 仍是可选的开发入口；`mise.toml`、`mise-run.mjs` 和现有子进程 PATH 保护保持不变。
- GUI Git 客户端若找不到 Node / pnpm，可在个人 `~/.config/husky/init.sh` 中初始化自己的
  版本管理环境，参见 [Husky 官方说明](https://typicode.github.io/husky/how-to.html#node-version-managers-and-guis)。
- 缺少命令或检查失败仍然阻止 push；hook 不自动安装工具，不静默跳过检查。
- 本次只解除 hook 对 mise 的依赖，不新增版本检查，也不修改现有开发、CLI/SEA 或 CI 的版本要求。

## Affected Unit Tests

> **已不在 pre-push 钩子里**，现在是手动入口（`pnpm run test:unit:affected`，或 `pnpm verify:pre-push`）。全量单测由 CI 跑。
>
> **不要把它搬进 CI。** 它按「本地推送增量」设计，在 CI 的 detached HEAD + 浅克隆下会退化：`@{upstream}` 不存在、`fetch-depth: 1` 时 `origin/main` 也不存在，于是有时全量、有时全跳过；更糟的是 diff 为空时它**直接返回 0**——绿勾可能代表一个测试都没跑。CI 用 `pnpm test:unit`。

默认验证本次 push 新增的变更，而不是固定比较 `origin/main`。base 选择顺序：

- 显式设置 `ZCODE_PRE_PUSH_BASE` / `ZCODE_AFFECTED_TEST_BASE` 时，使用该 base 与 `HEAD` 的 merge-base，便于手动做 MR 范围自检。
- Git `pre-push` hook 传入 stdin 时，优先使用其中的 `remote_sha..local_sha`。这对应当前远端跟踪分支到本次推送目标的增量，适合日常 push。
- 没有 hook stdin 时，使用当前分支的 `@{upstream}..HEAD`，适合手动执行 `pnpm run test:unit:affected`。
- 新分支或没有 upstream 时，才退回到 `origin/HEAD`、`origin/main`、`origin/master`、`main`、`master` 这类默认分支，并使用 merge-base 计算范围。

具体执行分两层：

- `scripts/run-affected-unit-tests.mjs` 负责计算 base、识别全量 fallback 场景、跳过无关变更。
- `lint-staged.config.mjs` 负责按 `lint-staged --diff "<base>..<head>"` 传入的分支变更文件分组，并按 Vitest 官方推荐调用 `vitest related --run`。
- `lint-staged` 面向 pre-commit 设计，任务结束后会自动 `git add` 匹配文件。pre-push 主路径会给它设置临时 `GIT_INDEX_FILE`，避免验证过程改动真实 index。
- `lint-staged` 任务通过 `scripts/run-lint-staged-vitest.mjs` 启动 Vitest，并在启动前清理 Git local env。原因是临时 `GIT_INDEX_FILE` 或 Git hook 环境变量会污染单测中创建的临时 Git 仓库。

选择规则：

- 只改文档、非 JS/TS 资源或桌面端 E2E 文件时，不跑 Vitest 单测。
- 改动普通 JS/TS/JSON 源文件时，通过 `lint-staged` 将文件列表传给 `vitest related --run`，查找并执行受影响的测试文件。这里的 changed files 不是“只跑改过的测试文件”，而是作为输入交给 Vitest 的静态 import 关系分析；因此改了一个源文件时，会跑引用它的未修改测试文件。
- 直接改动 `packages/*/test/**/*.test.ts` 时，通过 `lint-staged` 分组后直接执行这些测试文件。
- 每次分组回调中，变更测试文件合并为一个 `vitest run` 命令，关联源码合并为一个 `vitest related --run` 命令。不再按单个测试文件或每 8 个源码拆批，避免反复启动 Vitest、重复执行跨批次关联到的测试。此调整撤销 `96fa6b1783`、`9f4a831d8d` 的拆批策略，不减少测试选择范围；文件列表仍通过 manifest 传递，保留 Windows 特殊文件名保护。
- 改动测试运行环境、依赖或 TypeScript/Vitest 配置时，退回全量 `pnpm run test:unit`。这些文件包括 `package.json`、`pnpm-lock.yaml`、`vitest.config.*`、`vitest.setup.*`、`tsconfig*.json`、`.husky/pre-push`、`lint-staged.config.mjs` 和 affected-test 脚本自身。
- 删除 JS/TS/JSON 代码文件时，退回全量 `pnpm run test:unit`。原因是被删除文件无法再作为 `vitest related` 的输入，但依赖它的测试仍需要暴露导入断裂或行为缺失。

该入口只覆盖根 Vitest 单测范围，即 `packages/*/test/**/*.test.ts`，不替代 `apps/zcode-cli` 自身的 Turbo/Vitest 测试，也不替代桌面端 E2E。
