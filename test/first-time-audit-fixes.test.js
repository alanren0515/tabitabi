import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createExampleCandidates } from "../src/example-experience.js";
import { translate } from "../src/i18n.js";

const appSource = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const serverSource = await readFile(new URL("../server.mjs", import.meta.url), "utf8");
const cssSource = await readFile(new URL("../src/styles.css", import.meta.url), "utf8");

test("keeps fictional candidates behind an explicit example choice", () => {
  const examples = createExampleCandidates("銀座 鮨 蒼月", { inputType: "example" });
  assert.ok(examples.length > 0);
  assert.ok(examples.every((item) => item.sourceMode === "demo" && item.example === true));
  assert.ok(examples.every((item) => item.sources.every((source) => !/TikTok|画像/.test(source.name))));
  assert.match(examples[0].summary, /架空データ/);
  assert.doesNotMatch(appSource, /import \{[^}]*findCandidates[^}]*\} from "\.\/analyzer\.js"/);
  assert.match(appSource, /!capabilities\.placesSearch\)[^]*enterSearchRecovery/);
  assert.match(appSource, /data-recovery-example/);
});

test("keeps screenshot wording only for a screenshot-based example", () => {
  const [example] = createExampleCandidates("ホームズパスタ 上野店", { inputType: "screenshot" });
  assert.equal(example.exampleInputType, "screenshot");
  assert.ok(example.sources.some((source) => /TikTok|画像/.test(source.name)));
});

test("renders persistent recovery, inline input errors, and compact location review", () => {
  assert.match(appSource, /state\.analysisError = t\("error\.inputRequired"\)[^]*renderHome\(\)[^]*#clue/);
  assert.match(appSource, /homeRecoveryNotice[^]*recovery-banner/);
  assert.match(appSource, /review-location-summary/);
  assert.match(appSource, /<details class="review-more"/);
  assert.match(cssSource, /\.review-location-summary/);
});

test("keeps operational settings folded while preserving normal settings", () => {
  assert.match(appSource, /<form id="settings-form"[^]*pilotAccessCode/);
  assert.match(appSource, /<details class="operations-settings">/);
  assert.match(appSource, /operations-settings[^]*providerStopped[^]*renderDailyBudget/);
});

test("uses the real input mode for result source labels and scrolls after language changes", () => {
  for (const locale of ["ja", "en", "zh-CN"]) {
    for (const key of ["result.inputSourceScreenshot", "result.inputSourceText", "result.inputSourceWebpage", "result.inputSourceExample"]) {
      assert.notEqual(translate(locale, key), key);
    }
  }
  assert.match(appSource, /function resultInputSourceLabel/);
  assert.match(appSource, /result\.inputSourceText/);
  assert.doesNotMatch(appSource, /currentLocale\(\) === "ja" \? esc\(r\.sourceContext/);
  assert.match(appSource, /settings-language-select[^]*window\.scrollTo\(\{ top: 0, behavior: "auto" \}\)/);
});

test("ships matching save-plan copy and public operator fallbacks in all languages", () => {
  assert.equal(translate("ja", "result.savePlan"), "予定を保存");
  assert.equal(translate("en", "result.savePlan"), "Save plan");
  assert.equal(translate("zh-CN", "result.savePlan"), "保存计划");
  assert.match(appSource, /DEFAULT_PUBLIC_OPERATOR_NAME = "Ren"/);
  assert.match(appSource, /DEFAULT_PUBLIC_CONTACT_EMAIL = "rgq\.alan515@gmail\.com"/);
  assert.match(serverSource, /PUBLIC_OPERATOR_NAME \|\| "Ren"/);
  assert.match(serverSource, /"rgq\.alan515@gmail\.com"/);
});
