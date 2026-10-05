import { createHash, timingSafeEqual } from "node:crypto";
import { publicReleaseMode, releaseAccessMode } from "./release-mode.mjs";

export function pilotAccessRequired(env = process.env) {
  return !publicReleaseMode(env) && Boolean(String(env.PILOT_ACCESS_CODE || ""));
}

export function pilotAccessCodeStrong(env = process.env) {
  return String(env.PILOT_ACCESS_CODE || "").length >= 24;
}

export function protectedPilotApiPath(method, pathname) {
  if (String(method || "").toUpperCase() !== "POST") return false;
  return pathname === "/api/extract-screenshot"
    || pathname === "/api/extract-webpage"
    || pathname === "/api/price-signals"
    || pathname === "/api/events"
    || pathname === "/api/measurement-flows"
    || pathname === "/api/research-consent"
    || pathname.startsWith("/api/restaurants/");
}

export function pilotAccessAuthorized(request, env = process.env) {
  const mode = releaseAccessMode(env);
  if (mode === "public" || mode === "local") return true;
  if (mode === "misconfigured") return false;
  const expected = String(env.PILOT_ACCESS_CODE || "");
  const supplied = String(request?.headers?.["x-pilot-access"] || "");
  return timingSafeEqual(digest(expected), digest(supplied));
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}
