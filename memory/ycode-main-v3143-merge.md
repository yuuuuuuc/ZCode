---
name: ycode-main-v3143-merge
description: 2026-09-26 已把上游 v3.14.3 merge 进 ycode 并推到 origin/ycode
metadata:
  type: project
---

2026-09-26 本地与 `origin/ycode` 都是 merge commit `6cc93f2149b0a2dd46cdd4d7cb4bc9ab4497b652`。第一父 `b61b58cb42e49c39680fdf99695ea30d81a6782d`，第二父 `29628c9acdb81b703bbd4080c207a0e7ce5e276e`（main v3.14.3）。`origin/main...origin/ycode` 落后 0、领先 4。未改 main，未 rebase，未强推。

session send 协议保留 `botDeliveryTarget`，没有 `offPeakTaskId`。`oauthService`、`appARMSBootstrap`、`PlanBadge`、`UsageSummary` 不在树里。ycode 合并前就有的 `offPeakTaskId` 类型/适配层，以及 `config/provider/zcode-builtin.json` 里的 coding-plan 字符串，这次没有清掉。

`pnpm --dir apps/zcode-cli check` 的 `registry:check` 在合并前的 `b61b58c` 上同样失败，差的是生成物第 3 行 hash 注释；不要为这次合并重跑 `registry:generate`。`/workflow`、侧栏远控、onboarding dismiss、侧栏无套餐这四项界面交互没有在运行中的 Web/Desktop 上验过。

没有登录用户时，侧栏 footer 展示名是 `Yuuc`，不转圈。`Root` 不能写无值的 `initialIsRestoringOAuthSession`，JSX 会把它当成 true，账号移除后没有任何路径把它改回 false。

**Why:** 交接文档把 `offPeak*` 写成零命中，实际是合并前残留，不是这次从 main 带回来的。
**How to apply:** 查「闲时/套餐是否被合并带回来」时对比 `HEAD^1`，不要把 ycode 原有字段当成回归。界面四项在有人实际点过之前仍算未验。
