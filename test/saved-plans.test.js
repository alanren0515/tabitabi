import test from "node:test";
import assert from "node:assert/strict";
import { createSavedPlan, normalizeSavedPlans, recordPlanReview, searchSavedPlans, sortSavedPlansByUrgency, updateSavedPlan } from "../src/saved-plans.js";

test("creates a privacy-minimized live saved plan with schedule and action status", () => {
  const item = createSavedPlan({
    restaurant: { id: "google:1", placeId: "1", name: "真实店名", sourceMode: "live", recommendation: "recommended", address: "不应保存的第三方详情" },
    userLabel: "用户保存的名称",
    plan: { planDate: "2026-08-01", planTime: "19:30", partySize: "4" },
    now: "2026-07-12T00:00:00.000Z"
  });
  assert.equal(item.planStatus, "needs_reservation");
  assert.equal(item.partySize, 4);
  assert.equal(item.name, "用户保存的名称");
  assert.equal(item.sourceMode, "live");
  assert.equal(item.address, undefined);
  assert.equal(item.snapshot, undefined);
});

test("keeps an explicitly selected example labelled in saved plans", () => {
  const item = createSavedPlan({
    restaurant: { id: "sample:1", name: "架空店", sourceMode: "demo", recommendation: "unknown" },
    plan: {}
  });
  assert.equal(item.sourceMode, "demo");
  assert.equal(item.restaurantId, "sample:1");
  assert.equal(item.snapshot, undefined);
});

test("creates independent UUID plans for the same restaurant on different dates", () => {
  const restaurant = { id: "google:1", placeId: "1", sourceMode: "live" };
  const first = createSavedPlan({ restaurant, plan: { planDate: "2026-08-01" } });
  const second = createSavedPlan({ restaurant, plan: { planDate: "2026-08-02" } });
  assert.match(first.id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(first.id, second.id);
  assert.equal(first.restaurantId, second.restaurantId);
  const items = normalizeSavedPlans([first, second]);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map(item => item.planDate), ["2026-08-01", "2026-08-02"]);
});

test("migrates stable old references without retaining unknown or third-party snapshots", () => {
  const old = { id: "google:old", name: "私の店", sourceMode: "live", placeId: "old", planStatus: "reserved", lastAnalyzedAt: "2026-07-12T00:00:00.000Z", snapshot: { secret: "forbidden" }, unknown: "forbidden", userClues: { name: "私の店", unknown: "forbidden" } };
  const [item] = normalizeSavedPlans([old]);
  assert.equal(item.schemaVersion, 2);
  assert.equal(item.legacyId, old.id);
  assert.equal(item.restaurantId, old.id);
  assert.equal(item.userProgress, "reserved_by_user");
  assert.equal(item.lastReviewedAt, null);
  assert.equal(item.lastReviewOutcome, null);
  assert.deepEqual(normalizeSavedPlans([old]), [item]);
  assert.deepEqual(normalizeSavedPlans([item]), [item]);
  assert.equal(JSON.stringify(item).includes("forbidden"), false);
});

test("preserves every saved plan and distinguishes legacy dates and duplicate references", () => {
  const items = normalizeSavedPlans(Array.from({ length: 240 }, (_, index) => ({ id: "same-restaurant", name: `店 ${index}`, planDate: index % 2 ? "2026-08-01" : "2026-08-02" })));
  assert.equal(items.length, 240);
  assert.equal(new Set(items.map(item => item.id)).size, 240);
  assert.deepEqual(normalizeSavedPlans(items), items);
});

test("validates actual calendar dates and preserves unknown times as unknown", () => {
  const [invalid] = normalizeSavedPlans([{ id: "old", planDate: "2026-02-30", planTime: "25:00", savedAt: "yesterday", updatedAt: "2026-02-30T00:00:00.000Z", lastAnalyzedAt: null }]);
  assert.equal(invalid.planDate, "");
  assert.equal(invalid.planTime, "");
  assert.equal(invalid.savedAt, null);
  assert.equal(invalid.updatedAt, null);
  assert.equal(invalid.lastAnalyzedAt, null);
  assert.equal(normalizeSavedPlans([{ id: "leap", planDate: "2028-02-29" }])[0].planDate, "2028-02-29");
  assert.equal(normalizeSavedPlans([{ id: "century", planDate: "2100-02-29" }])[0].planDate, "");
});

test("limits user fields, searches only user names and notes, and separates progress from system status", () => {
  const original = createSavedPlan({ restaurant: { id: "1", sourceMode: "live", name: "provider-only" }, userLabel: "ＡＢＣの店", userClues: { address: "地".repeat(600), unknown: "forbidden" }, plan: { note: "誕生日 ".repeat(200), planStatus: "needs_reservation" } });
  assert.ok(original.note.length <= 500 && original.note.length > 480);
  assert.equal(original.userClues.address.length, 500);
  assert.deepEqual(searchSavedPlans([original], "abc"), [original]);
  assert.equal(searchSavedPlans([original], "誕生日").length, 1);
  assert.equal(searchSavedPlans([original], "provider-only").length, 0);
  assert.equal(searchSavedPlans([original], "地").length, 0);
  const edited = updateSavedPlan(original, { userProgress: "visited", note: "行った", snapshot: { forbidden: true } });
  assert.equal(edited.planStatus, "needs_reservation");
  assert.equal(edited.userProgress, "visited");
  assert.equal(edited.revision, 2);
  assert.equal(edited.snapshot, undefined);
  assert.equal(original.userProgress, "want_to_go");
});

test("records only completed real reviews with reliable result times and an explicit terminal outcome", () => {
  const item = createSavedPlan({ restaurant: { id: "live", sourceMode: "live" }, plan: { userProgress: "reserved_by_user" }, now: "2026-07-12T00:00:00.000Z" });
  const completed = { sourceMode: "live", requestStatus: "completed", resultGeneratedAt: "2026-07-13T00:00:00.000Z", outcome: "unknown" };
  for (const review of [
    { ...completed, sourceMode: "demo" }, { ...completed, requestStatus: "failed" },
    { ...completed, requestStatus: "checking" }, { ...completed, resultGeneratedAt: null },
    { ...completed, resultGeneratedAt: "2026-02-30T00:00:00.000Z" }, { ...completed, outcome: "reserved" }
  ]) assert.deepEqual(recordPlanReview(item, review), item);
  const reviewed = recordPlanReview(item, completed);
  assert.equal(reviewed.lastReviewedAt, completed.resultGeneratedAt);
  assert.equal(reviewed.lastReviewOutcome, "unknown");
  assert.equal(reviewed.userProgress, item.userProgress);
  assert.equal(reviewed.revision, 2);
  assert.deepEqual(recordPlanReview(reviewed, { ...completed, resultGeneratedAt: "2026-07-12T00:00:00.000Z" }), reviewed);
  const demo = createSavedPlan({ restaurant: { id: "demo", sourceMode: "demo" } });
  assert.deepEqual(recordPlanReview(demo, completed), demo);
  assert.equal(normalizeSavedPlans([{ ...demo, lastReviewedAt: completed.resultGeneratedAt, lastReviewOutcome: "supported" }])[0].lastReviewedAt, null);
  const editedLater = updateSavedPlan(item, { note: "編集中" }, "2026-07-14T00:00:00.000Z");
  assert.equal(recordPlanReview(editedLater, completed).updatedAt, editedLater.updatedAt);
});

test("updates status while preserving the rest of a saved plan", () => {
  const updated = updateSavedPlan({ id: "1", planStatus: "needs_reservation", partySize: 2 }, { planStatus: "reserved" }, "2026-07-13T00:00:00.000Z");
  assert.equal(updated.planStatus, "reserved");
  assert.equal(updated.partySize, 2);
});

test("migrates old bookmarks to the current plan defaults", () => {
  const [item] = normalizeSavedPlans([{ id: "old", recommendation: "walk_in_ok", savedAt: "2026-01-01T00:00:00.000Z" }]);
  assert.equal(item.planStatus, "walk_in");
  assert.equal(item.partySize, 2);
});

test("sorts saved plans by action urgency and upcoming date without mutating storage order", () => {
  const plans = [
    { id: "reserved", planStatus: "reserved", planDate: "2026-07-20" },
    { id: "needs-later", planStatus: "needs_reservation", planDate: "2026-08-01" },
    { id: "unknown", planStatus: "information_needed", planDate: "2026-07-14" },
    { id: "needs-soon", planStatus: "needs_reservation", planDate: "2026-07-15" },
    { id: "needs-undated", planStatus: "needs_reservation", planDate: "" },
    { id: "needs-past", planStatus: "needs_reservation", planDate: "2026-07-10" }
  ];
  const sorted = sortSavedPlansByUrgency(plans, "2026-07-13");
  assert.deepEqual(sorted.map((item) => item.id), ["needs-soon", "needs-later", "needs-undated", "needs-past", "unknown", "reserved"]);
  assert.deepEqual(plans.map((item) => item.id), ["reserved", "needs-later", "unknown", "needs-soon", "needs-undated", "needs-past"]);
});

test("a selected plan cannot bind a same-name different branch or demo result", async () => {
  const {savedPlanMatchesRestaurant}=await import("../src/saved-plans.js");
  const a=createSavedPlan({restaurant:{id:"google:a",placeId:"a",sourceMode:"live"},userClues:{name:"同名店"}});
  assert.equal(savedPlanMatchesRestaurant(a,{id:"google:a",placeId:"a",sourceMode:"live"}),true);
  assert.equal(savedPlanMatchesRestaurant(a,{id:"google:b",placeId:"b",sourceMode:"live"}),false);
  assert.equal(savedPlanMatchesRestaurant(a,{id:"google:a",placeId:"a",sourceMode:"demo"}),false);
  assert.equal(savedPlanMatchesRestaurant(a,{id:"google:a",sourceMode:"live"}),false);
});
