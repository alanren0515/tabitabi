import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { reviewWorkflowFixture, reviewWorkflowPolicies, fixtureContext, fixtureField, fixtureEvidence,
  FIXTURE_NOW, FIXTURE_DUE } from "../eval/review-workflow/fixtures.mjs";
import { evaluateFieldPolicy, createReviewRecord, createReviewTask, startReview, recordFieldReview, resolveFieldConflict,
  completeTask, transitionReviewTask, invalidateExpiredFields, createDeliveryDraft, requestDeliveryReview,
  recordDeliveryAcceptance, reviseDeliveryDraft, exportDeliveryDraft, listDueReviews } from "../server/review-workflow.mjs";

const policyQuery = { fieldPath: "identity.place_id", sourceType: "operator_checked", purpose: "private_delivery", scope: "export",
  at: FIXTURE_NOW, observedAt: "2026-10-01T00:00:00.000Z" };
function options(fixture, at = FIXTURE_NOW) { return { policies: fixture.policies, context: fixtureContext(fixture.record, fixture.task, at) }; }
function draft(fixture, overrides = {}, context = fixtureContext()) {
  return createDeliveryDraft([fixture.record], { ...fixture.deliveryInput, ...overrides }, { policies: fixture.policies, context });
}
function exported(fixture, value = draft(fixture), at = FIXTURE_NOW, format = "json") {
  return exportDeliveryDraft(value, { records: [fixture.record], policies: fixture.policies, context: fixtureContext(null, null, at), format });
}
function freshRecord(policies = reviewWorkflowPolicies(), overrides = {}, context = fixtureContext()) {
  return createReviewRecord({ fixtureOnly: true, recordId: "00000000-0000-4000-8000-000000000002", cycleId: "fixture-cycle-1",
    pilotEndsAt: "2026-10-31T00:00:00.000Z", ...overrides }, { policies, context });
}

test("field/source/purpose/scope matrix defaults to deny, including unknown provenance and public export", () => {
  const policies = reviewWorkflowPolicies();
  assert.equal(evaluateFieldPolicy(policies, policyQuery).allowed, true);
  for (const query of [{ sourceType: "unknown" }, { sourceType: "user_clue" }, { fieldPath: "rawApi" },
    { scope: "public" }, { purpose: "marketing" }, { fieldPath: "provider.rating", sourceType: "provider_fact" },
    { fieldPath: "operation.hours", sourceType: "provider_fact" }]) assert.equal(evaluateFieldPolicy(policies, { ...policyQuery, ...query }).allowed, false);
  const memoryOnly = { ...policyQuery, fieldPath: "provider.rating", sourceType: "provider_fact", purpose: "review", scope: "persist" };
  assert.equal(evaluateFieldPolicy(policies, memoryOnly).reason, "SCOPE_NOT_ALLOWED");
  const purpose = policies.find(policy => policy.fieldPath === policyQuery.fieldPath && policy.sourceType === policyQuery.sourceType);
  purpose.purposes = ["review"];
  assert.equal(evaluateFieldPolicy(policies, policyQuery).reason, "PURPOSE_NOT_ALLOWED");
});

test("license evidence, review version and unambiguous policy are mandatory", () => {
  for (const mutate of [policy => { delete policy.licenseEvidence; }, policy => { delete policy.reviewVersion; },
    policy => { policy.licenseEvidence.synthetic = false; }, policy => { policy.permissions.export = "yes"; },
    policy => { policy.retentionDays = 91; }, policy => { policy.licenseEvidence.extraRawLicense = "not retained"; }]) {
    const policies = reviewWorkflowPolicies(), policy = policies.find(item => item.fieldPath === policyQuery.fieldPath && item.sourceType === policyQuery.sourceType);
    mutate(policy);
    assert.equal(evaluateFieldPolicy(policies, policyQuery).reason, "FIELD_POLICY_INVALID");
  }
  const duplicate = reviewWorkflowPolicies(); duplicate.push(structuredClone(duplicate.find(item => item.fieldPath === policyQuery.fieldPath && item.sourceType === policyQuery.sourceType)));
  assert.equal(evaluateFieldPolicy(duplicate, policyQuery).reason, "AMBIGUOUS_POLICY");
});

test("shorter policy retention and license expiry override the 90 day metadata limit, with exact expiry denied", () => {
  const policies = reviewWorkflowPolicies(), policy = policies.find(item => item.fieldPath === policyQuery.fieldPath && item.sourceType === policyQuery.sourceType);
  policy.retentionDays = 1;
  assert.equal(evaluateFieldPolicy(policies, { ...policyQuery, at: "2026-10-01T23:59:59.999Z" }).allowed, true);
  assert.equal(evaluateFieldPolicy(policies, policyQuery).reason, "FIELD_POLICY_EXPIRED");
  policy.retentionDays = 90; policy.licenseEvidence.validUntil = FIXTURE_NOW;
  assert.equal(evaluateFieldPolicy(policies, policyQuery).reason, "FIELD_POLICY_EXPIRED");
  assert.equal(evaluateFieldPolicy(policies, { ...policyQuery, observedAt: "2026-09-01T00:00:00.000Z" }).reason, "OBSERVATION_OUTSIDE_LICENSE");
  assert.equal(evaluateFieldPolicy(policies, { ...policyQuery, observedAt: "2026-10-03T00:00:00.000Z" }).reason, "OBSERVATION_OUTSIDE_LICENSE");
});

test("record creation requires a synthetic scope, UUID and permissioned metadata and keeps only explicit input fields", () => {
  const policies = reviewWorkflowPolicies();
  assert.throws(() => freshRecord(policies, { fixtureOnly: false }), /FIXTURE_ONLY/);
  assert.throws(() => freshRecord(policies, {}, { ...fixtureContext(), fixtureOnly: false }), /FIXTURE_ONLY/);
  assert.throws(() => freshRecord(policies, { recordId: "not-a-uuid" }), /INVALID_RECORD_INPUT/);
  assert.throws(() => freshRecord([]), /FIELD_POLICY_UNKNOWN/);
  const record = freshRecord(policies, { contractRetainUntil: "2026-10-03T00:00:00.000Z", rawApi: { rating: 4.9 }, contact: "private contact", screenshot: "private" });
  assert.equal(record.retainUntil, "2026-10-03T00:00:00.000Z");
  assert.equal(Object.hasOwn(record, "rawApi"), false); assert.equal(Object.hasOwn(record, "contact"), false);
  assert.equal(record.fields.length, 0); assert.equal(record.reviewedAt, null);
  assert.equal(record.history[0].operatorId, fixtureContext().operatorId);
});

test("each field records its own source time; supplier time cannot borrow the operator review timestamp", () => {
  const fixture = reviewWorkflowFixture();
  const field = fixture.record.fields.find(item => item.fieldPath === "booking.entry_type");
  assert.equal(field.sourceType, "provider_fact"); assert.equal(field.reviewedAt, "2026-10-01T00:05:00.000Z");
  assert.equal(field.evidence[0].observedAt, "2026-10-01T00:00:00.000Z");
  assert.equal(field.evidence[0].fetchedAt, "2026-09-30T23:00:00.000Z");
  const active = reviewWorkflowFixture({ complete: false });
  const unknownTime = fixtureField("booking.entry_type", { evidence: [fixtureEvidence("provider_fact", { fetchedAt: null })] });
  assert.throws(() => recordFieldReview(active.record, active.task, unknownTime, options(active)), /SOURCE_TIME_UNKNOWN/);
  const futureTime = fixtureField("booking.entry_type", { evidence: [fixtureEvidence("provider_fact", { fetchedAt: "2026-10-02T00:00:00.000Z" })] });
  assert.throws(() => recordFieldReview(active.record, active.task, futureTime, options(active)), /INVALID_SOURCE_TIME/);
});

test("unsupported values, unlicensed origins, missing evidence and opaque/raw evidence payloads are rejected", () => {
  const fixture = reviewWorkflowFixture({ complete: false });
  for (const [field, expected] of [
    [fixtureField("booking.conditions", { sourceType: "unknown", status: "unresolved", evidence: [], reason: "source_failure", nextAction: "check_source" }), /UNKNOWN_SOURCE_HAS_VALUE/],
    [fixtureField("booking.conditions", { evidence: [] }), /MISSING_EVIDENCE/],
    [fixtureField("booking.conditions", { evidence: [fixtureEvidence("operator_checked", { rawApi: { seats: 10 } })] }), /INVALID_OR_EXPIRED_EVIDENCE/],
    [fixtureField("booking.conditions", { sourceType: "provider_fact", evidence: [fixtureEvidence("provider_fact")] }), /FIELD_POLICY_UNKNOWN/],
    [fixtureField("booking.conditions", { dueAt: "2026-10-06T00:00:00.000Z" }), /DUE_AFTER_RETENTION/]
  ]) assert.throws(() => recordFieldReview(fixture.record, fixture.task, field, options(fixture)), expected);
  // Adding a human check cannot bypass the underlying supplier permission.
  const derived = fixtureField("booking.conditions", { evidence: [fixtureEvidence("operator_checked"), fixtureEvidence("provider_fact")] });
  assert.throws(() => recordFieldReview(fixture.record, fixture.task, derived, options(fixture)), /FIELD_POLICY_UNKNOWN/);
});

test("a new operator review or cache observation cannot extend the supplier retention window", () => {
  const fixture = reviewWorkflowFixture({ complete: false });
  fixture.policies.find(policy => policy.fieldPath === "booking.entry_type" && policy.sourceType === "provider_fact").retentionDays = 1;
  const cached = fixtureField("booking.entry_type", { evidence: [fixtureEvidence("provider_fact", { observedAt: FIXTURE_NOW,
    fetchedAt: "2026-09-30T23:00:00.000Z" })] });
  assert.throws(() => recordFieldReview(fixture.record, fixture.task, cached, options(fixture)), /FIELD_POLICY_EXPIRED/);
});

test("scope and optimistic revisions guard every task mutation without changing the original", () => {
  const fixture = reviewWorkflowFixture({ complete: false }), original = structuredClone(fixture);
  const field = fixtureField("booking.conditions");
  for (const [context, code] of [
    [{ ...options(fixture).context, expectedRevision: fixture.record.revision - 1 }, /REVISION_MISMATCH/],
    [{ ...options(fixture).context, expectedTaskRevision: fixture.task.revision - 1 }, /TASK_REVISION_MISMATCH/],
    [{ ...options(fixture).context, workspaceId: "fixture-workspace-2" }, /WORKSPACE_MISMATCH/],
    [{ ...options(fixture).context, occurredAt: "2026-09-30T00:00:00.000Z" }, /ACTION_TIME_INVALID/]
  ]) assert.throws(() => recordFieldReview(fixture.record, fixture.task, field, { policies: fixture.policies, context }), code);
  const foreign = { ...fixture.task, recordId: "00000000-0000-4000-8000-000000000002" };
  assert.throws(() => recordFieldReview(fixture.record, foreign, field, options(fixture)), /TASK_SCOPE_MISMATCH/);
  const suspended = { ...fixture.record, workspaceState: "suspended" };
  assert.throws(() => recordFieldReview(suspended, fixture.task, field, options(fixture)), /WORKSPACE_SUSPENDED/);
  assert.deepEqual(fixture, original);
});

test("a conflict cannot be overwritten or completed; explicit human evidence and decision resolve it", () => {
  const fixture = reviewWorkflowFixture({ conflict: true });
  assert.throws(() => recordFieldReview(fixture.record, fixture.task, fixtureField("identity.place_id"), options(fixture)), /HUMAN_CONFLICT_RESOLUTION_REQUIRED/);
  assert.throws(() => completeTask(fixture.record, fixture.task, options(fixture)), /TASK_HAS_UNRESOLVED_FIELDS/);
  assert.throws(() => resolveFieldConflict(fixture.record, fixture.task, fixtureField("identity.place_id"), options(fixture)), /HUMAN_CONFLICT_RESOLUTION_REQUIRED/);
  const foreignActor = fixtureField("identity.place_id", { evidence: [fixtureEvidence("operator_checked", { method: "conflict_resolution", operatorId: "fixture-other-operator" })] });
  assert.throws(() => resolveFieldConflict(fixture.record, fixture.task, foreignActor, options(fixture)), /HUMAN_ACTOR_MISMATCH/);
  const resolution = fixtureField("identity.place_id", { evidence: [fixtureEvidence("operator_checked", { method: "conflict_resolution", evidenceId: "fixture-resolution-1" })] });
  const pair = resolveFieldConflict(fixture.record, fixture.task, resolution, options(fixture));
  const resolved = pair.record.fields.find(field => field.fieldPath === "identity.place_id");
  assert.deepEqual(resolved.humanResolution, { operatorId: fixtureContext().operatorId, decidedAt: FIXTURE_NOW, evidenceId: "fixture-resolution-1", decision: "supported" });
  assert.equal(pair.record.history.at(-1).action, "resolve_conflict");
  const completed = completeTask(pair.record, pair.task, { policies: fixture.policies, context: fixtureContext(pair.record, pair.task) });
  assert.equal(completed.task.status, "completed");
  assert.equal(fixture.record.fields.find(field => field.fieldPath === "identity.place_id").status, "conflict");
});

test("blocked tasks require a reason and an operator resume; completed tasks need a new linked task", () => {
  const fixture = reviewWorkflowFixture({ unresolved: true });
  assert.throws(() => transitionReviewTask(fixture.record, fixture.task, "blocked", options(fixture)), /BLOCKED_REASON_REQUIRED/);
  let pair = transitionReviewTask(fixture.record, fixture.task, "blocked", { ...options(fixture), reason: "source_failure" });
  assert.equal(pair.task.blockedReason, "source_failure");
  assert.throws(() => startReview(pair.record, pair.task, { context: fixtureContext(pair.record, pair.task) }), /INVALID_TASK_TRANSITION/);
  pair = transitionReviewTask(pair.record, pair.task, "pending", { context: fixtureContext(pair.record, pair.task) });
  assert.equal(pair.task.blockedReason, null);
  pair = startReview(pair.record, pair.task, { context: fixtureContext(pair.record, pair.task) });
  assert.equal(pair.task.status, "in_progress");
  const done = reviewWorkflowFixture();
  assert.throws(() => recordFieldReview(done.record, done.task, fixtureField("booking.conditions"), options(done)), /TASK_NOT_IN_PROGRESS/);
  assert.throws(() => transitionReviewTask(done.record, done.task, "pending", options(done)), /INVALID_TASK_TRANSITION/);
  const next = createReviewTask(done.record, { taskId: "fixture-task-2", assignee: fixtureContext().operatorId, affectedFields: ["booking.conditions"], reason: "expired" },
    { context: fixtureContext(done.record), previousTask: done.task });
  assert.equal(next.task.linkedTaskId, done.task.taskId); assert.equal(next.task.status, "pending");
  assert.equal(done.task.status, "completed");
  const restarted = startReview(next.record, next.task, { context: fixtureContext(next.record, next.task) });
  assert.throws(() => completeTask(restarted.record, restarted.task, { policies: done.policies, context: fixtureContext(restarted.record, restarted.task) }), /TASK_REVIEW_EVIDENCE_MISSING/);
});

test("task completion rejects overdue evidence rather than treating old supported fields as current", () => {
  const fixture = reviewWorkflowFixture({ complete: false });
  assert.throws(() => completeTask(fixture.record, fixture.task, options(fixture, FIXTURE_DUE)), /FIELD_EVIDENCE_EXPIRED/);
  const revoked = structuredClone(fixture); revoked.policies.find(policy => policy.fieldPath === "booking.entry_type").permissions.persist = false;
  assert.throws(() => completeTask(revoked.record, revoked.task, options(revoked)), /SCOPE_NOT_ALLOWED/);
  assert.throws(() => completeTask(fixture.record, fixture.task, { ...options(fixture), workLogRefs: ["fixture-log-1", "fixture-log-1"] }), /INVALID_WORK_LOG_REFS/);
});

test("unresolved exports contain an explicit reason and next action without unknown values, and keep the assigned denominator", () => {
  const fixture = reviewWorkflowFixture({ unresolved: true }), payload = exported(fixture).payload;
  assert.deepEqual(payload.counts, { assigned: 1, resolved: 0, unresolved: 1 });
  assert.equal(payload.entries[0].fields.some(field => field.fieldPath === "booking.conditions"), false);
  assert.deepEqual(payload.entries[0].unresolved, [{ fieldPath: "booking.conditions", status: "unresolved", reason: "source_failure", nextAction: "check_source" }]);
  const missingReason = structuredClone(fixture); missingReason.record.fields.find(field => field.fieldPath === "booking.conditions").reason = null;
  assert.throws(() => draft(missingReason), /UNRESOLVED_REASON_REQUIRED/);
});

test("unconfirmed or conflicting identity withdraws all factual and booking values regardless of customer acceptance", () => {
  for (const config of [{ conflict: true }, { providerOnlyIdentity: true }]) {
    const fixture = reviewWorkflowFixture(config), value = draft(fixture), payload = exported(fixture, value).payload;
    assert.equal(payload.counts.resolved, 0);
    assert.deepEqual(payload.entries[0].fields.map(field => field.fieldPath), ["client.clue"]);
    const reviewed = requestDeliveryReview(value, { context: fixtureContext() });
    const { draft: accepted } = recordDeliveryAcceptance(reviewed, { acceptanceId: "fixture-accepted", status: "accepted", evidenceRef: "fixture-customer-reviewed" }, { context: fixtureContext() });
    assert.equal(exported(fixture, accepted).payload.entries[0].result, "unresolved");
    assert.equal(exported(fixture, accepted).payload.entries[0].fields.some(field => field.fieldPath.startsWith("booking.")), false);
  }
});

test("private delivery export refuses restricted fields, missing fields/evidence, stale revisions and cycle/workspace mismatch", () => {
  const fixture = reviewWorkflowFixture();
  for (const path of ["contact.phone", "screenshot", "rawApi", "privateBookingUrl", "internalNote", "laborRate", "paymentDetails", "review.metadata"]) {
    assert.throws(() => draft(fixture, { requestedFields: [path] }), /RESTRICTED_DELIVERY_FIELD/);
  }
  assert.throws(() => draft(fixture, { requestedFields: ["operation.status"] }), /MISSING_REVIEW_FIELD/);
  assert.throws(() => draft(fixture, { reviewRevisions: { [fixture.record.recordId]: fixture.record.revision - 1 } }), /REVISION_MISMATCH/);
  assert.throws(() => draft(fixture, { cycleId: "fixture-cycle-other" }), /CYCLE_MISMATCH/);
  assert.throws(() => draft(fixture, {}, { ...fixtureContext(), workspaceId: "fixture-workspace-other" }), /WORKSPACE_MISMATCH/);
  const missing = structuredClone(fixture); missing.record.fields[0].evidence = [];
  assert.throws(() => draft(missing), /MISSING_EVIDENCE/);
});

test("export revalidates live policy and actual review revision and rejects modified draft projections", () => {
  const fixture = reviewWorkflowFixture(), value = draft(fixture);
  const stale = structuredClone(fixture); stale.record.revision++;
  assert.throws(() => exported(stale, value), /REVISION_MISMATCH/);
  const revoked = structuredClone(fixture); revoked.policies.find(policy => policy.fieldPath === "booking.entry_type").permissions.export = false;
  assert.throws(() => exported(revoked, value), /SCOPE_NOT_ALLOWED/);
  const licenseExpired = structuredClone(fixture); licenseExpired.policies.find(policy => policy.fieldPath === "booking.entry_type").licenseEvidence.validUntil = FIXTURE_NOW;
  assert.throws(() => exported(licenseExpired, value), /FIELD_POLICY_EXPIRED/);
  const tampered = structuredClone(value); tampered.entries[0].fields[0].value = "Fabricated client statement";
  assert.throws(() => exported(fixture, tampered), /DELIVERY_PROJECTION_MISMATCH/);
  const injected = { ...value, contact: "private" };
  assert.throws(() => exported(fixture, injected), /INVALID_DELIVERY_DRAFT/);
  assert.throws(() => exported(fixture, value, FIXTURE_DUE), /FIELD_EVIDENCE_EXPIRED/);
});

test("expiration removes previously held values/evidence in a new revision without rewriting old historical snapshots", () => {
  const fixture = reviewWorkflowFixture(), original = structuredClone(fixture.record);
  const result = invalidateExpiredFields(fixture.record, { policies: fixture.policies, context: fixtureContext(fixture.record, null, FIXTURE_DUE) });
  assert.equal(result.expiredFields.length, fixture.record.fields.length); assert.equal(result.record.fields.length, 0);
  assert.equal(result.record.revision, fixture.record.revision + 1); assert.equal(result.record.history.at(-1).action, "invalidate_expired");
  assert.deepEqual(fixture.record, original);
  const revokedConflict = reviewWorkflowFixture({ conflict: true });
  revokedConflict.policies.find(policy => policy.fieldPath === "identity.place_id" && policy.sourceType === "provider_fact").permissions.persist = false;
  const conflictResult = invalidateExpiredFields(revokedConflict.record, options(revokedConflict));
  assert.deepEqual(conflictResult.expiredFields, ["identity.place_id"]);
});

test("accepted old revision remains attached to that revision and changed deliveries require fresh review", () => {
  const fixture = reviewWorkflowFixture(), initial = draft(fixture);
  assert.throws(() => recordDeliveryAcceptance(initial, { acceptanceId: "fixture-acceptance", status: "accepted", evidenceRef: "fixture-review" }, { context: fixtureContext() }), /INVALID_DELIVERY_TRANSITION/);
  const reviewed = requestDeliveryReview(initial, { context: fixtureContext() });
  assert.throws(() => recordDeliveryAcceptance(reviewed, { acceptanceId: "fixture-acceptance", status: "accepted" }, { context: fixtureContext() }), /ACCEPTANCE_EVIDENCE_REQUIRED/);
  const accepted = recordDeliveryAcceptance(reviewed, { acceptanceId: "fixture-acceptance", status: "accepted", evidenceRef: "fixture-review" }, { context: fixtureContext() });
  const changed = reviseDeliveryDraft(accepted.draft, [fixture.record], { ...fixture.deliveryInput, revision: 2 }, { policies: fixture.policies, context: fixtureContext() });
  assert.equal(accepted.acceptance.deliveryRevision, 1); assert.equal(accepted.acceptance.factCertification, false);
  assert.equal(changed.previous.acceptances[0].deliveryRevision, 1); assert.equal(changed.previous.status, "superseded");
  assert.equal(changed.draft.revision, 2); assert.equal(changed.draft.status, "draft"); assert.deepEqual(changed.draft.acceptances, []);
  assert.throws(() => exported(fixture, changed.previous), /DELIVERY_SUPERSEDED/);
  assert.equal(accepted.draft.status, "accepted");
});

test("delivery state time cannot move backwards and remains separate from the content revision", () => {
  const fixture = reviewWorkflowFixture(), initial = draft(fixture);
  const at = value => ({ context: fixtureContext(null, null, value) });
  const requestedAt = "2026-10-03T00:00:00.000Z", acceptedAt = "2026-10-03T01:00:00.000Z", revisedAt = "2026-10-03T02:00:00.000Z";
  const reviewed = requestDeliveryReview(initial, at(requestedAt));
  const acceptance = { acceptanceId: "fixture-acceptance", status: "accepted", evidenceRef: "fixture-review" };
  assert.throws(() => recordDeliveryAcceptance(reviewed, acceptance, at("2026-10-02T12:00:00.000Z")), /ACTION_TIME_INVALID/);
  const accepted = recordDeliveryAcceptance(reviewed, acceptance, at(acceptedAt));
  const revisionInput = { ...fixture.deliveryInput, revision: 2 };
  assert.throws(() => reviseDeliveryDraft(accepted.draft, [fixture.record], revisionInput,
    { policies: fixture.policies, ...at(requestedAt) }), /ACTION_TIME_INVALID/);
  const changed = reviseDeliveryDraft(accepted.draft, [fixture.record], revisionInput, { policies: fixture.policies, ...at(revisedAt) });
  assert.equal(initial.updatedAt, initial.generatedAt);
  assert.equal(reviewed.updatedAt, requestedAt); assert.equal(reviewed.revision, 1);
  assert.equal(accepted.draft.updatedAt, acceptedAt); assert.equal(accepted.draft.revision, 1);
  assert.equal(accepted.acceptance.deliveryRevision, 1);
  assert.equal(changed.previous.updatedAt, revisedAt); assert.equal(changed.previous.revision, 1);
  assert.equal(changed.draft.updatedAt, revisedAt); assert.equal(changed.draft.revision, 2);
  const corrupt = { ...reviewed, updatedAt: "2026-10-01T00:00:00.000Z" };
  assert.throws(() => recordDeliveryAcceptance(corrupt, acceptance, at(acceptedAt)), /INVALID_DELIVERY_DRAFT/);
});

test("bounded UTF-8 JSON/Markdown exports whitelist internal identities and clearly disclose source times and fixture limits", () => {
  const fixture = reviewWorkflowFixture(), output = exported(fixture), parsed = JSON.parse(output.content);
  assert.equal(output.contentType, "application/json; charset=utf-8");
  assert.equal(parsed.revision, 1); assert.equal(parsed.generatedAt, FIXTURE_NOW); assert.ok(parsed.timeMeaning.includes("fetchedAt"));
  for (const key of ["workspaceId", "operatorId", "history", "acceptances", "workLogRefs", "policies", "laborRate", "paymentDetails"]) assert.equal(Object.hasOwn(parsed, key), false);
  assert.equal(output.content.includes("fixture-operator-1"), false);
  assert.equal(parsed.copyCannotBeRecalled, true); assert.equal(parsed.publicAccessEnabled, false);
  assert.equal(parsed.fixtureOnly, true); assert.equal(parsed.workspaceEnabled, false);
  for (const key of ["realWorldEvidence", "gqEvidence", "g1Evidence", "releaseGateEvidence"]) assert.equal(parsed[key], false);
  const markdown = exported(fixture, draft(fixture), FIXTURE_NOW, "markdown");
  assert.ok(markdown.content.includes("Fixture only; no GQ/G1/release evidence"));
  assert.ok(markdown.content.includes("```json"));
  assert.throws(() => exported(fixture, draft(fixture), FIXTURE_NOW, "html"), /EXPORT_FORMAT_NOT_ALLOWED/);
});

test("delivery entry limits and record uniqueness are explicit, rather than silently truncating inputs", () => {
  const fixture = reviewWorkflowFixture();
  assert.throws(() => createDeliveryDraft(Array(21).fill(fixture.record), fixture.deliveryInput, { policies: fixture.policies, context: fixtureContext() }), /INVALID_DELIVERY_INPUT/);
  assert.throws(() => createDeliveryDraft([fixture.record, fixture.record], fixture.deliveryInput, { policies: fixture.policies, context: fixtureContext() }), /INVALID_DELIVERY_INPUT/);
});

test("due view, fixture construction, private export and validation perform no fetch or automatic task starts", t => {
  const original = globalThis.fetch; let fetchCount = 0;
  globalThis.fetch = () => { fetchCount++; throw new Error("external requests forbidden"); };
  t.after(() => { globalThis.fetch = original; });
  const fixture = reviewWorkflowFixture();
  assert.deepEqual(listDueReviews([fixture.record], { at: FIXTURE_NOW }), []);
  assert.deepEqual(listDueReviews([fixture.record], { at: FIXTURE_DUE }), [{ recordId: fixture.record.recordId,
    workspaceId: fixture.record.workspaceId, revision: fixture.record.revision, dueAt: FIXTURE_DUE }]);
  exported(fixture); assert.equal(fixture.task.status, "completed"); assert.equal(fetchCount, 0);
});

test("default validation CLI is provider-free, reports synthetic evidence only, and refuses any external/customer input", () => {
  const stdout = execFileSync(process.execPath, ["scripts/validate-review-workflow.mjs"], { cwd: new URL("..", import.meta.url), encoding: "utf8" });
  const report = JSON.parse(stdout);
  assert.equal(report.passed, true); assert.equal(report.checks.length, 8); assert.ok(report.checks.every(check => check.passed));
  assert.equal(report.networkRequestsAttempted, 0); assert.equal(report.storageWrites, 0); assert.equal(report.workspaceEnabled, false);
  for (const key of ["realWorldEvidence", "gqEvidence", "g1Evidence", "releaseGateEvidence"]) assert.equal(report[key], false);
  assert.throws(() => execFileSync(process.execPath, ["scripts/validate-review-workflow.mjs", "--input", "real-customer.json"],
    { cwd: new URL("..", import.meta.url), encoding: "utf8", stdio: "pipe" }), error => JSON.parse(error.stdout).code === "FIXTURE_CLI_ARGUMENTS_NOT_ALLOWED");
});
