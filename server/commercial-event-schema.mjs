// Shared v2 contract. The A02 store supplies trusted flow context and persistent consent state.
export const COMMERCIAL_SCHEMA_VERSION = 2;
export const RESEARCH_CONSENT_VERSION = "research-v1";
export const COMMERCIAL_RETENTION_DAYS = 30;
export const SESSION_IDLE_MS = 30 * 60 * 1_000;
const RETENTION_MS = COMMERCIAL_RETENTION_DAYS * 24 * 60 * 60 * 1_000;

const RUN_EVENTS = new Set([
  "analysis_started", "input_submitted", "clues_extracted", "candidates_shown",
  "candidate_confirmed", "analysis_completed", "analysis_failed"
]);
const REVIEW_EVENTS = new Set(["review_started", "review_completed", "review_failed"]);
const LINKED_EVENTS = new Set(["primary_action_clicked", "issue_reported", "saved_plan_updated"]);
const SESSION_EVENTS = new Set(["app_visit"]);
export const COMMERCIAL_EVENTS = Object.freeze([...RUN_EVENTS, ...REVIEW_EVENTS, ...LINKED_EVENTS, ...SESSION_EVENTS]);
export const COMMERCIAL_ENUMS = Object.freeze({
  inputType: Object.freeze(["screenshot", "text", "social_link", "webpage", "restaurant_name"]),
  actionCapability: Object.freeze(["direct_booking", "platform_booking", "phone", "map", "listing", "search", "unknown"]),
  issueCategory: Object.freeze(["wrong_branch", "wrong_link", "outdated_info", "unclear_condition", "other"]),
  failureStage: Object.freeze(["input", "extraction", "search", "confirmation", "details", "review", "unknown"]),
  channel: Object.freeze(["direct", "social", "search", "partner", "unknown"]),
  researchSource: Object.freeze(["natural", "benchmark", "assigned_task", "incentivized", "reminded", "unknown"]),
  deviceCategory: Object.freeze(["mobile", "desktop", "tablet", "unknown"])
});

export function validateCommercialEvent(body) {
  const errors = [];
  if (!plainObject(body)) return { valid: false, errors: ["invalid_body"], event: null };
  if (body.schemaVersion !== COMMERCIAL_SCHEMA_VERSION) errors.push("unsupported_schema_version");
  if (!COMMERCIAL_EVENTS.includes(body.event)) errors.push("unsupported_event");
  if (!uuid(body.eventId)) errors.push("invalid_event_id");
  if (!uuid(body.sessionId)) errors.push("invalid_session_id");

  const hasRun = Object.hasOwn(body, "analysisRunId") && body.analysisRunId != null;
  const hasInteraction = Object.hasOwn(body, "interactionId") && body.interactionId != null;
  if (hasRun && !opaqueId(body.analysisRunId)) errors.push("invalid_run_id");
  if (hasInteraction && !uuid(body.interactionId)) errors.push("invalid_interaction_id");
  if (RUN_EVENTS.has(body.event) && (!hasRun || hasInteraction)) errors.push("run_link_required");
  if (REVIEW_EVENTS.has(body.event) && (!hasInteraction || hasRun)) errors.push("interaction_link_required");
  if (LINKED_EVENTS.has(body.event) && hasRun === hasInteraction) errors.push("single_link_required");
  if (SESSION_EVENTS.has(body.event) && (hasRun || hasInteraction)) errors.push("session_event_has_link");
  if (Object.hasOwn(body, "batchId") && !uuid(body.batchId)) errors.push("invalid_batch_id");

  const fields = {};
  for (const [key, allowed] of Object.entries(COMMERCIAL_ENUMS)) {
    if (!Object.hasOwn(body, key)) continue;
    if (!allowed.includes(body[key])) errors.push(`invalid_${key}`);
    else fields[key] = body[key];
  }
  if (body.event === "primary_action_clicked" && !fields.actionCapability) errors.push("action_capability_required");
  if (body.event === "issue_reported" && !fields.issueCategory) errors.push("issue_category_required");
  if (["analysis_failed", "review_failed"].includes(body.event) && !fields.failureStage) errors.push("failure_stage_required");
  if (fields.issueCategory && body.event !== "issue_reported") errors.push("unexpected_issue_category");

  if (errors.length) return { valid: false, errors, event: null };
  // Never spread input: URLs, names, text feedback, IDs and timestamps outside this contract are discarded.
  const event = {
    schemaVersion: COMMERCIAL_SCHEMA_VERSION, event: body.event,
    eventId: body.eventId.toLowerCase(), sessionId: body.sessionId.toLowerCase(),
    ...(hasRun ? { analysisRunId: body.analysisRunId } : {}),
    ...(hasInteraction ? { interactionId: body.interactionId.toLowerCase() } : {}),
    ...(body.batchId ? { batchId: body.batchId.toLowerCase() } : {}), ...fields
  };
  return { valid: true, errors: [], event };
}

export function sanitizeCommercialEvent(body, now = new Date(), trusted = {}) {
  const result = validateCommercialEvent(body);
  if (!result.valid || !validDate(now)) return null;
  const record = {
    ...result.event,
    // Source and eligibility must come from server-observed flow context, never the browser payload.
    sourceMode: ["live", "demo"].includes(trusted.sourceMode) ? trusted.sourceMode : "unknown",
    trafficType: ["product", "audit"].includes(trusted.trafficType) ? trusted.trafficType : "unknown",
    channel: enumOrUnknown(trusted.channel, COMMERCIAL_ENUMS.channel),
    researchSource: enumOrUnknown(trusted.researchSource, COMMERCIAL_ENUMS.researchSource),
    occurredAt: now.toISOString(),
    releaseRevision: /^[a-f0-9]{40}$/.test(trusted.releaseRevision || "") ? trusted.releaseRevision : null
  };
  return record;
}

export function createResearchConsentRecord(body, now = new Date()) {
  if (!plainObject(body) || !validDate(now) || body.consentVersion !== RESEARCH_CONSENT_VERSION) return null;
  if (!["accepted", "declined", "revoked"].includes(body.state)) return null;
  if (body.state === "declined") return { consentVersion: RESEARCH_CONSENT_VERSION, state: "declined", occurredAt: now.toISOString() };
  if (!uuid(body.deviceId)) return null;
  return {
    consentVersion: RESEARCH_CONSENT_VERSION, state: body.state,
    deviceId: body.deviceId.toLowerCase(), occurredAt: now.toISOString(),
    ...(body.state === "accepted" ? { expiresAt: new Date(now.valueOf() + RETENTION_MS).toISOString() } : {})
  };
}

// A separate research join, so withdrawal never depends on deleting the commercial record.
// Callers must supply the latest server-side consent, not the client's claim.
export function createResearchAssociation(record, consent, now = new Date()) {
  if (!record || !validDate(now) || !uuid(record.eventId) || record.schemaVersion !== COMMERCIAL_SCHEMA_VERSION) return null;
  if (consent?.state !== "accepted" || consent.consentVersion !== RESEARCH_CONSENT_VERSION || !uuid(consent.deviceId)) return null;
  const granted = Date.parse(consent.occurredAt);
  const expiry = Date.parse(consent.expiresAt);
  const eventTime = Date.parse(record.occurredAt);
  if (!Number.isFinite(granted) || !Number.isFinite(expiry) || expiry - granted !== RETENTION_MS) return null;
  if (!Number.isFinite(eventTime) || eventTime < granted || eventTime > now.valueOf()) return null;
  if (granted > now.valueOf() || now.valueOf() >= expiry) return null;
  return {
    eventId: record.eventId.toLowerCase(), deviceId: consent.deviceId.toLowerCase(), consentVersion: consent.consentVersion,
    occurredAt: record.occurredAt, expiresAt: consent.expiresAt
  };
}

function enumOrUnknown(value, allowed) { return allowed.includes(value) ? value : "unknown"; }
function uuid(value) { return typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value); }
function opaqueId(value) { return typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value); }
function plainObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function validDate(value) { return value instanceof Date && Number.isFinite(value.valueOf()); }
