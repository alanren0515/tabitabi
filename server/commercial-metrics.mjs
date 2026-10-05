import { COMMERCIAL_ENUMS, validateCommercialEvent } from "./commercial-event-schema.mjs";

const DAY = 86_400_000;
const RETENTION = 30 * DAY;
const MINIMUM_DEVICES = 5;
const id = (value) => typeof value === "string" ? value.toLowerCase() : "";
const uuid = (value) => /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id(value));
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const rate = (numerator, denominator) => denominator ? numerator / denominator : null;
const parent = (event) => event.analysisRunId || event.interactionId;

// Pure, offline aggregation of the commercial-store snapshot. Never returns join keys or identifiers.
export function summarizeCommercialMetrics(state, { now, releaseRevision } = {}) {
  const clock = now instanceof Date ? now.valueOf() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(clock)) throw new Error("COMMERCIAL_AS_OF_REQUIRED");
  if (!/^[a-f0-9]{40}$/.test(releaseRevision || "")) throw new Error("COMMERCIAL_REVISION_REQUIRED");
  if (state?.version !== 1 || !Array.isArray(state.events) || !Array.isArray(state.researchLinks)
    || !object(state.consents) || !object(state.flows)) throw new Error("INVALID_COMMERCIAL_SNAPSHOT");

  const exclusions = { invalidEvents: 0, duplicateEvents: 0, conflictingEventIds: 0, futureEvents: 0,
    outsideRetentionEvents: 0, otherRevisionEvents: 0, demoEvents: 0, auditEvents: 0,
    unknownEligibilityEvents: 0, invalidResearchLinks: 0, duplicateResearchLinks: 0,
    ambiguousResearchLinks: 0, unlinkedNaturalCompletions: 0 };
  const byId = new Map();
  const conflicts = new Set();
  for (const item of state.events) {
    const event = item?.record;
    if (!validateCommercialEvent(event).valid || !Number.isFinite(Date.parse(event.occurredAt))) {
      exclusions.invalidEvents++;
      continue;
    }
    const normalized = { ...event, eventId: id(event.eventId), sessionId: id(event.sessionId),
      ...(event.interactionId ? { interactionId: id(event.interactionId) } : {}),
      ...(event.batchId ? { batchId: id(event.batchId) } : {}) };
    const previous = byId.get(normalized.eventId);
    if (previous) {
      exclusions.duplicateEvents++;
      if (stable(previous) !== stable(normalized)) conflicts.add(normalized.eventId);
    } else byId.set(normalized.eventId, normalized);
  }
  exclusions.conflictingEventIds = conflicts.size;
  const records = [...byId.values()].filter((event) => !conflicts.has(event.eventId));
  // Reject the entire flow when any observed event is demo, audit, unknown, or another revision.
  const flowReasons = new Map();
  for (const event of records) {
    if (Date.parse(event.occurredAt) > clock) continue;
    const key = parent(event);
    if (!key) continue;
    const flow = state.flows[key];
    const reason = event.releaseRevision !== releaseRevision || (flow && flow.releaseRevision !== releaseRevision)
      ? "otherRevisionEvents" : event.sourceMode === "demo" || flow?.demo ? "demoEvents"
        : event.trafficType === "audit" || flow?.trafficType === "audit" ? "auditEvents"
          : event.sourceMode !== "live" || event.trafficType !== "product" || flow?.invalidSequence
            ? "unknownEligibilityEvents" : null;
    if (reason && (!flowReasons.has(key) || priority(reason) < priority(flowReasons.get(key)))) flowReasons.set(key, reason);
  }
  const eligible = records.filter((event) => {
    const time = Date.parse(event.occurredAt);
    const reason = time > clock ? "futureEvents" : time <= clock - RETENTION ? "outsideRetentionEvents"
      : flowReasons.get(parent(event)) || (event.releaseRevision !== releaseRevision ? "otherRevisionEvents"
        : event.sourceMode === "demo" ? "demoEvents" : event.trafficType === "audit" ? "auditEvents"
          : event.sourceMode !== "live" || event.trafficType !== "product" ? "unknownEligibilityEvents" : null);
    if (reason) exclusions[reason]++;
    return !reason;
  }).sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) || a.eventId.localeCompare(b.eventId));

  const links = new Map();
  const ambiguous = new Set();
  for (const link of state.researchLinks) {
    const event = byId.get(id(link?.eventId));
    const grant = state.consents[link?.grantKey];
    const granted = Date.parse(grant?.occurredAt);
    const expiry = Date.parse(grant?.expiresAt);
    const time = Date.parse(event?.occurredAt);
    if (!event || conflicts.has(event.eventId) || !uuid(link?.deviceId) || grant?.state !== "accepted"
      || grant.consentVersion !== "research-v1" || link.consentVersion !== grant.consentVersion
      || id(grant.deviceId) !== id(link.deviceId) || !Number.isFinite(granted) || expiry - granted !== RETENTION
      || clock >= expiry || granted > clock || time < granted || time >= expiry || time > clock
      || Date.parse(link.occurredAt) !== time || Date.parse(link.expiresAt) !== expiry) {
      exclusions.invalidResearchLinks++;
      continue;
    }
    const candidate = { device: id(link.deviceId), grantKey: link.grantKey, granted, expiry };
    const previous = links.get(event.eventId);
    if (previous) {
      exclusions.duplicateResearchLinks++;
      if (previous.device !== candidate.device || previous.grantKey !== candidate.grantKey) ambiguous.add(event.eventId);
    } else links.set(event.eventId, candidate);
  }
  exclusions.ambiguousResearchLinks = ambiguous.size;
  for (const key of ambiguous) links.delete(key);

  // A later reminder/task signal disqualifies the whole flow, including its earlier completion.
  const nonNaturalFlows = new Set(records.filter(event => Date.parse(event.occurredAt) <= clock
    && (event.researchSource !== "natural" || (state.flows[parent(event)]?.researchSource
      && state.flows[parent(event)].researchSource !== "natural"))).map(parent));
  const natural = eligible.filter((event) => event.researchSource === "natural" && !nonNaturalFlows.has(parent(event)));
  const completionEvents = uniqueEvents(natural, "analysis_completed", "analysisRunId");
  const linked = natural.filter((event) => links.has(event.eventId));
  const cohorts = new Map();
  for (const event of completionEvents) {
    const link = links.get(event.eventId);
    if (!link) { exclusions.unlinkedNaturalCompletions++; continue; }
    if (!cohorts.has(link.device)) cohorts.set(link.device, { event, link, mature: false, retained: false });
  }
  const r7Exclusions = { immatureDevices: 0, consentWindowIncompleteDevices: 0, before24hEvents: 0,
    after7dEvents: 0, sameSessionEvents: 0, sameAnalysisEvents: 0, initialBatchEvents: 0,
    nonRefreshReviewEvents: 0, differentGrantEvents: 0 };
  for (const cohort of cohorts.values()) {
    const anchor = Date.parse(cohort.event.occurredAt);
    if (cohort.link.expiry <= anchor + 7 * DAY) { r7Exclusions.consentWindowIncompleteDevices++; continue; }
    if (clock < anchor + 7 * DAY) { r7Exclusions.immatureDevices++; continue; }
    cohort.mature = true;
    for (const event of linked) {
      const link = links.get(event.eventId);
      if (link.device !== cohort.link.device || event.eventId === cohort.event.eventId
        || !["analysis_completed", "review_completed"].includes(event.event)) continue;
      const elapsed = Date.parse(event.occurredAt) - anchor;
      const anchorBatch = batch(cohort.event, state);
      const reason = link.grantKey !== cohort.link.grantKey ? "differentGrantEvents"
        : elapsed < DAY ? "before24hEvents" : elapsed > 7 * DAY ? "after7dEvents"
          : event.sessionId === cohort.event.sessionId ? "sameSessionEvents"
            : event.analysisRunId && event.analysisRunId === cohort.event.analysisRunId ? "sameAnalysisEvents"
              : anchorBatch && anchorBatch === batch(event, state) ? "initialBatchEvents"
                : event.event === "review_completed" && state.flows[event.interactionId]?.reviewIntent !== "saved_plan_refresh"
                  ? "nonRefreshReviewEvents" : null;
      if (reason) r7Exclusions[reason]++;
      else cohort.retained = true;
    }
  }
  const cohortList = [...cohorts.values()];
  const totalFunnel = funnel(eligible);
  const linkedInputs = new Set(eligible.filter((event) => event.event === "input_submitted" && links.has(event.eventId)).map((event) => event.analysisRunId));
  const slices = {};
  for (const dimension of ["channel", "researchSource", "inputType", "deviceCategory"]) {
    slices[dimension] = {};
    for (const value of [...new Set([...COMMERCIAL_ENUMS[dimension], "unknown"])]) {
      const events = eligible.filter((event) => (event[dimension] || "unknown") === value);
      const devices = new Set(events.flatMap((event) => links.has(event.eventId) ? [links.get(event.eventId).device] : []));
      slices[dimension][value] = devices.size < MINIMUM_DEVICES
        ? { suppressed: true, reason: "fewer_than_5_consented_devices" }
        : { suppressed: false, consentedDevices: devices.size, funnel: funnel(events),
          r7: r7(cohortList.filter((cohort) => (cohort.event[dimension] || "unknown") === value)) };
    }
  }
  return {
    schemaVersion: 1, asOf: new Date(clock).toISOString(), releaseRevision,
    evidenceType: "offline_snapshot", releaseGateEvidence: false, populationUnit: "anonymous_consented_device",
    funnel: totalFunnel, r7: { ...r7(cohortList), observedAnchorDevices: cohorts.size, exclusions: r7Exclusions },
    coverage: { eligibleEvents: eligible.length, researchLinkedEvents: eligible.filter((event) => links.has(event.eventId)).length,
      consentedDevices: new Set(eligible.flatMap((event) => links.has(event.eventId) ? [links.get(event.eventId).device] : [])).size,
      inputRuns: totalFunnel.inputRuns, researchLinkedInputRuns: linkedInputs.size,
      researchLinkedInputRunRate: rate(linkedInputs.size, totalFunnel.inputRuns),
      unknownResearchSourceEvents: eligible.filter((event) => event.researchSource === "unknown" || !COMMERCIAL_ENUMS.researchSource.includes(event.researchSource)).length,
      nonNaturalResearchSourceEvents: eligible.filter((event) => !["natural", "unknown"].includes(event.researchSource) && COMMERCIAL_ENUMS.researchSource.includes(event.researchSource)).length },
    exclusions, slices,
    definitions: { r7Window: "[24h, 7d] after first observed eligible analysis completion after consent; different session; new analysis or saved_plan_refresh; initial batch excluded",
      zeroDenominator: "null", sliceMinimumConsentedDevices: MINIMUM_DEVICES,
      funnelPopulation: "live product flows at target revision; research sources remain separate in slices",
      coverageUnit: "linked input runs / eligible input runs; not consent rate or unique people" },
    limitations: ["Consenting devices are not people; storage clearing and cross-device use change counts.",
      "R7 describes consenting devices only and cannot be extrapolated to all visitors.",
      "Only the retained 30-day snapshot is observable; the anchor is not lifetime first use.",
      "Revoked or expired grants and deleted joins cannot contribute, including historical as-of reports.",
      "No confirmed bookings, revenue, willingness-to-pay, or legacy return lower bound is inferred from v2 events.",
      "Small slices are suppressed; this internal report is not a customer publication or formal privacy guarantee."]
  };
}

function r7(cohorts) {
  const denominator = cohorts.filter((item) => item.mature).length;
  const numerator = cohorts.filter((item) => item.mature && item.retained).length;
  return { retainedDevices: numerator, matureDevices: denominator, rate: rate(numerator, denominator) };
}
function batch(event, state) { return id(state.flows[parent(event)]?.batchId || event.batchId); }
function uniqueEvents(events, name, key) {
  const found = new Map();
  for (const event of events) if (event.event === name && event[key] && !found.has(event[key])) found.set(event[key], event);
  return [...found.values()];
}
function funnel(events) {
  const inputs = new Set(uniqueEvents(events, "input_submitted", "analysisRunId").map((event) => event.analysisRunId));
  const completions = new Set(uniqueEvents(events, "analysis_completed", "analysisRunId").filter((event) => inputs.has(event.analysisRunId)).map((event) => event.analysisRunId));
  const actions = events.filter((event) => event.event === "primary_action_clicked" && completions.has(event.analysisRunId));
  const actionRuns = new Set(actions.map((event) => event.analysisRunId)).size;
  const bookingOutboundRuns = new Set(actions.filter((event) => ["direct_booking", "platform_booking"].includes(event.actionCapability)).map((event) => event.analysisRunId)).size;
  const count = (name) => uniqueEvents(events, name, "analysisRunId").filter((event) => inputs.has(event.analysisRunId)).length;
  return { inputRuns: inputs.size, startedRuns: count("analysis_started"), cluesExtractedRuns: count("clues_extracted"),
    candidatesShownRuns: count("candidates_shown"), candidateConfirmedRuns: count("candidate_confirmed"),
    completedRuns: completions.size, failedRuns: count("analysis_failed"), actionRuns, bookingOutboundRuns,
    savedPlanRuns: count("saved_plan_updated"), issueReportRuns: count("issue_reported"),
    reviewCompletedInteractions: uniqueEvents(events, "review_completed", "interactionId").length,
    reviewFailedInteractions: uniqueEvents(events, "review_failed", "interactionId").length,
    completionRate: rate(completions.size, inputs.size), actionRate: rate(actionRuns, completions.size),
    bookingOutboundRate: rate(bookingOutboundRuns, completions.size),
    actionCapabilityRuns: Object.fromEntries(COMMERCIAL_ENUMS.actionCapability.map((capability) => [capability,
      new Set(actions.filter((event) => event.actionCapability === capability).map((event) => event.analysisRunId)).size])) };
}
function priority(reason) { return ["otherRevisionEvents", "demoEvents", "auditEvents", "unknownEligibilityEvents"].indexOf(reason); }
function stable(value) { return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))); }
