import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto, randomUUID, randomBytes } from "node:crypto";
import { createMeasurementClient, RESEARCH_STORAGE_KEY } from "../src/measurement-client.js";

const DAY = 86_400_000;
const storage = () => { const data = new Map(); return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
function setup(overrides = {}) {
  let time = Date.parse("2026-10-03T00:00:00Z");
  const calls = [];
  const local = overrides.storage || storage();
  let handler;
  const config = { storage: local, sessionStorage: storage(), cryptoImpl: webcrypto, now: () => time,
    fetchImpl: async (path, options) => {
      const body = JSON.parse(options.body); calls.push({ path, body, headers: options.headers });
      if (handler) { const result = await handler(path, body); if (result) return result; }
      if (path === "/api/measurement-flows") {
        const id = randomUUID();
        return reply({ flowId: id, token: randomBytes(32).toString("base64url"), sessionId: body.sessionId,
          [body.kind === "analysis" ? "analysisRunId" : "interactionId"]: id, expiresAt: new Date(time + 30 * 60_000).toISOString() });
      }
      if (path === "/api/research-consent") return reply({ accepted: true, state: body.state, expiresAt: new Date(time + 30 * DAY).toISOString() });
      return reply({ accepted: true }, 202);
    }, ...overrides };
  return { client: createMeasurementClient(config), config, calls, local, advance: ms => { time += ms; }, handle: fn => { handler = fn; } };
}
const start = c => c.start({ kind: "analysis", inputType: "text", batchId: c.newBatchId() });

test("default has no research identifier, whitelists events and retries with the same ID", async () => {
  const ctx = setup(); const c = ctx.client;
  assert.equal(ctx.local.getItem(RESEARCH_STORAGE_KEY), null);
  await start(c);
  let failures = 0;
  ctx.handle(path => path === "/api/events" && failures++ === 0 ? reply({}, 503) : null);
  assert.equal(await c.emit("input_submitted", { text: "private input", url: "private", deviceId: randomUUID() }), true);
  const events = ctx.calls.filter(x => x.path === "/api/events");
  assert.equal(events.length, 2);
  assert.equal(events[0].body.eventId, events[1].body.eventId);
  assert.ok(events.every(x => !x.body.research && !x.body.text && !x.body.url && !x.body.deviceId));
  assert.equal(await c.emit("review_completed"), false);
});

test("flow retains batch, session and review intent; idle session rotates, old headers expire", async () => {
  const { client: c, advance, calls } = setup();
  const first = await start(c);
  assert.equal(c.flow.batchId, first.batchId);
  advance(30 * 60_000);
  assert.deepEqual(c.requestHeaders(), {});
  await c.start({ kind: "review", reviewIntent: "saved_plan_refresh", campaignId: "verified-campaign" });
  assert.notEqual(c.flow.sessionId, first.sessionId);
  assert.equal(calls.at(-1).body.reviewIntent, "saved_plan_refresh");
  assert.equal(calls.at(-1).body.campaignId, "verified-campaign");
  await c.start({ kind: "analysis", inputType: "screenshot" });
  assert.deepEqual(c.requestHeaders("text"), {});
  await c.start({ kind: "analysis", inputType: "social_link" });
  assert.ok(c.requestHeaders("text")["X-Measurement-Flow"]);
  await c.start({ kind: "analysis", inputType: "webpage" });
  assert.ok(c.requestHeaders("text")["X-Measurement-Flow"]);
  assert.ok(c.requestHeaders("webpage")["X-Measurement-Flow"]);
  assert.deepEqual(c.requestHeaders("screenshot"), {});
});

test("explicit consent links only subsequent events; withdrawal clears identifiers", async () => {
  const { client: c, local, calls } = setup();
  await start(c); await c.emit("input_submitted");
  await c.acceptResearch(); assert.equal(c.research.state, "accepted");
  await c.emit("analysis_completed");
  assert.ok(calls.at(-1).body.research.deviceId);
  assert.equal("token" in c.research, false);
  await c.revokeResearch();
  assert.deepEqual(JSON.parse(local.getItem(RESEARCH_STORAGE_KEY)), { state: "revoked" });
  await c.emit("primary_action_clicked", { actionCapability: "map" });
  assert.equal(calls.at(-1).body.research, undefined);
});

test("offline withdrawal stops links immediately, survives reload and removes queued research", async () => {
  const ctx = setup(); const c = ctx.client;
  await start(c); await c.acceptResearch();
  let release;
  ctx.handle((path, body) => {
    if (path === "/api/research-consent") throw new Error("offline");
    if (path === "/api/events" && body.event === "input_submitted") return new Promise(resolve => { release = resolve; });
  });
  const first = c.emit("input_submitted");
  await new Promise(resolve => setImmediate(resolve));
  const queued = c.emit("analysis_completed");
  await c.revokeResearch();
  assert.equal(c.research.state, "pending_revocation");
  release(reply({ accepted: true }, 202)); await first; await queued;
  assert.equal(ctx.calls.at(-1).body.research, undefined);
  c.clearLocalSession();
  assert.equal(JSON.parse(ctx.local.getItem(RESEARCH_STORAGE_KEY)).state, "pending_revocation");
  ctx.handle(() => null);
  const reloaded = createMeasurementClient(ctx.config);
  await reloaded.retryResearch();
  assert.equal(reloaded.research.state, "revoked");
});

test("late acceptance cannot resurrect consent after withdrawal", async () => {
  const ctx = setup(); let release;
  ctx.handle((path, body) => path === "/api/research-consent" && body.state === "accepted" ? new Promise(resolve => { release = resolve; }) : null);
  const accepting = ctx.client.acceptResearch();
  await new Promise(resolve => setImmediate(resolve));
  await ctx.client.revokeResearch();
  release(reply({ accepted: true, state: "accepted", expiresAt: "2026-11-02T00:00:00Z" }));
  await accepting;
  assert.equal(ctx.client.research.state, "revoked");
});

test("cross-tab withdrawal and expiry are observed before sending; refusal creates no identifier", async () => {
  const ctx = setup(); const c = ctx.client;
  await start(c); await c.acceptResearch();
  ctx.local.setItem(RESEARCH_STORAGE_KEY, JSON.stringify({ state: "revoked" }));
  await c.emit("input_submitted"); assert.equal(ctx.calls.at(-1).body.research, undefined);
  await c.acceptResearch(); ctx.advance(30 * DAY);
  assert.equal(c.research.state, "expired");
  assert.equal(JSON.parse(ctx.local.getItem(RESEARCH_STORAGE_KEY)).deviceId, undefined);
  await c.declineResearch();
  assert.equal(ctx.calls.at(-1).body.deviceId, undefined);
});

test("storage failures fail closed for research while core flow and anonymous events remain usable", async () => {
  const broken = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const ctx = setup({ storage: broken });
  assert.equal((await ctx.client.acceptResearch()).state, "unavailable");
  assert.ok(await start(ctx.client));
  assert.equal(await ctx.client.emit("input_submitted"), true);
  assert.ok(ctx.calls.every(x => x.path !== "/api/research-consent" && !x.body.research));
});

test("ambiguous accept remains unlinked; retry refreshes request age without replacing credentials", async () => {
  const ctx = setup();
  ctx.handle(path => path === "/api/research-consent" ? reply({}, 503) : null);
  await ctx.client.acceptResearch();
  assert.equal(ctx.client.research.state, "pending_accept");
  const original = JSON.parse(ctx.local.getItem(RESEARCH_STORAGE_KEY));
  ctx.advance(6 * 60_000); ctx.handle(() => null);
  await ctx.client.retryResearch();
  const current = JSON.parse(ctx.local.getItem(RESEARCH_STORAGE_KEY));
  assert.equal(current.deviceId, original.deviceId); assert.equal(current.token, original.token);
  assert.notEqual(current.requestedAt, original.requestedAt);
  assert.equal(ctx.client.research.state, "accepted");
});

test("action capabilities do not turn listing, map or unverified links into booking exits", async () => {
  const { measurementActionCapability: classify } = await import("../src/measurement-client.js");
  assert.equal(classify("map"), "map");
  assert.equal(classify("open_booking_source"), "listing");
  assert.equal(classify("open_booking_source", {capability:{recommended:false,bookingMode:"instant"}}), "listing");
  assert.equal(classify("open_booking_source", {capability:{recommended:true,bookingMode:"instant"}}), "platform_booking");
  assert.equal(classify("official_website", {officiality:"restaurant_official",capability:{recommended:true,bookingMode:"request"}}), "direct_booking");
});
