import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { translate } from "../src/i18n.js";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../src/i18n.js", import.meta.url), "utf8");

test("requires a confirmed candidate before presenting details or reservation choices", () => {
  assert.match(appSource, /state\.view = "candidate_confirmed"/);
  assert.match(appSource, /data-confirmed-action="details"/);
  assert.match(appSource, /data-confirmed-action="reservation"/);
  assert.match(appSource, /recordConfirmation: false/);
});

test("explains that details are fetched only after identity confirmation", () => {
  assert.match(appSource, /candidate\.identityTitle/);
  assert.match(i18nSource, /店舗を特定してから詳細を取得/);
  assert.match(appSource, /t\("candidate\.liveCost"\)/);
  assert.match(translate("ja", "candidate.liveCost"), /営業時間・電話・予約方法は店舗確認後だけ取得/);
});

test("labels screenshot text without presenting it as an officially verified fact", () => {
  assert.match(i18nSource, /表示内容、投稿上の主張、感想を分けて扱います/);
  assert.match(i18nSource, /公式確認済みの事実ではありません/);
  assert.doesNotMatch(appSource, />可见事实</);
});
