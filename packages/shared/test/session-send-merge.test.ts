import assert from "node:assert/strict";
import test from "node:test";
import { zcodeSessionSendParamsSchema } from "../src/zcode-protocol/index.ts";

const botDeliveryTarget = {
  provider: "feishu",
  botId: "bot-1",
  providerUserId: "user-1",
  chatType: "private",
} as const;

test("session send keeps generic bot delivery and rejects off-peak fields", () => {
  const accepted = zcodeSessionSendParamsSchema.safeParse({
    sessionId: "session-1",
    content: "hello",
    botDeliveryTarget,
  });
  assert.equal(accepted.success, true);

  const rejected = zcodeSessionSendParamsSchema.safeParse({
    sessionId: "session-1",
    content: "hello",
    offPeakTaskId: "off-peak-1",
    offPeakRunType: "init",
  });
  assert.equal(rejected.success, false);
});
