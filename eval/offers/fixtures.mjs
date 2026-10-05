// Fictional amounts and references exercise validation only. They are neither
// selected selling prices nor observations of real customers or maintainers.
export function offerFixture(audience = "business_maintenance") {
  const business = audience === "business_maintenance";
  return {
    schemaVersion: 1, offerId: business ? "synthetic-maintenance" : "synthetic-consumer", offerVersion: "synthetic-v1",
    audience, status: "draft", evidenceType: "synthetic",
    price: { currency: "JPY", amountMinor: business ? 12345 : 321, taxTreatment: "pending_confirmation" },
    period: { unit: business ? "month" : "one_time", count: 1 },
    validity: { startsAt: "2026-10-01T00:00:00.000Z", expiresAt: "2026-11-01T00:00:00.000Z" },
    scope: { maxItems: business ? 20 : 1, fields: ["restaurant_identity", "action_entry", "conditions"],
      sources: ["customer_authorized", "official_site", "booking_platform"], reviewsPerItem: 1, languages: ["ja"],
      noRealtimeAvailability: true, noBookingGuarantee: true },
    capacity: { maxConcurrentCustomers: business ? 3 : 1, maxOperatorMinutesPerCycle: null, maxApiCallsPerCycle: null },
    fulfillment: { mode: business ? "operator_assisted" : "bounded_consumer_research", serviceWindow: "pending_confirmation",
      deliveryDays: null, unresolvedHandling: "report_unknown_and_next_action", acceptanceMethod: business ? "customer_revision_review" : "user_result_review" },
    refund: { policy: "pending_confirmation", windowDays: null, channel: "pending_confirmation" },
    dataScope: { inputs: ["authorized_task_clues", "self_authored_notes", "permitted_source_references"],
      excludedInputs: ["raw_screenshots", "private_messages", "account_credentials", "payment_details"], rawRetentionDays: 30, aggregateRetentionDays: 90, contactCollection: false },
    costEvidence: { status: "pending_confirmation", basis: "pending_confirmation", reportVersion: null, currency: "JPY", lowerMinor: null, upperMinor: null,
      componentCoverage: { api: "pending_confirmation", labor: "pending_confirmation", support: "pending_confirmation", channel: "pending_confirmation", fixed_allocation: "pending_confirmation", acquisition: "pending_confirmation" }, reference: null },
    approvedActivation: { state: "not_approved", offerVersion: null, approvalReference: null, approvedAt: null }
  };
}

export function draftOfferTemplates() {
  return ["consumer", "business_maintenance"].map(audience => {
    const offer = offerFixture(audience);
    offer.offerId = audience === "consumer" ? "consumer-draft" : "maintenance-draft";
    offer.offerVersion = "draft-v1";
    offer.evidenceType = "operator_reviewed";
    offer.price.amountMinor = null;
    return offer;
  });
}

export function inactiveOfferResearchFixtureConfig() {
  return { enabled: false, offers: [offerFixture("consumer")] };
}

export function commercialFactFixture(offer, layer, overrides = {}) {
  const monetary = ["paid", "renewed", "refunded"].includes(layer);
  const needsCycle = monetary || ["delivered", "accepted"].includes(layer);
  return { schemaVersion: 1, factId: `synthetic-${layer}`, subjectReference: "synthetic-subject-1", audience: offer.audience,
    offerId: offer.offerId, offerVersion: offer.offerVersion, layer, cycleId: needsCycle ? "synthetic-cycle-1" : null,
    deliveryRevision: ["delivered", "accepted"].includes(layer) ? "synthetic-delivery-v1" : null,
    priorCycleId: layer === "renewed" ? "synthetic-cycle-prior" : null,
    money: monetary || layer === "explicit_price_accepted" ? { currency: offer.price.currency, amountMinor: offer.price.amountMinor } : null,
    paymentStatus: monetary ? "reconciled" : null, evidenceReference: `synthetic-evidence-${layer}`,
    evidenceType: "synthetic", occurredAt: "2026-10-03T00:00:00.000Z", ...overrides };
}

export function offerResearchFixture() {
  const business = offerFixture("business_maintenance"), consumer = offerFixture("consumer");
  const commercialFacts = [];
  for (let number = 1; number <= 2; number++) {
    for (const layer of ["explicit_price_accepted", "contracted", "real_task_provided", "paid", "delivered", "accepted", "renewed", "delivered", "accepted"]) {
      const renewal = commercialFacts.filter(row => row.subjectReference === `synthetic-subject-${number}` && row.layer === "renewed").length > 0;
      const index = commercialFacts.length + 1;
      commercialFacts.push(commercialFactFixture(business, layer, { factId: `synthetic-fact-${index}`,
        subjectReference: `synthetic-subject-${number}`, evidenceReference: `synthetic-evidence-${index}`,
        ...(["paid", "delivered", "accepted", "renewed"].includes(layer) ? { cycleId: `synthetic-subject-${number}-cycle-${layer === "renewed" || renewal ? 2 : 1}` } : {}),
        ...(layer === "renewed" ? { priorCycleId: `synthetic-subject-${number}-cycle-1` } : {}) }));
    }
  }
  commercialFacts.push(commercialFactFixture(business, "refunded", { factId: "synthetic-refund-1", evidenceReference: "synthetic-refund-evidence-1",
    cycleId: "synthetic-subject-1-cycle-1", money: { currency: "JPY", amountMinor: 1000 } }));
  return { schemaVersion: 1, evidenceType: "synthetic", offers: [business, consumer],
    interviews: Array.from({ length: 6 }, (_, index) => ({ schemaVersion: 1, interviewId: `synthetic-interview-${index + 1}`,
      participantReference: `synthetic-maintainer-${index + 1}`, segment: ["marketing_agency", "food_media", "inhouse_operator", "frequent_maintainer"][index % 4],
      actualMaintainer: true, recentTaskEvidenceReference: `synthetic-task-reference-${index + 1}`,
      occurredAt: "2026-10-03T00:00:00.000Z", evidenceType: "synthetic" })),
    priceSignals: ["interested", "not_needed", "too_expensive", "unsure"].map((choice, index) => ({ schemaVersion: 1,
      signalId: `synthetic-signal-${index + 1}`, offerId: consumer.offerId, offerVersion: consumer.offerVersion, choice,
      sourceContext: "completed_analysis", occurredAt: "2026-10-03T00:00:00.000Z", evidenceType: "synthetic" })), commercialFacts };
}
