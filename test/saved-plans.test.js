import test from "node:test";
import assert from "node:assert/strict";
import { createSavedPlan, normalizeSavedPlans, sortSavedPlansByUrgency, updateSavedPlan } from "../src/saved-plans.js";

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
  assert.equal(item.address, undefined);
  assert.equal(item.snapshot, undefined);
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
