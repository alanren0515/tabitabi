import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");

test("requires a confirmed candidate before presenting details or reservation choices", () => {
  assert.match(appSource, /state\.view = "candidate_confirmed"/);
  assert.match(appSource, /data-confirmed-action="details"/);
  assert.match(appSource, /data-confirmed-action="reservation"/);
  assert.match(appSource, /recordConfirmation: false/);
});

test("explains that details are fetched only after identity confirmation", () => {
  assert.match(appSource, /店舗を特定してから詳細を取得/);
  assert.match(appSource, /営業時間・電話・予約方法は店舗確認後だけ取得/);
});

test("labels screenshot text without presenting it as an officially verified fact", () => {
  assert.match(appSource, /表示内容・投稿上の主張・感想を分けて扱います/);
  assert.match(appSource, /画像に表示されていることだけを示します/);
  assert.doesNotMatch(appSource, />可见事实</);
});
