import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("escapes user-visible result strings before inserting HTML", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  for (const expression of [
    "${esc(r.summary)}",
    "${esc(reason)}",
    "esc(r.nextAction)",
    "${esc(r.queue)}",
    "esc(r.conflictTitle || \"情報が一致していません\")",
    "${esc(r.conflict)}"
  ]) assert.ok(source.includes(expression), expression);
});
