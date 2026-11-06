import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from "node:fs/promises";
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
    env: { PATH: `${directory}:${process.env.PATH}`, HOME: directory, GITHUB_ACTIONS: "true", FLY_API_TOKEN: "", FLY_SECRET_METADATA_TOKEN: "synthetic-metadata-test-only",
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

test("remote monitor uses only the machine-exec credential while audit receives both inputs", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-monitor-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const preload = join(directory, "http-probe.mjs");
  await writeFile(preload, `globalThis.fetch = async url => {
    const path = new URL(url).pathname;
    if (!["/healthz", "/readyz", "/api/capabilities"].includes(path)) throw new Error("Unexpected endpoint");
    return new Response(JSON.stringify({ ready: true, providerCircuit: { open: false }, releaseRevision: "${"a".repeat(40)}" }), { status: 200 });
  };`);
  await writeFile(join(directory, "fly.toml"), 'app = "tabitabi-jp"\n');
  await writeFile(join(directory, "git"), `#!/bin/sh
if [ "$1" = "rev-parse" ]; then printf '${"a".repeat(40)}\\n'; fi
`, { mode: 0o700 });
  await writeFile(join(directory, "flyctl"), `#!/usr/bin/env node
const { appendFileSync } = require("node:fs");
appendFileSync(process.env.MONITOR_TEST_DIRECTORY + "/cli-environments.jsonl", JSON.stringify({
  command: process.argv[3], usesLegacyToken: process.env.FLY_API_TOKEN === "synthetic-test-only",
  hasMetadataVariable: Object.hasOwn(process.env, "FLY_SECRET_METADATA_TOKEN"), configDirectory: process.env.FLY_CONFIG_DIR
}) + "\\n");
if (process.argv[2] === "machine" && process.argv[3] === "list") {
  process.stdout.write(JSON.stringify([{ id: "2874ddda755048", state: "started" }]));
} else if (process.argv[2] === "machine" && process.argv[3] === "exec") {
  process.stdout.write(JSON.stringify({ stdout: "TABITABI_DAILY_MONITOR=" + JSON.stringify({ schemaVersion: 1,
    releaseRevision: "${"a".repeat(40)}", status: "healthy", alerts: [], budget: { available: true } }) }));
} else process.exit(8);
`, { mode: 0o700 });
  await mkdir(join(directory, "scripts"));
  await writeFile(join(directory, "scripts/audit-fly-remote.mjs"), `import { mkdirSync, writeFileSync } from "node:fs";
writeFileSync("audit-environment.json", JSON.stringify({
  usesLegacyToken: process.env.FLY_API_TOKEN === "synthetic-test-only",
  hasMetadataToken: process.env.FLY_SECRET_METADATA_TOKEN === "synthetic-metadata-test-only"
}));
mkdirSync("data/release-evidence", { recursive: true });
writeFileSync("data/release-evidence/latest-fly.json", JSON.stringify({ passed: true }));
`);
  const result = spawnSync(process.execPath, ["--import", preload, resolve("scripts/daily-monitor.mjs")], {
    cwd: directory, encoding: "utf8", timeout: 10_000,
    env: { PATH: `${directory}:${process.env.PATH}`, GITHUB_ACTIONS: "true", FLY_API_TOKEN: "synthetic-test-only",
      FLY_SECRET_METADATA_TOKEN: "synthetic-metadata-test-only", MONITOR_TEST_DIRECTORY: directory }
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(await readFile(join(directory, "data/monitoring/latest.json"), "utf8"));
  assert.equal(report.status, "healthy");
  const environments = (await readFile(join(directory, "cli-environments.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(environments.map((item) => item.command), ["list", "exec"]);
  assert.ok(environments.every((item) => item.usesLegacyToken && !item.hasMetadataVariable));
  for (const path of new Set(environments.map((item) => item.configDirectory))) await assert.rejects(access(path), { code: "ENOENT" });
  assert.deepEqual(JSON.parse(await readFile(join(directory, "audit-environment.json"), "utf8")), { usesLegacyToken: true, hasMetadataToken: true });
  assert.doesNotMatch(JSON.stringify(report) + result.stdout + result.stderr, /synthetic-test-only|synthetic-metadata-test-only/);
});

test("workflow exposes Fly credentials only to the daily-monitor step", async () => {
  const workflow = await readFile(resolve(".github/workflows/daily-monitor.yml"), "utf8");
  const [job, ...steps] = workflow.split(/(?=^      - name:)/m);
  assert.doesNotMatch(job, /FLY_(?:API|SECRET_METADATA)_TOKEN/);
  let monitorSteps = 0;
  for (const step of steps) {
    if (step.startsWith("      - name: Run daily monitor\n")) {
      monitorSteps++;
      assert.match(step, /FLY_API_TOKEN: \$\{\{ secrets\.FLY_API_TOKEN \}\}/);
      assert.match(step, /FLY_SECRET_METADATA_TOKEN: \$\{\{ secrets\.FLY_SECRET_METADATA_TOKEN \}\}/);
    } else assert.doesNotMatch(step, /FLY_(?:API|SECRET_METADATA)_TOKEN/);
  }
  assert.equal(monitorSteps, 1);
});
