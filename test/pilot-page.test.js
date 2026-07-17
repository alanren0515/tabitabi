import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("publishes a privacy-bounded Japanese pilot invitation without exposing the access code", async () => {
  const [app, html, server] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../server.mjs", import.meta.url), "utf8")
  ]);

  assert.match(app, /クローズドテスト参加者募集/);
  assert.match(app, /予約の確定、支払い、電話は必要ありません/);
  assert.match(app, /DM、通知、非公開投稿、他人の個人情報を含む画像は使用しないでください/);
  assert.match(app, /メールで参加を相談する/);
  assert.match(app, /コードを公開投稿へ転載しないでください/);
  assert.doesNotMatch(app, /PILOT_ACCESS_CODE=/);
  assert.match(html, /href="\/pilot" data-action="pilot"/);
  assert.match(server, /\["\/pilot", "\/privacy", "\/terms"\]/);
});
