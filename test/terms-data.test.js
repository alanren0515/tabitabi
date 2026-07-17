import test from "node:test";
import assert from "node:assert/strict";
import { TERMS_EFFECTIVE_DATE, TERMS_SECTIONS } from "../src/terms-data.js";

test("terms state the core booking, third-party fee, and safety boundaries", () => {
  const text = TERMS_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs]).join(" ");
  assert.match(TERMS_EFFECTIVE_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(text, /予約は成立しません/);
  assert.match(text, /キャンセル料/);
  assert.match(text, /アレルギー/);
  assert.match(text, /飲食店、旅行会社、予約代行業者ではなく/);
});
