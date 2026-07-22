import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { translate } from "../src/i18n.js";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const i18nSource = await readFile(new URL("../src/i18n.js", import.meta.url), "utf8");

test("loads details immediately after the user confirms a candidate", () => {
  assert.doesNotMatch(appSource, /state\.view = "candidate_confirmed"/);
  assert.doesNotMatch(appSource, /data-confirmed-action=/);
  assert.match(appSource, /await openConfirmedCandidate\("details"\)/);
  assert.match(appSource, /recordConfirmation: false/);
});

test("fetches details only after identity confirmation without showing technical cost copy", () => {
  assert.doesNotMatch(appSource, /t\("candidate\.liveCost"\)/);
  assert.match(appSource, /await openConfirmedCandidate\("details"\)/);
  assert.equal(translate("ja", "candidate.select"), "このお店です");
});

test("labels screenshot text without presenting it as an officially verified fact", () => {
  assert.match(i18nSource, /表示内容、投稿上の主張、感想を分けて扱います/);
  assert.match(i18nSource, /公式確認済みの事実ではありません/);
  assert.doesNotMatch(appSource, />可见事实</);
});
