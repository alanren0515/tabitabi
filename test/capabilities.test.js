import test from "node:test";
import assert from "node:assert/strict";
import { createCapabilitiesLoader } from "../src/capabilities.js";

test("caches successful capabilities briefly and supports a forced refresh", async () => {
  let calls = 0;
  const load = createCapabilitiesLoader({
    fetchImpl: async () => ({ ok: true, json: async () => ({ revision: ++calls }) }),
    now: () => 1_000
  });
  assert.equal((await load()).revision, 1);
  assert.equal((await load()).revision, 1);
  assert.equal((await load({ force: true })).revision, 2);
});

test("retries a failed capabilities request after the short failure TTL", async () => {
  let time = 1_000;
  let calls = 0;
  const load = createCapabilitiesLoader({
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new Error("temporary failure");
      return { ok: true, json: async () => ({ visionExtraction: true }) };
    },
    failureTtlMs: 5_000,
    now: () => time
  });
  await assert.rejects(() => load(), /temporary failure/);
  await assert.rejects(() => load(), /temporary failure/);
  assert.equal(calls, 1);
  time += 5_001;
  assert.equal((await load()).visionExtraction, true);
  assert.equal(calls, 2);
});

test("rejects non-success and malformed capability responses", async () => {
  const failed = createCapabilitiesLoader({ fetchImpl: async () => ({ ok: false, status: 503 }) });
  await assert.rejects(() => failed(), /503/);
  const malformed = createCapabilitiesLoader({ fetchImpl: async () => ({ ok: true, json: async () => [] }) });
  await assert.rejects(() => malformed(), /invalid/);
});
