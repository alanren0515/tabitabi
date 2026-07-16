const ALLOWED_RECOMMENDATIONS = new Set([
  "recommended",
  "walk_in_ok",
  "temporarily_unavailable",
  "unknown"
]);

const BOOKING_FLOW_KINDS = new Set([
  "online_reservation_flow",
  "provider_booking_flow"
]);

const SAFE_UNAVAILABLE_ACTION_TYPES = new Set(["map", "official_website"]);
const IDENTITY_FIELDS = new Set(["address", "name", "branch"]);
const SUCCESS_CLAIM_PATTERN = /(?:预约|予約|booking|reservation).{0,8}(?:成功|成立|完成|confirmed|complete)|(?:成功|成立|confirmed).{0,8}(?:预约|予約|booking|reservation)/iu;

export function evaluateDecisionSafety(restaurant = {}) {
  const issues = [];
  const options = Array.isArray(restaurant.reservationOptions) ? restaurant.reservationOptions : [];
  const facts = Array.isArray(restaurant.evidenceFacts) ? restaurant.evidenceFacts : [];
  const risks = Array.isArray(restaurant.risks) ? restaurant.risks : [];
  const evidence = Array.isArray(restaurant.decisionEvidence) ? restaurant.decisionEvidence : [];
  const primaryAction = restaurant.primaryAction || null;
  const recommendation = restaurant.recommendation;

  if (!ALLOWED_RECOMMENDATIONS.has(recommendation)) {
    issues.push("unsupported_recommendation");
  }
  if (!evidence.length) {
    issues.push("missing_decision_evidence");
  }

  const recommendedBookingOptions = options.filter((option) =>
    BOOKING_FLOW_KINDS.has(option?.capability?.kind) && option?.capability?.recommended !== false
  );
  if (recommendation === "recommended" && !recommendedBookingOptions.length) {
    issues.push("recommended_without_verified_booking_flow");
  }

  if (recommendation === "walk_in_ok") {
    const officialNoReservationFact = facts.some((fact) =>
      fact?.field === "reservation_policy"
      && fact?.value === "not_accepted"
      && fact?.sourceType === "official_website"
      && fact?.confidence === "high"
    );
    if (!officialNoReservationFact) issues.push("walk_in_without_official_no_reservation_evidence");
  }

  const unresolvedIdentityRisk = risks.some((risk) =>
    risk?.severity === "high"
    && !risk?.resolvedByOfficial
    && IDENTITY_FIELDS.has(risk?.field)
  );
  if (unresolvedIdentityRisk && recommendation === "recommended") {
    issues.push("recommended_with_unresolved_identity_risk");
  }

  const primaryOption = findPrimaryOption(options, primaryAction);
  if (primaryOption?.capability?.kind === "discovery") {
    issues.push("discovery_link_used_as_primary_action");
  }
  if (unresolvedIdentityRisk && isBookingAction(primaryAction, primaryOption)) {
    issues.push("booking_primary_action_with_unresolved_identity_risk");
  }

  if (recommendation === "temporarily_unavailable") {
    if (!primaryAction || !SAFE_UNAVAILABLE_ACTION_TYPES.has(primaryAction.type)) {
      issues.push("unavailable_without_safe_status_check_action");
    }
    if (isBookingAction(primaryAction, primaryOption)) {
      issues.push("unavailable_with_booking_primary_action");
    }
  }

  if (SUCCESS_CLAIM_PATTERN.test(String(primaryAction?.label || ""))) {
    issues.push("primary_action_claims_reservation_success");
  }

  return {
    passed: issues.length === 0,
    issues,
    recommendation: recommendation || null,
    primaryActionType: primaryAction?.type || null,
    primaryActionProvider: primaryAction?.provider || null,
    evidenceCount: evidence.length,
    unresolvedIdentityRisk
  };
}

function findPrimaryOption(options, primaryAction) {
  if (!primaryAction) return null;
  return options.find((option) =>
    (primaryAction.url && option?.url === primaryAction.url)
    || (primaryAction.provider && option?.provider === primaryAction.provider)
  ) || null;
}

function isBookingAction(primaryAction, primaryOption) {
  return Boolean(
    BOOKING_FLOW_KINDS.has(primaryOption?.capability?.kind)
    || ["reservation", "open_booking_source"].includes(primaryAction?.type)
  );
}

