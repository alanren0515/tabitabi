import { randomUUID } from "node:crypto";

export function createRequestCache({ ttlMs = 60_000, maxEntries = 200, now = () => Date.now() } = {}) {
  const entries = new Map();
  const pending = new Map();

  async function getOrLoad(key, loader, { onAccess = () => {} } = {}) {
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now()) {
      onAccess({ loadId: cached.loadId, cacheStatus: "hit" });
      return { value: cached.value, cacheStatus: "hit" };
    }
    if (cached) entries.delete(key);
    if (pending.has(key)) {
      const shared = pending.get(key);
      onAccess({ loadId: shared.loadId, cacheStatus: "coalesced" });
      return { value: await shared.promise, cacheStatus: "coalesced" };
    }

    const loadId = randomUUID();
    onAccess({ loadId, cacheStatus: "miss" });
    const promise = Promise.resolve().then(() => loader({ loadId }));
    pending.set(key, { promise, loadId });
    try {
      const value = await promise;
      entries.set(key, { value, loadId, expiresAt: now() + ttlMs });
      trimOldest(entries, maxEntries);
      return { value, cacheStatus: "miss" };
    } finally {
      pending.delete(key);
    }
  }

  return { getOrLoad, clear: () => entries.clear() };
}

function trimOldest(entries, maxEntries) {
  while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
}
