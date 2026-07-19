import test from "node:test";
import assert from "node:assert/strict";
import { localizedLegalContent } from "../src/legal-content.js";

test("provides product-authored English and Simplified Chinese legal and pilot content", () => {
  for (const locale of ["en", "zh-CN"]) {
    const content = localizedLegalContent(locale);
    assert.equal(content.terms.sections.length, 5);
    assert.equal(content.privacy.cards.length, 4);
    assert.equal(content.pilot.criteria.length, 3);
    assert.equal(content.pilot.tasks.length, 4);
    assert.match(content.terms.highlightBody, locale === "en" ? /does not confirm a reservation/i : /不代表预约已经成立/);
    assert.match(content.privacy.providersBody, /Qwen/);
  }
  assert.equal(localizedLegalContent("ja"), null);
});
