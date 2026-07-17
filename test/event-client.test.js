import test from "node:test";
import assert from "node:assert/strict";
import { sendEvent } from "../src/event-client.js";

test("reports success only after the event endpoint accepts the request", async () => {
  let request;
  const accepted = await sendEvent(async (url, options) => {
    request = { url, options };
    return { ok: true };
  }, { event: "feedback_submitted", helpful: true }, { "X-Pilot-Access": "pilot-code" });

  assert.equal(accepted, true);
  assert.equal(request.url, "/api/events");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.keepalive, true);
  assert.equal(request.options.headers["X-Pilot-Access"], "pilot-code");
  assert.deepEqual(JSON.parse(request.options.body), { event: "feedback_submitted", helpful: true });
});

test("reports failure for rejected or unreachable event requests", async () => {
  assert.equal(await sendEvent(async () => ({ ok: false }), { event: "feedback_submitted" }), false);
  assert.equal(await sendEvent(async () => { throw new Error("offline"); }, { event: "feedback_submitted" }), false);
});
