import test from "node:test";
import assert from "node:assert/strict";
import { createShadowEntitlementState, summarizeShadowEntitlements, transitionShadowEntitlements } from "../server/shadow-entitlements.mjs";

const at = "2026-10-03T00:00:00.000Z", reservationExpiresAt = "2026-10-03T01:00:00.000Z", expiresAt = "2026-10-04T00:00:00.000Z";
const initial = credits => createShadowEntitlementState({ credits, at, expiresAt });
const reserve = (state, operationId = "operation-one", creditUnits = 1) => transitionShadowEntitlements(state, { type: "reserve", operationId, units: creditUnits, at, reservationExpiresAt });
const delivered = { delivery: "delivered_reconciliation", terminal: true, resultKind: "insufficient_information" };
const failed = { delivery: "not_delivered", outcome: "complete_failure" };

test("same operation reservation and terminal delivery commit once; cached new operation consumes a separate simulated credit", () => {
  const original = initial(2), reserved = reserve(original);
  assert.equal(summarizeShadowEntitlements(original).available, 2); // reducer never mutates its input
  let state = reserve(reserved);
  assert.equal(summarizeShadowEntitlements(state).reserved, 1);
  assert.throws(() => reserve(state, "operation-one", 2), /SHADOW_OPERATION_CONFLICT/);
  state = transitionShadowEntitlements(state, { type: "commit", operationId: "operation-one", at, evidence: delivered });
  state = transitionShadowEntitlements(state, { type: "commit", operationId: "operation-one", at, evidence: delivered });
  state = reserve(state, "cached-new-operation");
  assert.equal(summarizeShadowEntitlements(state).committed, 1);
  assert.equal(summarizeShadowEntitlements(state).reserved, 1);
  assert.equal(summarizeShadowEntitlements(state).available, 0);
  assert.throws(() => reserve(state, "third-operation"), /SHADOW_INSUFFICIENT_AVAILABLE/);
  assert.equal(summarizeShadowEntitlements(state).realEntitlementsChanged, false);
});

test("HTTP/partial/unknown delivery cannot commit, release or reclaim a reservation", () => {
  const state = reserve(initial(1));
  for (const evidence of [undefined, { delivery: "http_success", terminal: true, resultKind: "confirmed" },
    { delivery: "delivered_reconciliation", terminal: false, resultKind: "confirmed" }, { delivery: "unknown" }]) {
    assert.throws(() => transitionShadowEntitlements(state, { type: "commit", operationId: "operation-one", at, evidence }), /SHADOW_DELIVERY_EVIDENCE_REQUIRED/);
  }
  assert.throws(() => transitionShadowEntitlements(state, { type: "release", operationId: "operation-one", at, evidence: { delivery: "unknown", outcome: "complete_failure" } }), /SHADOW_NONDELIVERY_EVIDENCE_REQUIRED/);
  const expiredTime = transitionShadowEntitlements(state, { type: "advance_time", at: expiresAt });
  assert.equal(summarizeShadowEntitlements(expiredTime).reserved, 1);
  assert.equal(summarizeShadowEntitlements(expiredTime).heldUnknownDeliveryOperations, 1);
  assert.throws(() => transitionShadowEntitlements(expiredTime, { type: "expire", operationId: "operation-one", at: expiresAt }), /SHADOW_NONDELIVERY_EVIDENCE_REQUIRED/);
});

test("complete failure releases once and does not allow the same operation to consume again", () => {
  let state = reserve(initial(1));
  const release = { type: "release", operationId: "operation-one", at, evidence: failed };
  state = transitionShadowEntitlements(state, release);
  state = transitionShadowEntitlements(state, release);
  state = reserve(state);
  const summary = summarizeShadowEntitlements(state);
  assert.equal(summary.available, 1);
  assert.equal(summary.released, 1);
  assert.equal(summary.reserved, 0);
  assert.throws(() => transitionShadowEntitlements(state, { type: "commit", operationId: "operation-one", at, evidence: delivered }), /SHADOW_TERMINAL_OPERATION/);
  state = reserve(state, "new-operation");
  assert.equal(summarizeShadowEntitlements(state).reserved, 1);
});

test("proven non-delivery can expire a reservation; grant expiry keeps committed and unknown delivery held", () => {
  let state = reserve(initial(3));
  const expire = { type: "expire", operationId: "operation-one", at: reservationExpiresAt,
    evidence: { delivery: "not_delivered", outcome: "never_dispatched" } };
  assert.throws(() => transitionShadowEntitlements(state, { ...expire, at }), /SHADOW_RESERVATION_NOT_EXPIRED/);
  state = transitionShadowEntitlements(state, expire);
  assert.equal(summarizeShadowEntitlements(state).available, 3);
  assert.equal(summarizeShadowEntitlements(state).expiredOperations, 1);
  state = transitionShadowEntitlements(state, { type: "reserve", operationId: "delivered", units: 1, at: reservationExpiresAt, reservationExpiresAt: expiresAt });
  state = transitionShadowEntitlements(state, { type: "commit", operationId: "delivered", at: reservationExpiresAt, evidence: delivered });
  state = transitionShadowEntitlements(state, { type: "reserve", operationId: "unknown", units: 1, at: reservationExpiresAt, reservationExpiresAt: expiresAt });
  state = transitionShadowEntitlements(state, { type: "advance_time", at: expiresAt });
  const summary = summarizeShadowEntitlements(state);
  assert.equal(summary.available, 0);
  assert.equal(summary.committed, 1);
  assert.equal(summary.reserved, 1);
  assert.equal(summary.expired, 1);
  assert.equal(summary.available + summary.reserved + summary.committed + summary.expired, 3);
  assert.throws(() => transitionShadowEntitlements(state, { type: "release", operationId: "delivered", at: expiresAt, evidence: failed }), /SHADOW_TERMINAL_OPERATION/);
  assert.throws(() => transitionShadowEntitlements(state, { type: "reserve", operationId: "new", units: 1, at: expiresAt, reservationExpiresAt: "2026-10-05T00:00:00.000Z" }), /SHADOW_RESERVATION_EXPIRY|SHADOW_ALLOWANCE_EXPIRED/);
});

test("corrupt balances, duplicate operations, invalid timestamps and backwards time stop the pure simulation", () => {
  assert.throws(() => initial(0), /INVALID_SHADOW_ALLOWANCE/);
  assert.throws(() => createShadowEntitlementState({ credits: 1, at: "2026-02-30T00:00:00.000Z", expiresAt }), /INVALID_SHADOW_ALLOWANCE/);
  const state = reserve(initial(1));
  assert.throws(() => transitionShadowEntitlements(state, { type: "advance_time", at: "2026-10-02T00:00:00.000Z" }), /INVALID_SHADOW_EVENT/);
  const corrupt = structuredClone(state); corrupt.operations.push({ ...corrupt.operations[0] });
  assert.throws(() => summarizeShadowEntitlements(corrupt), /INVALID_SHADOW_STATE/);
  corrupt.operations[1].operationId = "different";
  assert.throws(() => summarizeShadowEntitlements(corrupt), /INVALID_SHADOW_STATE/);
  state.shadowOnly = false;
  assert.throws(() => transitionShadowEntitlements(state, { type: "advance_time", at }), /INVALID_SHADOW_STATE/);
});
