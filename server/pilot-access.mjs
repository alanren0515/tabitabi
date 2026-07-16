import { createHash, timingSafeEqual } from "node:crypto";

export function pilotAccessRequired(env = process.env) {
  return Boolean(String(env.PILOT_ACCESS_CODE || ""));
}

export function protectedPilotApiPath(method, pathname) {
  if (String(method || "").toUpperCase() !== "POST") return false;
  return pathname === "/api/extract-screenshot"
    || pathname === "/api/extract-webpage"
    || pathname.startsWith("/api/restaurants/");
}

export function pilotAccessAuthorized(request, env = process.env) {
  const expected = String(env.PILOT_ACCESS_CODE || "");
  if (!expected) return true;
  const supplied = String(request?.headers?.["x-pilot-access"] || "");
  return timingSafeEqual(digest(expected), digest(supplied));
}

function digest(value) {
  return createHash("sha256").update(value, "utf8").digest();
}
