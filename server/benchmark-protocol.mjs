export const BENCHMARK_ROUTES = Object.freeze(["baseline", "candidate", "primaryReference"]);
export const BENCHMARK_TERMINALS = Object.freeze([
  "correct_action", "justified_unknown", "incorrect_unknown", "wrong_branch",
  "unsafe_action", "wrong_action", "abandoned", "timed_out"
]);

const VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const CODE = /^[A-Za-z][A-Za-z0-9_-]{2,63}$/;
const REVISION = /^[a-f0-9]{40}$/;
const PARTICIPANT = /^P-[A-Za-z0-9_-]{3,32}$/;
const REVIEWER = /^R-[A-Za-z0-9_-]{3,32}$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export function benchmarkTime(value) {
  if (typeof value !== "string" || !ISO_TIME.test(value)) return null;
  const time = Date.parse(value);
  const canonical = value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction || "").padEnd(3, "0")}Z`);
  return Number.isFinite(time) && new Date(time).toISOString() === canonical ? time : null;
}

const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => typeof value === "string" && value.trim().length > 0 && value.length <= 2000;
const identifier = (value, pattern = VERSION) => typeof value === "string" && pattern.test(value);
const relativePath = (value) => text(value) && !value.startsWith("/") && !value.split(/[\\/]/).includes("..") && !/[\r\n\0]/.test(value);
const integer = (value, minimum = 0) => Number.isInteger(value) && value >= minimum;
const issue = (errors, code, path) => errors.push({ code, path });
const same = (left, right) => left === right;
const evidenceClass = (studyMode) => studyMode === "real" ? "human_study" : "synthetic_fixture";

// Errors contain fixed codes and structural paths only. Never interpolate input values.
export function validateBenchmarkProtocol(protocol, { studyMode = "synthetic" } = {}) {
  const errors = [];
  if (!object(protocol)) return { valid: false, errors: [{ code: "missing_protocol", path: "protocol" }] };
  for (const field of ["protocolVersion", "groundTruthVersion"]) {
    if (!identifier(protocol[field])) issue(errors, "invalid_version", `protocol.${field}`);
  }
  for (const field of ["baselineRevision", "candidateRevision"]) {
    if (!identifier(protocol[field], REVISION)) issue(errors, "invalid_revision", `protocol.${field}`);
  }
  if (protocol.baselineRevision === protocol.candidateRevision) issue(errors, "identical_product_revisions", "protocol.candidateRevision");
  if (protocol.status !== "frozen" || benchmarkTime(protocol.frozenAt) === null) issue(errors, "protocol_not_frozen", "protocol.frozenAt");
  if (protocol.evidenceClass !== evidenceClass(studyMode)) issue(errors, "evidence_class_mismatch", "protocol.evidenceClass");
  if (!text(protocol.taskGoal)) issue(errors, "missing_task_goal", "protocol.taskGoal");
  if (!integer(protocol.timeCapSeconds, 1) || protocol.timeCapSeconds > 3600) issue(errors, "invalid_time_cap", "protocol.timeCapSeconds");
  if (protocol.timingScope !== "task_display_and_input_to_terminal") issue(errors, "invalid_timing_scope", "protocol.timingScope");

  const window = protocol.studyWindow;
  if (!object(window) || benchmarkTime(window.startsAt) === null || benchmarkTime(window.endsAt) === null
    || benchmarkTime(window.startsAt) < benchmarkTime(protocol.frozenAt)
    || benchmarkTime(window.endsAt) <= benchmarkTime(window.startsAt)) {
    issue(errors, "invalid_study_window", "protocol.studyWindow");
  }
  const reference = protocol.primaryReference;
  if (!object(reference) || !identifier(reference.referenceCode, CODE) || !identifier(reference.revision)
    || !Array.isArray(reference.operationPath) || reference.operationPath.length < 1
    || reference.operationPath.some((step) => !text(step))) {
    issue(errors, "invalid_primary_reference", "protocol.primaryReference");
  }
  // A single object is the only primary arm. Secondary arms cannot replace it.
  if (Array.isArray(protocol.primaryReferences)) issue(errors, "multiple_primary_references", "protocol.primaryReferences");
  const mix = protocol.caseMix;
  if (!object(mix) || !integer(mix.normal, 1) || !integer(mix.hard, 1)) issue(errors, "invalid_frozen_case_mix", "protocol.caseMix");
  if (!Array.isArray(protocol.caseRoster) || !protocol.caseRoster.length
    || protocol.caseRoster.some((code) => !identifier(code, CODE))
    || new Set(protocol.caseRoster).size !== protocol.caseRoster.length) issue(errors, "invalid_frozen_case_roster", "protocol.caseRoster");
  const rubric = protocol.rubric;
  if (!object(rubric) || !identifier(rubric.version) || !text(rubric.unsafeActionDefinition)
    || !Array.isArray(rubric.criticalErrors) || rubric.criticalErrors.length !== 2
    || !rubric.criticalErrors.includes("wrong_branch") || !rubric.criticalErrors.includes("unsafe_action")) {
    issue(errors, "invalid_critical_error_rubric", "protocol.rubric");
  }
  if (!object(protocol.assignmentDesign) || protocol.assignmentDesign.type !== "distinct_participants_per_case"
    || protocol.assignmentDesign.routeOrderBalanced !== true || !text(protocol.assignmentDesign.description)) {
    issue(errors, "missing_assignment_design", "protocol.assignmentDesign");
  }
  const participants = Array.isArray(protocol.targetParticipants) ? protocol.targetParticipants : [];
  const participantCodes = new Set();
  if (!participants.length) issue(errors, "missing_target_participants", "protocol.targetParticipants");
  for (const [index, participant] of participants.entries()) {
    if (!object(participant) || !identifier(participant.participantCode, PARTICIPANT) || participant.targetPopulationConfirmed !== true) {
      issue(errors, "invalid_target_participant", `protocol.targetParticipants[${index}]`);
    }
    if (participantCodes.has(participant?.participantCode)) issue(errors, "duplicate_participant", `protocol.targetParticipants[${index}]`);
    participantCodes.add(participant?.participantCode);
  }
  const devices = Array.isArray(protocol.deviceAvailability) ? protocol.deviceAvailability : [];
  const deviceCodes = new Set();
  if (!devices.length) issue(errors, "missing_device_availability", "protocol.deviceAvailability");
  for (const [index, device] of devices.entries()) {
    if (!object(device) || !identifier(device.deviceCode, CODE) || !identifier(device.platform)
      || !identifier(device.region) || benchmarkTime(device.verifiedAt) === null
      || benchmarkTime(device.verifiedAt) > benchmarkTime(protocol.frozenAt)
      || BENCHMARK_ROUTES.some((route) => device.routes?.[route] !== true)) {
      issue(errors, "invalid_device_availability", `protocol.deviceAvailability[${index}]`);
    }
    if (deviceCodes.has(device?.deviceCode)) issue(errors, "duplicate_device", `protocol.deviceAvailability[${index}]`);
    deviceCodes.add(device?.deviceCode);
  }
  const retention = protocol.retention;
  if (!object(retention) || !integer(retention.rawDays, 1) || retention.rawDays > 30
    || !integer(retention.anonymousSummaryDays, 1) || retention.anonymousSummaryDays > 90
    || retention.storageScope !== "controlled_research" || !identifier(retention.rawLocationRef, CODE)
    || !identifier(retention.summaryLocationRef, CODE) || retention.expiryEnforcement !== "manual_review"
    || retention.noProductEventLogging !== true) {
    issue(errors, "invalid_controlled_retention", "protocol.retention");
  }
  const snapshot = protocol.baselineSnapshot;
  if (!object(snapshot) || !identifier(snapshot.revision, REVISION) || snapshot.revision !== protocol.baselineRevision
    || !relativePath(snapshot.archivePath) || !identifier(snapshot.archiveSha256, /^[a-f0-9]{64}$/)
    || benchmarkTime(snapshot.createdAt) === null || benchmarkTime(snapshot.createdAt) > benchmarkTime(protocol.frozenAt)
    || !text(snapshot.nodeVersion) || !relativePath(snapshot.configurationFixturePath) || !text(snapshot.replayCommand)) {
    issue(errors, "invalid_baseline_snapshot", "protocol.baselineSnapshot");
  }
  return { valid: errors.length === 0, errors };
}

export function validateGroundTruth(truth, protocol, { studyMode = "synthetic", path = "groundTruth" } = {}) {
  const errors = [];
  if (!object(truth)) return { valid: false, excluded: true, errors: [{ code: "invalid_ground_truth", path }] };
  if (!identifier(truth.caseId, CODE)) issue(errors, "invalid_case_code", `${path}.caseId`);
  if (truth.groundTruthVersion !== protocol?.groundTruthVersion) issue(errors, "mixed_ground_truth_versions", `${path}.groundTruthVersion`);
  if (truth.evidenceClass !== evidenceClass(studyMode)) issue(errors, "evidence_class_mismatch", `${path}.evidenceClass`);
  if (!["normal", "hard"].includes(truth.stratum)) issue(errors, "invalid_stratum", `${path}.stratum`);
  if (truth.status === "invalid_truth") {
    if (!text(truth.invalidReason)) issue(errors, "missing_invalid_truth_reason", `${path}.invalidReason`);
    return { valid: errors.length === 0, excluded: true, errors };
  }
  if (truth.status !== "confirmed") issue(errors, "unconfirmed_ground_truth", `${path}.status`);
  if (!["actionable", "unknown_required"].includes(truth.expectation)) issue(errors, "invalid_truth_expectation", `${path}.expectation`);
  if (!object(truth.restaurant) || !identifier(truth.restaurant.restaurantId, CODE) || !identifier(truth.restaurant.branchId, CODE)) {
    issue(errors, "missing_restaurant_identity", `${path}.restaurant`);
  }
  if (!["text", "screenshot", "url"].includes(truth.entryType)) issue(errors, "invalid_entry_type", `${path}.entryType`);
  if (!identifier(truth.expectedAction, CODE)) issue(errors, "missing_expected_action", `${path}.expectedAction`);
  if (truth.expectation === "unknown_required" && truth.expectedAction !== "unknown") issue(errors, "invalid_unknown_truth_action", `${path}.expectedAction`);
  if (truth.expectation === "actionable" && truth.expectedAction === "unknown") issue(errors, "invalid_actionable_truth_action", `${path}.expectedAction`);
  const verification = truth.verification;
  if (!object(verification) || verification.method !== (studyMode === "real" ? "human" : "synthetic")
    || !identifier(verification.reviewerCode, REVIEWER) || benchmarkTime(verification.confirmedAt) === null
    || benchmarkTime(verification.confirmedAt) > benchmarkTime(protocol?.frozenAt)
    || !Array.isArray(verification.sources) || verification.sources.length === 0
    || verification.sources.some((source) => !object(source) || !identifier(source.referenceCode, CODE)
      || !["official", "booking_platform", "human_confirmation", "synthetic"].includes(source.kind)
      || (studyMode === "real" && source.kind === "synthetic") || benchmarkTime(source.checkedAt) === null
      || (studyMode === "real" && !text(source.evidenceRef))
      || benchmarkTime(source.checkedAt) > benchmarkTime(verification.confirmedAt))) {
    issue(errors, "missing_truth_verification", `${path}.verification`);
  }
  if (benchmarkTime(truth.validFrom) === null || benchmarkTime(truth.validUntil) === null
    || benchmarkTime(truth.validUntil) <= benchmarkTime(truth.validFrom)
    || benchmarkTime(truth.validFrom) > benchmarkTime(protocol?.studyWindow?.startsAt)
    || benchmarkTime(truth.validUntil) < benchmarkTime(protocol?.studyWindow?.endsAt)) {
    issue(errors, "invalid_truth_validity_window", `${path}.validUntil`);
  }
  return { valid: errors.length === 0, excluded: errors.length > 0, errors };
}

export function benchmarkRouteRevision(protocol, route) {
  if (route === "baseline") return protocol?.baselineRevision;
  if (route === "candidate") return protocol?.candidateRevision;
  if (route === "primaryReference") return protocol?.primaryReference?.revision;
  return null;
}

export function validateAttempt(attempt, protocol, truth, { studyMode = "synthetic", path = "attempt" } = {}) {
  const errors = [];
  if (!object(attempt)) return { valid: false, durationSeconds: null, errors: [{ code: "invalid_attempt", path }] };
  if (!identifier(attempt.attemptId, CODE)) issue(errors, "invalid_attempt_code", `${path}.attemptId`);
  if (!object(truth) || !identifier(attempt.caseId, CODE) || !same(attempt.caseId, truth.caseId)) issue(errors, "unknown_case", `${path}.caseId`);
  if (!BENCHMARK_ROUTES.includes(attempt.route)) issue(errors, "invalid_route", `${path}.route`);
  if (attempt.revision !== benchmarkRouteRevision(protocol, attempt.route)) issue(errors, "mixed_route_revisions", `${path}.revision`);
  if (attempt.protocolVersion !== protocol?.protocolVersion) issue(errors, "mixed_protocol_versions", `${path}.protocolVersion`);
  if (attempt.groundTruthVersion !== protocol?.groundTruthVersion) issue(errors, "mixed_ground_truth_versions", `${path}.groundTruthVersion`);
  if (attempt.rubricVersion !== protocol?.rubric?.version) issue(errors, "mixed_rubric_versions", `${path}.rubricVersion`);
  if (attempt.evidenceClass !== evidenceClass(studyMode)) issue(errors, "evidence_class_mismatch", `${path}.evidenceClass`);
  if (!identifier(attempt.participantCode, PARTICIPANT)
    || !(Array.isArray(protocol?.targetParticipants) && protocol.targetParticipants.some((participant) => participant?.participantCode === attempt.participantCode && participant.targetPopulationConfirmed === true))) {
    issue(errors, "invalid_participant_code", `${path}.participantCode`);
  }
  if (!identifier(attempt.reviewerCode, REVIEWER) || !text(attempt.reviewReason) || attempt.reviewStatus !== "confirmed") {
    issue(errors, "missing_human_review", `${path}.reviewReason`);
  }
  if (!BENCHMARK_TERMINALS.includes(attempt.terminal)) issue(errors, "invalid_terminal", `${path}.terminal`);
  const device = Array.isArray(protocol?.deviceAvailability) ? protocol.deviceAvailability.find((item) => item?.deviceCode === attempt.deviceCode) : null;
  if (!device || device.region !== attempt.region || device.routes?.[attempt.route] !== true) issue(errors, "unavailable_device_or_region", `${path}.deviceCode`);
  if (!integer(attempt.assignmentOrder, 1)) issue(errors, "missing_assignment_order", `${path}.assignmentOrder`);
  if (!["available", "failed_after_assignment"].includes(attempt.routeAvailability)) issue(errors, "missing_route_availability", `${path}.routeAvailability`);
  if (attempt.routeAvailability === "failed_after_assignment" && !["abandoned", "timed_out", "incorrect_unknown"].includes(attempt.terminal)) {
    issue(errors, "failure_marked_success", `${path}.terminal`);
  }
  if (attempt.timingScope !== "task_display_and_input_to_terminal") issue(errors, "invalid_timing_scope", `${path}.timingScope`);
  const start = benchmarkTime(attempt.startedAt);
  const end = benchmarkTime(attempt.endedAt);
  let durationSeconds = null;
  if (start === null || end === null || end <= start) issue(errors, "missing_or_invalid_time", `${path}.endedAt`);
  else {
    durationSeconds = (end - start) / 1000;
    if (start < benchmarkTime(protocol?.frozenAt) || start < benchmarkTime(protocol?.studyWindow?.startsAt)
      || end > benchmarkTime(protocol?.studyWindow?.endsAt) || start < benchmarkTime(truth?.validFrom) || end > benchmarkTime(truth?.validUntil)) {
      issue(errors, "attempt_outside_frozen_window", `${path}.startedAt`);
    }
    if (durationSeconds > protocol?.timeCapSeconds || (attempt.terminal === "timed_out" && durationSeconds !== protocol?.timeCapSeconds)) {
      issue(errors, "time_cap_mismatch", `${path}.endedAt`);
    }
  }
  if (attempt.terminal === "correct_action" && (truth?.expectation !== "actionable"
    || attempt.selectedBranchId !== truth?.restaurant?.branchId || attempt.selectedAction !== truth?.expectedAction
    || attempt.branchConfirmed !== true || attempt.actionUnderstood !== true)) {
    issue(errors, "correct_action_not_supported", `${path}.terminal`);
  }
  if (attempt.terminal === "justified_unknown" && (truth?.expectation !== "unknown_required" || attempt.actionUnderstood !== true
    || attempt.selectedAction !== "unknown" || (attempt.selectedBranchId != null && attempt.selectedBranchId !== truth?.restaurant?.branchId))) {
    issue(errors, "justified_unknown_not_supported", `${path}.terminal`);
  }
  return { valid: errors.length === 0, durationSeconds, errors };
}

export function inspectBenchmark(study) {
  const errors = [];
  if (!object(study)) return { protocol: {}, studyMode: null, truths: [], attempts: [], errors: [{ code: "invalid_study", path: "study" }] };
  const studyMode = study.studyMode;
  if (!["synthetic", "real"].includes(studyMode)) issue(errors, "invalid_study_mode", "studyMode");
  const protocol = object(study.protocol) ? study.protocol : {};
  errors.push(...validateBenchmarkProtocol(study.protocol, { studyMode }).errors);
  if (!Array.isArray(study.groundTruth)) issue(errors, "missing_ground_truth", "groundTruth");
  if (!Array.isArray(study.attempts)) issue(errors, "missing_attempts", "attempts");
  const truths = (Array.isArray(study.groundTruth) ? study.groundTruth : []).map((value, index) => ({
    value: object(value) ? value : {}, index,
    validation: validateGroundTruth(value, protocol, { studyMode, path: `groundTruth[${index}]` })
  }));
  const truthBuckets = new Map();
  for (const truth of truths) {
    const bucket = truthBuckets.get(truth.value.caseId) || [];
    bucket.push(truth);
    truthBuckets.set(truth.value.caseId, bucket);
    errors.push(...truth.validation.errors);
  }
  for (const bucket of truthBuckets.values()) {
    if (bucket.length > 1) {
      for (const truth of bucket) {
        truth.validation.valid = false;
        truth.validation.excluded = true;
        issue(errors, "duplicate_ground_truth", `groundTruth[${truth.index}]`);
      }
    }
  }
  const attempts = (Array.isArray(study.attempts) ? study.attempts : []).map((value, index) => {
    const attempt = object(value) ? value : {};
    const bucket = truthBuckets.get(attempt.caseId) || [];
    const truth = bucket[0];
    const excluded = Boolean(truth?.validation.excluded);
    const validation = excluded ? { valid: false, durationSeconds: null, errors: [] }
      : validateAttempt(value, protocol, truth?.value, { studyMode, path: `attempts[${index}]` });
    errors.push(...validation.errors);
    return { value: attempt, index, truth, excluded, validation };
  });
  const ids = new Map();
  const pairs = new Map();
  for (const attempt of attempts) {
    const idBucket = ids.get(attempt.value.attemptId) || [];
    idBucket.push(attempt);
    ids.set(attempt.value.attemptId, idBucket);
    if (!attempt.excluded && attempt.truth && BENCHMARK_ROUTES.includes(attempt.value.route)) {
      const key = JSON.stringify([attempt.value.caseId, attempt.value.route]);
      const pair = pairs.get(key) || [];
      pair.push(attempt);
      pairs.set(key, pair);
    }
  }
  for (const [buckets, code] of [[ids, "duplicate_attempt_id"], [pairs, "duplicate_case_route"]]) {
    for (const bucket of buckets.values()) if (bucket.length > 1) for (const attempt of bucket) {
      attempt.validation.valid = false;
      if (!attempt.excluded) issue(errors, code, `attempts[${attempt.index}]`);
    }
  }
  const effectiveTruths = [...truthBuckets.values()].map((bucket) => bucket[0]).filter(Boolean);
  const roster = Array.isArray(protocol.caseRoster) ? protocol.caseRoster : [];
  if (roster.length !== effectiveTruths.length || effectiveTruths.some((truth) => !roster.includes(truth.value.caseId))) {
    issue(errors, "frozen_case_roster_mismatch", "groundTruth");
  }
  for (const truth of effectiveTruths.filter((item) => !item.validation.excluded)) {
    const caseAttempts = attempts.filter((item) => !item.excluded && item.value.caseId === truth.value.caseId && BENCHMARK_ROUTES.includes(item.value.route));
    for (const route of BENCHMARK_ROUTES) if (!caseAttempts.some((item) => item.value.route === route)) issue(errors, "missing_required_route", `groundTruth[${truth.index}].${route}`);
    const participantCodes = caseAttempts.map((item) => item.value.participantCode);
    if (new Set(participantCodes).size !== participantCodes.length) issue(errors, "dependent_case_assignment", `groundTruth[${truth.index}]`);
  }
  // The order values record the actual session ordering; duplicates make balancing unverifiable.
  const participantOrders = new Set();
  for (const attempt of attempts.filter((item) => !item.excluded)) {
    const key = JSON.stringify([attempt.value.participantCode, attempt.value.assignmentOrder]);
    if (participantOrders.has(key)) issue(errors, "duplicate_participant_assignment_order", `attempts[${attempt.index}].assignmentOrder`);
    participantOrders.add(key);
  }
  // Check the recorded schedule, not just the operator's routeOrderBalanced declaration.
  const participantGroups = Map.groupBy(attempts, (item) => item.value.participantCode);
  const firstRoutes = Object.fromEntries(BENCHMARK_ROUTES.map((route) => [route, 0]));
  for (const group of participantGroups.values()) {
    const ordered = [...group].sort((a, b) => a.value.assignmentOrder - b.value.assignmentOrder);
    if (BENCHMARK_ROUTES.includes(ordered[0]?.value.route)) firstRoutes[ordered[0].value.route]++;
    const counts = BENCHMARK_ROUTES.map((route) => group.filter((item) => item.value.route === route).length);
    if (Math.max(...counts) - Math.min(...counts) > 1) issue(errors, "unbalanced_participant_routes", `attempts[${ordered[0].index}]`);
    for (let index = 1; index < ordered.length; index++) {
      const start = benchmarkTime(ordered[index].value.startedAt);
      const previousEnd = benchmarkTime(ordered[index - 1].value.endedAt);
      if (start !== null && previousEnd !== null && start < previousEnd) issue(errors, "overlapping_or_reordered_tasks", `attempts[${ordered[index].index}]`);
    }
  }
  if (Math.max(...Object.values(firstRoutes)) - Math.min(...Object.values(firstRoutes)) > 1) issue(errors, "unbalanced_first_route", "attempts");
  return { protocol, studyMode, truths: effectiveTruths, attempts, errors };
}

export function validateBenchmark(study) {
  const inspected = inspectBenchmark(study);
  return {
    valid: inspected.errors.length === 0,
    studyMode: ["synthetic", "real"].includes(inspected.studyMode) ? inspected.studyMode : null,
    protocolFrozen: inspected.protocol.status === "frozen" && benchmarkTime(inspected.protocol.frozenAt) !== null,
    counts: {
      uniqueCases: inspected.truths.length,
      validCases: inspected.truths.filter((truth) => !truth.validation.excluded).length,
      excludedCases: inspected.truths.filter((truth) => truth.validation.excluded).length,
      attemptRecords: inspected.attempts.length,
      excludedAttemptRecords: inspected.attempts.filter((attempt) => attempt.excluded).length,
      incompleteAttemptRecords: inspected.attempts.filter((attempt) => !attempt.excluded && !attempt.validation.valid).length
    },
    errors: inspected.errors
  };
}
