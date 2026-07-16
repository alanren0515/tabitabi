export function serviceReadiness({ visionCapabilities = {}, env = {} } = {}) {
  const missing = [];
  if (!visionCapabilities.visionExtraction) missing.push("vision_extraction");
  if (!env.GOOGLE_MAPS_API_KEY) missing.push("places_search");
  return {
    status: missing.length ? "not_ready" : "ready",
    ready: missing.length === 0,
    missing,
    fallbackAvailable: Boolean(visionCapabilities.fallbackAvailable),
    optionalEnrichment: Boolean(env.HOTPEPPER_API_KEY)
  };
}

