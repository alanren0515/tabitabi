const id = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value);
const units = value => Number.isSafeInteger(value) && value > 0 && value <= 100_000;
const timestamp = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === (value.length === 20 ? value.replace("Z", ".000Z") : value);
const fail = code => { throw new Error(code); };

// Pure fixture-only reducer. Never attach this in-memory simulation to real purchased balances.
export function createShadowEntitlementState({ credits, at, expiresAt }) {
  if (!units(credits) || !timestamp(at) || !timestamp(expiresAt) || Date.parse(at) >= Date.parse(expiresAt)) fail("INVALID_SHADOW_ALLOWANCE");
  return { schemaVersion: 1, shadowOnly: true, realEntitlementsChanged: false, credits, at, expiresAt, operations: [] };
}

export function summarizeShadowEntitlements(state) {
  validate(state);
  const sum = status => state.operations.filter(operation => operation.status === status).reduce((total, operation) => total + operation.units, 0);
  const reserved = sum("reserved"), committed = sum("committed");
  const remaining = state.credits - reserved - committed;
  const active = Date.parse(state.at) < Date.parse(state.expiresAt);
  return { shadowOnly: true, realEntitlementsChanged: false, available: active ? remaining : 0, reserved, committed,
    released: sum("released"), expired: active ? 0 : remaining, expiredOperations: state.operations.filter(operation => operation.status === "expired").length,
    heldUnknownDeliveryOperations: state.operations.filter(operation => operation.status === "reserved" && Date.parse(operation.reservationExpiresAt) <= Date.parse(state.at)).length,
    operationCount: state.operations.length, realWorldEvidence: false, releaseGateEvidence: false };
}

export function transitionShadowEntitlements(state, event) {
  validate(state);
  if (!event || !["reserve", "commit", "release", "expire", "advance_time"].includes(event.type) || !timestamp(event.at)
    || Date.parse(event.at) < Date.parse(state.at)) fail("INVALID_SHADOW_EVENT");
  const next = structuredClone(state); next.at = event.at;
  if (event.type === "advance_time") return next;
  if (!id(event.operationId)) fail("INVALID_SHADOW_EVENT");
  const operation = next.operations.find(item => item.operationId === event.operationId);
  if (event.type === "reserve") {
    if (!units(event.units)) fail("INVALID_SHADOW_EVENT");
    if (operation) {
      if (operation.units !== event.units) fail("SHADOW_OPERATION_CONFLICT");
      return next; // Retrying even a released/expired operation cannot reserve or commit again.
    }
    if (!timestamp(event.reservationExpiresAt) || Date.parse(event.reservationExpiresAt) <= Date.parse(event.at)
      || Date.parse(event.reservationExpiresAt) > Date.parse(state.expiresAt)) fail("INVALID_SHADOW_RESERVATION_EXPIRY");
    if (Date.parse(event.at) >= Date.parse(state.expiresAt)) fail("SHADOW_ALLOWANCE_EXPIRED");
    if (summarizeShadowEntitlements(next).available < event.units) fail("SHADOW_INSUFFICIENT_AVAILABLE");
    next.operations.push({ operationId: event.operationId, units: event.units, status: "reserved", reservedAt: event.at,
      reservationExpiresAt: event.reservationExpiresAt, terminalAt: null });
    validate(next);
    return next;
  }
  if (!operation) fail("SHADOW_OPERATION_NOT_FOUND");
  const target = { commit: "committed", release: "released", expire: "expired" }[event.type];
  if (operation.status === target) return next;
  if (operation.status !== "reserved") fail("SHADOW_TERMINAL_OPERATION");
  if (event.type === "commit") {
    if (event.evidence?.delivery !== "delivered_reconciliation" || event.evidence?.terminal !== true
      || !["confirmed", "insufficient_information"].includes(event.evidence?.resultKind)) fail("SHADOW_DELIVERY_EVIDENCE_REQUIRED");
  } else {
    if (event.evidence?.delivery !== "not_delivered" || !["complete_failure", "never_dispatched"].includes(event.evidence?.outcome)) fail("SHADOW_NONDELIVERY_EVIDENCE_REQUIRED");
    if (event.type === "release" && event.evidence.outcome !== "complete_failure") fail("SHADOW_COMPLETE_FAILURE_REQUIRED");
    if (event.type === "expire" && Date.parse(event.at) < Date.parse(operation.reservationExpiresAt)) fail("SHADOW_RESERVATION_NOT_EXPIRED");
  }
  operation.status = target; operation.terminalAt = event.at;
  validate(next);
  return next;
}

function validate(state) {
  if (!state || state.schemaVersion !== 1 || state.shadowOnly !== true || state.realEntitlementsChanged !== false
    || !units(state.credits) || !timestamp(state.at) || !timestamp(state.expiresAt) || !Array.isArray(state.operations)
    || state.operations.length > 10_000) fail("INVALID_SHADOW_STATE");
  const seen = new Set(); let spent = 0;
  for (const operation of state.operations) {
    if (!operation || !id(operation.operationId) || seen.has(operation.operationId) || !units(operation.units)
      || !["reserved", "committed", "released", "expired"].includes(operation.status) || !timestamp(operation.reservedAt)
      || !timestamp(operation.reservationExpiresAt) || Date.parse(operation.reservedAt) >= Date.parse(operation.reservationExpiresAt)
      || Date.parse(operation.reservationExpiresAt) > Date.parse(state.expiresAt) || Date.parse(operation.reservedAt) > Date.parse(state.at)
      || (operation.status === "reserved" ? operation.terminalAt !== null : !timestamp(operation.terminalAt)
        || Date.parse(operation.terminalAt) < Date.parse(operation.reservedAt) || Date.parse(operation.terminalAt) > Date.parse(state.at))) fail("INVALID_SHADOW_STATE");
    seen.add(operation.operationId);
    if (["reserved", "committed"].includes(operation.status)) spent += operation.units;
  }
  if (spent > state.credits) fail("INVALID_SHADOW_STATE");
}
