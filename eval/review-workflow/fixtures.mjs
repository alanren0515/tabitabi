import { createReviewRecord, createReviewTask, startReview, recordFieldReview, completeTask } from "../../server/review-workflow.mjs";

export const FIXTURE_NOW = "2026-10-02T00:00:00.000Z";
export const FIXTURE_DUE = "2026-10-04T00:00:00.000Z";
export const FIXTURE_EXPIRY = "2026-10-05T00:00:00.000Z";
const WORKSPACE = "fixture-workspace-1", OPERATOR = "fixture-operator-1";

export function fixtureContext(record = null, task = null, occurredAt = FIXTURE_NOW) {
  return { fixtureOnly: true, workspaceId: record?.workspaceId || WORKSPACE, operatorId: OPERATOR,
    expectedRevision: record?.revision || 1, ...(task ? { expectedTaskRevision: task.revision } : {}), occurredAt };
}

export function reviewWorkflowPolicies() {
  const rows = [
    ["review.metadata", "operator_checked", true, true],
    ["client.clue", "user_clue", true, true],
    ["identity.place_id", "operator_checked", true, true],
    ["identity.place_id", "provider_fact", true, true],
    ["identity.name", "provider_fact", true, true],
    ["identity.name", "operator_checked", true, true],
    ["identity.address", "provider_fact", true, true],
    ["identity.address", "operator_checked", true, true],
    ["operation.status", "operator_checked", true, true],
    ["operation.hours", "provider_fact", true, false],
    ["provider.rating", "provider_fact", false, false],
    ["provider.budget", "provider_fact", false, false],
    ["booking.entry_type", "provider_fact", true, true],
    ["booking.entry_type", "operator_checked", true, true],
    ["booking.conditions", "operator_checked", true, true],
    ["review.conclusion", "operator_checked", true, true],
    ["review.source_reference", "operator_checked", true, true],
    ["contact.phone", "operator_checked", true, false]
  ];
  return rows.map(([fieldPath, sourceType, persist, allowExport], index) => ({ schemaVersion: 1, fixtureOnly: true,
    policyId: `fixture-policy-${index + 1}-v1`, fieldPath, sourceType, purposes: ["review", "private_delivery"],
    permissions: { persist, export: allowExport, public: false }, retentionDays: 90, reviewVersion: "fixture-license-review-v1",
    licenseEvidence: { synthetic: true, reference: `fixture-license-${index + 1}`, reviewerId: "fixture-policy-reviewer",
      reviewedAt: "2026-09-30T00:00:00.000Z", validFrom: "2026-09-30T00:00:00.000Z", validUntil: "2027-01-01T00:00:00.000Z" } }));
}

export function fixtureEvidence(sourceType = "operator_checked", overrides = {}) {
  return { evidenceId: `fixture-evidence-${sourceType}`, sourceType, reference: `fixture-source-${sourceType}`,
    observedAt: "2026-10-01T00:00:00.000Z", fetchedAt: sourceType === "provider_fact" ? "2026-09-30T23:00:00.000Z" : null,
    expiresAt: FIXTURE_EXPIRY, method: sourceType === "user_clue" ? "client_statement" : sourceType === "provider_fact" ? "provider_fetch" : "manual_source_check",
    operatorId: sourceType === "operator_checked" ? OPERATOR : null, synthetic: true, ...overrides };
}

export function fixtureField(fieldPath, overrides = {}) {
  const sourceType = overrides.sourceType || (fieldPath === "client.clue" ? "user_clue" : fieldPath === "booking.entry_type" ? "provider_fact" : "operator_checked");
  const evidence = fixtureEvidence(sourceType, { evidenceId: `fixture-${fieldPath.replaceAll(".", "-")}-${sourceType}`,
    ...(fieldPath === "identity.place_id" && sourceType === "operator_checked" ? { method: "branch_match" } : {}) });
  const values = { "client.clue": "Client wrote: Fixture Restaurant A, east branch", "identity.place_id": "fixture-place-east",
    "booking.entry_type": "online_request", "booking.conditions": "Seat availability and acceptance remain unknown",
    "review.conclusion": "The branch and entry type were checked; this does not confirm a reservation" };
  return { fieldPath, status: "supported", sourceType, value: values[fieldPath] || `Synthetic ${fieldPath}`,
    evidence: [evidence], dueAt: FIXTURE_DUE, reason: null, nextAction: "none", ...overrides };
}

/** All identities, licenses, human actors, facts and customer acceptances here are invented. */
export function reviewWorkflowFixture({ unresolved = false, conflict = false, providerOnlyIdentity = false, complete = true } = {}) {
  const policies = reviewWorkflowPolicies();
  let pair = { record: createReviewRecord({ fixtureOnly: true, recordId: "00000000-0000-4000-8000-000000000001",
    cycleId: "fixture-cycle-1", pilotEndsAt: "2026-10-31T00:00:00.000Z" },
  { policies, context: fixtureContext(null, null, "2026-10-01T00:00:00.000Z") }) };
  const fields = ["client.clue", "identity.place_id", "booking.entry_type", "booking.conditions", "review.conclusion"];
  pair = createReviewTask(pair.record, { taskId: "fixture-task-1", reason: "not_reviewed", affectedFields: fields, assignee: OPERATOR },
    { context: fixtureContext(pair.record, null, "2026-10-01T00:01:00.000Z") });
  pair = startReview(pair.record, pair.task, { context: fixtureContext(pair.record, pair.task, "2026-10-01T00:02:00.000Z") });
  for (const [index, fieldPath] of fields.entries()) {
    let field = fixtureField(fieldPath);
    if (providerOnlyIdentity && fieldPath === "identity.place_id") field = fixtureField(fieldPath, { sourceType: "provider_fact" });
    if (unresolved && fieldPath === "booking.conditions") field = fixtureField(fieldPath, { sourceType: "unknown", status: "unresolved",
      value: null, evidence: [], reason: "source_failure", nextAction: "check_source" });
    if (conflict && fieldPath === "identity.place_id") field = fixtureField(fieldPath, { status: "conflict", value: null,
      evidence: [fixtureEvidence("provider_fact"), fixtureEvidence("operator_checked", { method: "branch_match" })], reason: "conflict", nextAction: "human_resolution" });
    pair = recordFieldReview(pair.record, pair.task, field, { policies,
      context: fixtureContext(pair.record, pair.task, `2026-10-01T00:0${index + 3}:00.000Z`) });
  }
  if (complete && !unresolved && !conflict) pair = completeTask(pair.record, pair.task,
    { policies, context: fixtureContext(pair.record, pair.task, "2026-10-01T00:08:00.000Z"), workLogRefs: ["fixture-worklog-1"] });
  return { schemaVersion: 1, fixtureOnly: true, realWorldEvidence: false, gqEvidence: false, g1Evidence: false,
    releaseGateEvidence: false, policies, ...pair,
    deliveryInput: { deliveryId: "fixture-delivery-1", cycleId: "fixture-cycle-1", offerVersion: "fixture-offer-v1",
      revision: 1, requestedFields: fields, reviewRevisions: { [pair.record.recordId]: pair.record.revision } } };
}
