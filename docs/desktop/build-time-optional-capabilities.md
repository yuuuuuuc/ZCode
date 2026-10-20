# 桌面构建期可选能力

## 目标

ARMS 与事件上报由构建期配置决定是否启用，未配置时关闭。自动更新在本分支固定关闭：

| 能力 | 配置项 | 关闭时的行为 |
| --- | --- | --- |
| ARMS RUM 上报 | `ZCODE_ARMS_RUM_ENDPOINT` | 主进程与渲染进程的 ARMS SDK 以 `enable: false` 初始化，不产生上报 |
| 事件上报（数仓） | `ZCODE_TELEMETRY_REPORT_ENDPOINT` | 遥测事件在发送前直接返回 |
| 自动更新 | 本分支启动时固定 `enabled: false`，不再读取 `ZCODE_AUTO_UPDATE` | 正式版也不检查、不下载更新；帮助菜单「检查更新」仍显示，点击不会发起检查 |

这样同一份源码可以产出“默认不上报”的构建，也可以产出启用上报的正式构建，
不需要在源码里写死上报地址。自动更新不随这些配置打开。

## 配置来源与优先级

1. 构建进程的环境变量。显式设置为空字符串表示关闭。
2. `config/private/build-defaults.json`。只存在于内部仓库，开源导出不包含。
3. 以上都没有时关闭。

## 所有者与数据流

```
环境变量 / config/private/build-defaults.json
        │ scripts/build-time-config.mjs（唯一解析入口）
        ▼
desktop tsup（main、host、preload）与 desktop vite（renderer）的 define
        │ __ZCODE_ARMS_RUM_ENDPOINT__ / __ZCODE_TELEMETRY_REPORT_ENDPOINT__ / __ZCODE_AUTO_UPDATE_ENABLED__
        ▼
@zcode/shared env 常量 ── 运行时代码只读这些常量
```

- 未注入 define 的环境（测试、其他 bundle）得到关闭值；vitest 为测试注入固定的事件上报端点，以便验证上报链路。
- 自动更新在 Desktop Main 启动时固定关闭（`initAutoUpdater({ enabled: false })`）。构建期 `ZCODE_AUTO_UPDATE` 不能再打开这条检查。
- Agent 的 OTLP 遥测沿用既有机制，由打包环境的 `ZCODE_PACKAGED_AGENT_OTEL_*` 注入，不在本文件范围内。

## 验收

1. 内部仓库存在私有默认配置时，ARMS 与事件上报仍按配置启用，地址不变。自动更新保持关闭。
2. 没有私有默认配置、也没有环境变量时，三项均关闭。
3. 环境变量优先于私有默认配置，显式空字符串可以关闭单项能力。
4. 类型检查、Lint 与相关单测通过。
