import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommercialStore } from "../server/commercial-store.mjs";

const DAY = 86_400_000;
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-commercial-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let clock = Date.parse("2026-10-02T10:00:00Z");
  const path = join(directory, "state.json");
  const config = { path, now: () => clock, releaseRevision: "a".repeat(40), ...options };
  return {
    store: createCommercialStore(config), config, path,
    advance: (ms) => { clock += ms; }, time: () => new Date(clock).toISOString(),
    read: async () => JSON.parse(await readFile(path, "utf8"))
  };
}
async function flow(store, extra = {}) { return store.registerFlow({ kind: "analysis", inputType: "text", sessionId: randomUUID(), ...extra }); }
function event(parent, extra = {}) {
  return { schemaVersion: 2, eventId: randomUUID(), sessionId: parent.sessionId,
    ...(parent.analysisRunId ? { analysisRunId: parent.analysisRunId } : { interactionId: parent.interactionId }),
    event: parent.analysisRunId ? "input_submitted" : "review_started", ...extra };
}
async function complete(store, parent) {
  if (parent.analysisRunId) {
    await store.observe(parent, { stage: "input", inputType: "text" });
    await store.observe(parent, { stage: "search" });
  }
  await store.observe(parent, { stage: "details" });
}
const expectCode = (promise, code) => assert.rejects(promise, (error) => error.code === code);
function consent(time, extra = {}) {
  return { consentVersion: "research-v1", state: "accepted", deviceId: randomUUID(), token: randomBytes(32).toString("base64url"), requestedAt: time, ...extra };
}

test("parallel retransmits and a second store instance commit one event, including after restart", async (t) => {
  const ctx = await setup(t);
  const parent = await flow(ctx.store);
  const body = event(parent);
  const second = createCommercialStore(ctx.config);
  const receipts = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? ctx.store : second).ingest(body, parent)));
  assert.equal(receipts.filter((receipt) => !receipt.duplicate).length, 1);
  assert.equal((await ctx.read()).events.length, 1);
  assert.equal((await createCommercialStore(ctx.config).ingest(body, parent)).duplicate, true);
  await expectCode(ctx.store.ingest({ ...body, event: "analysis_started" }, parent), "EVENT_ID_CONFLICT");
  assert.equal((await ctx.read()).events.length, 1);
});

test("live completion requires server-issued linkage and observed stages", async (t) => {
  const ctx = await setup(t);
  const parent = await flow(ctx.store, { sourceMode: "live", researchSource: "natural", channel: "direct" });
  await ctx.store.ingest(event(parent, { sourceMode: "live", releaseRevision: "b".repeat(40) }), parent);
  assert.equal((await ctx.read()).events[0].record.sourceMode, "unknown");
  await expectCode(ctx.store.ingest(event(parent, { event: "analysis_completed" }), parent), "COMPLETION_NOT_OBSERVED");
  await complete(ctx.store, parent);
  await ctx.store.ingest(event(parent, { event: "analysis_completed" }), parent);
  const records = (await ctx.read()).events.map((item) => item.record);
  assert.ok(records.every((record) => record.sourceMode === "live"));
  assert.ok(records.every((record) => record.releaseRevision === "a".repeat(40)));
  assert.ok(records.every((record) => record.researchSource === "unknown" && record.channel === "unknown"));
  await expectCode(ctx.store.ingest(event(parent), { ...parent, token: randomBytes(32).toString("base64url") }), "INVALID_MEASUREMENT_FLOW");
  await expectCode(ctx.store.ingest(event(parent, { sessionId: randomUUID() }), parent), "MEASUREMENT_LINK_MISMATCH");
});

test("mixed demo and audit downgrade the entire flow, even a duplicate with a demo signal", async (t) => {
  const ctx = await setup(t);
  const parent = await flow(ctx.store);
  await complete(ctx.store, parent);
  const body = event(parent, { event: "analysis_completed" });
  await ctx.store.ingest(body, parent);
  await ctx.store.ingest({ ...body, sourceMode: "demo", trafficType: "audit" }, parent);
  await complete(ctx.store, parent);
  const record = (await ctx.read()).events[0].record;
  assert.equal(record.sourceMode, "demo");
  assert.equal(record.trafficType, "audit");
  const demo = await flow(ctx.store, { sourceMode: "demo" });
  await ctx.store.ingest(event(demo, { event: "analysis_completed" }), demo);
  assert.equal((await ctx.read()).events[1].record.sourceMode, "demo");
});

test("review is independent and cannot mint a first-analysis completion", async (t) => {
  const ctx = await setup(t);
  const parent = await flow(ctx.store, { kind: "review" });
  await complete(ctx.store, parent);
  await ctx.store.ingest(event(parent, { event: "review_completed" }), parent);
  await expectCode(ctx.store.ingest(event(parent, { event: "analysis_completed" }), parent), "INVALID_EVENT");
  await expectCode(ctx.store.ingest({ ...event(parent), interactionId: undefined, analysisRunId: parent.flowId, event: "analysis_completed" }, parent), "MEASUREMENT_LINK_MISMATCH");
  const record = (await ctx.read()).events[0].record;
  assert.equal(record.event, "review_completed");
  assert.equal(record.sourceMode, "live");
  assert.equal("analysisRunId" in record, false);
});

test("failed real attempts remain live inputs without inventing completed tasks", async (t) => {
  const ctx = await setup(t);
  const parent = await flow(ctx.store);
  await ctx.store.ingest(event(parent), parent);
  await ctx.store.observe(parent, { stage: "input", inputType: "text", outcome: "started" });
  await ctx.store.ingest(event(parent, { event: "analysis_failed", failureStage: "extraction" }), parent);
  await expectCode(ctx.store.ingest(event(parent, { event: "analysis_completed" }), parent), "COMPLETION_NOT_OBSERVED");
  assert.ok((await ctx.read()).events.every((item) => item.record.sourceMode === "live"));
  const review = await flow(ctx.store, { kind: "review" });
  await ctx.store.observe(review, { stage: "details", outcome: "started" });
  await ctx.store.ingest(event(review, { event: "review_failed", failureStage: "review" }), review);
  await expectCode(ctx.store.ingest(event(review, { event: "review_completed" }), review), "COMPLETION_NOT_OBSERVED");
  assert.equal((await ctx.read()).events.at(-1).record.sourceMode, "live");
});

test("out-of-order stages and input-type mismatches cannot establish live qualification", async (t) => {
  const ctx = await setup(t);
  const parent = await flow(ctx.store);
  await ctx.store.observe(parent, { stage: "details" });
  await complete(ctx.store, parent);
  await ctx.store.ingest(event(parent, { event: "analysis_completed" }), parent);
  assert.equal((await ctx.read()).events[0].record.sourceMode, "unknown");
  const wrongInput = await flow(ctx.store, { inputType: "screenshot" });
  await complete(ctx.store, wrongInput);
  await ctx.store.ingest(event(wrongInput, { event: "analysis_completed" }), wrongInput);
  assert.equal((await ctx.read()).events[1].record.sourceMode, "unknown");
});

test("URL entry text parsing is a real attempt, but completion still needs successful clues or webpage extraction", async (t) => {
  const ctx = await setup(t);
  const withClues = await flow(ctx.store, { inputType: "webpage" });
  await ctx.store.ingest(event(withClues), withClues);
  await complete(ctx.store, withClues);
  await ctx.store.ingest(event(withClues, { event: "analysis_completed" }), withClues);
  assert.ok((await ctx.read()).events.every(item => item.record.sourceMode === "live"));

  const onlyLink = await flow(ctx.store, { inputType: "webpage" });
  await ctx.store.ingest(event(onlyLink), onlyLink);
  await ctx.store.observe(onlyLink, { stage: "input", inputType: "text", outcome: "started" });
  await expectCode(ctx.store.ingest(event(onlyLink, { event: "analysis_completed" }), onlyLink), "COMPLETION_NOT_OBSERVED");
  assert.equal((await ctx.read()).events.at(-1).record.sourceMode, "live");
  await ctx.store.observe(onlyLink, { stage: "input", inputType: "webpage" });
  await ctx.store.observe(onlyLink, { stage: "search" });
  await ctx.store.observe(onlyLink, { stage: "details" });
  await ctx.store.ingest(event(onlyLink, { event: "analysis_completed" }), onlyLink);
  assert.equal((await ctx.read()).events.at(-1).record.sourceMode, "live");
});

test("flow expiry blocks new writes but preserves authenticated 30-day duplicate receipts", async (t) => {
  const ctx = await setup(t);
  const parent = await flow(ctx.store);
  ctx.advance(10 * 60_000);
  const body = event(parent);
  await ctx.store.ingest(body, parent);
  ctx.advance(20 * 60_000);
  await expectCode(ctx.store.ingest(event(parent), parent), "MEASUREMENT_FLOW_EXPIRED");
  assert.equal((await ctx.store.ingest(body, parent)).duplicate, true);
  ctx.advance(30 * DAY - 25 * 60_000);
  assert.equal((await ctx.store.ingest(body, parent)).duplicate, true);
  ctx.advance(5 * 60_000);
  await ctx.store.prune();
  assert.equal((await ctx.read()).events.length, 0);
});

test("a new release cannot reuse an old flow as current-version evidence", async (t) => {
  const ctx = await setup(t);
  const parent = await flow(ctx.store);
  const body = event(parent);
  await ctx.store.ingest(body, parent);
  const upgraded = createCommercialStore({ ...ctx.config, releaseRevision: "b".repeat(40) });
  await expectCode(upgraded.observe(parent, { stage: "input", inputType: "text" }), "MEASUREMENT_FLOW_EXPIRED");
  await expectCode(upgraded.ingest(event(parent), parent), "MEASUREMENT_FLOW_EXPIRED");
  assert.equal((await upgraded.ingest(body, parent)).duplicate, true);
  assert.equal((await ctx.read()).events[0].record.releaseRevision, "a".repeat(40));
});

test("consent retry cannot extend expiry, and revoke removes joins across restart and queued retries", async (t) => {
  const ctx = await setup(t);
  const grant = consent(ctx.time());
  const first = await ctx.store.consent(grant);
  ctx.advance(DAY);
  assert.equal((await ctx.store.consent(grant)).expiresAt, first.expiresAt);
  const parent = await flow(ctx.store);
  const body = event(parent, { research: grant });
  assert.equal((await ctx.store.ingest(body, parent)).researchLinked, true);
  await ctx.store.consent({ ...grant, state: "revoked" });
  const restarted = createCommercialStore(ctx.config);
  assert.equal((await restarted.ingest(body, parent)).researchLinked, false);
  assert.equal((await restarted.ingest(event(parent, { research: grant }), parent)).researchLinked, false);
  await expectCode(restarted.consent(grant), "RESEARCH_GRANT_CLOSED");
  const stored = await ctx.read();
  assert.equal(stored.researchLinks.length, 0);
  assert.equal(JSON.stringify(stored).includes(grant.deviceId), false);
  assert.equal(JSON.stringify(stored).includes(grant.token), false);
  assert.equal(JSON.stringify(stored).includes(parent.token), false);
});

test("revocation delivered before acceptance prevents an out-of-order grant", async (t) => {
  const ctx = await setup(t);
  const grant = consent(ctx.time());
  await ctx.store.consent({ ...grant, state: "revoked" });
  await expectCode(ctx.store.consent(grant), "RESEARCH_GRANT_CLOSED");
  ctx.advance(31 * DAY);
  await ctx.store.prune();
  await expectCode(ctx.store.consent(grant), "CONSENT_REQUEST_EXPIRED");
});

test("expiry clears personal research joins without waiting for new events; refusal remains usable", async (t) => {
  const ctx = await setup(t);
  const grant = consent(ctx.time());
  await ctx.store.consent(grant);
  ctx.advance(29 * DAY);
  const parent = await flow(ctx.store);
  await ctx.store.ingest(event(parent, { research: grant }), parent);
  ctx.advance(DAY);
  await createCommercialStore(ctx.config).prune();
  const stored = await ctx.read();
  assert.equal(stored.events.length, 1);
  assert.equal(stored.researchLinks.length, 0);
  assert.equal(JSON.stringify(stored).includes(grant.deviceId), false);
  await expectCode(ctx.store.consent(grant), "RESEARCH_GRANT_CLOSED");
  assert.equal((await ctx.store.consent({ consentVersion: "research-v1", state: "declined" })).state, "declined");
  const next = await flow(ctx.store);
  assert.equal((await ctx.store.ingest(event(next), next)).accepted, true);
});

test("unexpired dedupe capacity is never evicted; corrupt storage fails closed without overwriting", async (t) => {
  const ctx = await setup(t, { maxEvents: 1 });
  const parent = await flow(ctx.store);
  const first = event(parent);
  await ctx.store.ingest(first, parent);
  await expectCode(ctx.store.ingest(event(parent), parent), "MEASUREMENT_CAPACITY_REACHED");
  assert.equal((await ctx.store.ingest(first, parent)).duplicate, true);
  assert.equal((await ctx.read()).events.length, 1);
  await writeFile(ctx.path, "corrupt private state");
  await expectCode(ctx.store.ingest(first, parent), "MEASUREMENT_STORE_UNAVAILABLE");
  assert.equal(await readFile(ctx.path, "utf8"), "corrupt private state");
});

test("stored events have no input, contacts, content, raw credentials or browser source claims", async (t) => {
  const ctx = await setup(t);
  const parent = await flow(ctx.store);
  await ctx.store.ingest(event(parent, { rawInput: "PRIVATE_INPUT", feedbackText: "PRIVATE_TEXT", email: "PRIVATE_EMAIL", placeId: "PRIVATE_PLACE", sourceMode: "live" }), parent);
  const stored = JSON.stringify(await ctx.read());
  for (const value of ["PRIVATE_INPUT", "PRIVATE_TEXT", "PRIVATE_EMAIL", "PRIVATE_PLACE", parent.token]) assert.equal(stored.includes(value), false);
});

test("only registered campaigns qualify research; exclusions and legacy batches override them", async (t) => {
  const ctx = await setup(t, { campaigns: { organic: { channel: "social", researchSource: "natural" } } });
  for (const extra of [{ campaignId: "organic" }, { campaignId: "organic", batchOriginKnown: false }, { campaignId: "organic", researchSource: "reminded" }, { campaignId: "__proto__", researchSource: "natural" }]) {
    const parent = await flow(ctx.store, extra); await complete(ctx.store, parent);
    await ctx.store.ingest(event(parent), parent);
  }
  const records = (await ctx.read()).events.map(x => x.record);
  assert.deepEqual(records.map(x => x.researchSource), ["natural", "unknown", "reminded", "unknown"]);
  const parent = await flow(ctx.store, { kind: "review", reviewIntent: "saved_plan_refresh" });
  assert.equal((await ctx.read()).flows[parent.flowId].reviewIntent, "saved_plan_refresh");
});

test("bounded consent clock skew is accepted but stale requests cannot reopen expired grants", async (t) => {
  const ctx = await setup(t);
  await ctx.store.consent(consent(new Date(Date.parse(ctx.time()) + 60_000).toISOString()));
  await expectCode(ctx.store.consent(consent(new Date(Date.parse(ctx.time()) + 300_001).toISOString())), "CONSENT_REQUEST_EXPIRED");
});
