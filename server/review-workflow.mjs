import { isDeepStrictEqual } from "node:util";

// A12 is an in-memory synthetic model, deliberately unconnected to application routes or storage.
export const REVIEW_WORKFLOW_SCHEMA_VERSION = 1;
export const FIELD_PATHS = Object.freeze([
  "client.clue", "identity.place_id", "identity.name", "identity.address", "contact.phone",
  "operation.status", "operation.hours", "provider.rating", "provider.budget",
  "booking.entry_type", "booking.conditions", "review.conclusion", "review.source_reference", "review.metadata"
]);
export const SOURCE_TYPES = Object.freeze(["user_clue", "provider_fact", "operator_checked", "unknown"]);
export const FIELD_STATES = Object.freeze(["pending", "supported", "unresolved", "conflict", "not_applicable"]);
export const TASK_STATES = Object.freeze(["pending", "in_progress", "completed", "blocked", "cancelled"]);
const DELIVERY_FIELDS = FIELD_PATHS.filter(path => !["contact.phone", "review.metadata"].includes(path));
const REASONS = ["missing_clue", "identity_unconfirmed", "conflict", "budget", "source_failure", "source_time_unknown", "expired", "missing_evidence", "not_applicable", "not_reviewed"];
const NEXT_ACTIONS = ["request_clue", "human_resolution", "check_source", "review_again", "none"];
const METHODS = ["client_statement", "provider_fetch", "branch_match", "manual_source_check", "conflict_resolution"];
const ACTIONS = ["create_record", "create_task", "start_review", "field_review", "resolve_conflict", "complete_task", "block_task", "resume_task", "cancel_task", "invalidate_expired"];
const DELIVERY_STATES = ["draft", "review_requested", "accepted", "changes_requested", "superseded"];
const MAX_HISTORY = 200;
const DAY = 86_400_000;
const MARKERS = Object.freeze({ fixtureOnly: true, realWorldEvidence: false, gqEvidence: false, g1Evidence: false, releaseGateEvidence: false, workspaceEnabled: false });
const RECORD_KEYS = ["schemaVersion", ...Object.keys(MARKERS), "recordId", "workspaceId", "cycleId", "revision", "workspaceState", "createdAt", "reviewedAt", "dueAt", "retainUntil", "fields", "history"];
const FIELD_KEYS = ["fieldPath", "status", "sourceType", "value", "policyId", "reviewTaskId", "reviewedAt", "dueAt", "retainUntil", "evidence", "reason", "nextAction", "humanResolution"];
const EVIDENCE_KEYS = ["evidenceId", "sourceType", "reference", "observedAt", "fetchedAt", "expiresAt", "method", "operatorId", "synthetic"];
const TASK_KEYS = ["schemaVersion", ...Object.keys(MARKERS), "taskId", "workspaceId", "cycleId", "recordId", "revision", "expectedRecordRevision", "status", "reason", "affectedFields", "assignee", "linkedTaskId", "workLogRefs", "createdAt", "updatedAt", "blockedReason"];
const DRAFT_KEYS = ["schemaVersion", ...Object.keys(MARKERS), "deliveryId", "workspaceId", "cycleId", "offerVersion", "revision", "status", "generatedAt", "updatedAt", "allowedFields", "reviewRevisions", "entries", "acceptances", "copyCannotBeRecalled", "publicAccessEnabled"];

function fail(code) { throw new Error(code); }
function id(value) { return typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(value); }
function uuid(value) { return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function time(value) { return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value; }
function revision(value) { return Number.isSafeInteger(value) && value > 0; }
function keys(value, allowed) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => allowed.includes(key)); }
function text(value, max = 500) { return typeof value === "string" && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value); }
function minTime(...values) { return new Date(Math.min(...values.map(Date.parse))).toISOString(); }
function retentionAnchor(evidence) { return evidence.sourceType === "provider_fact" ? evidence.fetchedAt : evidence.observedAt; }
function markerValid(value) { return Object.entries(MARKERS).every(([key, expected]) => value?.[key] === expected); }
function fieldList(values, allowed = FIELD_PATHS, max = 20) {
  return Array.isArray(values) && values.length > 0 && values.length <= max && values.every(path => allowed.includes(path)) && new Set(values).size === values.length;
}
function contextValid(context) {
  if (!context?.fixtureOnly) fail("FIXTURE_ONLY");
  if (!id(context.workspaceId) || !id(context.operatorId) || !time(context.occurredAt) || !revision(context.expectedRevision)) fail("INVALID_CONTEXT");
}
function requireScope(value, context, { expired = false } = {}) {
  contextValid(context);
  if (value.workspaceId !== context.workspaceId) fail("WORKSPACE_MISMATCH");
  if (value.revision !== context.expectedRevision) fail("REVISION_MISMATCH");
  if (value.workspaceState && value.workspaceState !== "active") fail("WORKSPACE_SUSPENDED");
  const latestAction = value.history?.at(-1)?.occurredAt || value.updatedAt || value.createdAt || value.generatedAt;
  if (Date.parse(context.occurredAt) < Date.parse(latestAction)) fail("ACTION_TIME_INVALID");
  if (!expired && value.retainUntil && Date.parse(context.occurredAt) >= Date.parse(value.retainUntil)) fail("RECORD_EXPIRED");
}
function policyValid(policy) {
  const license = policy?.licenseEvidence;
  return keys(policy, ["schemaVersion", "fixtureOnly", "policyId", "fieldPath", "sourceType", "purposes", "permissions", "retentionDays", "reviewVersion", "licenseEvidence"])
    && policy.schemaVersion === 1 && policy.fixtureOnly === true && id(policy.policyId) && FIELD_PATHS.includes(policy.fieldPath)
    && SOURCE_TYPES.includes(policy.sourceType) && policy.sourceType !== "unknown" && id(policy.reviewVersion)
    && Array.isArray(policy.purposes) && policy.purposes.length > 0 && policy.purposes.every(purpose => ["review", "private_delivery"].includes(purpose))
    && new Set(policy.purposes).size === policy.purposes.length && keys(policy.permissions, ["persist", "export", "public"])
    && ["persist", "export", "public"].every(key => typeof policy.permissions[key] === "boolean")
    && Number.isInteger(policy.retentionDays) && policy.retentionDays >= 1 && policy.retentionDays <= 90
    && keys(license, ["reference", "reviewerId", "reviewedAt", "validFrom", "validUntil", "synthetic"])
    && license.synthetic === true && id(license.reference) && id(license.reviewerId) && time(license.reviewedAt)
    && time(license.validFrom) && time(license.validUntil) && Date.parse(license.validFrom) < Date.parse(license.validUntil)
    && Date.parse(license.reviewedAt) < Date.parse(license.validUntil);
}

/** Permission is exact per field and provenance; unknown/ambiguous/expired is denied. Synthetic licenses are not legal opinions. */
export function evaluateFieldPolicy(policies, query) {
  const denied = reason => ({ allowed: false, reason, policyId: null, expiresAt: null });
  if (!query || !FIELD_PATHS.includes(query.fieldPath) || !SOURCE_TYPES.includes(query.sourceType)) return denied("FIELD_POLICY_UNKNOWN");
  if (query.sourceType === "unknown") return denied("UNKNOWN_SOURCE");
  if (!["review", "private_delivery"].includes(query.purpose) || !["persist", "export", "public"].includes(query.scope) || !time(query.at) || !time(query.observedAt)) return denied("INVALID_POLICY_QUERY");
  if (query.scope === "public") return denied("PUBLIC_SCOPE_DISABLED");
  if (!Array.isArray(policies) || policies.length > 100) return denied("INVALID_POLICY_MATRIX");
  const matches = policies.filter(policy => policy?.fieldPath === query.fieldPath && policy?.sourceType === query.sourceType);
  if (matches.length !== 1) return denied(matches.length ? "AMBIGUOUS_POLICY" : "FIELD_POLICY_UNKNOWN");
  const policy = matches[0];
  if (!policyValid(policy)) return denied("FIELD_POLICY_INVALID");
  if (!policy.purposes.includes(query.purpose)) return denied("PURPOSE_NOT_ALLOWED");
  if (!policy.permissions[query.scope]) return denied("SCOPE_NOT_ALLOWED");
  const at = Date.parse(query.at), observed = Date.parse(query.observedAt), license = policy.licenseEvidence;
  if (observed > at || observed < Date.parse(license.validFrom)) return denied("OBSERVATION_OUTSIDE_LICENSE");
  if (at < Math.max(Date.parse(license.reviewedAt), Date.parse(license.validFrom))) return denied("LICENSE_NOT_YET_VALID");
  const expiresAt = minTime(license.validUntil, new Date(observed + policy.retentionDays * DAY).toISOString());
  if (at >= Date.parse(expiresAt)) return denied("FIELD_POLICY_EXPIRED");
  return { allowed: true, reason: null, policyId: policy.policyId, expiresAt };
}
function requirePolicy(policies, query) {
  const result = evaluateFieldPolicy(policies, query);
  if (!result.allowed) fail(result.reason);
  return result;
}
function validateEvidence(evidence, at) {
  if (!keys(evidence, EVIDENCE_KEYS) || !id(evidence.evidenceId) || !id(evidence.reference) || evidence.synthetic !== true
    || !SOURCE_TYPES.includes(evidence.sourceType) || evidence.sourceType === "unknown" || !time(evidence.observedAt)
    || !time(evidence.expiresAt) || !METHODS.includes(evidence.method) || Date.parse(evidence.observedAt) > Date.parse(at)
    || Date.parse(evidence.expiresAt) <= Date.parse(at)) fail("INVALID_OR_EXPIRED_EVIDENCE");
  if (evidence.sourceType === "provider_fact" && !time(evidence.fetchedAt)) fail("SOURCE_TIME_UNKNOWN");
  if (evidence.fetchedAt !== null && (!time(evidence.fetchedAt) || Date.parse(evidence.fetchedAt) > Date.parse(evidence.observedAt))) fail("INVALID_SOURCE_TIME");
  if (evidence.sourceType === "operator_checked" && (!id(evidence.operatorId) || !["branch_match", "manual_source_check", "conflict_resolution"].includes(evidence.method))) fail("HUMAN_EVIDENCE_REQUIRED");
  if (evidence.sourceType === "user_clue" && evidence.method !== "client_statement") fail("USER_CLUE_METHOD_INVALID");
  if (evidence.sourceType === "provider_fact" && evidence.method !== "provider_fetch") fail("PROVIDER_METHOD_INVALID");
}
function validateRecord(record) {
  if (!keys(record, RECORD_KEYS) || !markerValid(record) || record.schemaVersion !== 1 || !uuid(record.recordId)
    || !id(record.workspaceId) || !id(record.cycleId) || !revision(record.revision) || !["active", "suspended", "closed"].includes(record.workspaceState)
    || !time(record.createdAt) || !time(record.retainUntil) || Date.parse(record.createdAt) >= Date.parse(record.retainUntil)
    || !(record.reviewedAt === null || time(record.reviewedAt)) || !(record.dueAt === null || time(record.dueAt))
    || !Array.isArray(record.fields) || record.fields.length > FIELD_PATHS.length || new Set(record.fields.map(field => field?.fieldPath)).size !== record.fields.length
    || !Array.isArray(record.history) || record.history.length > MAX_HISTORY) fail("INVALID_REVIEW_RECORD");
  for (const field of record.fields) {
    if (!keys(field, FIELD_KEYS) || !FIELD_PATHS.includes(field.fieldPath) || field.fieldPath === "review.metadata" || !FIELD_STATES.includes(field.status)
      || !SOURCE_TYPES.includes(field.sourceType) || !id(field.reviewTaskId) || !time(field.reviewedAt) || !time(field.dueAt) || !time(field.retainUntil)
      || !Array.isArray(field.evidence) || field.evidence.length > 5 || !(field.policyId === null || id(field.policyId))
      || !REASONS.includes(field.reason) && field.reason !== null || !NEXT_ACTIONS.includes(field.nextAction)
      || !(field.humanResolution === null || keys(field.humanResolution, ["operatorId", "decidedAt", "evidenceId", "decision"]))) fail("INVALID_REVIEW_FIELD");
    if (field.status === "supported" && (!text(field.value) || !field.evidence.length || field.sourceType === "unknown")) fail("MISSING_EVIDENCE");
    if (field.status !== "supported" && field.value !== null) fail("UNSUPPORTED_VALUE");
    if (field.status === "conflict" && field.evidence.length < 2) fail("CONFLICT_EVIDENCE_REQUIRED");
  }
  for (const item of record.history) {
    if (!keys(item, ["action", "operatorId", "occurredAt", "affectedFields", "fromRevision", "toRevision"]) || !ACTIONS.includes(item.action)
      || !id(item.operatorId) || !time(item.occurredAt) || !Array.isArray(item.affectedFields) || !item.affectedFields.every(path => FIELD_PATHS.includes(path))
      || !Number.isSafeInteger(item.fromRevision) || item.toRevision !== item.fromRevision + 1) fail("INVALID_REVIEW_HISTORY");
  }
}
function validateTask(record, task, context) {
  validateRecord(record); requireScope(record, context);
  if (!keys(task, TASK_KEYS) || !markerValid(task) || task.schemaVersion !== 1 || !id(task.taskId) || !revision(task.revision)
    || !TASK_STATES.includes(task.status) || !fieldList(task.affectedFields, FIELD_PATHS.filter(path => path !== "review.metadata"))
    || !id(task.assignee) || !REASONS.includes(task.reason) || !time(task.createdAt) || !time(task.updatedAt)
    || !(task.linkedTaskId === null || id(task.linkedTaskId)) || !(task.blockedReason === null || REASONS.includes(task.blockedReason))
    || !Array.isArray(task.workLogRefs) || task.workLogRefs.length > 50 || !task.workLogRefs.every(id)) fail("INVALID_REVIEW_TASK");
  if (task.workspaceId !== record.workspaceId || task.cycleId !== record.cycleId || task.recordId !== record.recordId) fail("TASK_SCOPE_MISMATCH");
  if (task.expectedRecordRevision !== record.revision || context.expectedTaskRevision !== task.revision) fail("TASK_REVISION_MISMATCH");
  if (Date.parse(context.occurredAt) < Date.parse(task.updatedAt)) fail("ACTION_TIME_INVALID");
}
function audit(record, action, fields, context) {
  if (record.history.length >= MAX_HISTORY) fail("HISTORY_LIMIT");
  return { action, operatorId: context.operatorId, occurredAt: context.occurredAt, affectedFields: [...fields], fromRevision: record.revision, toRevision: record.revision + 1 };
}
function advance(record, task, action, context, recordChanges = {}, taskChanges = {}) {
  const next = { ...structuredClone(record), ...recordChanges, revision: record.revision + 1,
    history: [...structuredClone(record.history), audit(record, action, task.affectedFields, context)] };
  return { record: next, task: { ...structuredClone(task), ...taskChanges, revision: task.revision + 1, expectedRecordRevision: next.revision, updatedAt: context.occurredAt } };
}

export function createReviewRecord(input, { policies, context }) {
  contextValid(context);
  if (input?.fixtureOnly !== true) fail("FIXTURE_ONLY");
  if (!uuid(input.recordId) || !id(input.cycleId) || context.expectedRevision !== 1 || !time(input.pilotEndsAt)
    || Date.parse(input.pilotEndsAt) < Date.parse(context.occurredAt) || !(input.contractRetainUntil === undefined || time(input.contractRetainUntil))) fail("INVALID_RECORD_INPUT");
  const metadata = requirePolicy(policies, { fieldPath: "review.metadata", sourceType: "operator_checked", purpose: "review", scope: "persist", at: context.occurredAt, observedAt: context.occurredAt });
  const retainUntil = minTime(new Date(Date.parse(input.pilotEndsAt) + 90 * DAY).toISOString(), metadata.expiresAt,
    input.contractRetainUntil || metadata.expiresAt);
  if (Date.parse(retainUntil) <= Date.parse(context.occurredAt)) fail("RECORD_EXPIRED");
  return { schemaVersion: 1, ...MARKERS, recordId: input.recordId, workspaceId: context.workspaceId, cycleId: input.cycleId,
    revision: 1, workspaceState: "active", createdAt: context.occurredAt, reviewedAt: null, dueAt: null, retainUntil, fields: [],
    history: [{ action: "create_record", operatorId: context.operatorId, occurredAt: context.occurredAt, affectedFields: [], fromRevision: 0, toRevision: 1 }] };
}

export function createReviewTask(record, input, { context, previousTask = null }) {
  validateRecord(record); requireScope(record, context);
  if (!id(input?.taskId) || !id(input.assignee) || !REASONS.includes(input.reason) || !fieldList(input.affectedFields, FIELD_PATHS.filter(path => path !== "review.metadata"))) fail("INVALID_TASK_INPUT");
  if (previousTask && (previousTask.workspaceId !== record.workspaceId || previousTask.recordId !== record.recordId
    || !["completed", "cancelled"].includes(previousTask.status) || previousTask.taskId === input.taskId)) fail("INVALID_LINKED_TASK");
  const next = { ...structuredClone(record), revision: record.revision + 1, history: [...structuredClone(record.history), audit(record, "create_task", input.affectedFields, context)] };
  return { record: next, task: { schemaVersion: 1, ...MARKERS, taskId: input.taskId, workspaceId: record.workspaceId,
    cycleId: record.cycleId, recordId: record.recordId, revision: 1, expectedRecordRevision: next.revision, status: "pending",
    reason: input.reason, affectedFields: [...input.affectedFields], assignee: input.assignee, linkedTaskId: previousTask?.taskId || null,
    workLogRefs: [], createdAt: context.occurredAt, updatedAt: context.occurredAt, blockedReason: null } };
}

export function startReview(record, task, { context }) {
  validateTask(record, task, context);
  if (task.status !== "pending") fail("INVALID_TASK_TRANSITION");
  return advance(record, task, "start_review", context, {}, { status: "in_progress" });
}

function prepareField(record, task, input, policies, context, resolving) {
  if (task.status !== "in_progress") fail("TASK_NOT_IN_PROGRESS");
  if (!input || !task.affectedFields.includes(input.fieldPath) || !FIELD_STATES.includes(input.status) || input.status === "pending"
    || !SOURCE_TYPES.includes(input.sourceType) || !time(input.dueAt) || Date.parse(input.dueAt) <= Date.parse(context.occurredAt)
    || !NEXT_ACTIONS.includes(input.nextAction) || !Array.isArray(input.evidence) || input.evidence.length > 5
    || new Set(input.evidence.map(item => item?.evidenceId)).size !== input.evidence.length) fail("INVALID_FIELD_INPUT");
  const prior = record.fields.find(field => field.fieldPath === input.fieldPath);
  if (prior?.status === "conflict" && !resolving) fail("HUMAN_CONFLICT_RESOLUTION_REQUIRED");
  if (resolving && prior?.status !== "conflict") fail("FIELD_HAS_NO_CONFLICT");
  if (input.sourceType === "unknown" && (input.status !== "unresolved" || input.value !== null || input.evidence.length)) fail("UNKNOWN_SOURCE_HAS_VALUE");
  if (input.status === "supported" && (!text(input.value) || !input.evidence.length || input.sourceType === "unknown")) fail("MISSING_EVIDENCE");
  if (input.status !== "supported" && input.value !== null) fail("UNSUPPORTED_VALUE");
  if (input.status === "conflict" && input.evidence.length < 2) fail("CONFLICT_EVIDENCE_REQUIRED");
  if (input.status !== "supported" && !REASONS.includes(input.reason)) fail("UNRESOLVED_REASON_REQUIRED");
  if (input.status === "supported" && input.reason !== null) fail("INVALID_FIELD_REASON");
  const grants = [];
  for (const evidence of input.evidence) {
    validateEvidence(evidence, context.occurredAt);
    if (evidence.sourceType === "operator_checked" && evidence.operatorId !== context.operatorId) fail("HUMAN_ACTOR_MISMATCH");
    grants.push(requirePolicy(policies, { fieldPath: input.fieldPath, sourceType: evidence.sourceType, purpose: "review", scope: "persist", at: context.occurredAt, observedAt: retentionAnchor(evidence) }));
  }
  if (input.sourceType !== "unknown" && !input.evidence.some(item => item.sourceType === input.sourceType)) fail("SOURCE_EVIDENCE_MISMATCH");
  const mainGrant = input.sourceType === "unknown" ? null : grants[input.evidence.findIndex(item => item.sourceType === input.sourceType)];
  const retainUntil = minTime(record.retainUntil, ...grants.map(grant => grant.expiresAt), ...input.evidence.map(item => item.expiresAt));
  if (Date.parse(input.dueAt) > Date.parse(retainUntil)) fail("DUE_AFTER_RETENTION");
  if (resolving && (input.sourceType !== "operator_checked" || !["supported", "unresolved", "not_applicable"].includes(input.status)
    || !input.evidence.some(item => item.sourceType === "operator_checked" && item.method === "conflict_resolution"))) fail("HUMAN_CONFLICT_RESOLUTION_REQUIRED");
  const decision = resolving ? { operatorId: context.operatorId, decidedAt: context.occurredAt,
    evidenceId: input.evidence.find(item => item.method === "conflict_resolution").evidenceId, decision: input.status } : null;
  return { fieldPath: input.fieldPath, status: input.status, sourceType: input.sourceType, value: input.value,
    policyId: mainGrant?.policyId || null, reviewTaskId: task.taskId, reviewedAt: context.occurredAt, dueAt: input.dueAt, retainUntil,
    evidence: structuredClone(input.evidence), reason: input.reason, nextAction: input.nextAction, humanResolution: decision };
}
function updateField(record, task, input, { policies, context }, resolving) {
  validateTask(record, task, context);
  const field = prepareField(record, task, input, policies, context, resolving);
  const fields = [...record.fields.filter(item => item.fieldPath !== field.fieldPath).map(item => structuredClone(item)), field];
  return advance(record, task, resolving ? "resolve_conflict" : "field_review", context,
    { fields, reviewedAt: context.occurredAt, dueAt: minTime(...fields.map(item => item.dueAt)) });
}
export function recordFieldReview(record, task, input, options) { return updateField(record, task, input, options, false); }
export function resolveFieldConflict(record, task, input, options) { return updateField(record, task, input, options, true); }

export function completeTask(record, task, { policies, context, workLogRefs = [] }) {
  validateTask(record, task, context);
  if (task.status !== "in_progress") fail("INVALID_TASK_TRANSITION");
  if (task.affectedFields.some(path => !["supported", "not_applicable"].includes(record.fields.find(field => field.fieldPath === path)?.status))) fail("TASK_HAS_UNRESOLVED_FIELDS");
  if (task.affectedFields.some(path => { const field = record.fields.find(item => item.fieldPath === path);
    return field.reviewTaskId !== task.taskId || Date.parse(field.reviewedAt) < Date.parse(task.createdAt); })) fail("TASK_REVIEW_EVIDENCE_MISSING");
  for (const path of task.affectedFields) checkField(record.fields.find(field => field.fieldPath === path), policies, "persist", context.occurredAt);
  if (!Array.isArray(workLogRefs) || workLogRefs.length > 50 || !workLogRefs.every(id) || new Set(workLogRefs).size !== workLogRefs.length) fail("INVALID_WORK_LOG_REFS");
  return advance(record, task, "complete_task", context, {}, { status: "completed", workLogRefs: [...workLogRefs] });
}

export function transitionReviewTask(record, task, status, { context, reason = null }) {
  validateTask(record, task, context);
  const allowed = status === "blocked" && task.status === "in_progress" || status === "pending" && task.status === "blocked"
    || status === "cancelled" && ["pending", "in_progress", "blocked"].includes(task.status);
  if (!allowed) fail("INVALID_TASK_TRANSITION");
  if (status === "blocked" && !["missing_clue", "conflict", "budget", "source_failure", "source_time_unknown"].includes(reason)) fail("BLOCKED_REASON_REQUIRED");
  const action = status === "blocked" ? "block_task" : status === "pending" ? "resume_task" : "cancel_task";
  return advance(record, task, action, context, {}, { status, blockedReason: status === "blocked" ? reason : null });
}

function checkField(field, policies, scope, at) {
  if (Date.parse(at) >= Date.parse(field.retainUntil) || Date.parse(at) >= Date.parse(field.dueAt)) fail("FIELD_EVIDENCE_EXPIRED");
  if (["supported", "not_applicable"].includes(field.status) && (!field.evidence.length || field.sourceType === "unknown")) fail("MISSING_EVIDENCE");
  for (const evidence of field.evidence) {
    validateEvidence(evidence, at);
    requirePolicy(policies, { fieldPath: field.fieldPath, sourceType: evidence.sourceType, purpose: scope === "persist" ? "review" : "private_delivery", scope, at, observedAt: retentionAnchor(evidence) });
  }
  if (!field.evidence.length) return;
  const matched = field.evidence.find(item => item.sourceType === field.sourceType);
  const grant = requirePolicy(policies, { fieldPath: field.fieldPath, sourceType: field.sourceType, purpose: scope === "persist" ? "review" : "private_delivery", scope, at, observedAt: matched ? retentionAnchor(matched) : null });
  if (grant.policyId !== field.policyId) fail("FIELD_POLICY_REVISION_MISMATCH");
}

/** Returns a new revision with stale source values and evidence removed. It does not erase files or schedule deletion. */
export function invalidateExpiredFields(record, { policies, context }) {
  validateRecord(record); requireScope(record, context, { expired: true });
  const expiredFields = record.fields.filter(field => {
    try { checkField(field, policies, "persist", context.occurredAt); return Date.parse(context.occurredAt) >= Date.parse(record.retainUntil); }
    catch { return true; }
  }).map(field => field.fieldPath);
  if (!expiredFields.length) return { record: structuredClone(record), expiredFields: [] };
  const fields = record.fields.filter(field => !expiredFields.includes(field.fieldPath)).map(field => structuredClone(field));
  return { record: { ...structuredClone(record), fields, revision: record.revision + 1, dueAt: fields.length ? minTime(...fields.map(field => field.dueAt)) : null,
    history: [...structuredClone(record.history), audit(record, "invalidate_expired", expiredFields, context)] }, expiredFields };
}

function identityState(record) {
  if (record.fields.some(field => field.fieldPath.startsWith("identity.") && field.status === "conflict")) return "conflict";
  const place = record.fields.find(field => field.fieldPath === "identity.place_id");
  return place?.status === "supported" && place.sourceType === "operator_checked"
    && place.evidence.some(evidence => ["branch_match", "conflict_resolution"].includes(evidence.method)) ? "confirmed" : "unconfirmed";
}
function projectedField(field) {
  return { fieldPath: field.fieldPath, status: field.status, sourceType: field.sourceType, value: field.value,
    reviewedAt: field.reviewedAt, dueAt: field.dueAt,
    evidence: field.evidence.map(item => ({ evidenceId: item.evidenceId, sourceType: item.sourceType, reference: item.reference,
      observedAt: item.observedAt, fetchedAt: item.fetchedAt, expiresAt: item.expiresAt, method: item.method })) };
}

export function createDeliveryDraft(records, input, { policies, context }) {
  contextValid(context);
  if (Array.isArray(input?.requestedFields) && input.requestedFields.some(path => !DELIVERY_FIELDS.includes(path))) fail("RESTRICTED_DELIVERY_FIELD");
  if (!Array.isArray(records) || !records.length || records.length > 20 || new Set(records.map(record => record.recordId)).size !== records.length
    || !id(input?.deliveryId) || !id(input.cycleId) || !id(input.offerVersion) || !revision(input.revision)
    || input.revision !== context.expectedRevision || !fieldList(input.requestedFields, DELIVERY_FIELDS)
    || !keys(input.reviewRevisions, records.map(record => record.recordId)) || Object.keys(input.reviewRevisions).length !== records.length) fail("INVALID_DELIVERY_INPUT");
  const entries = [];
  for (const record of records) {
    validateRecord(record);
    requireScope(record, { ...context, expectedRevision: input.reviewRevisions[record.recordId] });
    if (record.cycleId !== input.cycleId) fail("CYCLE_MISMATCH");
    requirePolicy(policies, { fieldPath: "review.metadata", sourceType: "operator_checked", purpose: "private_delivery", scope: "export", at: context.occurredAt, observedAt: record.createdAt });
    const fields = [], unresolved = [], identity = identityState(record);
    for (const path of input.requestedFields) {
      const field = record.fields.find(item => item.fieldPath === path);
      if (!field) fail("MISSING_REVIEW_FIELD");
      if (["supported", "not_applicable"].includes(field.status)) {
        checkField(field, policies, "export", context.occurredAt);
        if (identity !== "confirmed" && path !== "client.clue") unresolved.push({ fieldPath: path, status: "unresolved",
          reason: identity === "conflict" ? "conflict" : "identity_unconfirmed", nextAction: identity === "conflict" ? "human_resolution" : "request_clue" });
        else fields.push(projectedField(field));
      }
      else {
        if (!field.reason || field.nextAction === "none") fail("UNRESOLVED_REASON_REQUIRED");
        unresolved.push({ fieldPath: path, status: field.status, reason: field.reason, nextAction: field.nextAction });
      }
    }
    // Identity is a precondition even if the delivery requests only a conclusion/booking field.
    if (identity === "confirmed") checkField(record.fields.find(field => field.fieldPath === "identity.place_id"), policies, "export", context.occurredAt);
    else if (!unresolved.some(item => item.fieldPath.startsWith("identity."))) unresolved.push({ fieldPath: "identity.place_id", status: identity === "conflict" ? "conflict" : "unresolved", reason: identity === "conflict" ? "conflict" : "identity_unconfirmed", nextAction: identity === "conflict" ? "human_resolution" : "request_clue" });
    entries.push({ recordId: record.recordId, reviewRevision: record.revision, identityState: identity, reviewedAt: record.reviewedAt,
      dueAt: record.dueAt, result: unresolved.length ? "unresolved" : "resolved", fields, unresolved });
  }
  return { schemaVersion: 1, ...MARKERS, deliveryId: input.deliveryId, workspaceId: context.workspaceId, cycleId: input.cycleId,
    offerVersion: input.offerVersion, revision: input.revision, status: "draft", generatedAt: context.occurredAt, updatedAt: context.occurredAt,
    allowedFields: [...input.requestedFields], reviewRevisions: { ...input.reviewRevisions }, entries, acceptances: [],
    copyCannotBeRecalled: true, publicAccessEnabled: false };
}
function validateDraft(draft, context) {
  if (!keys(draft, DRAFT_KEYS) || !markerValid(draft) || draft.schemaVersion !== 1 || !id(draft.deliveryId) || !id(draft.cycleId) || !id(draft.offerVersion)
    || !DELIVERY_STATES.includes(draft.status) || !time(draft.generatedAt) || !time(draft.updatedAt)
    || Date.parse(draft.updatedAt) < Date.parse(draft.generatedAt) || !fieldList(draft.allowedFields, DELIVERY_FIELDS)
    || !Array.isArray(draft.entries) || draft.entries.length > 20 || !Array.isArray(draft.acceptances) || draft.acceptances.length > 50
    || draft.copyCannotBeRecalled !== true || draft.publicAccessEnabled !== false) fail("INVALID_DELIVERY_DRAFT");
  requireScope(draft, context);
}
export function requestDeliveryReview(draft, { context }) {
  validateDraft(draft, context);
  if (draft.status !== "draft") fail("INVALID_DELIVERY_TRANSITION");
  return { ...structuredClone(draft), status: "review_requested", updatedAt: context.occurredAt };
}
export function recordDeliveryAcceptance(draft, input, { context }) {
  validateDraft(draft, context);
  if (draft.status !== "review_requested") fail("INVALID_DELIVERY_TRANSITION");
  if (!id(input?.acceptanceId) || !id(input.evidenceRef) || !["accepted", "changes_requested"].includes(input.status)) fail("ACCEPTANCE_EVIDENCE_REQUIRED");
  if (draft.acceptances.some(item => item.acceptanceId === input.acceptanceId)) fail("DUPLICATE_ACCEPTANCE");
  const acceptance = { schemaVersion: 1, ...MARKERS, acceptanceId: input.acceptanceId, deliveryId: draft.deliveryId,
    deliveryRevision: draft.revision, status: input.status, recordedAt: context.occurredAt, operatorId: context.operatorId,
    evidenceRef: input.evidenceRef, factCertification: false };
  return { draft: { ...structuredClone(draft), status: input.status, updatedAt: context.occurredAt,
    acceptances: [...structuredClone(draft.acceptances), acceptance] }, acceptance };
}
export function reviseDeliveryDraft(previous, records, input, { policies, context }) {
  validateDraft(previous, context);
  if (previous.status === "superseded" || input.deliveryId !== previous.deliveryId || input.cycleId !== previous.cycleId
    || input.revision !== previous.revision + 1) fail("INVALID_DELIVERY_REVISION");
  const draft = createDeliveryDraft(records, input, { policies, context: { ...context, expectedRevision: input.revision } });
  return { previous: { ...structuredClone(previous), status: "superseded", updatedAt: context.occurredAt }, draft };
}

/** Rebuilds the whitelist from current records/policies; stale revisions and fabricated draft fields cannot be exported. */
export function exportDeliveryDraft(draft, { records, policies, context, format = "json" }) {
  validateDraft(draft, context);
  if (draft.status === "superseded") fail("DELIVERY_SUPERSEDED");
  if (!["json", "markdown"].includes(format)) fail("EXPORT_FORMAT_NOT_ALLOWED");
  const rebuilt = createDeliveryDraft(records, { deliveryId: draft.deliveryId, cycleId: draft.cycleId, offerVersion: draft.offerVersion,
    revision: draft.revision, requestedFields: draft.allowedFields, reviewRevisions: draft.reviewRevisions }, { policies, context });
  if (!isDeepStrictEqual(rebuilt.entries, draft.entries)) fail("DELIVERY_PROJECTION_MISMATCH");
  const payload = { schemaVersion: 1, ...MARKERS, deliveryId: draft.deliveryId, cycleId: draft.cycleId, offerVersion: draft.offerVersion,
    revision: draft.revision, status: draft.status, generatedAt: draft.generatedAt, exportedAt: context.occurredAt,
    timeMeaning: "reviewedAt is the operator review time; observedAt/fetchedAt are independent evidence times; no live opening or seat guarantee",
    allowedFields: [...draft.allowedFields], entries: rebuilt.entries, copyCannotBeRecalled: true, publicAccessEnabled: false,
    counts: { assigned: rebuilt.entries.length, resolved: rebuilt.entries.filter(entry => entry.result === "resolved").length,
      unresolved: rebuilt.entries.filter(entry => entry.result === "unresolved").length } };
  const json = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(json, "utf8") > 100_000) fail("EXPORT_SIZE_LIMIT");
  if (format === "json") return { contentType: "application/json; charset=utf-8", content: json, payload };
  // JSON fenced in Markdown preserves all provenance and times while preventing user text becoming Markdown links/HTML.
  const content = `# Synthetic private review delivery\n\nRevision: ${draft.revision}\n\nFixture only; no GQ/G1/release evidence. Copies cannot be recalled.\n\n${json.includes("```") ? "~~~~" : "```"}json\n${json}\n${json.includes("```") ? "~~~~" : "```"}\n`;
  if (Buffer.byteLength(content, "utf8") > 101_000) fail("EXPORT_SIZE_LIMIT");
  return { contentType: "text/markdown; charset=utf-8", content, payload };
}

export function listDueReviews(records, { at }) {
  if (!time(at) || !Array.isArray(records) || records.length > 60) fail("INVALID_DUE_QUERY");
  return records.map(record => { validateRecord(record); return record; }).filter(record => record.dueAt && Date.parse(record.dueAt) <= Date.parse(at))
    .map(record => ({ recordId: record.recordId, workspaceId: record.workspaceId, revision: record.revision, dueAt: record.dueAt }))
    .sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.recordId.localeCompare(b.recordId));
}
