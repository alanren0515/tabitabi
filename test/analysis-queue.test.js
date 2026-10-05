import test from "node:test";
import assert from "node:assert/strict";
import { addPendingRestaurants, addPendingRestaurantsWithReport, batchProgress, normalizePendingAnalyses, parseBatchRestaurantLines, pendingAnalysisToTextExtraction, pendingWork, recoverPendingAnalyses, removePendingAnalysis, restaurantClueKey, transitionPendingAnalysis } from "../src/analysis-queue.js";

test("queues the other screenshot restaurants without persisting screenshot or engagement data", () => {
  const queued = addPendingRestaurants([], [
    { name: "一蘭", branch: "渋谷店", address: "東京都渋谷区", screenshot: "must not persist" },
    { name: "AFURI", branch: "原宿", area: "原宿", likes: 1000 }
  ], { excludeRestaurant: { name: "一蘭", branch: "渋谷店", address: "東京都渋谷区" }, sourcePlatform: "tiktok", now: "2026-07-13T00:00:00.000Z" });
  assert.equal(queued.length, 1);
  assert.equal(queued[0].clues.name, "AFURI");
  assert.equal(queued[0].sourcePlatform, "tiktok");
  assert.equal("screenshot" in queued[0].clues, false);
  assert.equal("likes" in queued[0].clues, false);
});

test("preserves a station-only restaurant clue through the pending queue", () => {
  const queued = addPendingRestaurants([], [{ name: "ホームズパスタ", nearest_station: "上野駅" }], { sourcePlatform: "instagram" });
  assert.equal(queued[0].clues.nearest_station, "上野駅");
  const extraction = pendingAnalysisToTextExtraction(queued[0]);
  assert.match(extraction.searchQuery, /上野駅/);
  assert.match(restaurantClueKey(queued[0].clues), /上野駅/);
});

test("deduplicates pending restaurants and converts one into editable text clues", () => {
  const first = addPendingRestaurants([], [{ name: "AFURI", branch: "原宿", area: "原宿" }], { now: "2026-07-13T00:00:00.000Z" });
  const again = addPendingRestaurants(first, [{ name: "ＡＦＵＲＩ", branch: "原宿", area: "原宿" }], { now: "2026-07-14T00:00:00.000Z" });
  assert.equal(again.length, 1);
  const extraction = pendingAnalysisToTextExtraction(again[0], 4);
  assert.equal(extraction.clues.name, "ＡＦＵＲＩ");
  assert.equal(extraction.plan.partySize, 4);
  assert.equal(extraction.kind, "pending_analysis");
});

test("normalizes, bounds, and removes local pending analyses", () => {
  const normalized = normalizePendingAnalyses([
    { id: "one", clues: { name: "店A", address: "a" }, sourcePlatform: "invalid", addedAt: "invalid" },
    { id: "duplicate", clues: { name: "店A", address: "a" } },
    { id: "missing", clues: { area: "東京" } }
  ]);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].sourcePlatform, "unknown");
  assert.deepEqual(removePendingAnalysis(normalized, "one"), []);
});

test("parses a privacy-safe batch list without starting restaurant searches", () => {
  const parsed = parseBatchRestaurantLines(`一蘭 渋谷店\nAFURI｜原宿｜東京都渋谷区千駄ヶ谷3-63-1\nすし大\t本館\t築地`);
  assert.equal(parsed.totalLineCount, 3);
  assert.deepEqual(parsed.restaurants, [
    { name: "一蘭 渋谷店" },
    { name: "AFURI", branch: "原宿", address: "東京都渋谷区千駄ヶ谷3-63-1" },
    { name: "すし大", branch: "本館", address: "築地" }
  ]);
  assert.equal(parsed.truncated, false);
});

test("caps batch input at thirty non-empty lines", () => {
  const parsed = parseBatchRestaurantLines(Array.from({ length: 35 }, (_, index) => `店${index}`).join("\n"));
  assert.equal(parsed.restaurants.length, 30);
  assert.equal(parsed.truncated, true);
});

test("queue continuations preserve original batch and never upgrade unknown legacy origin", () => {
  const first = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const initial = addPendingRestaurants([], [{ name: "店A" }], { batchId: first });
  const merged = addPendingRestaurants(initial, [{ name: "店A" }, { name: "店B" }], { batchId: second });
  assert.equal(merged[0].batchId, first); assert.equal(merged[1].batchId, second);
  const legacy = addPendingRestaurants([{ clues: { name: "店A" } }], [{ name: "店A" }], { batchId: second });
  assert.equal(legacy[0].batchId, null);
});

test("paused structured drafts recover without images or repeating completed work", () => {
  const batchId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  let items = addPendingRestaurants([], [{name:"店A"},{name:"店B"}],{batchId});
  items = transitionPendingAnalysis(items,items[0].id,"completed");
  items = transitionPendingAnalysis(items,items[1].id,"paused",{draft:{clues:{name:"店B 修正",image:"private"},plan:{planDate:"2026-10-08",partySize:4},image:"private"}});
  assert.equal(pendingWork(items).length,1);
  assert.deepEqual(batchProgress(items).map(x=>[x.total,x.completed,x.pending]),[[2,1,1]]);
  assert.equal(pendingAnalysisToTextExtraction(items[1]).clues.name,"店B 修正");
  assert.equal(pendingAnalysisToTextExtraction(items[1]).plan.partySize,4);
  assert.equal(JSON.stringify(items).includes("private"),false);
  assert.equal(transitionPendingAnalysis(items,items[0].id,"reviewing")[0].status,"completed");
  items = transitionPendingAnalysis(items,items[1].id,"reviewing");
  assert.equal(recoverPendingAnalyses(items)[1].status,"pending");
  assert.equal(recoverPendingAnalyses(items)[1].paused,true);
});

test("batch import reports capacity exclusions and does not erase saved edits on duplicate input", () => {
  let items=addPendingRestaurants([],Array.from({length:29},(_,i)=>({name:"店"+i})));
  items=transitionPendingAnalysis(items,items[0].id,"failed",{failureStage:"search",draft:{clues:{name:"店0 修正"}}});
  const report=addPendingRestaurantsWithReport(items,[{name:"新A"},{name:"新B"},{name:"新C"},{name:"店0"}]);
  assert.equal(report.addedCount,1); assert.equal(report.rejectedCount,2); assert.equal(report.duplicateCount,1);
  assert.equal(report.items[0].draft.clues.name,"店0 修正");
  assert.equal(report.items[0].status,"failed");
  assert.equal(normalizePendingAnalyses([{clues:{name:"bad-date"},draft:{plan:{planDate:"2026-99-99"}}}])[0].draft.plan.planDate,"");
});

test("migrates legacy queue identities stably and tolerates malformed elements", () => {
  const records=normalizePendingAnalyses([null,7,[],{id:"pending:legacy",clues:{name:"本店"},revision:1.5,status:"completed",paused:true,addedAt:"bad"}]);
  assert.equal(records.length,1);
  assert.match(records[0].id,/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(records[0].legacyId,"pending:legacy");
  assert.deepEqual(normalizePendingAnalyses(records),records);
  assert.equal(records[0].addedAt,null);
  assert.equal(records[0].revision,1);
  assert.equal(records[0].paused,false);
});

test("leaving a failed task preserves failure and the current draft", async () => {
  const {pausePendingAnalysis}=await import("../src/analysis-queue.js");
  let items=addPendingRestaurants([], [{name:"失敗店"}]);
  const id=items[0].id;
  items=transitionPendingAnalysis(items,id,"failed",{failureStage:"details"});
  items=pausePendingAnalysis(items,id,{clues:{name:"失敗店 修正"},plan:{partySize:4}});
  assert.equal(items[0].status,"failed");assert.equal(items[0].failureStage,"details");
  assert.equal(items[0].draft.clues.name,"失敗店 修正");
});
