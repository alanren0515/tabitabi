export const AUDIT_SESSION_KEY = "tabitabi-audit-session-v1";

export function resolveAuditSession({ search = "", storage = null } = {}) {
  const requested = new URLSearchParams(search).get("audit") === "1";
  let persisted = false;
  try { persisted = storage?.getItem(AUDIT_SESSION_KEY) === "1"; } catch {}
  if (requested) {
    try {
      storage?.setItem(AUDIT_SESSION_KEY, "1");
      persisted = storage?.getItem(AUDIT_SESSION_KEY) === "1";
    } catch { persisted = false; }
  }
  const active = requested || persisted;
  return { active, persisted, trafficType: active ? "audit" : "product" };
}

// Keep the exclusion marker through navigation/reload when tab storage is blocked.
export function auditNavigationPath(path, session) {
  if (!session?.active || session.persisted) return path;
  const url = new URL(path, "https://tabitabi.invalid");
  url.searchParams.set("audit", "1");
  return `${url.pathname}${url.search}${url.hash}`;
}
