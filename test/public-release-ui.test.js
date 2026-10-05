import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("public UI removes invitation controls and exposes formal privacy sections", async () => {
  const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(source, /capabilities\.publicReleaseMode \|\| \(!capabilities\.pilotAccessRequired && !state\.settings\.pilotAccessCode\) \? "" : `<label>\$\{t\("settings\.access"\)/);
  assert.match(source, /保管期間と国外処理/);
  assert.match(source, /開示等のご請求・苦情/);
  assert.match(source, /招待コードは不要です/);
  assert.match(source, /公開ベータでは招待アクセスコードは使用しません/);
  assert.match(source, /isPublicRelease\(\) \? \[\] : \(local\.sessionFields/);
});
