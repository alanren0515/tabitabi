// Artificial rates for arithmetic tests ONLY. These are not supplier quotes.
export const FIXTURE_TIME = "2026-10-03T00:00:00.000Z";
export const FIXTURE_PRICES = [
  { version: "fixture-request-usd", provider: "google_places", sku: "text_search_pro", unit: "request", perRequest: 0.1, currency: "USD" },
  { version: "fixture-request-jpy", provider: "hotpepper", sku: "gourmet_api", unit: "request", perRequest: 2, currency: "JPY" },
  { version: "fixture-qwen", provider: "qwen", sku: "fixture-model", unit: "tokens", perMillionInput: 2, perMillionOutput: 4, currency: "USD" },
  { version: "fixture-openai", provider: "openai", sku: "fixture-model", unit: "tokens", perMillionInput: 3, perMillionOutput: 6, perMillionCachedInput: 1, currency: "USD" }
].map(price => ({ ...price, effectiveFrom: "2026-10-01T00:00:00Z", effectiveUntil: "2026-11-01T00:00:00Z", verifiedAt: FIXTURE_TIME,
  sourceUrl: "https://example.invalid/synthetic-price-not-a-quote", freeTier: "excluded_from_list_price" }));

export function costFixture() {
  let index = 0;
  const next = () => `00000000-0000-4000-8000-${String(++index).padStart(12,"0")}`;
  const records = [];
  for (const [i, price] of FIXTURE_PRICES.entries()) {
    const base = { schemaVersion: 1, requestId: next(), httpOperationId: next(), analysisRunId: next(), loadId: next(),
      provider: price.provider, operation: price.provider === "google_places" ? "text_search" : price.provider === "hotpepper" ? "shop_search" : "screenshot_extraction",
      sku: price.sku, price, occurredAt: FIXTURE_TIME, releaseRevision: "a".repeat(40), attributionStatus: "verified_flow",
      trafficType: i === 1 ? "audit" : "product", sourceMode: "live", fallback: price.provider === "openai" };
    records.push({ ...base, recordType: "attempt_started" }, { ...base, recordType: "attempt_finished", finishedAt: FIXTURE_TIME,
      transportStatus: i === 2 ? "http_error" : "http_success", httpStatus: i === 2 ? 500 : 200,
      usage: i === 3 ? null : { inputTokens: 1000, outputTokens: 200, cachedInputTokens: 0 } });
    if (i === 0) records.push({ schemaVersion: 1, recordType: "cache_access", accessId: next(), httpOperationId: next(), analysisRunId: next(),
      attributionStatus: "verified_flow", trafficType: "product", sourceMode: "live", loadId: base.loadId,
      operation: "text_search", cacheStatus: "hit", outcome: "delivered", occurredAt: FIXTURE_TIME });
  }
  return records;
}
