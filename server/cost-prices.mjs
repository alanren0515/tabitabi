// No live prices have been approved/verified for this ledger. Missing prices stay unknown.
// Adding a price requires a dated official source, exact SKU/model and effective interval.
export const COST_PRICES = Object.freeze([]);

export function validateCostPrices(prices) {
  if (!Array.isArray(prices)) throw new Error("INVALID_COST_PRICES");
  const versions = new Set();
  for (const price of prices) {
    if (!price || !/^[a-zA-Z0-9_-]{1,80}$/.test(price.version || "") || versions.has(price.version)
      || !["google_places", "hotpepper", "qwen", "openai"].includes(price.provider)
      || !/^[a-zA-Z0-9_.:-]{1,100}$/.test(price.sku || "") || !/^[A-Z]{3}$/.test(price.currency || "")
      || !["request", "tokens"].includes(price.unit)
      || !Number.isFinite(Date.parse(price.effectiveFrom)) || !Number.isFinite(Date.parse(price.effectiveUntil))
      || Date.parse(price.effectiveUntil) <= Date.parse(price.effectiveFrom)
      || !Number.isFinite(Date.parse(price.verifiedAt)) || !/^https:\/\//.test(price.sourceUrl || "")
      || !["unknown", "excluded_from_list_price"].includes(price.freeTier)
      || (price.unit === "request" ? !finite(price.perRequest) : !finite(price.perMillionInput) || !finite(price.perMillionOutput)
        || (price.perMillionCachedInput != null && !finite(price.perMillionCachedInput)))) throw new Error("INVALID_COST_PRICES");
    versions.add(price.version);
  }
  for (let i = 0; i < prices.length; i++) for (let j = i + 1; j < prices.length; j++) {
    const a = prices[i], b = prices[j];
    if (a.provider === b.provider && a.sku === b.sku && Date.parse(a.effectiveFrom) < Date.parse(b.effectiveUntil)
      && Date.parse(b.effectiveFrom) < Date.parse(a.effectiveUntil)) throw new Error("OVERLAPPING_COST_PRICES");
  }
  return prices;
}

export function priceForAttempt(prices, provider, sku, occurredAt) {
  const time = Date.parse(occurredAt);
  const price = prices.find(item => item.provider === provider && item.sku === sku
    && Date.parse(item.effectiveFrom) <= time && time < Date.parse(item.effectiveUntil));
  if (!price) return null;
  // Persist a fixed, bounded snapshot; editing a future catalog cannot reprice this attempt.
  const keys = ["version", "provider", "sku", "currency", "unit", "effectiveFrom", "effectiveUntil", "verifiedAt", "sourceUrl", "freeTier",
    "perRequest", "perMillionInput", "perMillionOutput", "perMillionCachedInput"];
  return Object.fromEntries(keys.filter(key => Object.hasOwn(price, key)).map(key => [key, price[key]]));
}

export function estimateAttemptCost(price, usage) {
  if (!price) return { status: "unknown", reason: "price_unknown", amount: null, currency: null, priceVersion: null };
  try { validateCostPrices([price]); } catch { return { status: "unknown", reason: "invalid_price", amount: null, currency: null, priceVersion: null }; }
  const base = { currency: price.currency, priceVersion: price.version };
  if (price.unit === "request") return { ...base, status: "estimated", amount: price.perRequest, reason: null };
  if (!finite(usage?.inputTokens) || !finite(usage?.outputTokens)
    || (price.perMillionCachedInput != null && !finite(usage?.cachedInputTokens))
    || (usage?.cachedInputTokens != null && (!finite(usage.cachedInputTokens) || usage.cachedInputTokens > usage.inputTokens))) {
    return { ...base, status: "unknown", reason: "usage_unknown", amount: null };
  }
  const cached = price.perMillionCachedInput != null ? usage.cachedInputTokens : 0;
  const amount = ((usage.inputTokens - cached) * price.perMillionInput + cached * (price.perMillionCachedInput ?? 0)
    + usage.outputTokens * price.perMillionOutput) / 1_000_000;
  if (!Number.isFinite(amount)) return { ...base, status: "unknown", reason: "invalid_amount", amount: null };
  return { ...base, status: "estimated", amount, reason: null };
}

function finite(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0; }
