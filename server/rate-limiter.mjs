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

export function createSlidingWindowRateLimiter({ limit, windowMs = 60_000, now = () => Date.now(), maxKeys = 10_000 }) {
  if (!Number.isFinite(limit) || limit < 1) throw new TypeError("limit must be a positive number");
  const requests = new Map();

  return function consume(key) {
    const timestamp = now();
    const cutoff = timestamp - windowMs;
    const recent = (requests.get(key) || []).filter((item) => item > cutoff);
    const allowed = recent.length < limit;
    if (allowed) recent.push(timestamp);
    requests.set(key, recent);
    if (requests.size > maxKeys) pruneSlidingWindows(requests, cutoff, maxKeys);
    const oldest = recent[0] ?? timestamp;
    return {
      allowed,
      remaining: Math.max(0, limit - recent.length),
      retryAfterSeconds: allowed ? 0 : Math.max(1, Math.ceil((oldest + windowMs - timestamp) / 1000))
    };
  };
}

export function requestClientKey(request, trustProxy = false, flyProxy = false) {
  if (flyProxy) {
    const flyClientIp = String(request.headers?.["fly-client-ip"] || "").trim();
    if (flyClientIp) return flyClientIp;
  }
  if (trustProxy) {
    const forwarded = String(request.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return request.socket?.remoteAddress || "unknown";
}

function pruneSlidingWindows(requests, cutoff, maxKeys) {
  for (const [key, timestamps] of requests) {
    const recent = timestamps.filter((item) => item > cutoff);
    if (recent.length) requests.set(key, recent);
    else requests.delete(key);
  }
  while (requests.size > maxKeys) requests.delete(requests.keys().next().value);
}

function pruneExpiredOrOldest(windows, timestamp, maxKeys) {
  for (const [key, entry] of windows) if (entry.resetAt <= timestamp) windows.delete(key);
  while (windows.size > maxKeys) windows.delete(windows.keys().next().value);
}
