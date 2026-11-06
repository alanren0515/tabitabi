import test from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { REQUIRED_FLY_SECRETS } from "../server/fly-remote-audit.mjs";

const valid = {
  machines: [{ id: "machine-1", state: "started", region: "nrt", updated_at: "2026-07-18T10:00:00.000Z", image_ref: { tag: "deployment-TEST", digest: `sha256:${"b".repeat(64)}` }, config: { guest: { cpu_kind: "shared", cpus: 1, memory_mb: 512 }, mounts: [{ volume: "volume-1", path: "/app/data" }], services: [{ internal_port: 4173, checks: [{ path: "/healthz" }], autostart: true, autostop: true, min_machines_running: 0 }] } }],
  volumes: [{ id: "volume-1", state: "created", attached_machine_id: "machine-1", name: "tabitabi_data", region: "nrt", size_gb: 1, encrypted: true, snapshot_retention: 7, auto_backup_enabled: true }],
  checks: { "machine-1": [{ name: "http_service", status: "passing" }] },
  secrets: REQUIRED_FLY_SECRETS.map((name) => ({ name, status: "Deployed", value: "raw-private-secret-value" })),
  releases: [{ Status: "complete", Version: 5, CreatedAt: "2026-07-18T10:00:00.000Z", ImageRef: "registry.fly.io/tabitabi-jp:deployment-TEST" }]
};

test("Fly Secret metadata denial retains earlier evidence and continues to releases", async (t) => {
  const { report, calls } = await runAudit(t, { failures: { secrets: { code: 3, stderr: "unauthorized raw-private-value" } } });
  assert.equal(report.passed, false);
  assert.equal(report.collectionComplete, false);
  assert.equal(report.stage, "secrets");
  assert.equal(report.errorCategory, "secretMetadataAccessDenied");
  assert.equal(report.cliExitCode, 3);
  assert.deepEqual(report.cliFailureTerms, ["unauthorized", "value"]);
  assert.deepEqual(report.metadataAccess, { httpStatus: 403, access: "denied", reasonTerms: [] });
  assert.match(report.error, /Keep the deployed-secret check failing/);
  assert.equal(report.checks.requiredSecretsDeployed, false);
  for (const name of ["exactlyOneMachine", "machineShape", "exactlyOneVolume", "volumeMounted", "healthChecksPassing"]) {
    assert.equal(report.checks[name], true, name);
  }
  assert.equal(report.deployment.releaseVersion, 5);
  assert.equal(report.collection.releases.status, "succeeded");
  assert.deepEqual(calls, ["machines", "volumes", "checks", "secrets", "releases"]);
});

test("Fly audit records every bounded failure without hiding independent successes", async (t) => {
  const { report, calls } = await runAudit(t, { failures: {
    machines: { code: 7, stderr: "permission denied raw-private-value" },
    secrets: { code: 3, stderr: "unauthorized raw-private-value" },
    releases: { code: 4, stderr: "failed raw-private-value" }
  } });
  assert.equal(report.passed, false);
  assert.equal(report.stage, "machines");
  assert.equal(report.errorCategory, "accessDenied");
  assert.equal(report.cliExitCode, 7);
  assert.equal(report.collection.machines.status, "failed");
  assert.equal(report.collection.secrets.errorCategory, "secretMetadataAccessDenied");
  assert.deepEqual(report.collection.secrets.metadataAccess, { httpStatus: 403, access: "denied", reasonTerms: [] });
  assert.equal(report.collection.releases.cliExitCode, 4);
  assert.equal(report.collection.volumes.status, "succeeded");
  assert.equal(report.collection.checks.status, "succeeded");
  assert.equal(report.checks.exactlyOneMachine, false);
  assert.equal(report.checks.requiredSecretsDeployed, false);
  assert.equal(report.checks.exactlyOneVolume, true);
  assert.equal(report.checks.healthChecksPassing, true);
  assert.deepEqual(calls, ["machines", "volumes", "checks", "secrets", "releases"]);
});

test("release collection failure keeps an otherwise healthy audit failing", async (t) => {
  const { report } = await runAudit(t, { failures: { releases: { code: 4, stderr: "failed raw-private-value" } } });
  assert.equal(report.passed, false);
  assert.equal(report.collectionComplete, false);
  assert.equal(report.stage, "releases");
  assert.ok(Object.values(report.checks).every(Boolean));
  assert.equal(report.deployment.releaseVersion, null);
});

test("accepted Secret metadata probe cannot substitute for a failed CLI collection", async (t) => {
  const { report } = await runAudit(t, { failures: { secrets: { code: 3, stderr: "unauthorized raw-private-value" } }, metadataProbeStatus: 200 });
  assert.equal(report.passed, false);
  assert.equal(report.metadataAccess.access, "accepted");
  assert.equal(report.checks.requiredSecretsDeployed, false);
});

test("an unsupported collected record fails evaluation without relaying parser contents", async (t) => {
  const { report } = await runAudit(t, { secrets: [null] });
  assert.equal(report.passed, false);
  assert.equal(report.stage, "evaluation");
  assert.equal(report.errorCategory, "remoteUnavailable");
  assert.equal(report.collectionComplete, false);
});

test("metadata credential is isolated to Secret collection with an empty separate runtime", async (t) => {
  const { report, environments } = await runAudit(t, { metadataToken: "synthetic-metadata-test-only", legacyAccessToken: "synthetic-access-override", expectedStatus: 0 });
  assert.equal(report.passed, true);
  const secret = environments.find((item) => item.stage === "secrets");
  const other = environments.filter((item) => item.stage !== "secrets");
  assert.equal(secret.usesMetadataToken, true);
  assert.equal(secret.usesLegacyToken, false);
  assert.equal(secret.hasAccessOverride, false);
  assert.ok(other.every((item) => item.usesLegacyToken && !item.usesMetadataToken));
  assert.ok(other.every((item) => item.configDirectory !== secret.configDirectory));
});

test("metadata 401 and 403 use the same isolated credential for CLI and REST without fallback", async (t) => {
  for (const status of [401, 403]) {
    await t.test(String(status), async (t) => {
      const { report, environments, probes } = await runAudit(t, {
        metadataToken: "synthetic-metadata-test-only", legacyAccessToken: "synthetic-access-override",
        failures: { secrets: { code: 3, stderr: "unauthorized raw-private-value" } }, metadataProbeStatus: status
      });
      assert.equal(report.passed, false);
      assert.equal(report.checks.requiredSecretsDeployed, false);
      assert.equal(report.metadataAccess.httpStatus, status);
      assert.equal(environments.filter((item) => item.stage === "secrets").length, 1);
      assert.equal(environments.find((item) => item.stage === "secrets").usesMetadataToken, true);
      assert.equal(probes[0].usesMetadataToken, true);
      assert.equal(probes[0].usesLegacyToken, false);
      assert.equal(probes[0].hasAccessOverride, false);
    });
  }
});

test("unset metadata credential preserves the existing monitor credential", async (t) => {
  const { environments, probes } = await runAudit(t, { failures: { secrets: { code: 3, stderr: "unauthorized raw-private-value" } } });
  assert.ok(environments.every((item) => item.usesLegacyToken && !item.usesMetadataToken));
  assert.equal(new Set(environments.map((item) => item.configDirectory)).size, 1);
  assert.equal(probes[0].usesLegacyToken, true);
  assert.equal(probes[0].usesMetadataToken, false);
});

test("a recent routing transition gets one bounded health observation without repeating Secret or exec work", async (t) => {
  const machines = structuredClone(valid.machines);
  machines[0].events = [{ type: "cordon", status: "started", timestamp: Date.now() - 55_000 }];
  const { report, calls, environments } = await runAudit(t, {
    machines, metadataToken: "synthetic-metadata-test-only", expectedStatus: 0, expectedCalls: 7,
    checkSequence: [
      { "machine-1": [{ name: "http_service", status: "warning" }] }, valid.checks
    ]
  });
  assert.equal(report.passed, true);
  assert.equal(report.healthObservation.attempted, true);
  assert.equal(report.healthObservation.accepted, true);
  assert.equal(report.healthObservation.waitMs, 0);
  assert.deepEqual(calls, ["machines", "volumes", "checks", "secrets", "releases", "machines", "checks"]);
  assert.equal(environments.filter((item) => item.usesMetadataToken).length, 1);
  assert.ok(environments.filter((item) => item.stage !== "secrets").every((item) => item.usesLegacyToken));
});

test("complete collection still requires all required Secrets to be deployed", async (t) => {
  for (const [name, secrets, expectedPassed] of [
    ["deployed", valid.secrets, true],
    ["missing", valid.secrets.slice(1), false],
    ["staged", valid.secrets.map((item, index) => index === 0 ? { ...item, status: "Staged" } : item), false]
  ]) {
    await t.test(name, async (t) => {
      const { report } = await runAudit(t, { secrets, expectedStatus: expectedPassed ? 0 : 1 });
      assert.equal(report.passed, expectedPassed);
      assert.equal(report.collectionComplete, true);
      assert.equal(report.checks.requiredSecretsDeployed, expectedPassed);
      assert.equal(report.stage, undefined);
    });
  }
});

async function runAudit(t, { failures = {}, machines = valid.machines, secrets = valid.secrets, metadataProbeStatus = 403, expectedStatus = 1, metadataToken, legacyAccessToken, checkSequence, expectedCalls = 5 } = {}) {
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-fly-audit-cli-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, "fly.toml"), 'app = "tabitabi-jp"\n');
  await writeFile(join(directory, "responses.json"), JSON.stringify({ ...valid, machines, secrets, failures, checkSequence }));
  await writeFile(join(directory, "probe-calls.txt"), "");
  const preload = join(directory, "metadata-probe.mjs");
  await writeFile(preload, `import { appendFileSync } from "node:fs";
  globalThis.fetch = async (url, options) => {
    appendFileSync(process.env.AUDIT_TEST_DIRECTORY + "/probe-calls.txt", JSON.stringify({
      usesMetadataToken: options.headers.Authorization === "Bearer synthetic-metadata-test-only",
      usesLegacyToken: options.headers.Authorization === "Bearer synthetic-test-only",
      hasAccessOverride: options.headers.Authorization === "Bearer synthetic-access-override"
    }) + "\\n");
    if (url !== "https://api.machines.dev/v1/apps/tabitabi-jp/secrets") throw new Error("Unexpected endpoint");
    return new Response(null, { status: ${metadataProbeStatus} });
  };`);
  await writeFile(join(directory, "flyctl"), `#!/usr/bin/env node
const { readFileSync, appendFileSync, readdirSync } = require("node:fs");
const { join } = require("node:path");
const directory = process.env.AUDIT_TEST_DIRECTORY;
const responses = JSON.parse(readFileSync(join(directory, "responses.json"), "utf8"));
const stage = process.argv[2] === "machine" ? "machines" : process.argv[2];
appendFileSync(join(directory, "calls.txt"), stage + "\\n");
appendFileSync(join(directory, "environments.jsonl"), JSON.stringify({ stage,
  usesMetadataToken: process.env.FLY_API_TOKEN === "synthetic-metadata-test-only",
  usesLegacyToken: process.env.FLY_API_TOKEN === "synthetic-test-only",
  hasMetadataVariable: Object.hasOwn(process.env, "FLY_SECRET_METADATA_TOKEN"),
  hasAccessOverride: Object.hasOwn(process.env, "FLY_ACCESS_TOKEN"),
  configDirectory: process.env.FLY_CONFIG_DIR, configEntries: readdirSync(process.env.FLY_CONFIG_DIR)
}) + "\\n");
const failure = responses.failures[stage];
if (failure) { process.stderr.write(failure.stderr); process.exit(failure.code); }
if (!Object.hasOwn(responses, stage)) process.exit(9);
let response = responses[stage];
if (stage === "checks" && Array.isArray(responses.checkSequence)) {
  const count = readFileSync(join(directory, "calls.txt"), "utf8").split("\\n").filter(item => item === "checks").length;
  response = responses.checkSequence[Math.min(count - 1, responses.checkSequence.length - 1)];
}
process.stdout.write(JSON.stringify(response));
`, { mode: 0o700 });
  await writeFile(join(directory, "git"), `#!/bin/sh
if [ "$1" = "rev-parse" ]; then printf '${"a".repeat(40)}\\n'; fi
`, { mode: 0o700 });
  const env = { PATH: `${directory}:${process.env.PATH}`, FLY_API_TOKEN: "synthetic-test-only", AUDIT_TEST_DIRECTORY: directory };
  if (metadataToken !== undefined) env.FLY_SECRET_METADATA_TOKEN = metadataToken;
  if (legacyAccessToken !== undefined) env.FLY_ACCESS_TOKEN = legacyAccessToken;
  const result = spawnSync(process.execPath, ["--import", preload, resolve("scripts/audit-fly-remote.mjs")], {
    cwd: directory, encoding: "utf8", timeout: 10_000,
    env
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, expectedStatus, result.stderr);
  const report = JSON.parse(await readFile(join(directory, "data/release-evidence/latest-fly.json"), "utf8"));
  const calls = (await readFile(join(directory, "calls.txt"), "utf8")).trim().split("\n");
  assert.equal(calls.length, expectedCalls);
  const probeText = (await readFile(join(directory, "probe-calls.txt"), "utf8")).trim();
  const probes = probeText ? probeText.split("\n").map((line) => JSON.parse(line)) : [];
  assert.equal(probes.length, failures.secrets ? 1 : 0);
  const environments = (await readFile(join(directory, "environments.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.ok(environments.every((item) => !item.hasMetadataVariable));
  assert.ok(environments.every((item) => item.configEntries.length === 0));
  for (const path of new Set(environments.map((item) => item.configDirectory))) await assert.rejects(access(path), { code: "ENOENT" });
  assert.doesNotMatch(JSON.stringify(report) + result.stdout + result.stderr, /raw-private-value|raw-private-secret-value|synthetic-test-only|synthetic-metadata-test-only|synthetic-access-override/);
  return { report, calls, environments, probes };
}
