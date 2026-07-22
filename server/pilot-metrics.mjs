export const DEFAULT_PILOT_THRESHOLDS = Object.freeze({
  minimumInputRuns: 20,
  minimumFeedbackRuns: 10,
  analysisCompletionRate: 0.8,
  actionRate: 0.35,
  helpfulRate: 0.6
});

export function summarizePilotMetrics(events = [], { releaseRevision = "" } = {}) {
  const targetRevision = normalizeReleaseRevision(releaseRevision);
  const scopedEvents = targetRevision ? events.filter((item) => item?.releaseRevision === targetRevision) : events;
  const product = scopedEvents.filter((item) => item?.trafficType === "product");
  const demoRunIds = new Set(product.filter((item) => item?.analysisRunId && item?.sourceMode === "demo").map((item) => item.analysisRunId));
  const live = pilotEligibleLiveEvents(scopedEvents);
  const inputRuns = runIds(live, "input_submitted");
  const identifiedRuns = runIds(live, "restaurant_identified");
  const completedRuns = runIds(live, "analysis_completed");
  const actionRuns = runIds(live, "primary_action_clicked");
  const savedRuns = runIds(live, "saved_to_list");
  const feedbackByRun = uniqueRunEvents(live, "feedback_submitted");
  const helpfulRuns = feedbackByRun.filter((item) => item.helpful === true).length;
  const willingnessToPayDistribution = countWillingness(feedbackByRun);
  const identifiedInputRunIds = intersection(identifiedRuns, inputRuns);
  const completedInputRunIds = intersection(completedRuns, inputRuns);
  const actionCompletedRuns = intersectionSize(actionRuns, completedInputRunIds);
  const savedCompletedRuns = intersectionSize(savedRuns, completedInputRunIds);
  const firstOpens = product.filter((item) => item.event === "app_visit" && item.visitType === "first_open").length;
  const returnsWithin7Days = product.filter((item) => item.event === "app_visit" && item.visitType === "return_within_7d").length;

  return {
    inputRuns: inputRuns.size,
    identifiedRuns: identifiedInputRunIds.size,
    completedRuns: completedInputRunIds.size,
    actionRuns: actionCompletedRuns,
    savedRuns: savedCompletedRuns,
    feedbackRuns: feedbackByRun.length,
    helpfulRuns,
    willingnessToPayResponses: Object.values(willingnessToPayDistribution).reduce((sum, value) => sum + value, 0),
    willingnessToPayDistribution,
    analysisCompletionRate: rate(completedInputRunIds.size, inputRuns.size),
    identificationRate: rate(identifiedInputRunIds.size, inputRuns.size),
    actionRate: rate(actionCompletedRuns, completedInputRunIds.size),
    saveRate: rate(savedCompletedRuns, completedInputRunIds.size),
    helpfulRate: rate(helpfulRuns, feedbackByRun.length),
    firstOpens,
    returnsWithin7Days,
    sevenDayReturnLowerBound: rate(returnsWithin7Days, firstOpens),
    releaseRevision: targetRevision || null,
    excludedPreviousReleaseEvents: targetRevision ? events.length - scopedEvents.length : 0,
    excludedAuditEvents: scopedEvents.filter((item) => item?.trafficType === "audit").length,
    excludedLegacyEvents: scopedEvents.filter((item) => !["product", "audit"].includes(item?.trafficType)).length,
    excludedDemoRuns: demoRunIds.size
  };
}

function normalizeReleaseRevision(value) {
  const revision = String(value || "").trim().toLowerCase();
  return /^[a-f0-9]{40}$/.test(revision) ? revision : "";
}

function countWillingness(events) {
  const distribution = { consider: 0, depends_on_price: 0, would_not: 0, unsure: 0 };
  for (const event of events) if (Object.hasOwn(distribution, event.willingnessToPay)) distribution[event.willingnessToPay] += 1;
  return distribution;
}

export function pilotEligibleLiveEvents(events = []) {
  const product = events.filter((item) => item?.trafficType === "product");
  const demoRunIds = new Set(product.filter((item) => item?.analysisRunId && item?.sourceMode === "demo").map((item) => item.analysisRunId));
  return product.filter((item) => item?.sourceMode === "live" && (!item.analysisRunId || !demoRunIds.has(item.analysisRunId)));
}

export function evaluatePilotGate(metrics, thresholds = DEFAULT_PILOT_THRESHOLDS) {
  const gates = {
    inputSample: metrics.inputRuns >= thresholds.minimumInputRuns,
    feedbackSample: metrics.feedbackRuns >= thresholds.minimumFeedbackRuns,
    analysisCompletion: metrics.analysisCompletionRate !== null && metrics.analysisCompletionRate >= thresholds.analysisCompletionRate,
    actionRate: metrics.actionRate !== null && metrics.actionRate >= thresholds.actionRate,
    helpfulRate: metrics.helpfulRate !== null && metrics.helpfulRate >= thresholds.helpfulRate
  };
  return {
    gatePassed: Object.values(gates).every(Boolean),
    gates,
    blockedBy: Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name),
    thresholds
  };
}

function runIds(events, eventName) {
  return new Set(events.filter((item) => item.event === eventName && item.analysisRunId).map((item) => item.analysisRunId));
}

function uniqueRunEvents(events, eventName) {
  const byRun = new Map();
  for (const event of events) {
    if (event.event === eventName && event.analysisRunId && !byRun.has(event.analysisRunId)) byRun.set(event.analysisRunId, event);
  }
  return [...byRun.values()];
}

function intersectionSize(left, right) {
  let total = 0;
  for (const value of left) if (right.has(value)) total += 1;
  return total;
}

function intersection(left, right) {
  return new Set([...left].filter((value) => right.has(value)));
}

function rate(value, total) {
  return total ? value / total : null;
}
