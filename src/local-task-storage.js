import { isSavedPlanRecord, normalizeSavedPlans } from "./saved-plans.js";
import { isRecentAnalysisRecord, normalizeRecentAnalyses, RECENT_STORAGE_KEY } from "./recent-analyses.js";
import { normalizePendingAnalyses, PENDING_STORAGE_KEY } from "./analysis-queue.js";

export const LOCAL_TASK_STORAGE_KEYS = Object.freeze({ saved: "tabitabi-saved", recent: RECENT_STORAGE_KEY, pending: PENDING_STORAGE_KEY });
export const LOCAL_TASK_BACKUP_KEYS = Object.freeze(Object.fromEntries(Object.entries(LOCAL_TASK_STORAGE_KEYS).map(([domain, key]) => [domain, `${key}:migration-backup:v2`])));
export const LOCAL_TASK_STORAGE_STATUSES = Object.freeze(["ready", "corrupt", "migration_failed", "unavailable"]);
const NORMALIZERS = { saved: normalizeSavedPlans, recent: normalizeRecentAnalyses, pending: normalizePendingAnalyses };
const VALID_RECORDS = {
  saved: isSavedPlanRecord,
  recent: isRecentAnalysisRecord,
  pending: (item) => Boolean(item && typeof item === "object" && !Array.isArray(item) && typeof (item.clues || item).name === "string" && (item.clues || item).name.trim())
};

// Undo only the deletion, never replay a whole domain snapshot over later work.
// If a bounded domain cannot hold both sets, leave the current records intact.
export function restoreDeletedTasks(domain, current, deleted) {
  const normalize = NORMALIZERS[domain];
  if (!normalize) throw new RangeError("Unknown local task domain");
  const items = normalize(current);
  const ids = new Set(items.map(item => item.id));
  const additions = normalize(deleted).filter(item => !ids.has(item.id));
  const combined = [...items, ...additions];
  const restored = normalize(combined);
  if (restored.length !== combined.length) return { restored: false, items };
  return { restored: true, items: restored };
}

/** All persistent writes, rendering inputs, backups, and exports use one whitelist. */
export function createLocalTaskStorage({ storage } = {}) {
  const states = new Map();

  function domainConfig(domain) {
    if (!Object.hasOwn(LOCAL_TASK_STORAGE_KEYS, domain)) throw new RangeError("Unknown local task domain");
    return { key: LOCAL_TASK_STORAGE_KEYS[domain], backupKey: LOCAL_TASK_BACKUP_KEYS[domain], normalize: NORMALIZERS[domain] };
  }

  function result(domain, state) {
    return { items: NORMALIZERS[domain](state.items), status: state.status, omittedCount: state.omittedCount || 0 };
  }

  function readAndMigrate(domain, state) {
    const { key, backupKey, normalize } = domainConfig(domain);
    let raw;
    try { raw = storage.getItem(key); }
    catch { state.status = "unavailable"; return result(domain, state); }
    let original;
    if (raw === null || raw === undefined) original = [];
    else {
      try { original = JSON.parse(raw); }
      catch { state.status = "corrupt"; return result(domain, state); }
    }
    if (!Array.isArray(original)) { state.status = "corrupt"; return result(domain, state); }
    const safeOriginal = normalize(original);
    if (!state.dirty) {
      state.items = safeOriginal;
      state.hasReadBaseline = true;
    }
    state.omittedCount = Math.max(0, original.length - safeOriginal.length);
    state.blockedOmittedCount = state.omittedCount;
    // An unreadable record is not an empty domain. Keep the only original copy.
    if (!original.every(VALID_RECORDS[domain])) { state.status = "corrupt"; return result(domain, state); }
    // Loading an oversized domain (or duplicate queue clues) must not silently
    // erase records outside the active capacity. The safe subset is usable,
    // but only explicit clearing or repairing the original permits a retry.
    if (state.omittedCount > 0) {
      try { storage.setItem(backupKey, JSON.stringify(safeOriginal)); }
      catch { /* The original remains the only copy; still block replacement. */ }
      state.status = "migration_failed";
      return result(domain, state);
    }
    let safeTarget = state.dirty ? normalize(state.items) : safeOriginal;
    if (state.dirty && !state.hasReadBaseline) {
      // Before any readable baseline, omitted records are unknown rather than
      // intentional deletions. Merge only new IDs; conflicting contents cannot
      // safely choose either version. Keep this guard active across retries.
      const originalVersions = new Map();
      for (const item of safeOriginal) {
        if (!originalVersions.has(item.id)) originalVersions.set(item.id, new Set());
        originalVersions.get(item.id).add(JSON.stringify(item));
      }
      const additions = [];
      for (const item of safeTarget) {
        const versions = originalVersions.get(item.id);
        if (versions && (versions.size > 1 || !versions.has(JSON.stringify(item)))) {
          state.status = "migration_failed";
          return result(domain, state);
        }
        if (!versions) additions.push(item);
      }
      const combined = [...safeOriginal, ...additions];
      const merged = normalize(combined);
      const omittedCount = combined.length - merged.length;
      if (omittedCount > 0) {
        state.omittedCount = omittedCount;
        state.blockedOmittedCount = omittedCount;
        state.status = "migration_failed";
        return result(domain, state);
      }
      // The merged version is now the first observable baseline, even if the
      // following persistence attempt fails. Later edits/deletes can use it.
      safeTarget = merged;
      state.items = merged;
      state.hasReadBaseline = true;
    }
    const target = JSON.stringify(safeTarget);
    const migrating = raw !== null && raw !== undefined && raw !== JSON.stringify(safeOriginal);
    try {
      if (migrating) {
        // Never put raw legacy content in the backup. Persist the safe user
        // fields and stable legacyId mapping before replacing the original.
        storage.setItem(backupKey, JSON.stringify(safeOriginal));
      }
      if (migrating || state.dirty) storage.setItem(key, target);
    } catch {
      state.status = migrating ? "migration_failed" : "unavailable";
      return result(domain, state);
    }
    state.items = safeTarget;
    state.status = "ready";
    state.dirty = false;
    return result(domain, state);
  }

  function load(domain) {
    domainConfig(domain);
    if (states.has(domain)) return result(domain, states.get(domain));
    const state = { items: [], status: "unavailable", dirty: false, hasReadBaseline: false, omittedCount: 0 };
    states.set(domain, state);
    return readAndMigrate(domain, state);
  }

  function write(domain, items) {
    const { key, normalize } = domainConfig(domain);
    if (!states.has(domain)) load(domain);
    const state = states.get(domain);
    // Keep the caller's safe memory version while storage is blocked. Edits and
    // deletes are authoritative only after a readable baseline or explicit clear.
    state.items = normalize(items);
    state.omittedCount = Math.max(state.blockedOmittedCount || 0, Array.isArray(items) ? Math.max(0, items.length - state.items.length) : 0);
    state.dirty = true;
    if (state.status !== "ready") return result(domain, state);
    try { storage.setItem(key, JSON.stringify(state.items)); }
    catch { state.status = "unavailable"; return result(domain, state); }
    state.dirty = false;
    return result(domain, state);
  }

  function retry(domain) {
    domainConfig(domain);
    if (!states.has(domain)) return load(domain);
    return readAndMigrate(domain, states.get(domain));
  }

  function clear(domain) {
    const { key, backupKey } = domainConfig(domain);
    if (!states.has(domain)) states.set(domain, { items: [], status: "unavailable", dirty: false, hasReadBaseline: false, omittedCount: 0 });
    const state = states.get(domain);
    let failed = false;
    for (const storageKey of [key, backupKey]) {
      try { storage.removeItem(storageKey); }
      catch { failed = true; }
    }
    if (failed) { state.status = "unavailable"; return result(domain, state); }
    state.items = [];
    state.status = "ready";
    state.dirty = false;
    state.hasReadBaseline = true;
    state.omittedCount = 0;
    state.blockedOmittedCount = 0;
    return result(domain, state);
  }

  function exportDomain(domain) {
    const exported = load(domain);
    // Exports never read the legacy raw or backup and never expose errors.
    return { schemaVersion: 2, domain, items: exported.items, status: exported.status, omittedCount: exported.omittedCount };
  }

  return { load, write, retry, clear, exportDomain };
}
