import test from "node:test";
import assert from "node:assert/strict";
import { matchesExpected, normalize } from "../scripts/eval-matching.mjs";

test("folds Japanese small katakana variants in addresses", () => {
  assert.equal(normalize("千駄ヶ谷"), normalize("千駄ケ谷"));
});

test("folds Japanese chome notation, full-width digits, and Unicode address dashes", () => {
  assert.equal(normalize("浅草１丁目２５−１５"), normalize("浅草1-25-15"));
  assert.equal(normalize("壺屋２丁目６−５"), normalize("壺屋2-6-5"));
  assert.equal(normalize("宇田川町３１−３"), normalize("宇田川町31-3"));
});

test("accepts a confirmed multilingual restaurant alias", () => {
  assert.equal(matchesExpected(
    { name: "TsuruTonTan UDON NOODLE Brasserie 六本木", address: "東京都港区六本木7丁目8-6" },
    { nameAnyOf: ["つるとんたん", "TsuruTonTan"], addressIncludes: "六本木" }
  ), true);
});
