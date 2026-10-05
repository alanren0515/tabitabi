import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCommercialEvent, sanitizeCommercialEvent, createResearchConsentRecord,
  createResearchAssociation, COMMERCIAL_EVENTS
} from "../server/commercial-event-schema.mjs";
import { sanitizeEvent } from "../server/event-sanitizer.mjs";

const NOW = new Date("2026-10-02T03:00:00.000Z");
const UUID = "01234567-89ab-4cde-8fab-0123456789ab";
const OTHER = "fedcba98-7654-4321-8abc-0123456789ab";
const event = (extra = {}) => ({ schemaVersion: 2, event: "input_submitted", eventId: UUID, sessionId: OTHER, analysisRunId: "run_12345678", ...extra });

test("v2 whitelists fields and refuses arbitrary enum contents", () => {
  const payload = event({ inputType: "text", feedbackText: "private", placeId: "private", rawInput: "private", url: "private", email: "private", deviceId: UUID });
  const { valid, event: clean } = validateCommercialEvent(payload);
  assert.equal(valid, true);
  assert.deepEqual(Object.keys(clean).sort(), ["schemaVersion", "event", "eventId", "sessionId", "analysisRunId", "inputType"].sort());
  for (const field of ["inputType", "channel", "researchSource", "deviceCategory", "issueCategory", "actionCapability", "failureStage"]) {
    const invalid = validateCommercialEvent(event({ [field]: "unregistered-user-content" }));
    assert.equal(invalid.valid, false);
    assert.equal(JSON.stringify(invalid.errors).includes("unregistered-user-content"), false);
  }
});

test("review cannot inflate first-analysis completion and linked actions have one parent", () => {
  const review = event({ event: "review_completed", analysisRunId: null, interactionId: UUID });
  assert.equal(validateCommercialEvent(review).valid, true);
  assert.equal(validateCommercialEvent(event({ event: "analysis_completed", interactionId: UUID })).valid, false);
  assert.equal(validateCommercialEvent(event({ event: "review_completed" })).valid, false);
  assert.equal(validateCommercialEvent(event({ event: "primary_action_clicked", actionCapability: "map" })).valid, true);
  assert.equal(validateCommercialEvent(event({ event: "primary_action_clicked", actionCapability: "map", interactionId: UUID })).valid, false);
  assert.equal(validateCommercialEvent(event({ event: "issue_reported", issueCategory: "wrong_branch" })).valid, true);
  assert.equal(validateCommercialEvent(event({ event: "issue_reported" })).valid, false);
  assert.equal(validateCommercialEvent(event({ event: "review_failed", analysisRunId: null, interactionId: UUID, failureStage: "review" })).valid, true);
  assert.equal(validateCommercialEvent(event({ event: "analysis_failed" })).valid, false);
});

test("unsupported versions and malformed ids never silently become legacy events", () => {
  for (const value of [null, [], "text", 2]) assert.equal(validateCommercialEvent(value).valid, false);
  for (const schemaVersion of [undefined, 1, 3, "2"]) assert.equal(validateCommercialEvent(event({ schemaVersion })).valid, false);
  for (const value of ["", "email@example.com", "https://example.com", "a".repeat(100)]) {
    assert.equal(validateCommercialEvent(event({ eventId: value })).valid, false);
    assert.equal(validateCommercialEvent(event({ sessionId: value })).valid, false);
  }
  assert.equal(sanitizeEvent(event({ feedbackText: "must not enter v2" })), null);
  assert.equal(sanitizeEvent({ event: "feedback_submitted", schemaVersion: 1, feedbackText: "existing feedback" }).feedbackText, "existing feedback");
  assert.equal(sanitizeEvent(null), null);
  assert.ok(COMMERCIAL_EVENTS.includes("review_completed"));
  assert.equal(validateCommercialEvent(event({ eventId: UUID.toUpperCase() })).event.eventId, UUID);
});

test("server context overrides client source, revision, channel, research and clock claims", () => {
  const input = event({ sourceMode: "live", trafficType: "product", releaseRevision: "b".repeat(40), occurredAt: "2099-01-01", channel: "direct", researchSource: "natural" });
  const unknown = sanitizeCommercialEvent(input, NOW);
  assert.equal(unknown.sourceMode, "unknown");
  assert.equal(unknown.trafficType, "unknown");
  assert.equal(unknown.channel, "unknown");
  assert.equal(unknown.researchSource, "unknown");
  assert.equal(unknown.releaseRevision, null);
  const trusted = sanitizeCommercialEvent(input, NOW, { sourceMode: "demo", trafficType: "audit", releaseRevision: "a".repeat(40), channel: "partner", researchSource: "benchmark" });
  assert.equal(trusted.sourceMode, "demo");
  assert.equal(trusted.trafficType, "audit");
  assert.equal(trusted.channel, "partner");
  assert.equal(trusted.researchSource, "benchmark");
  assert.equal(trusted.releaseRevision, "a".repeat(40));
  assert.equal(trusted.occurredAt, NOW.toISOString());
  assert.equal(sanitizeCommercialEvent(input, new Date("invalid")), null);
});

test("session-only visits require no run and consent is independent of core events", () => {
  assert.equal(validateCommercialEvent(event({ event: "app_visit", analysisRunId: null })).valid, true);
  assert.equal(validateCommercialEvent(event({ event: "app_visit" })).valid, false);
  const declined = createResearchConsentRecord({ consentVersion: "research-v1", state: "declined", deviceId: UUID }, NOW);
  assert.deepEqual(declined, { consentVersion: "research-v1", state: "declined", occurredAt: NOW.toISOString() });
  assert.ok(sanitizeCommercialEvent(event(), NOW));
  assert.equal(createResearchConsentRecord({ consentVersion: "old", state: "accepted", deviceId: UUID }, NOW), null);
});

test("research linkage expires at 30 days and revocation suppresses queued associations", () => {
  const consent = createResearchConsentRecord({ consentVersion: "research-v1", state: "accepted", deviceId: UUID, email: "must not be stored" }, NOW);
  assert.equal(consent.expiresAt, "2026-11-01T03:00:00.000Z");
  assert.equal("email" in consent, false);
  const record = sanitizeCommercialEvent(event(), NOW);
  assert.ok(createResearchAssociation(record, consent, NOW));
  assert.equal(createResearchAssociation(record, { ...consent, state: "revoked" }, NOW), null);
  assert.equal(createResearchAssociation(record, { ...consent, state: "declined" }, NOW), null);
  assert.ok(createResearchAssociation(record, consent, new Date("2026-11-01T02:59:59.999Z")));
  assert.equal(createResearchAssociation(record, consent, new Date(consent.expiresAt)), null);
  assert.equal(createResearchAssociation(record, { ...consent, expiresAt: "2027-01-01T03:00:00.000Z" }, NOW), null);
  assert.equal(createResearchAssociation({ ...record, occurredAt: "2026-10-01T03:00:00.000Z" }, consent, NOW), null);
  assert.equal(createResearchAssociation({ ...record, occurredAt: "2026-10-03T03:00:00.000Z" }, consent, NOW), null);
});
