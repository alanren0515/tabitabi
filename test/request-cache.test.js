import test from "node:test";
import assert from "node:assert/strict";
import { createRequestCache } from "../server/request-cache.mjs";

test("returns cached Places results within the short TTL", async () => {
  let currentTime = 1000;
  let calls = 0;
  const cache = createRequestCache({ ttlMs: 60_000, now: () => currentTime });
  const loader = async () => ({ candidates: [++calls] });

  const first = await cache.getOrLoad("same-query", loader);
  const second = await cache.getOrLoad("same-query", loader);

  assert.equal(first.cacheStatus, "miss");
  assert.equal(second.cacheStatus, "hit");
  assert.deepEqual(second.value, { candidates: [1] });
  assert.equal(calls, 1);

  currentTime += 60_001;
  const expired = await cache.getOrLoad("same-query", loader);
  assert.equal(expired.cacheStatus, "miss");
  assert.equal(calls, 2);
});

test("coalesces simultaneous duplicate Places requests", async () => {
  let resolveLoader;
  let calls = 0;
  const cache = createRequestCache();
  const loader = () => {
    calls += 1;
    return new Promise((resolve) => { resolveLoader = resolve; });
  };

  const first = cache.getOrLoad("same-place", loader);
  await Promise.resolve();
  const second = cache.getOrLoad("same-place", loader);
  resolveLoader({ placeId: "abc" });

  assert.equal((await first).cacheStatus, "miss");
  assert.equal((await second).cacheStatus, "coalesced");
  assert.equal(calls, 1);
});
