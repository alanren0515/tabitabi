import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { validateOffer, getOfferResearchConfig, validateConsumerPriceSignal, summarizeOfferResearch } from "../server/offer-research.mjs";
import { offerFixture, offerResearchFixture, draftOfferTemplates, commercialFactFixture, inactiveOfferResearchFixtureConfig } from "../eval/offers/fixtures.mjs";

const now = new Date("2026-10-03T00:00:00.000Z");
const copy = value => structuredClone(value);
const signalFor = offer => ({ schemaVersion: 1, offerId: offer.offerId, offerVersion: offer.offerVersion, choice: "interested", sourceContext: "completed_analysis" });
const blank = (offers = [offerFixture()]) => ({ schemaVersion: 1, evidenceType: "synthetic", offers, interviews: [], priceSignals: [], commercialFacts: [] });
const business = report => report.audiences.business_maintenance;
function approvedFixture() {
  const offer = offerFixture("consumer");
  offer.evidenceType = "operator_reviewed";
  offer.status = "active";
  offer.price.taxTreatment = "included";
  offer.capacity.maxOperatorMinutesPerCycle = 60;
  offer.capacity.maxApiCallsPerCycle = 3;
  offer.fulfillment.serviceWindow = "agreed_manual_window_jst";
  offer.fulfillment.deliveryDays = 2;
  offer.refund = { policy: "agreed_manual_review", windowDays: 7, channel: "approved_manual_channel" };
  offer.costEvidence = { status: "documented", basis: "confirmed_usage_conservative_upper_bound", reportVersion: "synthetic-cost-v1", currency: "JPY", lowerMinor: 100, upperMinor: 200,
    componentCoverage: { api: "documented", labor: "documented", support: "documented", channel: "not_applicable", fixed_allocation: "documented", acquisition: "not_applicable" }, reference: "synthetic-cost-reference" };
  offer.approvedActivation = { state: "approved", offerVersion: offer.offerVersion, approvalReference: "synthetic-approval-reference", approvedAt: "2026-10-02T00:00:00.000Z" };
  return offer;
}
function insufficient(report) {
  assert.equal(report.gates.G1.status, "evidence_insufficient");
  assert.equal(report.gates.GB.status, "evidence_insufficient");
  assert.equal(report.realWorldEvidence, false);
  assert.equal(report.releaseGateEvidence, false);
}

test("drafts preserve missing actual price, capacity and cost as explicit nulls", () => {
  for (const offer of draftOfferTemplates()) {
    const result = validateOffer(offer);
    assert.equal(result.valid, true);
    assert.equal(result.offer.price.amountMinor, null);
    assert.equal(result.offer.costEvidence.upperMinor, null);
    assert.equal(result.offer.capacity.maxOperatorMinutesPerCycle, null);
    assert.equal(result.offer.approvedActivation.state, "not_approved");
  }
});

test("offers strictly reject unsupported versions, incomplete terms, unknown fields and unsafe amounts", () => {
  const changes = [offer => { offer.schemaVersion = 2; }, offer => { offer.email = "private@example.test"; },
    offer => { offer.price.amountMinor = 1.5; }, offer => { offer.price.currency = "toString"; },
    offer => { delete offer.refund; }, offer => { offer.scope.maxItems = 21; }, offer => { offer.capacity.maxConcurrentCustomers = 4; },
    offer => { offer.scope.noBookingGuarantee = false; }, offer => { offer.dataScope.contactCollection = true; },
    offer => { offer.fulfillment.deliveryDays = -1; }, offer => { offer.scope.fields = ["restaurant_identity", "restaurant_identity"]; },
    offer => { offer.validity.expiresAt = "2026-02-30T00:00:00.000Z"; }, offer => { offer.costEvidence.status = "documented"; },
    offer => { offer.refund.text = "arbitrary refund terms"; }, offer => { offer.dataScope.excludedInputs.pop(); }];
  for (const change of changes) { const offer = offerFixture(); change(offer); assert.equal(validateOffer(offer).valid, false); }
  for (const value of [null, [], "offer", Object.create(null)]) assert.equal(validateOffer(value).valid, false);
});

test("activation requires a matching approved version and complete pricing, capacity, costs and terms", () => {
  assert.equal(validateOffer(approvedFixture()).valid, true);
  const changes = [offer => { offer.approvedActivation.state = "not_approved"; }, offer => { offer.offerVersion = "synthetic-v2"; },
    offer => { offer.evidenceType = "synthetic"; }, offer => { offer.costEvidence.componentCoverage.labor = "pending_confirmation"; },
    offer => { offer.price.amountMinor = null; }, offer => { offer.capacity.maxApiCallsPerCycle = null; },
    offer => { offer.refund.channel = "pending_confirmation"; }, offer => { offer.costEvidence.upperMinor = 50; },
    offer => { offer.fulfillment.serviceWindow = "pending_confirmation"; }];
  for (const change of changes) { const offer = approvedFixture(); change(offer); assert.equal(validateOffer(offer).valid, false); }
});

test("runtime defaults and fixture cards remain inactive and contain no purchase offer", () => {
  const config = getOfferResearchConfig();
  assert.equal(config.enabled, false);
  assert.deepEqual(config.offers, []);
  const fixture = getOfferResearchConfig(inactiveOfferResearchFixtureConfig(), now);
  assert.equal(fixture.offers[0].activeForResearch, false);
  assert.equal(fixture.offers[0].purchaseAvailable, false);
  assert.deepEqual(validateConsumerPriceSignal(signalFor(offerFixture("consumer")), config, now).errors, ["inactive_offer"]);
  assert.deepEqual(validateConsumerPriceSignal(signalFor(offerFixture("consumer")), fixture, now).errors, ["inactive_offer"]);
  assert.throws(() => getOfferResearchConfig({ enabled: true, offers: [] }, now), /INVALID_OFFER_RESEARCH_CONFIG/);
  assert.throws(() => getOfferResearchConfig({ enabled: true, offers: [offerFixture("consumer")] }, now), /INVALID_OFFER_RESEARCH_CONFIG/);
  assert.throws(() => getOfferResearchConfig({ enabled: false, offers: [offerFixture()] }, now), /INVALID_OFFER_RESEARCH_CONFIG/);
});

test("public config projection is immutable and does not disclose internal approval or cost references", () => {
  const offer = approvedFixture();
  const config = getOfferResearchConfig({ enabled: true, offers: [offer] }, now);
  assert.equal(config.offers[0].purchaseAvailable, false);
  assert.equal(config.offers[0].researchOnly, true);
  assert.equal(JSON.stringify(config).includes("synthetic-approval-reference"), false);
  assert.equal(JSON.stringify(config).includes("synthetic-cost-reference"), false);
  offer.price.amountMinor = 999;
  assert.equal(config.offers[0].price.amountMinor, 321);
  assert.throws(() => { config.offers[0].price.amountMinor = 999; }, TypeError);
});

test("consumer price payload is a strict anonymous enum signal, never a payment or price acceptance", () => {
  const offer = approvedFixture();
  const config = getOfferResearchConfig({ enabled: true, offers: [offer] }, now);
  const body = signalFor(offer);
  assert.deepEqual(validateConsumerPriceSignal(body, config, now).signal, body);
  for (const extra of ["email", "text", "customerId", "amountMinor", "deviceId", "payment", "approvedActivation"])
    assert.deepEqual(validateConsumerPriceSignal({ ...body, [extra]: "private" }, config, now).errors, ["invalid_price_signal_fields"]);
  assert.deepEqual(validateConsumerPriceSignal({ ...body, choice: "explicit_price_accepted" }, config, now).errors, ["invalid_price_choice"]);
  assert.deepEqual(validateConsumerPriceSignal({ ...body, sourceContext: "private_message" }, config, now).errors, ["invalid_source_context"]);
  assert.deepEqual(validateConsumerPriceSignal({ ...body, schemaVersion: 2 }, config, now).errors, ["unsupported_price_signal_schema_version"]);
  assert.deepEqual(validateConsumerPriceSignal({ ...body, offerVersion: "synthetic-v2" }, config, now).errors, ["unknown_offer_version"]);
  assert.deepEqual(validateConsumerPriceSignal(body, copy(config), now).errors, ["inactive_offer"]);
});

test("server-held activation expires and approval claimed from the future cannot enable intake", () => {
  const offer = approvedFixture();
  const config = getOfferResearchConfig({ enabled: true, offers: [offer] }, now);
  assert.deepEqual(validateConsumerPriceSignal(signalFor(offer), config, new Date(offer.validity.expiresAt)).errors, ["inactive_offer"]);
  assert.deepEqual(validateConsumerPriceSignal(signalFor(offer), config, new Date("invalid")).errors, ["inactive_offer"]);
  offer.approvedActivation.approvedAt = "2026-10-04T00:00:00.000Z";
  assert.throws(() => getOfferResearchConfig({ enabled: true, offers: [offer] }, now), /INVALID_OFFER_RESEARCH_CONFIG/);
});

test("synthetic interviews, two matching task acceptances and completed renewals never pass G1 or GB", () => {
  const report = summarizeOfferResearch(offerResearchFixture());
  insufficient(report);
  assert.equal(report.interviewAssertions.suppliedUniqueActualMaintainersWithTaskReference, 6);
  assert.equal(report.sameVersionAcceptanceAndTask[0].suppliedSubjectsWithPriceAcceptanceAndTask, 2);
  assert.equal(business(report).layers.renewed.records, 2);
  assert.equal(business(report).paidCyclesAwaitingDelivery, 0);
  assert.equal(business(report).deliveredCyclesAwaitingAcceptance, 0);
  assert.equal(business(report).offerVersions[0].costEvidenceCompleteForSuppliedOffer, false);
  assert.equal(report.audiences.consumer.layers.paid.records, 0);
  assert.equal(report.audiences.consumer.layers.interested.uniqueSubjects, null);
});

test("even a complete synthetic cost assertion cannot promote synthetic research to business evidence", () => {
  const snapshot = offerResearchFixture();
  snapshot.offers[0].costEvidence = copy(approvedFixture().costEvidence);
  const report = summarizeOfferResearch(snapshot);
  assert.equal(business(report).offerVersions[0].costEvidenceCompleteForSuppliedOffer, true);
  assert.equal(report.sameVersionAcceptanceAndTask[0].suppliedSubjectsWithPriceAcceptanceAndTask, 2);
  assert.equal(business(report).layers.renewed.records, 2);
  insufficient(report);
});

test("all evidence layers stay independent even when terminal facts arrive first", () => {
  for (const layer of ["explicit_price_accepted", "contracted", "real_task_provided", "paid", "delivered", "accepted", "renewed", "refunded"]) {
    const snapshot = blank(), offer = snapshot.offers[0];
    snapshot.commercialFacts = [commercialFactFixture(offer, layer)];
    const report = summarizeOfferResearch(snapshot);
    for (const [name, result] of Object.entries(business(report).layers)) assert.equal(result.records, name === layer ? 1 : 0);
    insufficient(report);
  }
});

test("consumer interest and business facts never substitute for each other", () => {
  const snapshot = offerResearchFixture();
  snapshot.commercialFacts = snapshot.commercialFacts.filter(row => row.layer === "contracted");
  const report = summarizeOfferResearch(snapshot);
  assert.equal(report.audiences.consumer.layers.interested.records, 1);
  assert.equal(business(report).layers.interested.records, 0);
  assert.equal(business(report).layers.contracted.records, 2);
  assert.equal(business(report).layers.explicit_price_accepted.records, 0);
  assert.equal(report.sameVersionAcceptanceAndTask[0].suppliedSubjectsWithPriceAcceptanceAndTask, 0);
});

test("accepted price and real task must link the same offer version and subject", () => {
  const v1 = offerFixture(), v2 = copy(v1); v2.offerVersion = "synthetic-v2"; v2.price.amountMinor++;
  const snapshot = blank([v1, v2]);
  snapshot.commercialFacts = [commercialFactFixture(v1, "explicit_price_accepted"), commercialFactFixture(v2, "real_task_provided")];
  let report = summarizeOfferResearch(snapshot);
  assert.deepEqual(report.sameVersionAcceptanceAndTask.map(row => row.suppliedSubjectsWithPriceAcceptanceAndTask), [0, 0]);
  snapshot.commercialFacts[1].offerVersion = v1.offerVersion;
  report = summarizeOfferResearch(snapshot);
  assert.equal(report.sameVersionAcceptanceAndTask[0].suppliedSubjectsWithPriceAcceptanceAndTask, 1);
  snapshot.commercialFacts[1].subjectReference = "synthetic-other-subject";
  assert.equal(summarizeOfferResearch(snapshot).sameVersionAcceptanceAndTask[0].suppliedSubjectsWithPriceAcceptanceAndTask, 0);
});

test("changed terms under the same version are a conflict rather than migrated evidence", () => {
  const snapshot = blank();
  const changed = copy(snapshot.offers[0]); changed.scope.maxItems = 10;
  snapshot.offers.push(changed);
  snapshot.commercialFacts.push(commercialFactFixture(snapshot.offers[0], "explicit_price_accepted"));
  const report = summarizeOfferResearch(snapshot);
  assert.equal(report.diagnostics.conflictingRecords, 1);
  assert.equal(report.diagnostics.unknownOfferVersionRecords, 1);
  assert.equal(business(report).layers.explicit_price_accepted.records, 0);
});

test("price and currency mismatches and unreconciled payments remain explicit gaps", () => {
  const snapshot = blank(), offer = snapshot.offers[0];
  snapshot.commercialFacts = [commercialFactFixture(offer, "explicit_price_accepted", { money: { currency: "JPY", amountMinor: 1 } }),
    commercialFactFixture(offer, "paid", { factId: "synthetic-wrong-currency", evidenceReference: "synthetic-wrong-currency-evidence", money: { currency: "USD", amountMinor: offer.price.amountMinor } }),
    commercialFactFixture(offer, "paid", { factId: "synthetic-unverified-payment", evidenceReference: "synthetic-unverified-payment-evidence", paymentStatus: "payment_unverified" })];
  const report = summarizeOfferResearch(snapshot);
  assert.equal(business(report).priceOrCurrencyMismatchRecords, 2);
  assert.equal(business(report).paymentUnverifiedRecords, 1);
  assert.equal(business(report).layers.paid.records, 0);
  assert.deepEqual(business(report).currencies, {});
});

test("duplicate record and payment evidence IDs are idempotent; conflicts withhold every use", () => {
  const snapshot = blank(), offer = snapshot.offers[0];
  const paid = commercialFactFixture(offer, "paid");
  snapshot.commercialFacts = [paid, copy(paid), { ...copy(paid), factId: "synthetic-payment-retry" }];
  let report = summarizeOfferResearch(snapshot);
  assert.equal(business(report).layers.paid.records, 1);
  assert.equal(business(report).currencies.JPY.receivedKnownSubtotalMinor, offer.price.amountMinor);
  assert.equal(report.diagnostics.duplicateRecords, 1);
  assert.equal(report.diagnostics.duplicatePaymentEvidence, 1);
  snapshot.commercialFacts.push({ ...copy(paid), factId: "synthetic-payment-conflict", cycleId: "synthetic-other-cycle" });
  report = summarizeOfferResearch(snapshot);
  assert.equal(report.diagnostics.conflictingPaymentEvidence, 1);
  assert.equal(business(report).layers.paid.records, 0);
  assert.deepEqual(business(report).currencies, {});
  snapshot.commercialFacts = [paid, { ...copy(paid), factId: "synthetic-amount-conflict", money: { currency: "JPY", amountMinor: 1 } }];
  report = summarizeOfferResearch(snapshot);
  assert.equal(report.diagnostics.conflictingPaymentEvidence, 1);
  assert.equal(business(report).layers.paid.records, 0);
});

test("refunds reduce known received subtotal and currencies are never added", () => {
  const jpy = offerFixture(), usd = copy(jpy); usd.offerId = "synthetic-usd"; usd.price.currency = "USD"; usd.costEvidence.currency = "USD"; usd.price.amountMinor = 500;
  const snapshot = blank([jpy, usd]);
  snapshot.commercialFacts = [commercialFactFixture(jpy, "paid"),
    commercialFactFixture(jpy, "refunded", { money: { currency: "JPY", amountMinor: 1000 } }),
    commercialFactFixture(usd, "paid", { factId: "synthetic-usd-payment", evidenceReference: "synthetic-usd-payment-reference" })];
  const report = summarizeOfferResearch(snapshot), values = business(report).currencies;
  assert.equal(values.JPY.netKnownSubtotalMinor, jpy.price.amountMinor - 1000);
  assert.equal(values.USD.netKnownSubtotalMinor, 500);
  assert.equal(values.USD.minorUnitDigits, 2);
  assert.equal(values.JPY.completeFinancialCoverage, false);
  assert.equal(Object.hasOwn(business(report), "totalRevenue"), false);
});

test("payment without delivery and acceptance of the wrong revision stay visible", () => {
  const snapshot = blank(), offer = snapshot.offers[0];
  snapshot.commercialFacts = [commercialFactFixture(offer, "paid")];
  assert.equal(business(summarizeOfferResearch(snapshot)).paidCyclesAwaitingDelivery, 1);
  snapshot.commercialFacts.push(commercialFactFixture(offer, "delivered"), commercialFactFixture(offer, "accepted", { deliveryRevision: "synthetic-wrong-revision" }));
  const report = summarizeOfferResearch(snapshot);
  assert.equal(business(report).paidCyclesAwaitingDelivery, 0);
  assert.equal(business(report).deliveredCyclesAwaitingAcceptance, 1);
  assert.equal(business(report).acceptanceRevisionMismatchRecords, 1);
  assert.equal(business(report).layers.accepted.records, 1);
  insufficient(report);
});

test("renewal receipts alone do not supply a first-cycle payment, delivery or acceptance", () => {
  const snapshot = blank(); snapshot.commercialFacts = [commercialFactFixture(snapshot.offers[0], "renewed")];
  const report = summarizeOfferResearch(snapshot);
  assert.equal(business(report).layers.renewed.records, 1);
  assert.equal(business(report).layers.paid.records, 0);
  assert.equal(business(report).renewalWithoutVerifiedPriorCycleRecords, 1);
  assert.equal(business(report).paidCyclesAwaitingDelivery, 1);
  insufficient(report);
});

test("free extensions and renewal intent cannot be classified as a paid renewal", () => {
  const offer = offerFixture(); offer.price.amountMinor = 0;
  const snapshot = blank([offer]);
  snapshot.commercialFacts = [commercialFactFixture(offer, "renewed"),
    commercialFactFixture(offer, "renewed", { factId: "synthetic-intent", layer: "willing_to_renew" })];
  const report = summarizeOfferResearch(snapshot);
  assert.equal(report.diagnostics.invalidRecords.commercial_fact, 2);
  assert.equal(business(report).layers.renewed.records, 0);
  assert.deepEqual(business(report).currencies, {});
  insufficient(report);
});

test("expired quote acceptance and future-introduced interest do not become exact price evidence", () => {
  const snapshot = offerResearchFixture();
  snapshot.priceSignals[0].occurredAt = "2026-09-30T00:00:00.000Z";
  snapshot.commercialFacts = [commercialFactFixture(snapshot.offers[0], "explicit_price_accepted", { occurredAt: snapshot.offers[0].validity.expiresAt })];
  const report = summarizeOfferResearch(snapshot);
  assert.equal(report.diagnostics.outsideOfferValidityRecords, 2);
  assert.equal(business(report).layers.explicit_price_accepted.records, 0);
  assert.equal(report.audiences.consumer.layers.interested.records, 0);
});

test("unknown, private, invalid and mismatched records are excluded without disclosing their content", () => {
  const snapshot = blank(), offer = snapshot.offers[0];
  snapshot.commercialFacts = [commercialFactFixture(offer, "paid", { text: "SECRET-CUSTOMER-CONTENT" }),
    commercialFactFixture(offer, "paid", { factId: "synthetic-audience-mismatch", audience: "consumer" }),
    commercialFactFixture(offer, "paid", { factId: "synthetic-unknown-version", offerVersion: "unknown-version" })];
  const report = summarizeOfferResearch(snapshot);
  assert.equal(report.diagnostics.invalidRecords.commercial_fact, 1);
  assert.equal(report.diagnostics.audienceMismatchRecords, 1);
  assert.equal(report.diagnostics.unknownOfferVersionRecords, 1);
  assert.equal(JSON.stringify(report).includes("SECRET-CUSTOMER-CONTENT"), false);
  assert.equal(JSON.stringify(report).includes("synthetic-audience-mismatch"), false);
  assert.equal(business(report).layers.paid.records, 0);
});

test("explicit local claims and cost assertions still cannot establish real commercial gates", () => {
  const snapshot = offerResearchFixture(); snapshot.evidenceType = "local_unverified";
  for (const row of [...snapshot.interviews, ...snapshot.priceSignals, ...snapshot.commercialFacts]) row.evidenceType = "local_unverified";
  insufficient(summarizeOfferResearch(snapshot));
  assert.throws(() => summarizeOfferResearch({ ...snapshot, evidenceType: "real_verified" }), /INVALID_OFFER_RESEARCH_SNAPSHOT/);
  assert.throws(() => summarizeOfferResearch({ ...snapshot, schemaVersion: 2 }), /INVALID_OFFER_RESEARCH_SNAPSHOT/);
  assert.throws(() => summarizeOfferResearch({ ...snapshot, contacts: [] }), /INVALID_OFFER_RESEARCH_SNAPSHOT/);
  assert.throws(() => summarizeOfferResearch({ ...snapshot, offers: Array(101).fill(offerFixture()) }), /INVALID_OFFER_RESEARCH_SNAPSHOT/);
});

test("CLI defaults to built-in synthetic data without external input or network and bounds explicit input", async () => {
  const result = spawnSync(process.execPath, ["scripts/summarize-offer-research.mjs"], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.inputMode, "built_in_synthetic_only");
  assert.equal(report.networkCalls, 0);
  assert.equal(report.snapshotBoundary.realCustomerDataAuthorized, false);
  insufficient(report);
  const directory = await mkdtemp(join(tmpdir(), "tabitabi-offer-test-"));
  try {
    const path = join(directory, "synthetic.json");
    await writeFile(path, JSON.stringify(blank()));
    const local = spawnSync(process.execPath, ["scripts/summarize-offer-research.mjs", "--input", path], { encoding: "utf8" });
    assert.equal(local.status, 0, local.stderr);
    assert.equal(JSON.parse(local.stdout).inputMode, "explicit_local_snapshot_unverified");
    await writeFile(path, "SECRET-CUSTOMER-CONTENT");
    const malformed = spawnSync(process.execPath, ["scripts/summarize-offer-research.mjs", "--input", path], { encoding: "utf8" });
    assert.equal(malformed.status, 1);
    assert.match(malformed.stderr, /OFFER_RESEARCH_SNAPSHOT_READ_FAILED/);
    assert.equal(malformed.stderr.includes("SECRET-CUSTOMER-CONTENT"), false);
    await writeFile(path, Buffer.alloc(5 * 1024 * 1024 + 1));
    const oversized = spawnSync(process.execPath, ["scripts/summarize-offer-research.mjs", "--input", path], { encoding: "utf8" });
    assert.equal(oversized.status, 1);
    assert.match(oversized.stderr, /OFFER_RESEARCH_SNAPSHOT_TOO_LARGE/);
  } finally { await rm(directory, { recursive: true, force: true }); }
  const invalid = spawnSync(process.execPath, ["scripts/summarize-offer-research.mjs", "--real"], { encoding: "utf8" });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /INVALID_ARGUMENTS/);
});
