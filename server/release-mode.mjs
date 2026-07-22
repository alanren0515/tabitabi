export function publicReleaseMode(env = process.env) {
  return String(env.PUBLIC_RELEASE_MODE || "").trim().toLowerCase() === "true";
}

export function releaseAccessMode(env = process.env) {
  if (publicReleaseMode(env)) return "public";
  if (String(env.PILOT_ACCESS_CODE || "")) return "pilot";
  return String(env.NODE_ENV || "").toLowerCase() === "production" ? "misconfigured" : "local";
}

export function releaseAccessConfigured(env = process.env) {
  return releaseAccessMode(env) !== "misconfigured";
}
