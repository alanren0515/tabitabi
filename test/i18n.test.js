import test from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_LOCALES, isNativeLocale, localeNumberFormat, missingTranslationKeys, normalizeLocale, translate } from "../src/i18n.js";

test("supports product-authored Japanese, English, and Simplified Chinese locales", () => {
  assert.deepEqual(SUPPORTED_LOCALES.map((item) => item.value), ["ja", "en", "zh-CN"]);
  assert.equal(normalizeLocale("en-GB"), "en");
  assert.equal(normalizeLocale("zh-Hans"), "zh-CN");
  assert.equal(normalizeLocale("de-DE"), "ja");
  assert.equal(translate("en", "home.start"), "Start checking");
  assert.equal(translate("zh-CN", "home.start"), "开始确认");
  assert.equal(translate("ja", "home.start"), "確認をはじめる");
  assert.equal(isNativeLocale("ja-JP"), true);
  assert.equal(isNativeLocale("en-US"), true);
  assert.equal(isNativeLocale("zh_CN"), true);
  assert.equal(isNativeLocale("fr-FR"), false);
});

test("interpolates variables and falls back to Japanese for unsupported locales", () => {
  assert.equal(translate("en", "candidate.position", { index: 2, count: 3 }), "Candidate 2/3");
  assert.equal(translate("fr", "settings.step"), "設定");
  assert.match(localeNumberFormat("zh-CN").format(12345), /12[,，]?345/);
});

test("English and Simplified Chinese cover every Japanese message key", () => {
  assert.deepEqual(missingTranslationKeys("en"), []);
  assert.deepEqual(missingTranslationKeys("zh-CN"), []);
});
