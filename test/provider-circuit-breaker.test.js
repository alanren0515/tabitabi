import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProviderCircuitBreaker, ProviderCircuitOpenError } from "../server/provider-circuit-breaker.mjs";

test("opens before an excessive provider burst and automatically recovers", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-circuit-"));
  let now = new Date("2026-07-17T00:00:00Z");
  try {
    const circuit = createProviderCircuitBreaker({ path: join(root, "state.json"), now: () => now, providerLimits: { qwen: 2 }, openMs: 1000 });
    await circuit.admit("qwen");
    await circuit.admit("qwen");
    await assert.rejects(() => circuit.admit("qwen"), (error) => error instanceof ProviderCircuitOpenError && error.reason === "burst:qwen");
    assert.equal((await circuit.snapshot()).open, true);
    now = new Date(now.getTime() + 1001);
    assert.equal((await circuit.admit("qwen")).provider, "qwen");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("opens after repeated authentication failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-circuit-"));
  try {
    const circuit = createProviderCircuitBreaker({ path: join(root, "state.json"), authFailureLimit: 2 });
    await circuit.recordOutcome("google_places", { status: "error", errorCode: "authentication" });
    const snapshot = await circuit.recordOutcome("google_places", { status: "error", errorCode: "authentication" });
    assert.equal(snapshot.open, true);
    assert.match(snapshot.reason, /authentication:google_places/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("isolates repeated ordinary failures to the affected provider", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-circuit-"));
  try {
    const circuit = createProviderCircuitBreaker({ path: join(root, "state.json"), failureLimit: 3 });
    await circuit.recordOutcome("qwen", { status: "error", errorCode: "upstream" });
    await circuit.recordOutcome("qwen", { status: "error", errorCode: "upstream" });
    const snapshot = await circuit.recordOutcome("qwen", { status: "error", errorCode: "upstream" });
    assert.equal(snapshot.open, true);
    assert.match(snapshot.reason, /failures:qwen/);
    assert.equal((await circuit.admit("google_places")).provider, "google_places");
    await assert.rejects(() => circuit.admit("qwen"), ProviderCircuitOpenError);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fails closed when the circuit state is corrupt", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-circuit-"));
  const path = join(root, "state.json");
  try {
    await writeFile(path, "{bad-json", "utf8");
    const circuit = createProviderCircuitBreaker({ path });
    await assert.rejects(() => circuit.admit("qwen"), (error) => error instanceof ProviderCircuitOpenError && error.reason === "state_corrupt");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("fails closed when circuit JSON is syntactically valid but structurally corrupt", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-circuit-"));
  const path = join(root, "state.json");
  try {
    await writeFile(path, JSON.stringify({ version: 1, providers: { qwen: { openUntil: "invalid", attempts: "invalid", failures: [] } } }), "utf8");
    const circuit = createProviderCircuitBreaker({ path });
    await assert.rejects(() => circuit.admit("qwen"), (error) => error instanceof ProviderCircuitOpenError && error.reason === "state_corrupt");
    const snapshot = await circuit.snapshot();
    assert.equal(snapshot.open, true);
    assert.equal(snapshot.reason, "state_corrupt");
  } finally { await rm(root, { recursive: true, force: true }); }
});
