import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PROVIDER_FREE_CONFIG, verifyBaselineSnapshot } from "../server/benchmark-baseline.mjs";

async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-baseline-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, "source.tar"), "fixture source archive");
  await writeFile(join(root, "config.json"), JSON.stringify(PROVIDER_FREE_CONFIG));
  const snapshot = {
    revision: "a".repeat(40), archivePath: "source.tar", archiveSha256: createHash("sha256").update("fixture source archive").digest("hex"),
    createdAt: "2026-10-02T03:00:00.000Z", nodeVersion: process.version, configurationFixturePath: "config.json"
  };
  return { root, snapshot };
}

test("baseline verification requires actual retained bytes and provider-free configuration", async (t) => {
  const { root, snapshot } = await setup(t);
  assert.equal((await verifyBaselineSnapshot(snapshot, { root })).valid, true);
  await writeFile(join(root, "source.tar"), "changed");
  assert.deepEqual((await verifyBaselineSnapshot(snapshot, { root })).errors, ["baseline_archive_digest_mismatch"]);
  assert.equal((await verifyBaselineSnapshot({ ...snapshot, archivePath: "missing.tar" }, { root })).valid, false);
});

test("credentials or a disabled emergency stop invalidate the baseline config", async (t) => {
  const { root, snapshot } = await setup(t);
  for (const config of [
    { ...PROVIDER_FREE_CONFIG, GOOGLE_MAPS_API_KEY: "must-not-run" },
    { ...PROVIDER_FREE_CONFIG, PAID_API_EMERGENCY_STOP: "false" },
    { ...PROVIDER_FREE_CONFIG, UNREGISTERED_PROVIDER_KEY: "must-not-run" }
  ]) {
    await writeFile(join(root, "config.json"), JSON.stringify(config));
    assert.deepEqual((await verifyBaselineSnapshot(snapshot, { root })).errors, ["baseline_configuration_not_provider_free"]);
  }
});

test("baseline files cannot escape the controlled root through paths or symlinks", async (t) => {
  const { root, snapshot } = await setup(t);
  const other = await mkdtemp(join(tmpdir(), "tabitabi-baseline-outside-"));
  t.after(() => rm(other, { recursive: true, force: true }));
  await writeFile(join(other, "source.tar"), "fixture source archive");
  await symlink(join(other, "source.tar"), join(root, "link.tar"));
  for (const archivePath of [join(other, "source.tar"), "../source.tar", "link.tar", "..\source.tar"]) {
    assert.equal((await verifyBaselineSnapshot({ ...snapshot, archivePath }, { root })).valid, false);
  }
});
