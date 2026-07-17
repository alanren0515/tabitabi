import test from "node:test";
import assert from "node:assert/strict";
import { deleteLocalData, LOCAL_STORAGE_KEY, PENDING_STORAGE_KEY, RECENT_STORAGE_KEY, SETTINGS_STORAGE_KEY, summarizeLocalData, VISIT_STORAGE_KEY } from "../src/privacy-data.js";
import { PILOT_ACCESS_SESSION_KEY } from "../src/settings.js";

test("summarizes only local plan persistence", () => {
  const summary = summarizeLocalData([{ id: "1" }, { id: "2" }]);
  assert.equal(summary.savedPlanCount, 2);
  assert.equal(summary.recentAnalysisCount, 0);
  assert.equal(summary.pendingAnalysisCount, 0);
  assert.equal(summary.thirdPartyDetailsPersisted, false);
});

test("deletes only the documented local storage key", () => {
  const removed = [];
  const sessionRemoved = [];
  const result = deleteLocalData({ removeItem: (key) => removed.push(key) }, { removeItem: (key) => sessionRemoved.push(key) });
  assert.deepEqual(removed, [LOCAL_STORAGE_KEY, RECENT_STORAGE_KEY, SETTINGS_STORAGE_KEY, PENDING_STORAGE_KEY, VISIT_STORAGE_KEY]);
  assert.deepEqual(sessionRemoved, [PILOT_ACCESS_SESSION_KEY]);
  assert.deepEqual(result.deletedKeys, [LOCAL_STORAGE_KEY, RECENT_STORAGE_KEY, SETTINGS_STORAGE_KEY, PENDING_STORAGE_KEY, VISIT_STORAGE_KEY, PILOT_ACCESS_SESSION_KEY]);
});
