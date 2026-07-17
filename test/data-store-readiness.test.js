import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { probeWritableDataStore } from "../server/data-store-readiness.mjs";

test("probes data storage with atomic rename and removes its marker", async () => {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-ready-"));
  assert.equal(await probeWritableDataStore(join(root, "data")), true);
  await assert.rejects(() => readFile(join(root, "data", ".readiness-missing")));
});
