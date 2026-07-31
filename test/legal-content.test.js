import test from "node:test";
import assert from "node:assert/strict";
import { localizedLegalContent } from "../src/legal-content.js";

test("provides compact product-authored English and Simplified Chinese pilot content", () => {
  for (const locale of ["en", "zh-CN"]) {
    const content = localizedLegalContent(locale);
    assert.equal(content.terms.sections.length, 5);
    assert.equal(content.privacy.cards.length, 4);
    assert.equal(content.pilot.tasks.length, 3);
    assert.match(content.pilot.taskTitle, locale === "en" ? /three/i : /三件事/);
    assert.match(content.pilot.safetyBody, locale === "en" ? /No booking, payment, or phone call/i : /不需要预约、付款或打电话/);
    assert.match(content.pilot.safetyBody, /server disk|服务器磁盘/);
    assert.match(content.terms.highlightBody, locale === "en" ? /does not confirm a reservation/i : /不代表预约已经成立/);
    assert.match(content.privacy.providersBody, /Qwen/);
  }
  assert.equal(localizedLegalContent("ja"), null);
});

test("keeps public legal copy distinct from invitation-only pilot copy", () => {
  for (const locale of ["en", "zh-CN"]) {
    const pilot = localizedLegalContent(locale);
    const publicCopy = localizedLegalContent(locale, { publicRelease: true });
    assert.equal(publicCopy.terms.sections.length, 8);
    assert.notEqual(publicCopy.terms.intro, pilot.terms.intro);
    assert.notEqual(publicCopy.privacy.intro, pilot.privacy.intro);
    assert.match(publicCopy.privacy.providersBody, /Singapore|新加坡/);
    assert.match(publicCopy.privacy.metricsBody, /30 days|30天/);
    assert.ok(publicCopy.privacy.rightsTitle);
    assert.ok(publicCopy.privacy.retentionTitle);
    assert.match(publicCopy.pilot.joinBody, /No invitation code|无需邀请码/);
  }
});
