export function createRequestCache({ ttlMs = 60_000, maxEntries = 200, now = () => Date.now() } = {}) {
  const entries = new Map();
  const pending = new Map();

  async function getOrLoad(key, loader) {
    const cached = entries.get(key);
    if (cached && cached.expiresAt > now()) return { value: cached.value, cacheStatus: "hit" };
    if (cached) entries.delete(key);
    if (pending.has(key)) return { value: await pending.get(key), cacheStatus: "coalesced" };

    const promise = Promise.resolve().then(loader);
    pending.set(key, promise);
    try {
      const value = await promise;
      entries.set(key, { value, expiresAt: now() + ttlMs });
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
