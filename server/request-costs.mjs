import { randomUUID } from "node:crypto";
import { COST_PRICES, estimateAttemptCost, priceForAttempt, validateCostPrices } from "./cost-prices.mjs";

const uuid = value => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const sku = value => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,100}$/.test(value) ? value : "unknown";
const OPERATIONS = ["text_search", "place_details", "candidate_preview", "shop_search", "screenshot_extraction"];
const tokenCount = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

// Operational observation only. This is not a billing or entitlement ledger.
export function createRequestCostTracker({ append, prices = COST_PRICES, now = Date.now, onWriteError = () => {} } = {}) {
  const catalog = structuredClone(validateCostPrices(prices));
  async function write(record) {
    try { await append(record); }
    catch { try { onWriteError("COST_LOG_WRITE_FAILED"); } catch { /* core work remains available */ } }
  }
  function context(input = {}) {
    const linked = uuid(input.analysisRunId) !== uuid(input.interactionId);
    return {
      httpOperationId: uuid(input.httpOperationId) ? input.httpOperationId : randomUUID(),
      attributionStatus: linked ? "verified_flow" : "unattributed",
      ...(linked ? uuid(input.analysisRunId) ? { analysisRunId: input.analysisRunId } : { interactionId: input.interactionId } : {}),
      releaseRevision: /^[a-f0-9]{40}$/.test(input.releaseRevision || "") ? input.releaseRevision : null,
      trafficType: ["product", "audit"].includes(input.trafficType) ? input.trafficType : "unknown",
      sourceMode: ["live", "demo"].includes(input.sourceMode) ? input.sourceMode : "unknown"
    };
  }
  function trackedFetch(attribution, details, fetchImpl = fetch) {
    const owner = context(attribution);
    return async (url, options) => {
      const meta = typeof details === "function" ? details() : details;
      if (!["google_places", "hotpepper", "qwen", "openai"].includes(meta?.provider) || !OPERATIONS.includes(meta?.operation)) throw new Error("INVALID_COST_OPERATION");
      const occurredAt = new Date(now()).toISOString();
      const base = { schemaVersion: 1, requestId: randomUUID(), ...owner,
        loadId: uuid(meta.loadId) ? meta.loadId : null, provider: meta.provider, operation: meta.operation,
        sku: sku(meta.sku), fallback: meta.fallback === true, occurredAt };
      const price = priceForAttempt(catalog, base.provider, base.sku, occurredAt);
      await write({ ...base, recordType: "attempt_started", price });
      try {
        // Only this exact invocation records an attempt. Cache subscribers never execute this wrapper.
        const response = await fetchImpl(url, options);
        let usage = null;
        if (["qwen", "openai"].includes(base.provider)) {
          try {
            const payload = await response.clone().json();
            const raw = payload?.usage;
            if (raw && typeof raw === "object") usage = {
              inputTokens: tokenCount(base.provider === "openai" ? raw.input_tokens : raw.prompt_tokens),
              outputTokens: tokenCount(base.provider === "openai" ? raw.output_tokens : raw.completion_tokens),
              cachedInputTokens: tokenCount(base.provider === "openai" ? raw.input_tokens_details?.cached_tokens : raw.prompt_tokens_details?.cached_tokens)
            };
          } catch { /* Missing/invalid provider usage is unknown, never zero. */ }
        }
        await write({ ...base, recordType: "attempt_finished", finishedAt: new Date(now()).toISOString(),
          transportStatus: response.ok ? "http_success" : "http_error", httpStatus: response.status,
          usage, price, estimate: estimateAttemptCost(price, usage) });
        return response;
      } catch (error) {
        await write({ ...base, recordType: "attempt_finished", finishedAt: new Date(now()).toISOString(),
          transportStatus: ["TimeoutError", "AbortError"].includes(error?.name) ? "timeout" : "network_error",
          httpStatus: null, usage: null, price, estimate: estimateAttemptCost(price, null) });
        throw error;
      }
    };
  }
  async function cached(cache, key, attribution, operation, loader) {
    const owner = context(attribution);
    let access;
    let delivered = false;
    try {
      const result = await cache.getOrLoad(key, ({ loadId }) => loader(loadId), { onAccess: value => { access = value; } });
      delivered = true;
      return result;
    } finally {
      if (access) await write({ schemaVersion: 1, recordType: "cache_access", accessId: randomUUID(), ...owner,
        loadId: access.loadId, operation: OPERATIONS.includes(operation) ? operation : "unknown",
        cacheStatus: access.cacheStatus, outcome: delivered ? "delivered" : "failed", occurredAt: new Date(now()).toISOString() });
    }
  }
  return { context, trackedFetch, cached };
}
