export const ALLOWED_EVENTS = new Set([
  "input_submitted",
  "restaurant_identified",
  "candidate_confirmed",
  "candidate_rejected",
  "candidate_preview_requested",
  "candidate_preview_loaded",
  "analysis_completed",
  "primary_action_clicked",
  "booking_link_clicked",
  "phone_button_clicked",
  "share_result_clicked",
  "source_conflict_seen",
  "saved_to_list",
  "saved_plan_updated",
  "saved_plan_status_changed",
  "removed_from_list",
  "pending_queue_added",
  "pending_queue_opened",
  "pending_queue_removed",
  "pending_queue_completed",
  "local_data_deleted",
  "feedback_submitted",
  "feedback_helpful",
  "feedback_not_helpful",
  "app_visit"
]);

export function sanitizeEvent(body = {}, now = new Date()) {
  if (!ALLOWED_EVENTS.has(body.event)) return null;
  const willingnessToPay = allowedValue(body.willingnessToPay, ["consider", "depends_on_price", "would_not", "unsure"]);
  return {
    event: body.event,
    placeId: limitedString(body.placeId, 160),
    sourceMode: body.sourceMode === "live" ? "live" : "demo",
    trafficType: allowedValue(body.trafficType, ["product", "audit"]) || "product",
    analysisRunId: boundedRunId(body.analysisRunId),
    actionType: limitedString(body.actionType, 80),
    candidateCount: boundedInteger(body.candidateCount, 1, 3),
    selectedRank: boundedInteger(body.selectedRank, 1, 3),
    analysisDurationMs: boundedInteger(body.analysisDurationMs, 0, 300_000),
    cacheStatus: allowedValue(body.cacheStatus, ["miss", "hit", "coalesced"]),
    queueCount: boundedInteger(body.queueCount, 0, 30),
    inputType: allowedValue(body.inputType, ["screenshot", "text", "social_link", "webpage", "restaurant_name"]),
    planStatus: allowedValue(body.planStatus, ["needs_reservation", "reserved", "walk_in", "information_needed", "not_recommended"]),
    hasDate: body.hasDate === true,
    helpful: typeof body.helpful === "boolean" ? body.helpful : null,
    bookingOutcome: allowedValue(body.bookingOutcome, ["succeeded", "not_succeeded", "not_tried"]),
    accuracy: allowedValue(body.accuracy, ["accurate", "partly_wrong", "wrong"]),
    ...(willingnessToPay ? { willingnessToPay } : {}),
    feedbackText: limitedString(body.feedbackText, 500),
    visitType: allowedValue(body.visitType, ["first_open", "return_within_7d", "return_after_7d"]),
    occurredAt: now.toISOString()
  };
}

function boundedRunId(value) {
  const runId = limitedString(value, 80);
  return runId && /^[A-Za-z0-9_-]{8,80}$/.test(runId) ? runId : null;
}

function limitedString(value, maxLength) {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean ? clean.slice(0, maxLength) : null;
}

function allowedValue(value, allowed) {
  return allowed.includes(value) ? value : null;
}

function boundedInteger(value, minimum, maximum) {
  const number = Number(value);
  return Number.isInteger(number) && number >= minimum && number <= maximum ? number : null;
}
