import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("keeps verified phone actions without Japanese phone-script assistance", async () => {
  const [app, settings, analyzer] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/settings.js", import.meta.url), "utf8"),
    readFile(new URL("../src/analyzer.js", import.meta.url), "utf8")
  ]);

  assert.match(app, /href="tel:\$\{esc\(r\.phone\)\}"/);
  assert.match(app, /電話で確認/);
  for (const removed of ["電話用の文例", "やさしい日本語", "data-script-version", "phoneScriptVersion", "reservationName", "defaultPhoneScript"]) {
    assert.doesNotMatch(`${app}\n${settings}\n${analyzer}`, new RegExp(removed));
  }
});
