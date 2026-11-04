import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("Actions without a token writes an actionable failing report without probing the network", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-monitor-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const marker = join(directory, "network-probe");
  const preload = join(directory, "block-network.mjs");
  await writeFile(preload, `import { writeFileSync } from 'node:fs'; globalThis.fetch = () => { writeFileSync(${JSON.stringify(marker)}, 'attempted'); throw new Error('Network forbidden in test'); };`);
  await writeFile(join(directory, "fly.toml"), 'app = "tabitabi-jp"\n');
  await writeFile(join(directory, "flyctl"), `#!/bin/sh\nprintf attempted > '${marker}'\nexit 1\n`, { mode: 0o700 });
  const result = spawnSync(process.execPath, ["--import", preload, resolve("scripts/daily-monitor.mjs")], {
    cwd: directory, encoding: "utf8", timeout: 10_000,
    env: { PATH: `${directory}:${process.env.PATH}`, HOME: directory, GITHUB_ACTIONS: "true", FLY_API_TOKEN: "",
      GIT_DIR: spawnSync("git", ["rev-parse", "--absolute-git-dir"], { encoding: "utf8" }).stdout.trim(), GIT_WORK_TREE: resolve(".") }
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(await readFile(join(directory, "data/monitoring/latest.json"), "utf8"));
  assert.equal(report.alerts[0].code, "MONITOR_CREDENTIAL_MISSING");
  assert.equal(report.budget, null);
  assert.deepEqual(report.checksSkipped, ["http", "fly_machine_exec", "fly_resource_audit"]);
  await assert.rejects(access(marker), { code: "ENOENT" });
});
