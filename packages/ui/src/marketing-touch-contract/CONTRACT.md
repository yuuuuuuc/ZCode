# 活动展示控制器契约

官方投放已阻断：服务查询只返回空 `deliveries`，不再访问 `/api/v1/marketing/touch`。控制器在没有投放时不展示、不上报。下面的动作顺序只在调用方自行注入投放时成立。



`createMarketingTouchController` 是同步工厂。每个控制器独占其 banner/dialog、generation、待展示资源与动作状态。查询、准备、上报、执行和刷新由调用方注入；UI 观察同一个 store，不另存已确认活动列表。

```text
用户动作 → 关闭当前展示并作废旧查询 → 执行动作 → 异步上报 confirm
                                              └─ 领取成功 → 刷新资格
```

外链、导航和复制不改变资格，不立即刷新，避免异步 confirm 前重新查询并打开旧活动。以后服务端再次投放仍可展示。dispose 作废未完成查询并释放资源，旧回执不得重新打开弹窗。

回归见 `packages/ui/test/marketingTouchController.test.ts` 和 `packages/desktop/test/e2e/ui-shell/marketing-touch-delivery.test.ts`。本次登记保留原入口和依赖方向。
