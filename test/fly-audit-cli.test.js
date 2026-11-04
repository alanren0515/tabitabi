import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("Fly audit failures identify a bounded stage without relaying CLI stderr", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-fly-audit-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "fly.toml"), 'app = "tabitabi-jp"\n');
  await writeFile(join(directory, "flyctl"), `#!/bin/sh
case "$1" in
  machine|volumes) printf '[]' ;;
  checks) printf '{}' ;;
  secrets) printf 'unauthorized raw-private-value' >&2; exit 3 ;;
  *) exit 4 ;;
esac
`, { mode: 0o700 });
  const result = spawnSync(process.execPath, [resolve("scripts/audit-fly-remote.mjs")], {
    cwd: directory, encoding: "utf8", timeout: 10_000,
    env: { PATH: `${directory}:${process.env.PATH}`, FLY_API_TOKEN: "synthetic-test-only" }
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  const report = JSON.parse(await readFile(join(directory, "data/release-evidence/latest-fly.json"), "utf8"));
  assert.equal(report.passed, false);
  assert.equal(report.stage, "secrets");
  assert.equal(report.errorCategory, "authentication");
  assert.equal(report.cliExitCode, 3);
  assert.doesNotMatch(JSON.stringify(report) + result.stderr, /raw-private-value|synthetic-test-only/);
});
