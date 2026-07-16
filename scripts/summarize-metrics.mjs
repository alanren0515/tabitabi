import { readFile } from "node:fs/promises";
import { pilotEligibleLiveEvents, summarizePilotMetrics } from "../server/pilot-metrics.mjs";

const events = await readJsonLines("data/events.jsonl");
const sourceMetrics = await readJsonLines("data/source-metrics.jsonl");
const liveEvents = pilotEligibleLiveEvents(events);
const pilot = summarizePilotMetrics(events);
const eventCounts = countBy(liveEvents, (item) => item.event);
const feedback = uniqueRunEvents(liveEvents, "feedback_submitted");
const accurateFeedback = feedback.filter((item) => item.accuracy === "accurate").length;
const attemptedBookings = feedback.filter((item) => ["succeeded", "not_succeeded"].includes(item.bookingOutcome));
const successfulBookings = attemptedBookings.filter((item) => item.bookingOutcome === "succeeded").length;
const confirmedSelections = uniqueRunEvents(liveEvents, "candidate_confirmed").filter((item) => Number.isInteger(item.selectedRank));
const analysisLatencies = uniqueRunEvents(liveEvents, "analysis_completed")
  .map((item) => Number(item.analysisDurationMs))
  .filter((value) => Number.isFinite(value) && value >= 0)
  .sort((a, b) => a - b);
const previewRequests = liveEvents.filter((item) => item.event === "candidate_preview_requested");
const previewLoads = liveEvents.filter((item) => item.event === "candidate_preview_loaded");

const sourceSummary = Object.values(groupBy(sourceMetrics, (item) => `${item.source}:${item.operation}`)).map((records) => {
  const durations = records.map((record) => Number(record.durationMs)).filter(Number.isFinite).sort((a, b) => a - b);
  const inputTokens = finiteValues(records, "inputTokens");
  const outputTokens = finiteValues(records, "outputTokens");
  const totalTokens = finiteValues(records, "totalTokens");
  const imageTokens = finiteValues(records, "imageTokens");
  const cacheHits = records.filter((record) => record.cacheStatus === "hit").length;
  const coalescedRequests = records.filter((record) => record.cacheStatus === "coalesced").length;
  const upstreamCalls = records.filter((record) => !record.cacheStatus || record.cacheStatus === "miss").length;
  return {
    source: records[0].source,
    operation: records[0].operation,
    skuClass: records[0].skuClass,
    requests: records.length,
    upstreamCalls,
    cacheHits,
    coalescedRequests,
    successes: records.filter((record) => record.status === "success").length,
    errors: records.filter((record) => record.status === "error").length,
    fallbackAttempts: records.filter((record) => record.fallbackReason).length,
    averageDurationMs: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : null,
    p95DurationMs: percentile(durations, 0.95),
    averageInputTokens: average(inputTokens),
    averageOutputTokens: average(outputTokens),
    averageTotalTokens: average(totalTokens),
    averageImageTokens: average(imageTokens)
  };
});

console.log(JSON.stringify({
  funnel: {
    inputsSubmitted: pilot.inputRuns,
    restaurantsIdentified: pilot.identifiedRuns,
    identificationRate: pilot.identificationRate,
    candidateConfirmed: confirmedSelections.length,
    averageSelectedCandidateRank: confirmedSelections.length ? confirmedSelections.reduce((sum, item) => sum + item.selectedRank, 0) / confirmedSelections.length : null,
    analysesCompleted: pilot.completedRuns,
    analysisCompletionRate: pilot.analysisCompletionRate,
    liveAnalysisLatencySamples: analysisLatencies.length,
    averagePostConfirmationAnalysisMs: average(analysisLatencies),
    p95PostConfirmationAnalysisMs: percentile(analysisLatencies, 0.95),
    analysisUnder30SecondsRate: analysisLatencies.length ? analysisLatencies.filter((value) => value < 30_000).length / analysisLatencies.length : null,
    candidatePreviewRequested: previewRequests.length,
    candidatePreviewLoaded: previewLoads.length,
    candidatePreviewLoadRate: previewRequests.length ? previewLoads.length / previewRequests.length : null,
    candidatePreviewCacheHits: previewLoads.filter((item) => item.cacheStatus === "hit").length,
    primaryActionsClicked: pilot.actionRuns,
    actionRate: pilot.actionRate,
    bookingLinksClicked: eventCounts.booking_link_clicked || 0,
    phoneButtonsClicked: eventCounts.phone_button_clicked || 0,
    phoneScriptsCopied: eventCounts.phone_script_copied || 0,
    resultsShared: eventCounts.share_result_clicked || 0,
    sourceConflictsSeen: eventCounts.source_conflict_seen || 0,
    savedToList: pilot.savedRuns,
    saveRate: pilot.saveRate,
    feedbackSubmitted: pilot.feedbackRuns,
    helpfulRate: pilot.helpfulRate,
    willingnessToPayResponses: pilot.willingnessToPayResponses,
    willingnessToPayDistribution: pilot.willingnessToPayDistribution,
    accurateRate: feedback.length ? accurateFeedback / feedback.length : null,
    bookingSuccessRateAmongAttempts: attemptedBookings.length ? successfulBookings / attemptedBookings.length : null,
    feedbackHelpful: eventCounts.feedback_helpful || 0,
    feedbackNotHelpful: eventCounts.feedback_not_helpful || 0,
    excludedAuditEvents: pilot.excludedAuditEvents,
    excludedLegacyEvents: pilot.excludedLegacyEvents,
    excludedDemoRuns: pilot.excludedDemoRuns
  },
  sources: sourceSummary,
  note: "内部指标不包含截图或识别文字；token 与费用核对仍应以各供应商账单为准。"
}, null, 2));

async function readJsonLines(path) {
  try {
    const content = await readFile(path, "utf8");
    return content.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function countBy(items, keyFn) {
  return items.reduce((counts, item) => {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function uniqueRunEvents(items, eventName) {
  const byRun = new Map();
  for (const item of items) {
    if (item.event !== eventName || !item.analysisRunId || byRun.has(item.analysisRunId)) continue;
    byRun.set(item.analysisRunId, item);
  }
  return [...byRun.values()];
}

function groupBy(items, keyFn) {
  return items.reduce((groups, item) => {
    const key = keyFn(item);
    (groups[key] ||= []).push(item);
    return groups;
  }, {});
}

function percentile(values, ratio) {
  if (!values.length) return null;
  return values[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)];
}

function finiteValues(records, field) {
  return records
    .map((record) => record[field])
    .filter((value) => value !== null && value !== undefined && value !== "")
    .map(Number)
    .filter((value) => Number.isFinite(value) && value >= 0);
}

function average(values) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}
