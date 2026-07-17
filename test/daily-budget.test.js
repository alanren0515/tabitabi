import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDailyBudgetStore, dailyBudgetSnapshot, DailyBudgetExceededError, DailyBudgetUnavailableError } from "../server/daily-budget.mjs";

test("serializes a persistent daily budget and stops at the configured limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-budget-"));
  const now = new Date("2026-07-14T01:00:00Z");
  try {
    const store = createDailyBudgetStore({ path: join(root, "budget.json"), now: () => now });
    const results = await Promise.all([store.consume("places_search", 3), store.consume("places_search", 3), store.consume("places_search", 3)]);
    assert.deepEqual(results.map((item) => item.remaining), [2, 1, 0]);
    await assert.rejects(() => store.consume("places_search", 3), (error) => error instanceof DailyBudgetExceededError && error.status === 429);
    assert.equal((await store.read()).counts.places_search, 3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("resets counts on the next Tokyo calendar day", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-budget-"));
  let now = new Date("2026-07-14T14:59:00Z");
  try {
    const store = createDailyBudgetStore({ path: join(root, "budget.json"), now: () => now });
    assert.equal((await store.consume("vision_requests", 1)).remaining, 0);
    now = new Date("2026-07-14T15:01:00Z");
    assert.equal((await store.consume("vision_requests", 1)).remaining, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exposes only bounded daily usage and remaining counts", () => {
  assert.deepEqual(dailyBudgetSnapshot({ date: "2026-07-14", counts: { vision_requests: 4, places_search: 99, ignored: 3 } }, {
    vision_requests: 90,
    places_search: 90,
    places_details: 90
  }), {
    date: "2026-07-14",
    timeZone: "Asia/Tokyo",
    buckets: {
      vision_requests: { used: 4, limit: 90, remaining: 86 },
      places_search: { used: 90, limit: 90, remaining: 0 },
      places_details: { used: 0, limit: 90, remaining: 90 }
    }
  });
});

test("fails closed when the persistent budget file is corrupt", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-budget-"));
  const path = join(root, "budget.json");
  try {
    await writeFile(path, "{not-json", "utf8");
    const store = createDailyBudgetStore({ path, now: () => new Date("2026-07-14T01:00:00Z") });
    await assert.rejects(() => store.consume("vision_requests", 60), (error) => error instanceof DailyBudgetUnavailableError && error.status === 503);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
