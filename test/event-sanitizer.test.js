import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeEvent } from "../server/event-sanitizer.mjs";

test("accepts the complete MVP feedback event without unrelated payload fields", () => {
  const now = new Date("2026-07-13T06:00:00.000Z");
  const record = sanitizeEvent({
    event: "feedback_submitted",
    placeId: "place-1",
    sourceMode: "live",
    helpful: true,
    bookingOutcome: "succeeded",
    accuracy: "partly_wrong",
    willingnessToPay: "depends_on_price",
    feedbackText: "营业时间需要更新",
    rawInput: "must not be logged",
    screenshot: "must not be logged"
  }, now);
  assert.equal(record.event, "feedback_submitted");
  assert.equal(record.helpful, true);
  assert.equal(record.bookingOutcome, "succeeded");
  assert.equal(record.accuracy, "partly_wrong");
  assert.equal(record.willingnessToPay, "depends_on_price");
  assert.equal(record.feedbackText, "营业时间需要更新");
  assert.equal(record.occurredAt, now.toISOString());
  assert.equal("rawInput" in record, false);
  assert.equal("screenshot" in record, false);
});

test("rejects unsupported events and strips invalid categorical values", () => {
  assert.equal(sanitizeEvent({ event: "arbitrary_event" }), null);
  const record = sanitizeEvent({ event: "input_submitted", inputType: "password", bookingOutcome: "maybe" });
  assert.equal(record.inputType, null);
  assert.equal(record.bookingOutcome, null);
  assert.equal("willingnessToPay" in sanitizeEvent({ event: "feedback_submitted", willingnessToPay: "maybe" }), false);
});

test("accepts webpage as a privacy-safe input type without recording its URL", () => {
  const record = sanitizeEvent({ event: "input_submitted", inputType: "webpage", url: "https://restaurant.example/private-path" });
  assert.equal(record.inputType, "webpage");
  assert.equal("url" in record, false);
});

test("caps explicit free-text feedback to a small bounded field", () => {
  const record = sanitizeEvent({ event: "feedback_submitted", feedbackText: `  ${"a".repeat(800)}  ` });
  assert.equal(record.feedbackText.length, 500);
});

test("keeps bounded candidate ranking evidence without restaurant content", () => {
  const record = sanitizeEvent({ event: "candidate_confirmed", candidateCount: 3, selectedRank: 2, candidateName: "must not be logged" });
  assert.equal(record.candidateCount, 3);
  assert.equal(record.selectedRank, 2);
  assert.equal("candidateName" in record, false);
  assert.equal(sanitizeEvent({ event: "candidate_confirmed", candidateCount: 99, selectedRank: 0 }).selectedRank, null);
});

test("records bounded analysis latency and candidate preview cache status", () => {
  const completed = sanitizeEvent({ event: "analysis_completed", analysisDurationMs: 12_345 });
  assert.equal(completed.analysisDurationMs, 12_345);
  assert.equal(sanitizeEvent({ event: "analysis_completed", analysisDurationMs: 300_001 }).analysisDurationMs, null);

  const preview = sanitizeEvent({ event: "candidate_preview_loaded", placeId: "place-1", sourceMode: "live", cacheStatus: "hit", rating: 4.8 });
  assert.equal(preview.cacheStatus, "hit");
  assert.equal(preview.sourceMode, "live");
  assert.equal("rating" in preview, false);
});

test("records only a bounded pending queue count without restaurant clues", () => {
  const record = sanitizeEvent({ event: "pending_queue_added", queueCount: 4, restaurantNames: ["must not be logged"] });
  assert.equal(record.queueCount, 4);
  assert.equal("restaurantNames" in record, false);
  assert.equal(sanitizeEvent({ event: "pending_queue_added", queueCount: 31 }).queueCount, null);
});

test("keeps audit traffic separate and accepts only opaque bounded analysis run ids", () => {
  const record = sanitizeEvent({ event: "analysis_completed", trafficType: "audit", analysisRunId: "run_12345678" });
  assert.equal(record.trafficType, "audit");
  assert.equal(record.analysisRunId, "run_12345678");
  assert.equal(sanitizeEvent({ event: "analysis_completed", analysisRunId: "contains spaces" }).analysisRunId, null);
  assert.equal(sanitizeEvent({ event: "analysis_completed" }).trafficType, "product");
});

test("records privacy-safe visit categories without a user identifier", () => {
  const record = sanitizeEvent({ event: "app_visit", visitType: "return_within_7d", userId: "must not be logged" });
  assert.equal(record.visitType, "return_within_7d");
  assert.equal("userId" in record, false);
});

test("records only the server-provided deployment revision", () => {
  const trusted = "a".repeat(40);
  const record = sanitizeEvent({ event: "input_submitted", releaseRevision: "b".repeat(40) }, new Date(), { releaseRevision: trusted });
  assert.equal(record.releaseRevision, trusted);
  assert.equal("releaseRevision" in sanitizeEvent({ event: "input_submitted", releaseRevision: trusted }), false);
});
