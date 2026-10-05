// Synthetic-only builder shared by deterministic regression fixtures. Never reads live state.
const DAY = 86_400_000;
export const REVISION = "a".repeat(40);
export const OTHER_REVISION = "b".repeat(40);
export const ANCHOR = Date.parse("2026-09-10T00:00:00.000Z");
export const AS_OF = ANCHOR + 10 * DAY;
export { DAY };

export function fixture() {
  let sequence = 0;
  const nextId = () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;
  const state = { version: 1, events: [], flows: {}, consents: {}, researchLinks: [] };
  function device({ granted = ANCHOR - DAY, status = "accepted", channel = "direct" } = {}) {
    const deviceId = nextId();
    const grantKey = String(++sequence).padStart(64, "0");
    state.consents[grantKey] = { consentVersion: "research-v1", state: status, deviceId,
      occurredAt: new Date(granted).toISOString(), expiresAt: new Date(granted + 30 * DAY).toISOString(), retainUntil: granted + 30 * DAY };
    return { deviceId, grantKey, channel };
  }
  function event(who, at, name, options = {}) {
    const record = { schemaVersion: 2, eventId: nextId(), sessionId: options.sessionId || nextId(),
      event: name, sourceMode: "live", trafficType: "product", channel: who?.channel || "unknown", researchSource: "natural",
      inputType: "text", deviceCategory: "mobile", releaseRevision: REVISION, occurredAt: new Date(at).toISOString(), ...options };
    state.events.push({ record, fingerprint: String(sequence).padStart(64, "0") });
    if (who) state.researchLinks.push({ eventId: record.eventId, deviceId: who.deviceId, grantKey: who.grantKey,
      consentVersion: "research-v1", occurredAt: record.occurredAt, expiresAt: state.consents[who.grantKey].expiresAt });
    return record;
  }
  function analysis(who, at, options = {}) {
    const analysisRunId = options.analysisRunId || nextId();
    const sessionId = options.sessionId || nextId();
    const { failed = false, ...fields } = options;
    state.flows[analysisRunId] = { id: analysisRunId, kind: "analysis", sessionId, releaseRevision: fields.releaseRevision || REVISION,
      batchId: fields.batchId || null, inputType: "text", trafficType: fields.trafficType || "product", demo: fields.sourceMode === "demo",
      researchSource: fields.researchSource || "natural", stages: {}, retainUntil: at + 30 * DAY };
    const common = { ...fields, analysisRunId, sessionId };
    event(who, at - 1000, "input_submitted", common);
    return event(who, at, failed ? "analysis_failed" : "analysis_completed", { ...common, ...(failed ? { failureStage: "search" } : {}) });
  }
  function review(who, at, { reviewIntent = "saved_plan_refresh", ...options } = {}) {
    const interactionId = nextId();
    const sessionId = options.sessionId || nextId();
    state.flows[interactionId] = { id: interactionId, kind: "review", sessionId, reviewIntent,
      releaseRevision: options.releaseRevision || REVISION, batchId: options.batchId || null, trafficType: "product",
      stages: {}, retainUntil: at + 30 * DAY };
    return event(who, at, "review_completed", { ...options, interactionId, sessionId });
  }
  return { state, device, analysis, review, event, nextId };
}

export function syntheticFixture() {
  const f = fixture();
  for (let index = 0; index < 5; index++) {
    const person = f.device();
    const first = f.analysis(person, ANCHOR);
    if (index === 0) f.analysis(person, ANCHOR + DAY); // Inclusive 24h.
    if (index === 1) f.review(person, ANCHOR + 7 * DAY); // Inclusive 7d.
    if (index === 2) f.review(person, ANCHOR + 2 * DAY, { reviewIntent: "history_open" });
    if (index === 3) f.analysis(person, ANCHOR + 2 * DAY, { sessionId: first.sessionId });
    if (index === 4) f.analysis(person, ANCHOR + 2 * DAY, { failed: true });
  }
  const batchDevice = f.device({ channel: "social" });
  const batchId = f.nextId();
  f.analysis(batchDevice, ANCHOR, { batchId });
  f.analysis(batchDevice, ANCHOR + 2 * DAY, { batchId });
  const unknown = f.device({ channel: "unknown" });
  f.analysis(unknown, ANCHOR, { researchSource: "unknown" });
  const revoked = f.device({ status: "revoked" });
  f.analysis(revoked, ANCHOR);
  const mixed = f.device({ channel: "partner" });
  f.analysis(mixed, ANCHOR, { releaseRevision: OTHER_REVISION });
  f.analysis(mixed, ANCHOR + 6 * DAY);
  f.state.events.push(structuredClone(f.state.events[0]));
  f.state.researchLinks.push(structuredClone(f.state.researchLinks[0]));
  return { fixtureOnly: true, description: "Synthetic boundary, exclusion, and suppression scenarios; no observed people or product evidence.",
    asOf: new Date(AS_OF).toISOString(), releaseRevision: REVISION, state: f.state };
}
