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
  assert.match(appSource, /先确认身份，再读取详情/);
  assert.match(appSource, /营业时间、电话和预约方式则只在你确认门店后读取/);
});

test("labels screenshot text without presenting it as an officially verified fact", () => {
  assert.match(appSource, /画面文字、帖子说法与观点分开处理/);
  assert.match(appSource, /只表示截图中确实出现/);
  assert.doesNotMatch(appSource, />可见事实</);
});
