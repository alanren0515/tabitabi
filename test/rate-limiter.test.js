import test from "node:test";
import assert from "node:assert/strict";
import { createFixedWindowRateLimiter, createSlidingWindowRateLimiter, requestClientKey } from "../server/rate-limiter.mjs";

test("limits expensive requests per fixed window and resets", () => {
  let timestamp = 1000;
  const consume = createFixedWindowRateLimiter({ limit: 2, windowMs: 60_000, now: () => timestamp });
  assert.deepEqual(consume("client"), { allowed: true, remaining: 1, retryAfterSeconds: 60 });
  assert.deepEqual(consume("client"), { allowed: true, remaining: 0, retryAfterSeconds: 60 });
  assert.equal(consume("client").allowed, false);
  assert.equal(consume("other").allowed, true);
  timestamp += 60_001;
  assert.equal(consume("client").allowed, true);
});

test("trusts forwarded IP only when explicitly configured", () => {
  const request = {
    headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
    socket: { remoteAddress: "127.0.0.1" }
  };
  assert.equal(requestClientKey(request, false), "127.0.0.1");
  assert.equal(requestClientKey(request, true), "203.0.113.7");
});

test("enforces a true sliding window across the former reset boundary", () => {
  let timestamp = 0;
  const consume = createSlidingWindowRateLimiter({ limit: 2, windowMs: 1000, now: () => timestamp });
  assert.equal(consume("client").allowed, true);
  timestamp = 900;
  assert.equal(consume("client").allowed, true);
  timestamp = 1001;
  assert.equal(consume("client").allowed, true);
  assert.equal(consume("client").allowed, false);
  timestamp = 1901;
  assert.equal(consume("client").allowed, true);
});

test("prefers the Fly Proxy client address over spoofable forwarded values", () => {
  const request = {
    headers: { "fly-client-ip": "198.51.100.25", "x-forwarded-for": "203.0.113.99" },
    socket: { remoteAddress: "127.0.0.1" }
  };
  assert.equal(requestClientKey(request, true, true), "198.51.100.25");
});
