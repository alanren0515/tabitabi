// Only operator-reviewed acquisition sources belong here. An empty registry means
// that no incoming visit is assumed to be natural research traffic.
export const MEASUREMENT_CAMPAIGNS = Object.freeze({});

export function campaignContext(id, registry = MEASUREMENT_CAMPAIGNS) {
  const entry = typeof id === "string" && /^[a-z0-9_-]{1,40}$/.test(id)
    && Object.hasOwn(registry, id) ? registry[id] : null;
  return {
    channel: ["direct", "social", "search", "partner"].includes(entry?.channel) ? entry.channel : "unknown",
    researchSource: ["natural", "benchmark", "assigned_task", "incentivized", "reminded"].includes(entry?.researchSource) ? entry.researchSource : "unknown"
  };
}
