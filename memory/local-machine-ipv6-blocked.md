---
name: local-machine-ipv6-blocked
description: 本机出网 IPv6 被第三方 WFP 驱动整体阻断（WSAEACCES），导致 pnpm dev:desktop 卡在等 Vite；用 NODE_OPTIONS=--dns-result-order=ipv4first 绕开
metadata:
  type: project
---

2026-10-11 实测（Windows 11 Pro 26300，用户 `YUUC\Yuuc`）：**所有出网 IPv6 TCP 连接被拒**，返回 `WSAEACCES 10013`（`connect` 层的权限拒绝）。不是 loopback 专属——`::1`、本机全局 IPv6、公网 IPv6（Cloudflare/Google DNS）全拒；IPv4 完全正常；v4-mapped `::ffff:1.1.1.1` 走 v4 栈所以也正常。`listen` 正常、只有 `connect` 被拒 → 是 WFP `ALE_AUTH_CONNECT` 层的过滤决策。

**对开发的影响**：`vite.config.ts` 的 `server` 没写 `host`，默认 `'localhost'`，Node 在本机把它解析成 IPv6 优先（`dns.lookup('localhost')` → `[::1, 127.0.0.1]`），于是 Vite 只监听 `[::1]:5174`；`packages/desktop/scripts/dev.mjs` 的就绪探测对 `localhost` / `[::1]` 拿到 EACCES、对 `127.0.0.1` 拿到 ECONNREFUSED，永远等不到，**Electron 不启动、窗口不出现**（tsup 三个块其实都 Build success 了）。

**绕开（不改仓库、不需要管理员）**：`NODE_OPTIONS=--dns-result-order=ipv4first`（PowerShell 用 `$env:NODE_OPTIONS="--dns-result-order=ipv4first"`）再跑 `pnpm dev:desktop`，Vite 就绑 `127.0.0.1`。已验证该开关确实把 `listen("localhost")` 的绑定从 `::1` 改成 `127.0.0.1`。备选：直接打生产包（不依赖 dev server）。

**根因未定**：Windows 防火墙侧已排除——835 条规则全是 `PolicyStoreSourceType=Local`，**没有 GPO 规则**（`LocalFirewallRules N/A (仅 GPO 存储)` 只是"合并本地规则"的设置项，不代表规则被锁）；`codex_sandbox_*` 三条 Block 规则的作用域是另一个本地用户 `YUUC\CodexSandboxOffline`（SID -1005），对 `YUUC\Yuuc`（-1001）不生效。IPv6 栈配置也正常（`DisabledComponents=0x8` 只关 Teredo）。因此只能是**第三方 WFP callout 驱动**，本机加载了四个：火绒 `hrwfpdrv.sys`、雷神加速器 `nfwfp.sys`（Start=1，开机加载）、迅雷 `xlwfp.sys`、AdGuard `adgnetworkwfpdrv.sys`（其日志自称 network filtering 已停止，最不可能）。火绒是唯一按设计就是防火墙的，可能性最大。

**待补**：用管理员权限跑 `netsh wfp show filters file=...`（或 `wfp show netevents`）在复现失败的同时抓一次，`providerName`/`filterId` 才能点名具体驱动。注意 `sc stop hrwfpdrv` 常被火绒自我保护挡住，要在产品 UI 里关。**Why:** 这台机器上 `pnpm dev:desktop` 的"窗口不弹"以后还会遇到，先查这个而不是查仓库代码；也提醒：本机跑任何需要 IPv6 出网的东西都会失败。**How to apply:** 遇到 dev 启动卡在 `Waiting for Vite dev server... EACCES`，先用 `NODE_OPTIONS` 绕开继续干活，根因单独找 IT/查驱动。相关：[[ycode-opensource-audit]]
