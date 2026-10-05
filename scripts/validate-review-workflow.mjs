import assert from "node:assert/strict";
import { reviewWorkflowFixture, fixtureContext, fixtureField, fixtureEvidence, FIXTURE_NOW } from "../eval/review-workflow/fixtures.mjs";
import { evaluateFieldPolicy, createDeliveryDraft, exportDeliveryDraft, completeTask, recordFieldReview,
  resolveFieldConflict, requestDeliveryReview, recordDeliveryAcceptance, reviseDeliveryDraft } from "../server/review-workflow.mjs";

// Deliberately no --input or client files: A12 only validates the checked-in synthetic fixtures.
const checks = [];
let networkRequestsAttempted = 0;
globalThis.fetch = async () => { networkRequestsAttempted++; throw new Error("NETWORK_DISABLED_FOR_FIXTURES"); };
function check(name, run) {
  try { run(); checks.push({ name, passed: true }); }
  catch (error) { checks.push({ name, passed: false, code: error.message }); }
}
function draft(fixture, context = fixtureContext()) {
  return createDeliveryDraft([fixture.record], fixture.deliveryInput, { policies: fixture.policies, context });
}
function exported(fixture, value = draft(fixture), context = fixtureContext()) {
  return exportDeliveryDraft(value, { records: [fixture.record], policies: fixture.policies, context }).payload;
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node scripts/validate-review-workflow.mjs\nSynthetic, in-memory, provider-free A12 fixtures only. No client input, API, storage or B workspace activation.");
  } else {
    if (args.length) throw new Error("FIXTURE_CLI_ARGUMENTS_NOT_ALLOWED");
    check("strict_field_purpose_scope_license_retention", () => {
      const { policies } = reviewWorkflowFixture();
      const query = { fieldPath: "identity.place_id", sourceType: "operator_checked", purpose: "private_delivery", scope: "export", at: FIXTURE_NOW, observedAt: "2026-10-01T00:00:00.000Z" };
      assert.equal(evaluateFieldPolicy(policies, query).allowed, true);
      assert.equal(evaluateFieldPolicy(policies, { ...query, sourceType: "unknown" }).allowed, false);
      assert.equal(evaluateFieldPolicy(policies, { ...query, scope: "public" }).allowed, false);
      assert.equal(evaluateFieldPolicy(policies, { ...query, fieldPath: "provider.rating", sourceType: "provider_fact" }).allowed, false);
    });
    check("private_whitelist_and_time_provenance", () => {
      const payload = exported(reviewWorkflowFixture());
      assert.equal(payload.counts.resolved, 1);
      assert.equal(payload.entries[0].fields.find(field => field.fieldPath === "booking.entry_type").evidence[0].fetchedAt, "2026-09-30T23:00:00.000Z");
      assert.equal(Object.hasOwn(payload, "workspaceId"), false);
      assert.equal(payload.gqEvidence || payload.g1Evidence || payload.releaseGateEvidence || payload.realWorldEvidence, false);
    });
    check("unknown_remains_unresolved_without_source_value", () => {
      const fixture = reviewWorkflowFixture({ unresolved: true });
      const payload = exported(fixture);
      assert.equal(payload.counts.unresolved, 1);
      assert.equal(payload.entries[0].fields.some(field => field.fieldPath === "booking.conditions"), false);
      assert.throws(() => completeTask(fixture.record, fixture.task, { policies: fixture.policies, context: fixtureContext(fixture.record, fixture.task) }), /TASK_HAS_UNRESOLVED_FIELDS/);
    });
    check("conflict_requires_explicit_human_decision", () => {
      const fixture = reviewWorkflowFixture({ conflict: true });
      const options = { policies: fixture.policies, context: fixtureContext(fixture.record, fixture.task) };
      assert.throws(() => recordFieldReview(fixture.record, fixture.task, fixtureField("identity.place_id"), options), /HUMAN_CONFLICT_RESOLUTION_REQUIRED/);
      const pair = resolveFieldConflict(fixture.record, fixture.task, fixtureField("identity.place_id", {
        evidence: [fixtureEvidence("operator_checked", { evidenceId: "fixture-human-resolution", method: "conflict_resolution" })] }), options);
      assert.equal(pair.record.fields.find(field => field.fieldPath === "identity.place_id").humanResolution.operatorId, options.context.operatorId);
      assert.equal(exported(fixture).entries[0].fields.some(field => field.fieldPath.startsWith("booking.")), false);
    });
    check("revision_scope_restricted_field_and_missing_evidence_rejected", () => {
      const fixture = reviewWorkflowFixture();
      const stale = structuredClone(fixture); stale.deliveryInput.reviewRevisions[stale.record.recordId]--;
      assert.throws(() => draft(stale), /REVISION_MISMATCH/);
      assert.throws(() => draft(fixture, { ...fixtureContext(), workspaceId: "fixture-other-workspace" }), /WORKSPACE_MISMATCH/);
      const restricted = structuredClone(fixture); restricted.deliveryInput.requestedFields.push("contact.phone");
      assert.throws(() => draft(restricted), /RESTRICTED_DELIVERY_FIELD/);
      const missing = structuredClone(fixture); missing.record.fields[0].evidence = [];
      assert.throws(() => draft(missing), /MISSING_EVIDENCE/);
    });
    check("expired_evidence_cannot_be_exported", () => {
      const fixture = reviewWorkflowFixture(), value = draft(fixture);
      assert.throws(() => exported(fixture, value, { ...fixtureContext(), occurredAt: "2026-10-05T00:00:00.000Z" }), /FIELD_EVIDENCE_EXPIRED/);
    });
    check("new_delivery_revision_does_not_inherit_acceptance", () => {
      const fixture = reviewWorkflowFixture();
      const reviewed = requestDeliveryReview(draft(fixture), { context: fixtureContext() });
      const { draft: accepted, acceptance } = recordDeliveryAcceptance(reviewed, { acceptanceId: "fixture-acceptance-1", status: "accepted", evidenceRef: "fixture-customer-review-1" }, { context: fixtureContext() });
      const { previous, draft: updated } = reviseDeliveryDraft(accepted, [fixture.record], { ...fixture.deliveryInput, revision: 2 }, { policies: fixture.policies, context: fixtureContext() });
      assert.equal(previous.status, "superseded"); assert.equal(updated.status, "draft"); assert.equal(updated.acceptances.length, 0);
      assert.equal(acceptance.deliveryRevision, 1); assert.equal(acceptance.factCertification, false);
    });
    check("provider_identity_does_not_confirm_branch", () => {
      const payload = exported(reviewWorkflowFixture({ providerOnlyIdentity: true }));
      assert.equal(payload.entries[0].identityState, "unconfirmed");
      assert.equal(payload.counts.resolved, 0);
      assert.equal(payload.entries[0].fields.some(field => field.fieldPath.startsWith("booking.")), false);
    });
    const passed = checks.every(item => item.passed) && networkRequestsAttempted === 0;
    console.log(JSON.stringify({ schemaVersion: 1, fixtureOnly: true, providerFree: true, storageWrites: 0,
      networkRequestsAttempted, workspaceEnabled: false, realWorldEvidence: false, gqEvidence: false, g1Evidence: false,
      releaseGateEvidence: false, passed, checks }, null, 2));
    if (!passed) process.exitCode = 1;
  }
} catch (error) {
  console.log(JSON.stringify({ fixtureOnly: true, passed: false, code: error.message, realWorldEvidence: false,
    gqEvidence: false, g1Evidence: false, releaseGateEvidence: false }));
  process.exitCode = 1;
}
