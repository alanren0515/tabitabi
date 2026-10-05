import { isDeepStrictEqual } from "node:util";

export const OFFER_SCHEMA_VERSION = 1;
export const OFFER_RESEARCH_SCHEMA_VERSION = 1;
export const PRICE_SIGNAL_SCHEMA_VERSION = 1;
export const PRICE_SIGNAL_CHOICES = Object.freeze(["interested", "not_needed", "too_expensive", "unsure"]);
export const PRICE_SIGNAL_SOURCE_CONTEXTS = Object.freeze(["completed_analysis", "completed_review", "unknown"]);
export const OFFER_AUDIENCES = Object.freeze(["consumer", "business_maintenance"]);
export const COMMERCIAL_EVIDENCE_LAYERS = Object.freeze([
  "explicit_price_accepted", "contracted", "real_task_provided", "paid", "delivered", "accepted", "renewed", "refunded"
]);
const COST_COMPONENTS = ["api", "labor", "support", "channel", "fixed_allocation", "acquisition"];
const INPUTS = ["authorized_task_clues", "self_authored_notes", "permitted_source_references"];
const EXCLUDED_INPUTS = ["raw_screenshots", "private_messages", "account_credentials", "payment_details"];
const CURRENCIES = { JPY: 0, USD: 2, EUR: 2 };
const EVIDENCE_TYPES = ["synthetic", "local_unverified"];
const trustedConfigs = new WeakSet();
const object = value => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const id = value => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(value);
const nullableId = value => value === null || id(value);
const integer = (value, min = 0, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(value) && value >= min && value <= max;
const nullableInteger = (value, min = 0, max) => value === null || integer(value, min, max);
const time = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const list = (value, allowed, min = 1) => Array.isArray(value) && value.length >= min && value.length <= allowed.length
  && new Set(value).size === value.length && value.every(item => allowed.includes(item));
const versionKey = value => `${value.offerId}\u0000${value.offerVersion}`;
const addIssue = (issues, key) => { issues[key] = (issues[key] || 0) + 1; };
const clone = value => JSON.parse(JSON.stringify(value));
function freeze(value) { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

// Pure schema validation. Approval references are supplied assertions; this module
// never obtains approval, provisions service, charges, stores customers or calls APIs.
export function validateOffer(body) {
  const errors = [];
  if (!exact(body, ["schemaVersion", "offerId", "offerVersion", "audience", "status", "evidenceType", "price", "period", "validity", "scope", "capacity", "fulfillment", "refund", "dataScope", "costEvidence", "approvedActivation"]))
    return { valid: false, errors: ["invalid_offer_fields"], offer: null };
  if (body.schemaVersion !== OFFER_SCHEMA_VERSION) errors.push("unsupported_offer_schema_version");
  if (!id(body.offerId) || !id(body.offerVersion)) errors.push("invalid_offer_identity");
  if (!OFFER_AUDIENCES.includes(body.audience)) errors.push("invalid_offer_audience");
  if (!["draft", "active", "paused", "retired"].includes(body.status)) errors.push("invalid_offer_status");
  if (!["synthetic", "operator_reviewed"].includes(body.evidenceType)) errors.push("invalid_offer_evidence_type");
  const price = body.price;
  if (!exact(price, ["currency", "amountMinor", "taxTreatment"]) || !Object.hasOwn(CURRENCIES, price.currency)
    || !nullableInteger(price.amountMinor) || !["pending_confirmation", "included", "excluded"].includes(price.taxTreatment)) errors.push("invalid_price");
  const period = body.period;
  if (!exact(period, ["unit", "count"]) || !["one_time", "week", "month"].includes(period.unit)
    || !integer(period.count, 1, 12) || (period.unit === "one_time" && period.count !== 1)) errors.push("invalid_period");
  const validity = body.validity;
  if (!exact(validity, ["startsAt", "expiresAt"]) || !time(validity.startsAt) || !time(validity.expiresAt)
    || Date.parse(validity.startsAt) >= Date.parse(validity.expiresAt)) errors.push("invalid_offer_validity");
  const scope = body.scope;
  if (!exact(scope, ["maxItems", "fields", "sources", "reviewsPerItem", "languages", "noRealtimeAvailability", "noBookingGuarantee"])
    || !integer(scope.maxItems, 1, 20) || !integer(scope.reviewsPerItem, 1, 20)
    || !list(scope.fields, ["restaurant_identity", "operating_status", "action_entry", "conditions", "own_notes"])
    || !list(scope.sources, ["customer_authorized", "official_site", "booking_platform", "licensed_provider", "operator_observation"])
    || !list(scope.languages, ["ja", "en", "zh"]) || scope.noRealtimeAvailability !== true || scope.noBookingGuarantee !== true) errors.push("invalid_offer_scope");
  const capacity = body.capacity;
  if (!exact(capacity, ["maxConcurrentCustomers", "maxOperatorMinutesPerCycle", "maxApiCallsPerCycle"])
    || !integer(capacity.maxConcurrentCustomers, 1, body.audience === "business_maintenance" ? 3 : 20)
    || !nullableInteger(capacity.maxOperatorMinutesPerCycle, 0, 10_080) || !nullableInteger(capacity.maxApiCallsPerCycle, 0, 10_000)) errors.push("invalid_offer_capacity");
  const fulfillment = body.fulfillment;
  if (!exact(fulfillment, ["mode", "serviceWindow", "deliveryDays", "unresolvedHandling", "acceptanceMethod"])
    || !["operator_assisted", "bounded_consumer_research"].includes(fulfillment.mode)
    || fulfillment.mode !== (body.audience === "business_maintenance" ? "operator_assisted" : "bounded_consumer_research")
    || !["pending_confirmation", "agreed_manual_window_jst"].includes(fulfillment.serviceWindow)
    || !nullableInteger(fulfillment.deliveryDays, 1, 90) || fulfillment.unresolvedHandling !== "report_unknown_and_next_action"
    || fulfillment.acceptanceMethod !== (body.audience === "business_maintenance" ? "customer_revision_review" : "user_result_review")) errors.push("invalid_fulfillment");
  const refund = body.refund;
  if (!exact(refund, ["policy", "windowDays", "channel"]) || !["pending_confirmation", "agreed_manual_review"].includes(refund.policy)
    || !nullableInteger(refund.windowDays, 0, 90) || !["pending_confirmation", "approved_manual_channel"].includes(refund.channel)) errors.push("invalid_refund_terms");
  const data = body.dataScope;
  if (!exact(data, ["inputs", "excludedInputs", "rawRetentionDays", "aggregateRetentionDays", "contactCollection"])
    || !list(data.inputs, INPUTS) || !list(data.excludedInputs, EXCLUDED_INPUTS) || data.excludedInputs.length !== EXCLUDED_INPUTS.length
    || !integer(data.rawRetentionDays, 1, 30) || !integer(data.aggregateRetentionDays, 1, 90) || data.contactCollection !== false) errors.push("invalid_data_scope");
  const cost = body.costEvidence;
  const validCost = exact(cost, ["status", "basis", "reportVersion", "currency", "lowerMinor", "upperMinor", "componentCoverage", "reference"])
    && ["pending_confirmation", "documented"].includes(cost.status)
    && ["pending_confirmation", "supplier_billed", "confirmed_usage_conservative_upper_bound"].includes(cost.basis)
    && nullableId(cost.reportVersion) && nullableId(cost.reference) && Object.hasOwn(CURRENCIES, cost.currency) && cost.currency === price?.currency
    && nullableInteger(cost.lowerMinor) && nullableInteger(cost.upperMinor)
    && (cost.lowerMinor === null || cost.upperMinor === null || cost.lowerMinor <= cost.upperMinor)
    && exact(cost.componentCoverage, COST_COMPONENTS) && COST_COMPONENTS.every(key => ["pending_confirmation", "documented", "not_applicable"].includes(cost.componentCoverage[key]));
  if (!validCost || (cost.status === "documented" && !documentedCost(cost))) errors.push("invalid_cost_evidence");
  const activation = body.approvedActivation;
  const validActivation = exact(activation, ["state", "offerVersion", "approvalReference", "approvedAt"])
    && ["not_approved", "approved"].includes(activation.state)
    && (activation.state === "not_approved"
      ? activation.offerVersion === null && activation.approvalReference === null && activation.approvedAt === null
      : activation.offerVersion === body.offerVersion && id(activation.approvalReference) && time(activation.approvedAt) && body.evidenceType === "operator_reviewed");
  if (!validActivation) errors.push("invalid_approved_activation");
  if (body.status === "active" && (!validActivation || activation.state !== "approved" || price?.amountMinor === null
    || price?.taxTreatment === "pending_confirmation" || !validCost || !documentedCost(cost)
    || capacity?.maxOperatorMinutesPerCycle === null || capacity?.maxApiCallsPerCycle === null
    || fulfillment?.serviceWindow === "pending_confirmation" || fulfillment?.deliveryDays === null
    || refund?.policy === "pending_confirmation" || refund?.windowDays === null || refund?.channel === "pending_confirmation")) errors.push("activation_requirements_unmet");
  return errors.length ? { valid: false, errors, offer: null } : { valid: true, errors: [], offer: clone(body) };
}
function documentedCost(cost) {
  return cost.status === "documented" && cost.basis !== "pending_confirmation" && id(cost.reportVersion) && id(cost.reference)
    && integer(cost.lowerMinor) && integer(cost.upperMinor) && cost.lowerMinor <= cost.upperMinor
    && COST_COMPONENTS.every(key => cost.componentCoverage?.[key] !== "pending_confirmation");
}

// Default registry deliberately empty. Config is server-owned, immutable and
// projected for reading; passing a browser-provided config cannot enable intake.
export function getOfferResearchConfig(input = { enabled: false, offers: [] }, now = new Date()) {
  if (!exact(input, ["enabled", "offers"]) || typeof input.enabled !== "boolean" || !Array.isArray(input.offers) || input.offers.length > 20
    || !(now instanceof Date) || !Number.isFinite(now.valueOf())) throw new Error("INVALID_OFFER_RESEARCH_CONFIG");
  const seen = new Set();
  const offers = input.offers.map(body => {
    const result = validateOffer(body);
    if (!result.valid || body.audience !== "consumer" || seen.has(versionKey(body))) throw new Error("INVALID_OFFER_RESEARCH_CONFIG");
    seen.add(versionKey(body));
    const withinValidity = Date.parse(body.validity.startsAt) <= now.valueOf() && now.valueOf() < Date.parse(body.validity.expiresAt);
    if (input.enabled && (body.status !== "active" || body.approvedActivation.state !== "approved" || !withinValidity
      || Date.parse(body.approvedActivation.approvedAt) > now.valueOf())) throw new Error("INVALID_OFFER_RESEARCH_CONFIG");
    return { schemaVersion: OFFER_SCHEMA_VERSION, offerId: body.offerId, offerVersion: body.offerVersion, audience: body.audience,
      status: body.status, price: clone(body.price), period: clone(body.period), validity: clone(body.validity), scope: clone(body.scope),
      capacity: clone(body.capacity), fulfillment: clone(body.fulfillment), refund: clone(body.refund), dataScope: clone(body.dataScope),
      activeForResearch: input.enabled && withinValidity && body.status === "active", researchOnly: true, purchaseAvailable: false };
  });
  if (input.enabled && !offers.length) throw new Error("INVALID_OFFER_RESEARCH_CONFIG");
  const config = freeze({ schemaVersion: OFFER_RESEARCH_SCHEMA_VERSION, enabled: input.enabled, offers,
    choices: [...PRICE_SIGNAL_CHOICES], sourceContexts: [...PRICE_SIGNAL_SOURCE_CONTEXTS] });
  trustedConfigs.add(config);
  return config;
}

export function validateConsumerPriceSignal(body, config = getOfferResearchConfig(), now = new Date()) {
  if (!exact(body, ["schemaVersion", "offerId", "offerVersion", "choice", "sourceContext"])) return { valid: false, errors: ["invalid_price_signal_fields"], signal: null };
  const errors = [];
  if (body.schemaVersion !== PRICE_SIGNAL_SCHEMA_VERSION) errors.push("unsupported_price_signal_schema_version");
  if (!id(body.offerId) || !id(body.offerVersion)) errors.push("invalid_offer_identity");
  if (!PRICE_SIGNAL_CHOICES.includes(body.choice)) errors.push("invalid_price_choice");
  if (!PRICE_SIGNAL_SOURCE_CONTEXTS.includes(body.sourceContext)) errors.push("invalid_source_context");
  if (errors.length) return { valid: false, errors, signal: null };
  if (!trustedConfigs.has(config) || !config.enabled) return { valid: false, errors: ["inactive_offer"], signal: null };
  const offer = config.offers.find(item => item.offerId === body.offerId && item.offerVersion === body.offerVersion);
  if (!offer) return { valid: false, errors: ["unknown_offer_version"], signal: null };
  if (!(now instanceof Date) || !Number.isFinite(now.valueOf()) || !offer.activeForResearch
    || Date.parse(offer.validity.startsAt) > now.valueOf() || now.valueOf() >= Date.parse(offer.validity.expiresAt)) return { valid: false, errors: ["inactive_offer"], signal: null };
  return { valid: true, errors: [], signal: { schemaVersion: PRICE_SIGNAL_SCHEMA_VERSION, offerId: offer.offerId, offerVersion: offer.offerVersion,
    choice: body.choice, sourceContext: body.sourceContext } };
}
export const validatePriceSignal = validateConsumerPriceSignal;

function validInterview(row) {
  return exact(row, ["schemaVersion", "interviewId", "participantReference", "segment", "actualMaintainer", "recentTaskEvidenceReference", "occurredAt", "evidenceType"])
    && row.schemaVersion === OFFER_RESEARCH_SCHEMA_VERSION && id(row.interviewId) && id(row.participantReference)
    && ["marketing_agency", "food_media", "inhouse_operator", "frequent_maintainer"].includes(row.segment)
    && typeof row.actualMaintainer === "boolean" && nullableId(row.recentTaskEvidenceReference) && time(row.occurredAt) && EVIDENCE_TYPES.includes(row.evidenceType);
}
function validLocalSignal(row) {
  return exact(row, ["schemaVersion", "signalId", "offerId", "offerVersion", "choice", "sourceContext", "occurredAt", "evidenceType"])
    && row.schemaVersion === PRICE_SIGNAL_SCHEMA_VERSION && id(row.signalId) && id(row.offerId) && id(row.offerVersion)
    && PRICE_SIGNAL_CHOICES.includes(row.choice) && PRICE_SIGNAL_SOURCE_CONTEXTS.includes(row.sourceContext) && time(row.occurredAt) && EVIDENCE_TYPES.includes(row.evidenceType);
}
function validFact(row) {
  if (!exact(row, ["schemaVersion", "factId", "subjectReference", "audience", "offerId", "offerVersion", "layer", "cycleId", "deliveryRevision", "priorCycleId", "money", "paymentStatus", "evidenceReference", "evidenceType", "occurredAt"])
    || row.schemaVersion !== OFFER_RESEARCH_SCHEMA_VERSION || !id(row.factId) || !id(row.subjectReference) || !OFFER_AUDIENCES.includes(row.audience)
    || !id(row.offerId) || !id(row.offerVersion) || !COMMERCIAL_EVIDENCE_LAYERS.includes(row.layer) || !nullableId(row.cycleId)
    || !nullableId(row.deliveryRevision) || !nullableId(row.priorCycleId) || !id(row.evidenceReference) || !EVIDENCE_TYPES.includes(row.evidenceType) || !time(row.occurredAt)) return false;
  const monetary = ["paid", "renewed", "refunded"].includes(row.layer);
  const priceAcceptance = row.layer === "explicit_price_accepted";
  if (monetary || priceAcceptance) {
    if (!exact(row.money, ["currency", "amountMinor"]) || !Object.hasOwn(CURRENCIES, row.money.currency)
      || !integer(row.money.amountMinor, monetary ? 1 : 0)) return false;
  } else if (row.money !== null) return false;
  if (monetary ? !["reconciled", "payment_unverified"].includes(row.paymentStatus) : row.paymentStatus !== null) return false;
  if (["paid", "renewed", "refunded", "delivered", "accepted"].includes(row.layer) ? !id(row.cycleId) : row.cycleId !== null) return false;
  if (["delivered", "accepted"].includes(row.layer) ? !id(row.deliveryRevision) : row.deliveryRevision !== null) return false;
  return row.layer === "renewed" ? id(row.priorCycleId) && row.priorCycleId !== row.cycleId : row.priorCycleId === null;
}
function uniqueRows(rows, key, validate, diagnostics, label) {
  const entries = new Map(), conflicts = new Set();
  for (const row of rows) {
    if (!validate(row)) { addIssue(diagnostics.invalidRecords, label); continue; }
    const identity = typeof key === "function" ? key(row) : row[key];
    if (!entries.has(identity)) entries.set(identity, row);
    else { diagnostics.duplicateRecords++; if (!isDeepStrictEqual(entries.get(identity), row)) conflicts.add(identity); }
  }
  diagnostics.conflictingRecords += conflicts.size;
  return [...entries].filter(([identity]) => !conflicts.has(identity)).map(([, row]) => row);
}
function emptyAudience() {
  return { offerVersions: [], interestChoices: Object.fromEntries(PRICE_SIGNAL_CHOICES.map(choice => [choice, 0])),
    layers: Object.fromEntries(["interested", ...COMMERCIAL_EVIDENCE_LAYERS].map(layer => [layer, { records: 0, uniqueSubjects: layer === "interested" ? null : 0 }])),
    currencies: {}, paymentUnverifiedRecords: 0, priceOrCurrencyMismatchRecords: 0, paidCyclesAwaitingDelivery: 0,
    deliveredCyclesAwaitingAcceptance: 0, acceptanceRevisionMismatchRecords: 0, renewalWithoutVerifiedPriorCycleRecords: 0 };
}
function currencyBucket(audience, currency) {
  return audience.currencies[currency] ||= { minorUnitDigits: CURRENCIES[currency], receivedKnownSubtotalMinor: 0, refundedKnownSubtotalMinor: 0,
    netKnownSubtotalMinor: 0, completeFinancialCoverage: false };
}
function addMoney(bucket, key, amount, diagnostics) {
  if (!Number.isSafeInteger(bucket[key] + amount)) { addIssue(diagnostics.invalidRecords, "money_overflow"); return; }
  bucket[key] += amount;
}

// Offline counts of supplied assertions only. No amount of fixture data, claimed
// approval or "real" labels can establish human interviews, GQ, G1, GB or release.
export function summarizeOfferResearch(snapshot) {
  const keys = ["offers", "interviews", "priceSignals", "commercialFacts"];
  if (!exact(snapshot, ["schemaVersion", "evidenceType", ...keys]) || snapshot.schemaVersion !== OFFER_RESEARCH_SCHEMA_VERSION
    || !EVIDENCE_TYPES.includes(snapshot.evidenceType) || !keys.every(key => Array.isArray(snapshot[key]))
    || snapshot.offers.length > 100 || snapshot.interviews.length > 100 || keys.reduce((sum, key) => sum + snapshot[key].length, 0) > 10_000) throw new Error("INVALID_OFFER_RESEARCH_SNAPSHOT");
  const diagnostics = { invalidRecords: {}, duplicateRecords: 0, conflictingRecords: 0, unknownOfferVersionRecords: 0,
    audienceMismatchRecords: 0, outsideOfferValidityRecords: 0, conflictingPaymentEvidence: 0, duplicatePaymentEvidence: 0, syntheticRecords: 0, unverifiedLocalRecords: 0 };
  const offers = uniqueRows(snapshot.offers, versionKey, row => validateOffer(row).valid, diagnostics, "offer");
  const offerMap = new Map(offers.map(offer => [versionKey(offer), offer]));
  const interviews = uniqueRows(snapshot.interviews, "interviewId", validInterview, diagnostics, "interview");
  const signals = uniqueRows(snapshot.priceSignals, "signalId", validLocalSignal, diagnostics, "price_signal");
  const facts = uniqueRows(snapshot.commercialFacts, "factId", validFact, diagnostics, "commercial_fact");
  const audiences = Object.fromEntries(OFFER_AUDIENCES.map(audience => [audience, emptyAudience()]));
  for (const offer of offers) audiences[offer.audience].offerVersions.push({ offerId: offer.offerId, offerVersion: offer.offerVersion,
    status: offer.status, price: clone(offer.price), period: clone(offer.period), costEvidenceStatus: offer.costEvidence.status,
    costEvidenceCompleteForSuppliedOffer: documentedCost(offer.costEvidence), approvedActivationClaim: offer.approvedActivation.state,
    evidenceType: offer.evidenceType });
  function evidence(row) { diagnostics[row.evidenceType === "synthetic" ? "syntheticRecords" : "unverifiedLocalRecords"]++; }
  const withinOfferValidity = (row, offer) => Date.parse(offer.validity.startsAt) <= Date.parse(row.occurredAt)
    && Date.parse(row.occurredAt) < Date.parse(offer.validity.expiresAt);
  for (const interview of interviews) evidence(interview);
  for (const signal of signals) {
    const offer = offerMap.get(versionKey(signal));
    if (!offer) { diagnostics.unknownOfferVersionRecords++; continue; }
    if (!withinOfferValidity(signal, offer)) { diagnostics.outsideOfferValidityRecords++; continue; }
    evidence(signal);
    audiences[offer.audience].interestChoices[signal.choice]++;
    if (signal.choice === "interested") audiences[offer.audience].layers.interested.records++;
  }
  const monetary = new Map(), excludedPaymentEvidence = new Set();
  const linkedFacts = [];
  for (const fact of facts) {
    const offer = offerMap.get(versionKey(fact));
    if (!offer) { diagnostics.unknownOfferVersionRecords++; continue; }
    if (offer.audience !== fact.audience) { diagnostics.audienceMismatchRecords++; continue; }
    evidence(fact);
    const audience = audiences[fact.audience];
    if (fact.layer === "explicit_price_accepted" && !withinOfferValidity(fact, offer)) { diagnostics.outsideOfferValidityRecords++; continue; }
    const monetaryFact = ["paid", "renewed", "refunded"].includes(fact.layer);
    // Register every linked money assertion before amount matching. A mismatched
    // reuse of an existing evidence reference must also withhold the earlier row.
    if (monetaryFact) {
      const previous = monetary.get(fact.evidenceReference);
      if (previous) {
        const signature = row => Object.fromEntries(["subjectReference", "audience", "offerId", "offerVersion", "layer", "cycleId", "priorCycleId", "money", "paymentStatus", "evidenceType"].map(key => [key, row[key]]));
        if (isDeepStrictEqual(signature(previous), signature(fact))) diagnostics.duplicatePaymentEvidence++;
        else excludedPaymentEvidence.add(fact.evidenceReference);
        continue;
      }
      monetary.set(fact.evidenceReference, fact);
    }
    if (["explicit_price_accepted", "paid", "renewed", "refunded"].includes(fact.layer)
      && (fact.money.currency !== offer.price.currency || (fact.layer !== "refunded" && fact.money.amountMinor !== offer.price.amountMinor))) {
      audience.priceOrCurrencyMismatchRecords++; continue;
    }
    if (!monetaryFact) linkedFacts.push(fact);
  }
  diagnostics.conflictingPaymentEvidence = excludedPaymentEvidence.size;
  for (const [reference, fact] of monetary) {
    if (excludedPaymentEvidence.has(reference)) continue;
    const offer = offerMap.get(versionKey(fact));
    if (fact.money.currency !== offer.price.currency || (fact.layer !== "refunded" && fact.money.amountMinor !== offer.price.amountMinor)) continue;
    if (fact.paymentStatus !== "reconciled") { audiences[fact.audience].paymentUnverifiedRecords++; continue; }
    linkedFacts.push(fact);
    const bucket = currencyBucket(audiences[fact.audience], fact.money.currency);
    addMoney(bucket, fact.layer === "refunded" ? "refundedKnownSubtotalMinor" : "receivedKnownSubtotalMinor", fact.money.amountMinor, diagnostics);
  }
  for (const [audienceName, audience] of Object.entries(audiences)) {
    const audienceFacts = linkedFacts.filter(fact => fact.audience === audienceName);
    for (const layer of COMMERCIAL_EVIDENCE_LAYERS) {
      const rows = audienceFacts.filter(fact => fact.layer === layer);
      audience.layers[layer] = { records: rows.length, uniqueSubjects: new Set(rows.map(fact => fact.subjectReference)).size };
    }
    const cycleKey = row => `${row.subjectReference}\u0000${versionKey(row)}\u0000${row.cycleId}`;
    const paidCycles = new Set(audienceFacts.filter(row => ["paid", "renewed"].includes(row.layer)).map(cycleKey));
    const deliveries = new Map();
    for (const row of audienceFacts.filter(row => row.layer === "delivered")) {
      const revisions = deliveries.get(cycleKey(row)) || new Set(); revisions.add(row.deliveryRevision); deliveries.set(cycleKey(row), revisions);
    }
    const acceptedCycles = new Set();
    for (const row of audienceFacts.filter(row => row.layer === "accepted")) {
      if (deliveries.get(cycleKey(row))?.has(row.deliveryRevision)) acceptedCycles.add(cycleKey(row));
      else audience.acceptanceRevisionMismatchRecords++;
    }
    audience.paidCyclesAwaitingDelivery = [...paidCycles].filter(key => !deliveries.has(key)).length;
    audience.deliveredCyclesAwaitingAcceptance = [...deliveries.keys()].filter(key => !acceptedCycles.has(key)).length;
    for (const row of audienceFacts.filter(row => row.layer === "renewed")) {
      const priorKey = cycleKey({ ...row, cycleId: row.priorCycleId });
      if (!paidCycles.has(priorKey) || !acceptedCycles.has(priorKey)) audience.renewalWithoutVerifiedPriorCycleRecords++;
    }
    for (const bucket of Object.values(audience.currencies)) {
      const net = bucket.receivedKnownSubtotalMinor - bucket.refundedKnownSubtotalMinor;
      bucket.netKnownSubtotalMinor = Number.isSafeInteger(net) ? net : null;
    }
  }
  const actualMaintainers = interviews.filter(row => row.actualMaintainer && row.recentTaskEvidenceReference !== null);
  const maintainerCount = new Set(actualMaintainers.map(row => row.participantReference)).size;
  const businessFacts = linkedFacts.filter(row => row.audience === "business_maintenance");
  const sameVersionAcceptanceAndTask = offers.filter(row => row.audience === "business_maintenance").map(offer => {
    const rows = businessFacts.filter(row => versionKey(row) === versionKey(offer));
    const acceptances = new Set(rows.filter(row => row.layer === "explicit_price_accepted").map(row => row.subjectReference));
    const taskProviders = new Set(rows.filter(row => row.layer === "real_task_provided").map(row => row.subjectReference));
    return { offerId: offer.offerId, offerVersion: offer.offerVersion, suppliedSubjectsWithPriceAcceptanceAndTask: [...acceptances].filter(subject => taskProviders.has(subject)).length };
  });
  return { schemaVersion: OFFER_RESEARCH_SCHEMA_VERSION, scope: "offline_offer_research_snapshot_only", evidenceType: snapshot.evidenceType,
    realWorldEvidence: false, releaseGateEvidence: false, realOffersActivated: false, networkCalls: 0, realCustomerRecordsStored: false,
    interviewAssertions: { suppliedRecords: interviews.length, suppliedUniqueActualMaintainersWithTaskReference: maintainerCount, actualMaintainerEvidenceVerified: false },
    audiences, sameVersionAcceptanceAndTask, diagnostics,
    gates: { G1: { status: "evidence_insufficient", reasons: ["offline_assertions_are_not_verified_human_evidence", "gq_evidence_not_verified", "actual_interviews_and_exact_offer_task_acceptance_require_review"] },
      GB: { status: "evidence_insufficient", reasons: ["offline_assertions_are_not_verified_commercial_evidence", "per_customer_first_and_paid_renewal_delivery_acceptance_require_review", "complete_per_cycle_cost_and_positive_contribution_require_review"] } },
    limitations: ["Interest, explicit price acceptance, contract, real task, reconciled payment, delivery, acceptance, paid renewal and refund are counted separately; none implies another.",
      "Consumer and business maintenance assertions are separate. Missing, unverified, mismatched and conflicting evidence never becomes a paid conversion.",
      "Offer versions are immutable identities: old acceptance and task records do not transfer to changed prices, scope or terms.",
      "Known currency subtotals are supplied snapshot amounts, not verified revenue, complete customer margins or company profit. Currencies are never added.",
      "No contacts, free text, customer material, payment documents or source contents are accepted. IDs are local opaque references only.",
      "This module has no intake storage, network, payment, delivery or service activation side effects. G1/GB and release remain evidence_insufficient."] };
}
