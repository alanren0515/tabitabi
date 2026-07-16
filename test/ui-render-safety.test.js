import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("escapes user-visible result and phone-script strings before inserting HTML", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  for (const expression of [
    "${esc(r.summary)}",
    "${esc(reason)}",
    "${esc(r.nextAction)}",
    "${esc(r.queue)}",
    "${esc(r.conflictTitle || \"信息有冲突\")}",
    "${esc(r.conflict)}",
    "${esc(visibleScript.ja)}",
    "${esc(visibleScript.zh)}"
  ]) assert.ok(source.includes(expression), expression);
  assert.ok(!source.includes("<blockquote lang=\"ja\">${visibleScript.ja}</blockquote>"));
});
