import test from "node:test";
import assert from "node:assert/strict";
import { createVisionConcurrencyGate, imageContentFingerprint, VisionConcurrencyError } from "../server/vision-abuse-protection.mjs";

test("fingerprints decoded image bytes so harmless base64 whitespace cannot bypass deduplication", () => {
  const payload = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ";
  const compact = `data:image/png;base64,${payload}`;
  const spaced = `data:image/png;base64,${payload.slice(0, 20)}\n${payload.slice(20)}`;
  assert.equal(imageContentFingerprint(compact), imageContentFingerprint(spaced));
});

test("rejects excess concurrent model work and always releases the slot", async () => {
  const gate = createVisionConcurrencyGate({ limit: 1 });
  let release;
  const first = gate.run(() => new Promise((resolve) => { release = resolve; }));
  assert.equal(gate.active(), 1);
  await assert.rejects(() => gate.run(async () => "second"), (error) => error instanceof VisionConcurrencyError && error.status === 429);
  release("done");
  assert.equal(await first, "done");
  assert.equal(gate.active(), 0);
  await assert.rejects(() => gate.run(async () => { throw new Error("failed"); }), /failed/);
  assert.equal(gate.active(), 0);
});
