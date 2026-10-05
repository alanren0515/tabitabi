import test from "node:test";
import assert from "node:assert/strict";
import { createLocalTaskStorage, restoreDeletedTasks, LOCAL_TASK_BACKUP_KEYS, LOCAL_TASK_STORAGE_KEYS } from "../src/local-task-storage.js";
import { createSavedPlan, normalizeSavedPlans, updateSavedPlan } from "../src/saved-plans.js";
import { normalizeRecentAnalyses } from "../src/recent-analyses.js";
import { normalizePendingAnalyses } from "../src/analysis-queue.js";

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const calls = [];
  return {
    data, calls,
    getItem(key) { calls.push(["get", key]); return data.get(key) ?? null; },
    setItem(key, value) { calls.push(["set", key, value]); data.set(key, value); },
    removeItem(key) { calls.push(["remove", key]); data.delete(key); }
  };
}
const legacySaved = [{ id: "google:old", placeId: "old", sourceMode: "live", name: "私の店", planDate: "2026-08-01", planStatus: "reserved", note: "私のメモ", lastAnalyzedAt: "2026-07-12T00:00:00.000Z", unknown: "forbidden", snapshot: { address: "forbidden" }, userClues: { name: "私の店", unsupported: "forbidden" } }];
const domainNormalizers = { saved: normalizeSavedPlans, recent: normalizeRecentAnalyses, pending: normalizePendingAnalyses };

function domainItems(domain, count = 1, prefix = "Original") {
  return domainNormalizers[domain](Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`, name: `${prefix} ${index}`, clues: { name: `${prefix} ${index}` }
  })));
}

function blockReads(storage) {
  const originalGet = storage.getItem;
  let blocked = true;
  storage.getItem = function (key) { if (blocked) throw new Error("denied"); return originalGet.call(this, key); };
  return () => { blocked = false; };
}

test("undo restores only removed records and preserves later additions and edits in every domain", () => {
  for (const domain of Object.keys(domainNormalizers)) {
    const removed = domainItems(domain, 1, "Removed");
    const current = domainItems(domain, 1, "Added later");
    const restored = restoreDeletedTasks(domain, current, removed);
    assert.equal(restored.restored, true);
    assert.deepEqual(restored.items, [...current, ...removed]);
    const updated = domainNormalizers[domain]([{ ...removed[0], revision: 5 }]);
    assert.deepEqual(restoreDeletedTasks(domain, updated, removed).items, updated);
  }
});

test("undo at capacity cannot evict newer records or partially restore a deletion", () => {
  for (const [domain, capacity] of [["pending", 30], ["recent", 10]]) {
    const current = domainItems(domain, capacity, "Newer");
    const removed = domainItems(domain, 1, "Removed");
    assert.deepEqual(restoreDeletedTasks(domain, current, removed), { restored: false, items: current });
  }
});

test("undo cannot replace a newly created queue item with the same clues", () => {
  const [removed] = domainItems("pending", 1);
  const current = normalizePendingAnalyses([{ ...removed, id: "00000000-0000-4000-8000-000000000001", revision: 6 }]);
  assert.deepEqual(restoreDeletedTasks("pending", current, [removed]), { restored: false, items: current });
});

test("an absent domain is ready and does not create a backup or write on load", () => {
  const storage = memoryStorage();
  const service = createLocalTaskStorage({ storage });
  assert.deepEqual(service.load("saved"), { items: [], status: "ready", omittedCount: 0 });
  assert.deepEqual(storage.calls, [["get", LOCAL_TASK_STORAGE_KEYS.saved]]);
});

test("migrates a safe backup before replacement and exports no unknown or third-party fields", () => {
  const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS.saved]: JSON.stringify(legacySaved) });
  const service = createLocalTaskStorage({ storage });
  const loaded = service.load("saved");
  assert.equal(loaded.status, "ready");
  assert.equal(loaded.items[0].legacyId, "google:old");
  assert.equal(loaded.items[0].lastReviewedAt, null);
  assert.deepEqual(storage.calls.filter(([operation]) => operation === "set").map(([, key]) => key), [LOCAL_TASK_BACKUP_KEYS.saved, LOCAL_TASK_STORAGE_KEYS.saved]);
  assert.equal(storage.data.get(LOCAL_TASK_BACKUP_KEYS.saved).includes("forbidden"), false);
  assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS.saved).includes("forbidden"), false);
  assert.equal(JSON.stringify(service.exportDomain("saved")).includes("forbidden"), false);
});

test("backup failure preserves the only original and gates rendering-triggered writes", () => {
  const raw = JSON.stringify(legacySaved);
  const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS.saved]: raw });
  const originalSet = storage.setItem;
  storage.setItem = function (key, value) {
    if (key === LOCAL_TASK_BACKUP_KEYS.saved) throw new Error("quota");
    originalSet.call(this, key, value);
  };
  const service = createLocalTaskStorage({ storage });
  const loaded = service.load("saved");
  assert.equal(loaded.status, "migration_failed");
  assert.equal(loaded.items[0].name, "私の店");
  const safe = service.write("saved", [...loaded.items]);
  assert.equal(safe.status, "migration_failed");
  assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS.saved), raw);
  assert.equal(JSON.stringify(safe).includes("forbidden"), false);
});

test("replacement failure keeps the original and retry retains edits made in memory", () => {
  const raw = JSON.stringify(legacySaved);
  const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS.saved]: raw });
  const originalSet = storage.setItem;
  let fail = true;
  storage.setItem = function (key, value) {
    if (fail && key === LOCAL_TASK_STORAGE_KEYS.saved) throw new Error("quota");
    originalSet.call(this, key, value);
  };
  const service = createLocalTaskStorage({ storage });
  const loaded = service.load("saved");
  assert.equal(loaded.status, "migration_failed");
  assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS.saved), raw);
  assert.equal(storage.data.get(LOCAL_TASK_BACKUP_KEYS.saved).includes("forbidden"), false);
  const edited = updateSavedPlan(loaded.items[0], { note: "編集中のメモ", userProgress: "visited" }, "2026-08-02T00:00:00.000Z");
  assert.equal(service.write("saved", [edited]).items[0].note, "編集中のメモ");
  fail = false;
  const retried = service.retry("saved");
  assert.equal(retried.status, "ready");
  assert.deepEqual(retried.items, [edited]);
  assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS.saved)), [edited]);
  assert.equal(JSON.parse(storage.data.get(LOCAL_TASK_BACKUP_KEYS.saved))[0].note, "私のメモ");
});

test("bad JSON and structurally unreadable records remain corrupt rather than empty ready", () => {
  for (const raw of ["{broken", "{}", JSON.stringify([...legacySaved, { unknown: "forbidden" }])]) {
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS.saved]: raw });
    const service = createLocalTaskStorage({ storage });
    const loaded = service.load("saved");
    assert.equal(loaded.status, "corrupt");
    service.write("saved", loaded.items);
    assert.equal(service.retry("saved").status, "corrupt");
    assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS.saved), raw);
    assert.equal(JSON.stringify(service.exportDomain("saved")).includes("forbidden"), false);
    assert.equal(storage.calls.some(([operation]) => operation === "set"), false);
  }
});

test("unavailable reads retain a new safe draft and retry persists it once storage recovers", () => {
  const storage = memoryStorage();
  const originalGet = storage.getItem;
  let fail = true;
  storage.getItem = function (key) { if (fail) throw new Error("denied"); return originalGet.call(this, key); };
  const service = createLocalTaskStorage({ storage });
  assert.equal(service.load("saved").status, "unavailable");
  const draft = createSavedPlan({ restaurant: { id: "demo", sourceMode: "demo", name: "例" }, plan: { note: "オフライン編集" } });
  assert.deepEqual(service.write("saved", [draft]).items, [draft]);
  fail = false;
  assert.deepEqual(service.retry("saved"), { items: [draft], status: "ready", omittedCount: 0 });
  assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS.saved)), [draft]);
});

test("a first unavailable read and empty render write cannot delete unseen records in any domain", () => {
  for (const domain of Object.keys(domainNormalizers)) {
    const original = domainItems(domain);
    const raw = JSON.stringify(original);
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: raw });
    const recoverReads = blockReads(storage);
    const service = createLocalTaskStorage({ storage });
    assert.deepEqual(service.load(domain), { items: [], status: "unavailable", omittedCount: 0 });
    assert.deepEqual(service.write(domain, []).items, []);
    recoverReads();
    assert.deepEqual(service.retry(domain), { items: original, status: "ready", omittedCount: 0 });
    assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain]), raw);
  }
});

test("first-read recovery merges new safe drafts with unseen records in all three domains", () => {
  for (const domain of Object.keys(domainNormalizers)) {
    const original = domainItems(domain);
    const drafts = domainItems(domain, 1, "Draft");
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: JSON.stringify(original) });
    const recoverReads = blockReads(storage);
    const service = createLocalTaskStorage({ storage });
    assert.equal(service.load(domain).status, "unavailable");
    assert.deepEqual(service.write(domain, drafts).items, drafts);
    recoverReads();
    const combined = [...original, ...drafts];
    assert.deepEqual(service.retry(domain), { items: combined, status: "ready", omittedCount: 0 });
    assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain])), combined);
  }
});

test("first-read same-ID conflicts remain blocked across rendering and repeated retries in every domain", () => {
  for (const domain of Object.keys(domainNormalizers)) {
    const original = domainItems(domain);
    const raw = JSON.stringify(original);
    const conflict = domainNormalizers[domain]([domain === "pending"
      ? { ...original[0], draft: { ...original[0].draft, plan: { ...original[0].draft.plan, planDate: "2026-10-10" } } }
      : { ...original[0], name: "Conflicting name" }]);
    assert.equal(conflict[0].id, original[0].id);
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: raw });
    const recoverReads = blockReads(storage);
    const service = createLocalTaskStorage({ storage });
    assert.equal(service.load(domain).status, "unavailable");
    service.write(domain, conflict);
    recoverReads();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retried = service.retry(domain);
      assert.deepEqual(retried, { items: conflict, status: "migration_failed", omittedCount: 0 });
      assert.equal(service.write(domain, retried.items).status, "migration_failed");
      assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain]), raw);
    }
    assert.deepEqual(service.exportDomain(domain).items, conflict);
    assert.equal(storage.calls.some(([operation]) => operation === "set"), false);
  }
});

test("identical same-ID memory records are kept once during first-read recovery", () => {
  for (const domain of Object.keys(domainNormalizers)) {
    const original = domainItems(domain);
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: JSON.stringify(original) });
    const recoverReads = blockReads(storage);
    const service = createLocalTaskStorage({ storage });
    service.load(domain);
    service.write(domain, original);
    recoverReads();
    assert.deepEqual(service.retry(domain), { items: original, status: "ready", omittedCount: 0 });
    assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain])), original);
  }
});

test("first-read merges that exceed history or queue capacity retain the original and draft until repaired", () => {
  for (const [domain, capacity] of [["recent", 10], ["pending", 30]]) {
    const original = domainItems(domain, capacity);
    const drafts = domainItems(domain, 1, "Draft");
    const raw = JSON.stringify(original);
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: raw });
    const recoverReads = blockReads(storage);
    const service = createLocalTaskStorage({ storage });
    service.load(domain);
    service.write(domain, drafts);
    recoverReads();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const retried = service.retry(domain);
      assert.deepEqual(retried, { items: drafts, status: "migration_failed", omittedCount: 1 });
      assert.equal(service.write(domain, retried.items).omittedCount, 1);
      assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain]), raw);
    }
    assert.equal(storage.calls.some(([operation]) => operation === "set"), false);
    const repaired = original.slice(0, capacity - 1);
    storage.data.set(LOCAL_TASK_STORAGE_KEYS[domain], JSON.stringify(repaired));
    assert.deepEqual(service.retry(domain), { items: [...repaired, ...drafts], status: "ready", omittedCount: 0 });
    assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain])), [...repaired, ...drafts]);
  }
});

test("first-read recovery cannot silently deduplicate an unseen pending record with different identity", () => {
  const original = domainItems("pending");
  const draft = { ...original[0], id: "12345678-1234-4234-8234-123456789abc", legacyId: null };
  const raw = JSON.stringify(original);
  const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS.pending]: raw });
  const recoverReads = blockReads(storage);
  const service = createLocalTaskStorage({ storage });
  service.load("pending");
  service.write("pending", [draft]);
  recoverReads();
  assert.deepEqual(service.retry("pending"), { items: [draft], status: "migration_failed", omittedCount: 1 });
  assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS.pending), raw);
});

test("a recovered merged baseline supports subsequent memory deletions when persistence still fails", () => {
  for (const domain of Object.keys(domainNormalizers)) {
    const original = domainItems(domain);
    const drafts = domainItems(domain, 1, "Draft");
    const raw = JSON.stringify(original);
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: raw });
    const recoverReads = blockReads(storage);
    const originalSet = storage.setItem;
    const service = createLocalTaskStorage({ storage });
    service.load(domain);
    service.write(domain, drafts);
    recoverReads();
    storage.setItem = () => { throw new Error("quota"); };
    assert.deepEqual(service.retry(domain), { items: [...original, ...drafts], status: "unavailable", omittedCount: 0 });
    assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain]), raw);
    service.write(domain, []);
    storage.setItem = originalSet;
    assert.deepEqual(service.retry(domain), { items: [], status: "ready", omittedCount: 0 });
    assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain])), []);
  }
});

test("known baselines continue retrying edits and deletions in every domain", () => {
  for (const domain of Object.keys(domainNormalizers)) {
    const original = domainItems(domain);
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: JSON.stringify(original) });
    const originalSet = storage.setItem;
    const service = createLocalTaskStorage({ storage });
    assert.equal(service.load(domain).status, "ready");
    const edited = domainNormalizers[domain]([domain === "pending"
      ? { ...original[0], draft: { ...original[0].draft, clues: { name: "Edited draft" } } }
      : { ...original[0], name: "Edited name" }]);
    storage.setItem = () => { throw new Error("quota"); };
    assert.equal(service.write(domain, edited).status, "unavailable");
    storage.setItem = originalSet;
    assert.deepEqual(service.retry(domain).items, edited);
    assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain])), edited);
    storage.setItem = () => { throw new Error("quota"); };
    service.write(domain, []);
    storage.setItem = originalSet;
    assert.deepEqual(service.retry(domain).items, []);
    assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain])), []);
  }
});

test("a ready write failure returns the caller's safe memory version and retries deletions too", () => {
  const plans = normalizeSavedPlans(legacySaved);
  const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS.saved]: JSON.stringify(plans) });
  const originalSet = storage.setItem;
  const service = createLocalTaskStorage({ storage });
  assert.equal(service.load("saved").status, "ready");
  storage.setItem = () => { throw new Error("quota"); };
  const edited = updateSavedPlan(plans[0], { note: "最新版" });
  const failed = service.write("saved", [{ ...edited, unknown: "forbidden", snapshot: { forbidden: true } }]);
  assert.equal(failed.status, "unavailable");
  assert.equal(failed.items[0].note, "最新版");
  assert.equal(JSON.stringify(failed).includes("forbidden"), false);
  assert.deepEqual(service.load("saved").items, failed.items);
  service.write("saved", []);
  storage.setItem = originalSet;
  assert.deepEqual(service.retry("saved").items, []);
  assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS.saved)), []);
});

test("domain limits retain every saved plan but bound recent and pending with omitted counts", () => {
  const storage = memoryStorage();
  const service = createLocalTaskStorage({ storage });
  const saved = Array.from({ length: 240 }, (_, index) => ({ id: `plan-${index}` }));
  const recent = Array.from({ length: 12 }, (_, index) => ({ id: `recent-${index}`, analyzedAt: "unknown" }));
  const pending = Array.from({ length: 32 }, (_, index) => ({ id: `pending-${index}`, clues: { name: `店 ${index}` }, status: "reviewing" }));
  assert.equal(service.write("saved", saved).items.length, 240);
  assert.equal(service.write("recent", recent).omittedCount, 2);
  assert.equal(service.load("recent").items.length, 10);
  assert.equal(service.write("pending", pending).omittedCount, 2);
  assert.equal(service.load("pending").items.length, 30);
  assert.equal(service.load("pending").items[0].status, "reviewing");
});

test("loading oversized history or queue preserves the original instead of silently dropping excess records", () => {
  const originals = {
    recent: Array.from({ length: 12 }, (_, index) => ({ id: `recent-${index}`, name: `店 ${index}`, unknown: "forbidden" })),
    pending: Array.from({ length: 32 }, (_, index) => ({ id: `pending-${index}`, clues: { name: `店 ${index}` }, unknown: "forbidden" }))
  };
  for (const domain of ["recent", "pending"]) {
    const raw = JSON.stringify(originals[domain]);
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: raw });
    const service = createLocalTaskStorage({ storage });
    const loaded = service.load(domain);
    assert.equal(loaded.status, "migration_failed");
    assert.equal(loaded.omittedCount, 2);
    assert.equal(loaded.items.length, domain === "recent" ? 10 : 30);
    assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain]), raw);
    assert.equal(storage.data.get(LOCAL_TASK_BACKUP_KEYS[domain]).includes("forbidden"), false);
    assert.equal(JSON.stringify(service.exportDomain(domain)).includes("forbidden"), false);
    assert.equal(service.write(domain, loaded.items).omittedCount, 2);
    assert.equal(service.retry(domain).status, "migration_failed");
    assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain]), raw);
    assert.equal(storage.calls.some(([operation, key]) => operation === "set" && key === LOCAL_TASK_STORAGE_KEYS[domain]), false);
    // An explicit repair within capacity permits retry; the safe memory edit
    // made while blocked still wins over that older repaired source version.
    const edited = loaded.items.map((item, index) => index === 0 ? { ...item, name: "編集中の名称", ...(domain === "pending" ? { clues: { name: "編集中の名称" } } : {}) } : item);
    service.write(domain, edited);
    storage.data.set(LOCAL_TASK_STORAGE_KEYS[domain], JSON.stringify(originals[domain].slice(0, domain === "recent" ? 10 : 30)));
    const retried = service.retry(domain);
    assert.equal(retried.status, "ready");
    assert.equal(domain === "recent" ? retried.items[0].name : retried.items[0].clues.name, "編集中の名称");
  }
});

test("recent and pending migration/export use their whitelists including draft fields", () => {
  const storage = memoryStorage({
    [LOCAL_TASK_STORAGE_KEYS.recent]: JSON.stringify([{ id: "demo", sourceMode: "demo", name: "例", snapshot: { secret: "forbidden" }, unknown: "forbidden", analyzedAt: "unknown" }]),
    [LOCAL_TASK_STORAGE_KEYS.pending]: JSON.stringify([{ id: "pending", clues: { name: "私の店", unknown: "forbidden" }, snapshot: { secret: "forbidden" }, unknown: "forbidden", draft: { clues: { name: "編集した店", secret: "forbidden" }, plan: { planDate: "2026-08-01", unknown: "forbidden" }, unknown: "forbidden" } }])
  });
  const service = createLocalTaskStorage({ storage });
  for (const domain of ["recent", "pending"]) {
    assert.equal(service.load(domain).status, "ready");
    assert.equal(JSON.stringify(service.exportDomain(domain)).includes("forbidden"), false);
    assert.equal(storage.data.get(LOCAL_TASK_BACKUP_KEYS[domain]).includes("forbidden"), false);
    assert.equal(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain]).includes("forbidden"), false);
  }
  assert.equal(service.load("pending").items[0].draft.clues.name, "編集した店");
});

test("clear removes only its domain and safe backup, preserving settings and pilot access", () => {
  const initial = Object.fromEntries([...Object.values(LOCAL_TASK_STORAGE_KEYS), ...Object.values(LOCAL_TASK_BACKUP_KEYS), "tabitabi-settings", "pilot-access"].map(key => [key, "preserve"]));
  const storage = memoryStorage(initial);
  const service = createLocalTaskStorage({ storage });
  assert.deepEqual(service.clear("saved"), { items: [], status: "ready", omittedCount: 0 });
  assert.deepEqual(storage.calls, [["remove", LOCAL_TASK_STORAGE_KEYS.saved], ["remove", LOCAL_TASK_BACKUP_KEYS.saved]]);
  for (const key of Object.keys(initial).filter(key => ![LOCAL_TASK_STORAGE_KEYS.saved, LOCAL_TASK_BACKUP_KEYS.saved].includes(key))) assert.equal(storage.data.get(key), "preserve");
});

test("failed domain deletion reports unavailable without discarding in-memory edits", () => {
  const storage = memoryStorage();
  const service = createLocalTaskStorage({ storage });
  const items = service.write("saved", legacySaved).items;
  storage.removeItem = () => { throw new Error("denied"); };
  const cleared = service.clear("saved");
  assert.equal(cleared.status, "unavailable");
  assert.deepEqual(cleared.items, items);
});

test("clear resolves a first-read conflict and resets the baseline for later deletion retries", () => {
  for (const domain of Object.keys(domainNormalizers)) {
    const original = domainItems(domain);
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: JSON.stringify(original) });
    const recoverReads = blockReads(storage);
    const originalSet = storage.setItem;
    const service = createLocalTaskStorage({ storage });
    service.load(domain);
    service.write(domain, domain === "pending" ? [{ ...original[0], status: "skipped" }] : [{ ...original[0], name: "Conflict" }]);
    recoverReads();
    assert.equal(service.retry(domain).status, "migration_failed");
    assert.deepEqual(service.clear(domain), { items: [], status: "ready", omittedCount: 0 });
    assert.equal(storage.data.has(LOCAL_TASK_STORAGE_KEYS[domain]), false);
    const drafts = domainItems(domain, 1, "Draft");
    assert.equal(service.write(domain, drafts).status, "ready");
    storage.setItem = () => { throw new Error("quota"); };
    service.write(domain, []);
    storage.setItem = originalSet;
    assert.deepEqual(service.retry(domain), { items: [], status: "ready", omittedCount: 0 });
    assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain])), []);
  }
});

test("failed clear leaves an unread baseline protected during recovery", () => {
  for (const domain of Object.keys(domainNormalizers)) {
    const original = domainItems(domain);
    const drafts = domainItems(domain, 1, "Draft");
    const storage = memoryStorage({ [LOCAL_TASK_STORAGE_KEYS[domain]]: JSON.stringify(original) });
    const recoverReads = blockReads(storage);
    const service = createLocalTaskStorage({ storage });
    service.load(domain);
    service.write(domain, drafts);
    storage.removeItem = () => { throw new Error("denied"); };
    assert.deepEqual(service.clear(domain), { items: drafts, status: "unavailable", omittedCount: 0 });
    recoverReads();
    assert.deepEqual(service.retry(domain).items, [...original, ...drafts]);
    assert.deepEqual(JSON.parse(storage.data.get(LOCAL_TASK_STORAGE_KEYS[domain])), [...original, ...drafts]);
  }
});
