import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";

import { createBuildTimeConfigDefines, resolveBuildTimeConfig } from "../build-time-config.mjs";

const dir = await mkdtemp(join(tmpdir(), "zcode-build-time-config-"));
after(() => rm(dir, { recursive: true, force: true }));

async function writeDefaults(name, content) {
  const path = join(dir, name);
  await writeFile(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

test("没有私有默认配置也没有环境变量时自动更新关闭", async () => {
  const config = await resolveBuildTimeConfig({}, { defaultsPath: join(dir, "missing.json") });
  assert.deepEqual(config, {
    autoUpdateEnabled: false,
  });
});

test("私有默认配置可以启用自动更新", async () => {
  const defaultsPath = await writeDefaults("defaults.json", {
    ZCODE_AUTO_UPDATE: "1",
  });
  assert.deepEqual(await resolveBuildTimeConfig({}, { defaultsPath }), {
    autoUpdateEnabled: true,
  });
});

test("环境变量优先于私有默认配置，显式关闭自动更新", async () => {
  const defaultsPath = await writeDefaults("override.json", {
    ZCODE_AUTO_UPDATE: "true",
  });
  const config = await resolveBuildTimeConfig(
    {
      ZCODE_AUTO_UPDATE: "0",
    },
    { defaultsPath },
  );
  assert.deepEqual(config, {
    autoUpdateEnabled: false,
  });
});

test("私有默认配置格式错误时直接报错，不静默关闭", async () => {
  const defaultsPath = await writeDefaults("broken.json", "[1]");
  await assert.rejects(resolveBuildTimeConfig({}, { defaultsPath }), /必须是 JSON 对象/);
});

test("define 以 JSON 字面量注入", () => {
  assert.deepEqual(
    createBuildTimeConfigDefines({
      autoUpdateEnabled: true,
    }),
    {
      __ZCODE_AUTO_UPDATE_ENABLED__: "true",
    },
  );
});
