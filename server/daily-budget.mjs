import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export class DailyBudgetExceededError extends Error {
  constructor({ bucket, limit, date }) {
    super(`Daily application budget exhausted for ${bucket}`);
    this.name = "DailyBudgetExceededError";
    this.code = "DAILY_BUDGET_EXHAUSTED";
    this.status = 429;
    this.bucket = bucket;
    this.limit = limit;
    this.date = date;
  }
}

export class DailyBudgetUnavailableError extends Error {
  constructor() {
    super("The daily budget store is unavailable");
    this.name = "DailyBudgetUnavailableError";
    this.code = "DAILY_BUDGET_UNAVAILABLE";
    this.status = 503;
  }
}

export function createDailyBudgetStore({ path, timeZone = "Asia/Tokyo", now = () => new Date() }) {
  let queue = Promise.resolve();
  return {
    consume(bucket, limit) {
      const operation = queue.then(() => consumeDailyBudget({ path, bucket, limit, timeZone, now: now() }));
      queue = operation.catch(() => {});
      return operation;
    },
    read() {
      const operation = queue.then(() => readDailyBudget(path, localDate(now(), timeZone)));
      queue = operation.catch(() => {});
      return operation;
    }
  };
}

export function dailyBudgetSnapshot(current = {}, limits = {}, { expectedDate = null } = {}) {
  const storedDate = String(current?.date || "");
  const date = expectedDate ? String(expectedDate) : storedDate;
  const counts = (!expectedDate || storedDate === date) && current?.counts && typeof current.counts === "object" ? current.counts : {};
  const buckets = Object.fromEntries(Object.entries(limits).map(([bucket, limit]) => {
    const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 0;
    const used = Math.min(Math.max(Number(counts[bucket]) || 0, 0), safeLimit);
    return [bucket, { used, limit: safeLimit, remaining: Math.max(safeLimit - used, 0) }];
  }));
  return { date, timeZone: "Asia/Tokyo", buckets };
}

export async function consumeDailyBudget({ path, bucket, limit, timeZone = "Asia/Tokyo", now = new Date() }) {
  if (!/^[a-z][a-z0-9_]{1,60}$/.test(String(bucket || ""))) throw new TypeError("Invalid daily budget bucket");
  if (!Number.isInteger(limit) || limit < 1) throw new TypeError("Daily budget limit must be a positive integer");
  const date = localDate(now, timeZone);
  const current = await readDailyBudget(path, date);
  const used = Number(current.counts[bucket]) || 0;
  if (used >= limit) throw new DailyBudgetExceededError({ bucket, limit, date });
  const next = { date, counts: { ...current.counts, [bucket]: used + 1 }, updatedAt: new Date(now).toISOString() };
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temporaryPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await rename(temporaryPath, path);
  return { bucket, date, used: used + 1, remaining: limit - used - 1, limit };
}

async function readDailyBudget(path, date) {
  try {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value?.date !== date || !value.counts || typeof value.counts !== "object") return { date, counts: {} };
    return { date, counts: Object.fromEntries(Object.entries(value.counts).filter(([key, count]) => /^[a-z][a-z0-9_]{1,60}$/.test(key) && Number.isInteger(count) && count >= 0)) };
  } catch (error) {
    if (error.code === "ENOENT") return { date, counts: {} };
    if (error instanceof SyntaxError) throw new DailyBudgetUnavailableError();
    throw error;
  }
}

function localDate(value, timeZone) {
  const parts = new Intl.DateTimeFormat("en", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
