import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { classifyFlyCliError, createFlyCliRuntime } from "../server/fly-cli-runtime.mjs";
import { invalidateReleaseEvidence, writeReleaseEvidence } from "../server/release-evidence-store.mjs";
import { buildRemotePilotFailureEvidence } from "../server/remote-pilot-audit.mjs";

test("isolates Fly CLI locks while copying the existing login with private permissions", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-fly-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, "source");
  await mkdir(source);
  await writeFile(join(source, "config.yml"), "access_token: secret-test-value\n", { mode: 0o600 });
  const runtime = await createFlyCliRuntime({ env: { FLY_CONFIG_DIR: source }, tempRoot: root });
  assert.notEqual(runtime.env.FLY_CONFIG_DIR, source);
  assert.equal(await readFile(join(runtime.env.FLY_CONFIG_DIR, "config.yml"), "utf8"), "access_token: secret-test-value\n");
  assert.equal((await stat(runtime.env.FLY_CONFIG_DIR)).mode & 0o777, 0o700);
  assert.equal((await stat(join(runtime.env.FLY_CONFIG_DIR, "config.yml"))).mode & 0o777, 0o600);
  const isolated = runtime.env.FLY_CONFIG_DIR;
  await runtime.cleanup();
  await assert.rejects(() => stat(isolated), { code: "ENOENT" });
});

test("does not copy config.yml when FLY_API_TOKEN is already supplied", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-fly-token-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = await createFlyCliRuntime({ env: { FLY_API_TOKEN: "test-token" }, tempRoot: root });
  await assert.rejects(() => stat(join(runtime.env.FLY_CONFIG_DIR, "config.yml")), { code: "ENOENT" });
  await runtime.cleanup();
});

test("keeps cleanup retryable when the first removal fails", async () => {
  let removals = 0;
  const runtime = await createFlyCliRuntime({
    env: { FLY_API_TOKEN: "test-token" },
    tempRoot: "/virtual-temp",
    readdirImpl: async () => [],
    mkdtempImpl: async () => "/virtual-temp/tabitabi-flyctl-current",
    chmodImpl: async () => {},
    rmImpl: async () => {
      removals += 1;
      if (removals === 1) throw Object.assign(new Error("busy"), { code: "EBUSY" });
    }
  });
  await assert.rejects(() => runtime.cleanup(), { code: "EBUSY" });
  await runtime.cleanup();
  assert.equal(removals, 2);
});

test("removes a partially copied credential directory when setup fails", async () => {
  let removals = 0;
  let chmodCalls = 0;
  await assert.rejects(() => createFlyCliRuntime({
    env: { FLY_CONFIG_DIR: "/source" },
    tempRoot: "/virtual-temp",
    readdirImpl: async () => [],
    mkdtempImpl: async () => "/virtual-temp/tabitabi-flyctl-current",
    copyFileImpl: async () => {},
    chmodImpl: async () => {
      chmodCalls += 1;
      if (chmodCalls === 2) throw Object.assign(new Error("chmod failed"), { code: "EPERM" });
    },
    rmImpl: async () => { removals += 1; }
  }), { code: "EPERM" });
  assert.equal(removals, 1);
});

test("classifies Fly failures without exposing stderr contents", () => {
  const denied = classifyFlyCliError({ message: "open /Users/person/.fly/perms: operation not permitted" });
  assert.equal(denied.category, "configAccess");
  assert.doesNotMatch(denied.message, /Users\/person|perms/);
  assert.equal(classifyFlyCliError({ stderr: "unauthorized token-value" }).category, "authentication");
  assert.equal(classifyFlyCliError({ message: "request timeout" }).category, "timeout");
  assert.equal(classifyFlyCliError({ message: "unexpected secret-value" }).category, "remoteUnavailable");
});

test("persists a current-revision remote pilot failure shape instead of reusing old evidence", () => {
  const revision = "a".repeat(40);
  const report = buildRemotePilotFailureEvidence({
    app: "tabitabi-jp",
    revision,
    repositoryClean: true,
    error: { message: "permission denied /private/token" },
    now: new Date("2026-08-01T00:00:00Z")
  });
  assert.deepEqual(report, {
    schemaVersion: 2,
    source: "fly-audit-error",
    generatedAt: "2026-08-01T00:00:00.000Z",
    app: "tabitabi-jp",
    auditRevision: revision,
    repositoryClean: true,
    gatePassed: false,
    errorCategory: "configAccess",
    error: "Fly CLI could not initialize its private local runtime directory. Run the audit as the same OS user that owns the Fly login; do not print or manually copy the token."
  });
});

test("atomically replaces an old passing report with the latest failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-fly-evidence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "latest-remote-pilot.json");
  await writeFile(path, JSON.stringify({ gatePassed: true }));
  const failure = buildRemotePilotFailureEvidence({
    app: "tabitabi-jp",
    revision: "b".repeat(40),
    repositoryClean: true,
    error: { message: "timeout" },
    now: new Date("2026-08-01T01:00:00Z")
  });
  await writeReleaseEvidence(path, failure);
  assert.deepEqual(JSON.parse(await readFile(path, "utf8")), failure);
});

test("invalidates old passing evidence before a new audit can fail", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-fly-invalidate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "latest.json");
  await writeFile(path, JSON.stringify({ gatePassed: true }));
  await invalidateReleaseEvidence(path);
  await assert.rejects(() => writeReleaseEvidence(path, { gatePassed: false }, {
    renameImpl: async () => { throw Object.assign(new Error("disk full"), { code: "ENOSPC" }); }
  }), { code: "ENOSPC" });
  await assert.rejects(() => stat(path), { code: "ENOENT" });
  assert.equal(JSON.parse(await readFile(`${path}.previous`, "utf8")).gatePassed, true);
});
