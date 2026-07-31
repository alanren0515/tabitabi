import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("publishes a compact Japanese pilot invitation without exposing the access code", async () => {
  const [app, html, server] = await Promise.all([
    readFile(new URL("../src/app.js", import.meta.url), "utf8"),
    readFile(new URL("../index.html", import.meta.url), "utf8"),
    readFile(new URL("../server.mjs", import.meta.url), "utf8")
  ]);

  assert.match(app, /友だちから届いた店、/);
  assert.match(app, /やることは、3つだけ/);
  assert.match(app, /予約・支払い・電話は不要です。公開情報だけを使い、画像はTabiTabiのサーバーディスクに保存しません/);
  assert.match(app, /メールで参加を申し込む/);
  assert.match(app, /<a class="secondary-button" href="\/" data-action="home">アクセスコードをお持ちの方<\/a>/);
  assert.doesNotMatch(app, /2〜4件の飲食店を確認|コードを公開投稿へ転載しないでください/);
  assert.doesNotMatch(app, /PILOT_ACCESS_CODE=/);
  assert.match(html, /href="\/pilot" data-action="pilot"/);
  assert.match(server, /\["\/pilot", "\/privacy", "\/terms"\]/);
});
