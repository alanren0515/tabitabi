import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJsonlStore, pruneJsonlFile } from "../server/jsonl-store.mjs";

test("prunes expired, malformed, future, and oldest JSONL records atomically", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-jsonl-"));
  const path = join(root, "events.jsonl");
  const now = new Date("2026-07-14T00:00:00Z").valueOf();
  try {
    const lines = [
      { id: "expired", occurredAt: "2026-06-01T00:00:00Z" },
      { id: "keep-1", occurredAt: "2026-07-13T00:00:00Z" },
      { id: "keep-2", occurredAt: "2026-07-13T01:00:00Z" },
      { id: "keep-3", occurredAt: "2026-07-13T02:00:00Z" },
      { id: "future", occurredAt: "2027-01-01T00:00:00Z" }
    ];
    await writeFile(path, `${lines.map(JSON.stringify).join("\n")}\nnot-json\n`, "utf8");
    const result = await pruneJsonlFile({ path, maxAgeMs: 30 * 24 * 60 * 60 * 1_000, maxLines: 2, maxBytes: 10_000, now });
    assert.deepEqual(result, { kept: 2, removed: 4 });
    const records = (await readFile(path, "utf8")).trim().split("\n").map(JSON.parse);
    assert.deepEqual(records.map((item) => item.id), ["keep-2", "keep-3"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes concurrent appends and applies byte retention", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-jsonl-"));
  const path = join(root, "metrics.jsonl");
  const now = new Date("2026-07-14T00:00:00Z").valueOf();
  try {
    const store = createJsonlStore({ path, maxAgeMs: 30 * 24 * 60 * 60 * 1_000, maxLines: 100, maxBytes: 170, pruneEvery: 1, now: () => now });
    await Promise.all(Array.from({ length: 6 }, (_, index) => store.append({ id: index, occurredAt: new Date(now - index * 1_000).toISOString(), padding: "x".repeat(30) })));
    const content = await readFile(path, "utf8");
    assert.ok(Buffer.byteLength(content) <= 170);
    const records = content.trim().split("\n").filter(Boolean).map(JSON.parse);
    assert.ok(records.length > 0 && records.length < 6);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

