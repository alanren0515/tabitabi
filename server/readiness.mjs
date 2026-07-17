import { pilotAccessCodeStrong } from "./pilot-access.mjs";

export function serviceReadiness({ visionCapabilities = {}, env = {}, dataStoreWritable = true } = {}) {
  const missing = [];
  if (!visionCapabilities.visionExtraction) missing.push("vision_extraction");
  if (!env.GOOGLE_MAPS_API_KEY) missing.push("places_search");
  if (env.NODE_ENV === "production" && !pilotAccessCodeStrong(env)) missing.push("pilot_access");
  if (env.NODE_ENV === "production" && !String(env.PUBLIC_OPERATOR_NAME || "").trim()) missing.push("operator_name");
  if (env.NODE_ENV === "production" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(env.PUBLIC_CONTACT_EMAIL || "").trim())) missing.push("contact_email");
  if (!dataStoreWritable) missing.push("data_store_writable");
  return {
    status: missing.length ? "not_ready" : "ready",
    ready: missing.length === 0,
    missing,
    fallbackAvailable: Boolean(visionCapabilities.fallbackAvailable),
    optionalEnrichment: Boolean(env.HOTPEPPER_API_KEY)
  };
}
