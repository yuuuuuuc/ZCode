# 02 集成：启动、配置、部署

## 1. 三条启动链（现状事实）

### 1.1 桌面端（开发态）

```
pnpm dev:desktop
  → scripts/dev-desktop-env.mjs production     # 设 ZCODE_ENV、处理 Windows 路径
  → packages/desktop pre-dev: 准备本地 runtime 资源、清空 out/
  → vite dev server（renderer）+ tsup watch（main/host/preload/scheduler，marker 文件就绪）
  → 拉起 electron.exe
      app.whenReady
        → createWindowInstance()                        # main/index.ts:1515
            → createBrowserWindow()                     # desktopWindowChrome.ts:364
            → spawnHostProcess()                        # desktopHostProcess.ts:165
                → utilityProcess.fork(out/host/index.js)
                → MessageChannelMain：port2 给 host，port1 经
                  webContents.postMessage 给 renderer
            → loadWindow()                              # desktopHostProcess.ts:78
                dev: loadURL(vite + query 启动参数)     # prod: loadFile(out/renderer/index.html)
      host 初始化本地 services
        → resolveDefaultZCodeAgentCommand()             # zcodeAgentProcessManager.ts
            1) ZCODE_AGENT_SERVER_COMMAND env
            2) monorepo: apps/zcode-cli/.../dist/zcode.cjs 或 tsx 源码
            3) Electron 态: process.execPath + ELECTRON_RUN_AS_NODE=1 跑 resources/glm/zcode.cjs
            4) 部署的 native binary 兜底
        → spawn: zcode.cjs app-server --stdio
```

另有第三个常驻 utilityProcess：cron/off-peak 调度器（`src/main/desktopCronScheduler.ts:45` fork `out/scheduler/index.js`）。

### 1.2 Web 端

```
pnpm dev:web
  → @zcode/server dev: tsup watch + node dist/entry-http.js   # :3030
  → @zcode/web dev: vite                                       # :5173，代理 /ws、/api → 3030
浏览器 → fetch /api/server-info → connectViaWebSocket(/ws)
       → server 经 @zcode/services 拉起 agent（同 1.1 的解析链，spawn app-server --stdio）
```

### 1.3 终端（发行包）

```
zcode            # 无参数 → TUI（apps/zcode-cli/packages/tui）
zcode --web      # scripts/build-zcode.mjs 组装的发行包：runner.mjs serve() 以
                 #   process.execPath spawn serverEntry，注入
                 #   ZCODE_WEB_STATIC_ROOT=web/、ZCODE_AGENT_SERVER_COMMAND=agent/zcode.cjs、
                 #   ZCODE_SERVER_AUTH_TOKEN（非本机监听时自动生成）
```

## 2. 进程拓扑（桌面端）

```mermaid
graph TD
    MAIN[Electron Main 进程<br/>窗口/托盘/原生操作/消息转发<br/>不承载 task/session 业务状态]
    MAIN -->|utilityProcess.fork| H1[Host utilityProcess × 每窗口<br/>本地 services + 远程连接注册表]
    MAIN -->|utilityProcess.fork| SCH[Scheduler utilityProcess<br/>cron/off-peak]
    MAIN -->|MessageChannelMain| R[Renderer<br/>@zcode/ui，薄壳]
    R -->|port1| H1
    H1 -->|stdio, v4 wire| AG[Agent 子进程<br/>app-server --stdio]
    H1 -->|attachment| PHONE[手机远控连接<br/>复用同一 Host]
    H1 -->|连接注册表| REMOTE[远程 workspace<br/>SSH/WSL/Docker]
    AG -->|spawn| TOOLS[bash/ripgrep/MCP servers/…]
```

关键语义（`packages/desktop/src/host/index.ts:1-25` 头注释）：

- **每窗口一个 Host**；同窗口的 Renderer 与手机端都 attachment 到它（`windowHostAttachmentRegistry`），不为手机另起 Agent/Host/会话。
- **远程 workspace 连接注册表**（`windowRemoteConnectionRegistry`）是远端连接唯一 owner；SSH/WSL/Docker 探测能力来自 `@zcode/server/remote` 动态 import。
- **lease/owner**：`taskRealtimeBus.ts`（main 进程）自述 owns lease、stream batching、replay and command routing state；类型在 `shared/src/task-realtime.ts`，端口在 `services/src/session/sessionRealtimePort.ts`。
- **CommandInbox 串行 admission** 在 **Agent 进程内**（`apps/zcode-cli/packages/bootstrap/src/zcode-protocol-v4/command-inbox.ts`），Renderer 只持未提交草稿与 pending optimistic overlay。

## 3. WebSocket 通道矩阵

| 通道 | clientMode | 用途 | 准入 |
| --- | --- | --- | --- |
| `GET /ws` | web-remote-replayable | Web/手机主 RPC 通道，可重放恢复 | token（若启用） |
| `GET /ws/host` | desktop-continuous | 受信 Desktop host 实时通道 | 必须持 `/api/rpc-host-capability` 签发的一次性 capability header，普通 `/ws` 无法自我提升 |
| `GET /ws/remote/:id` | — | 把 `/api/connect-remote` 建立的远程连接 file/git/system/terminal services 桥接给浏览器 | id 一次性消费 |

（来源：`packages/server/src/http.ts`。）

## 4. 配置与环境变量（不完全清单，按生效位置分组）

### 构建期

| 变量/文件 | 作用 |
| --- | --- |
| `ZCODE_ENV`（test/production） | 后端环境轴，注入 web 与 desktop 构建 |
| `VITE_ZCODE_BASE_URL` / `ZCODE_BASE_URL` / `ZCODE_ENDPOINT_ORIGIN` | 产品 endpoint 推导（`shared/src/zcodeEndpoint.ts`） |
| `__ZCODE_BUILTIN_PROVIDER_CONFIG_JSON__` | `config/provider/zcode-builtin.json` 构建期注入（`scripts/builtin-provider-config.mjs`） |
| `__ZCODE_VERSION__` / `__ZCODE_COMMIT__` | 版本信息 define |
| `ZCODE_PREVIEW_IDENTITY` | 桌面打包 flavor（`scripts/desktop-product-identity.mjs`） |

### 桌面运行期（`desktopRuntimeEnv.ts` 的 `buildHostProcessEnv()` :461 起）

`ZCODE_DATA_BASE_DIR`（数据目录重定向，e2e 隔离）、`ZCODE_RUNTIME_ENV_KEY`、`GLM_BINARY_PATH`、`ZCODE_LARK_CLI_BINARY`、`ZCODE_CUA_*`、`ZCODE_DYNAMIC_WORKFLOW_MODE_ENV`（三层灰度）、`ZCODE_DESKTOP_AGENT_BYTECODE`、`ZCODE_REMOTE_ASSET_CDN_BASE_URL`/`ZCODE_REMOTE_ASSET_CACHE_DIR`、`ZCODE_DEV_REMOTE_ASSET_USE_CDN`。

### Server 运行期

`PORT`（默认 3030）、`ZCODE_SERVER_HOST`/`HOST`、`ZCODE_WEB_STATIC_ROOT`、`ZCODE_SERVER_AUTH_TOKEN`、`ZCODE_SERVER_WORKSPACE`（默认 cwd）、`ZCODE_SERVER_ID`/`_NAME`/`_TOKEN`、`ZCODE_AGENT_SERVER_COMMAND`/`_ARGS_JSON`/`_CWD`、`ZCODE_BUILTIN_PROVIDER_CONFIG_FILE`、`ZCODE_SERVER_SKIP_SERVICE_REGISTRATION`。

### 客户端内置配置

- `config/default.json`：`feedback_url`、`community_urls[zh-CN|en-US]` 等；Web 构建导入、Desktop 打包读取，可被远端 `GET /api/v1/client/configs` 覆盖（`config/README.md`）。
- 数据库/持久化路径族：SQLite 会话库（`getDefaultSessionDbPath()`）、任务索引、`~/.zcode/` 配置/插件/记忆目录——均可被 `ZCODE_DATA_BASE_DIR` 整体重定向。

## 5. 外部依赖与边界

| 类别 | 内容 |
| --- | --- |
| LLM API | 经 AI SDK（anthropic-messages / openai-compatible），提供商模板见 `config/provider/zcode-builtin.json` |
| MCP | Agent 内三层：core 投影（`mcp__<server>__<tool>` 命名）→ adapters transport/pool/OAuth → 插件贡献 mcpServers |
| 远程执行 | ssh2、WSL、Docker（`packages/server/src/remote/{ssh,wsl,docker}-backend.ts`） |
| 远程组件分发 | CDN tar.gz（`components/<platform>/glm|node-pty|node-runtime|ripgrep|server-bundle/<version+hash>`），开发态用 `packages/desktop/mock-cdn/` 离线镜像 |
| Bot 渠道 | Telegram/飞书/微信（`services/src/bots/`），webhook 回调 `POST /api/bots/:provider` |
| 遥测 | OTel OTLP（可选；开源化已移除官方遥测与强更检查，见 `specs/ycode-rebrand.md`） |
| 无消息队列/外部数据库 | 会话存储为本机 SQLite，跨进程通信用 stdio + WS + MessagePort |

## 6. 部署拓扑（现状事实）

```mermaid
graph LR
    subgraph 本机发行包 dist/zcode
        BIN[bin/zcode] --> NODE[内嵌 Node]
        BIN --> AGENTDIR[agent/zcode.cjs]
        BIN --> SERVER[server/entry-http.js]
        BIN --> WEB[web/ 静态产物]
    end
    subgraph 桌面安装包
        ELECTRON[Electron + asar] --> RES[resources/glm/zcode.cjs 或 .bytecode]
        ELECTRON --> OUT[out/main|host|preload|scheduler|renderer]
    end
    subgraph 远程主机
        RS[~/.zcode/server/zcode-server.cjs 单文件] --> RAGENT[远端 agent 运行时]
    end
    BUILDERS["scripts/build-zcode.mjs（发行包）<br/>pnpm bundle:desktop（安装包）<br/>server build:remote（单文件 CJS）"] -.组装.-> BIN
    BUILDERS -.上传(SFTP/SSH/WSL/Docker deploy).-> RS
```

- 守护化：`packages/zcode-server-cli` 的 Supervisor（CrashBudget 退避、代际更新、回滚）+ 三系统服务注册（`src/runtime/platform/serviceManager.ts`）。
- 冒烟：`scripts/zcode-distribution-smoke.mjs`；macOS 发布体检 `scripts/doctor-macos-release-app.sh`。
- **CI 不存在**（`.github/` 目录缺失），发布/验证全靠本地脚本约定（见 04 P0）。

## 7. 远程组件资源解析（desktop）

`src/main/desktopRuntimeEnv.ts` 的 `resolveRemoteAssetDirs()`（:291）：

- 开发态：`mock-cdn/`（`releases/<ZCODE_VERSION>` 存在才启用），`ZCODE_DEV_REMOTE_ASSET_USE_CDN=1` 切真 CDN。
- 生产态：`remoteCdnBaseUrl(s)`（可 env 覆盖）+ 本地缓存 `userData/remote-assets-cache`。
- 内嵌 Agent 解析：`resolveBundledZCodeAgentBinaryPath()`（:325，多候选）；远端跨平台原生二进制由 `scripts/prepare-prebuilds.mjs` 准备。
