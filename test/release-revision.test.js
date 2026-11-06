import test from "node:test";
import assert from "node:assert/strict";
import { currentGitState } from "../server/release-revision.mjs";

test("local revision commands preserve repository context without inheriting Fly credentials", async () => {
  const calls = [];
  const result = await currentGitState(async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: args[0] === "rev-parse" ? `${"a".repeat(40)}\n` : "" };
  }, { env: { PATH: "/bin", GIT_DIR: "/fixture/.git", GIT_WORK_TREE: "/fixture",
    FLY_API_TOKEN: "synthetic-exec", FLY_ACCESS_TOKEN: "synthetic-personal", FLY_SECRET_METADATA_TOKEN: "synthetic-metadata" } });
  assert.deepEqual(result, { revision: "a".repeat(40), clean: true });
  assert.equal(calls.length, 2);
  for (const { command, options } of calls) {
    assert.equal(command, "git");
    assert.deepEqual(options.env, { PATH: "/bin", GIT_DIR: "/fixture/.git", GIT_WORK_TREE: "/fixture" });
  }
});
