import assert from "node:assert/strict";
import test from "node:test";
import { parseSlashCommand } from "../src/command-center/slash-commands.ts";

test("merge keeps /workflow and does not restore /login", () => {
  const workflow = parseSlashCommand("/workflow draft a release plan");
  assert.equal(workflow?.type, "known");
  assert.equal(workflow && "name" in workflow ? workflow.name : undefined, "workflow");

  const login = parseSlashCommand("/login zai-coding-plan");
  assert.equal(login?.type, "unknown");
});
