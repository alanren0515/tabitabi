import test from "node:test";
import assert from "node:assert/strict";
import { PUBLIC_TERMS_SECTIONS, TERMS_EFFECTIVE_DATE, TERMS_SECTIONS } from "../src/terms-data.js";

test("terms state the core booking, third-party fee, and safety boundaries", () => {
  const text = TERMS_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs]).join(" ");
  assert.match(TERMS_EFFECTIVE_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(text, /予約は成立しません/);
  assert.match(text, /キャンセル料/);
  assert.match(text, /アレルギー/);
  assert.match(text, /飲食店、旅行会社、予約代行業者ではなく/);
});

test("public Japanese terms cover submissions, suspension, liability, and governing law", () => {
  assert.equal(PUBLIC_TERMS_SECTIONS.length, 8);
  const text = JSON.stringify(PUBLIC_TERMS_SECTIONS);
  for (const pattern of [/投稿内容/, /禁止事項/, /変更・制限・停止/, /責任の範囲/, /日本法/]) assert.match(text, pattern);
  assert.match(TERMS_EFFECTIVE_DATE, /^\d{4}-\d{2}-\d{2}$/);
});
