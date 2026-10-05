import test from "node:test";
import assert from "node:assert/strict";
import { addRecentAnalysis, createRecentAnalysis, normalizeRecentAnalyses } from "../src/recent-analyses.js";

test("stores only a place id, user clues, and plan for live recent analyses", () => {
  const entry = createRecentAnalysis({
    restaurant: { id: "google:p1", placeId: "p1", sourceMode: "live", name: "Google-provided name", rating: 4.8, address: "third-party address" },
    userClues: { name: "用户输入店名", area: "上野", address: "用户输入地址" },
    plan: { planDate: "2026-07-18", planTime: "19:30", partySize: 4 },
    now: "2026-07-13T06:00:00.000Z"
  });
  assert.equal(entry.placeId, "p1");
  assert.equal(entry.name, "用户输入店名");
  assert.equal(entry.userClues.address, "用户输入地址");
  assert.equal("rating" in entry, false);
  assert.equal("address" in entry, false);
  assert.equal("snapshot" in entry, false);
});

test("demo history also drops snapshots and unsupported fields", () => {
  const [entry] = normalizeRecentAnalyses([{ id: "demo", name: "例", sourceMode: "demo", analyzedAt: "unknown", planDate: "2026-02-30", snapshot: { secret: "forbidden" }, unknown: "forbidden", userClues: { name: "自写店", unsupported: "forbidden" } }]);
  assert.equal(entry.analyzedAt, null);
  assert.equal(entry.planDate, "");
  assert.equal(entry.userClues.name, "自写店");
  assert.equal(JSON.stringify(entry).includes("forbidden"), false);
  const created = createRecentAnalysis({ restaurant: { id: "demo", sourceMode: "demo", name: "例", snapshot: { secret: "forbidden" } }, now: "not a timestamp" });
  assert.equal(created.analyzedAt, null);
  assert.equal(created.snapshot, undefined);
});

test("deduplicates recent restaurants and caps history at ten", () => {
  const entries = Array.from({ length: 12 }, (_, index) => ({ id: `id-${index}`, analyzedAt: `2026-07-13T${String(index).padStart(2, "0")}:00:00.000Z`, sourceMode: "demo", name: `店 ${index}` }));
  const updated = addRecentAnalysis(entries, { id: "id-5", analyzedAt: "2026-07-14T00:00:00.000Z", sourceMode: "demo", name: "店 5 再分析" });
  assert.equal(updated.length, 10);
  assert.equal(updated[0].name, "店 5 再分析");
  assert.equal(updated.filter((item) => item.id === "id-5").length, 1);
});

test("removes persisted third-party snapshots from live history during normalization", () => {
  const [entry] = normalizeRecentAnalyses([{ id: "google:p1", placeId: "p1", sourceMode: "live", name: "用户店名", analyzedAt: "2026-07-13T06:00:00.000Z", snapshot: { rating: 5 } }]);
  assert.equal("snapshot" in entry, false);
  assert.equal(entry.requiresRefresh, true);
});
