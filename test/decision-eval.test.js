import test from "node:test";
import assert from "node:assert/strict";
import { evaluateDecisionSafety } from "../scripts/decision-eval.mjs";

const bookingOption = {
  provider: "tablecheck",
  url: "https://www.tablecheck.com/shops/demo/reserve",
  capability: { kind: "online_reservation_flow", recommended: true }
};

function baseRestaurant(overrides = {}) {
  return {
    recommendation: "unknown",
    decisionEvidence: [{ claim: "预约规则未知", certainty: "low" }],
    primaryAction: { label: "在地图核对", url: "https://maps.example/demo", type: "map" },
    reservationOptions: [],
    evidenceFacts: [],
    risks: [],
    ...overrides
  };
}

test("accepts an evidence-backed recommended booking flow", () => {
  const result = evaluateDecisionSafety(baseRestaurant({
    recommendation: "recommended",
    primaryAction: { label: "通过 TableCheck 开始预约", url: bookingOption.url, type: "open_booking_source", provider: "tablecheck" },
    reservationOptions: [bookingOption]
  }));
  assert.equal(result.passed, true);
});

test("rejects recommended decisions without a verified booking flow", () => {
  const result = evaluateDecisionSafety(baseRestaurant({ recommendation: "recommended" }));
  assert.deepEqual(result.issues, ["recommended_without_verified_booking_flow"]);
});

test("requires official high-confidence no-reservation evidence before walk-in guidance", () => {
  const invalid = evaluateDecisionSafety(baseRestaurant({ recommendation: "walk_in_ok" }));
  assert.ok(invalid.issues.includes("walk_in_without_official_no_reservation_evidence"));

  const valid = evaluateDecisionSafety(baseRestaurant({
    recommendation: "walk_in_ok",
    evidenceFacts: [{ field: "reservation_policy", value: "not_accepted", sourceType: "official_website", confidence: "high" }]
  }));
  assert.equal(valid.passed, true);
});

test("closed restaurants only expose safe status-check actions", () => {
  const unsafe = evaluateDecisionSafety(baseRestaurant({
    recommendation: "temporarily_unavailable",
    primaryAction: { label: "开始预约", url: bookingOption.url, type: "open_booking_source", provider: "tablecheck" },
    reservationOptions: [bookingOption]
  }));
  assert.ok(unsafe.issues.includes("unavailable_without_safe_status_check_action"));
  assert.ok(unsafe.issues.includes("unavailable_with_booking_primary_action"));

  const safe = evaluateDecisionSafety(baseRestaurant({ recommendation: "temporarily_unavailable" }));
  assert.equal(safe.passed, true);
});

test("does not promote discovery links or booking actions during unresolved identity conflicts", () => {
  const discovery = { provider: "tabelog", url: "https://google.example/search", capability: { kind: "discovery", recommended: false } };
  const result = evaluateDecisionSafety(baseRestaurant({
    recommendation: "recommended",
    primaryAction: { label: "打开页面", url: discovery.url, type: "open_booking_source", provider: "tabelog" },
    reservationOptions: [discovery, bookingOption],
    risks: [{ field: "branch", severity: "high", resolvedByOfficial: false }]
  }));
  assert.ok(result.issues.includes("discovery_link_used_as_primary_action"));
  assert.ok(result.issues.includes("recommended_with_unresolved_identity_risk"));
  assert.ok(result.issues.includes("booking_primary_action_with_unresolved_identity_risk"));
});

test("primary action cannot claim that a reservation already succeeded", () => {
  const result = evaluateDecisionSafety(baseRestaurant({
    primaryAction: { label: "预约成功", url: "https://maps.example/demo", type: "map" }
  }));
  assert.ok(result.issues.includes("primary_action_claims_reservation_success"));
});

