import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  isAgentBundleFresh,
  latestCliSourceMtimeMs,
  readAgentBundleFreshness,
} from "./agent-bundle-freshness.mjs";

test("bundle 比源码旧时不新鲜，不旧于源码时复用，缺失时重建", () => {
  assert.equal(isAgentBundleFresh({ bundleMtimeMs: 1000, sourceMtimeMs: 2000 }), false);
  assert.equal(isAgentBundleFresh({ bundleMtimeMs: 2000, sourceMtimeMs: 2000 }), true);
  assert.equal(isAgentBundleFresh({ bundleMtimeMs: 3000, sourceMtimeMs: 2000 }), true);
  assert.equal(isAgentBundleFresh({ bundleMtimeMs: undefined, sourceMtimeMs: 2000 }), false);
});

test("只比较各包 src 下的源码，跳过 dist 与 node_modules", async () => {
  const root = await mkdtemp(join(tmpdir(), "agent-bundle-freshness-"));
  try {
    const writeAt = async (relative, seconds) => {
      const path = join(root, relative);
      await mkdir(join(path, ".."), { recursive: true });
      await writeFile(path, "");
      await utimes(path, seconds, seconds);
    };
    await writeAt("packages/core/src/runtime/a.ts", 2000);
    await writeAt("packages/core/src/node_modules/dep.js", 9000);
    await writeAt("packages/core/src/dist/out.js", 9000);
    await writeAt("packages/core/README.md", 9000);
    await writeAt("packages/cli/dist/zcode.cjs", 1500);

    assert.equal(await latestCliSourceMtimeMs(join(root, "packages")), 2000 * 1000);
    const input = {
      bundlePath: join(root, "packages/cli/dist/zcode.cjs"),
      packagesRoot: join(root, "packages"),
    };
    assert.deepEqual(await readAgentBundleFreshness(input), { exists: true, fresh: false });

    await utimes(input.bundlePath, 3000, 3000);
    assert.deepEqual(await readAgentBundleFreshness(input), { exists: true, fresh: true });
    assert.deepEqual(
      await readAgentBundleFreshness({ ...input, bundlePath: join(root, "missing.cjs") }),
      { exists: false, fresh: false },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
