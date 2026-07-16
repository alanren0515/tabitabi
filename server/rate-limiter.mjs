export function createFixedWindowRateLimiter({ limit, windowMs = 60_000, now = () => Date.now(), maxKeys = 10_000 }) {
  if (!Number.isFinite(limit) || limit < 1) throw new TypeError("limit must be a positive number");
  const windows = new Map();

  return function consume(key) {
    const timestamp = now();
    let entry = windows.get(key);
    if (!entry || entry.resetAt <= timestamp) {
      entry = { count: 0, resetAt: timestamp + windowMs };
      windows.set(key, entry);
    }
    entry.count += 1;
    if (windows.size > maxKeys) pruneExpiredOrOldest(windows, timestamp, maxKeys);
    return {
      allowed: entry.count <= limit,
      remaining: Math.max(0, limit - entry.count),
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - timestamp) / 1000))
    };
  };
}

export function requestClientKey(request, trustProxy = false) {
  if (trustProxy) {
    const forwarded = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return request.socket?.remoteAddress || "unknown";
}

function pruneExpiredOrOldest(windows, timestamp, maxKeys) {
  for (const [key, entry] of windows) if (entry.resetAt <= timestamp) windows.delete(key);
  while (windows.size > maxKeys) windows.delete(windows.keys().next().value);
}
