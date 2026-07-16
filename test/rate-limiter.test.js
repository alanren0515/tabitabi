import test from "node:test";
import assert from "node:assert/strict";
import { createFixedWindowRateLimiter, requestClientKey } from "../server/rate-limiter.mjs";

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
