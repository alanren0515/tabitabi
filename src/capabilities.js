export function createCapabilitiesLoader({
  fetchImpl = fetch,
  url = "/api/capabilities",
  successTtlMs = 60_000,
  failureTtlMs = 5_000,
  now = () => Date.now()
} = {}) {
  let cachedPromise = null;
  let expiresAt = 0;

  return async function loadCapabilities({ force = false } = {}) {
    const currentTime = now();
    if (!force && cachedPromise && currentTime < expiresAt) return cachedPromise;

    cachedPromise = Promise.resolve()
      .then(() => fetchImpl(url, { cache: "no-store" }))
      .then(async (response) => {
        if (!response?.ok) throw new Error(`Capabilities request failed (${response?.status || "network"})`);
        const payload = await response.json();
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Capabilities response is invalid");
        expiresAt = now() + successTtlMs;
        return payload;
      })
      .catch((error) => {
        expiresAt = now() + failureTtlMs;
        throw error;
      });
    return cachedPromise;
  };
}
