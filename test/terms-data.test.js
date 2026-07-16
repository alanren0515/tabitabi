import test from "node:test";
import assert from "node:assert/strict";
import { TERMS_EFFECTIVE_DATE, TERMS_SECTIONS } from "../src/terms-data.js";

test("terms state the core booking, third-party fee, and safety boundaries", () => {
  const text = TERMS_SECTIONS.flatMap((section) => [section.title, ...section.paragraphs]).join(" ");
  assert.match(TERMS_EFFECTIVE_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(text, /不表示预约已经成立/);
  assert.match(text, /取消费/);
  assert.match(text, /过敏/);
  assert.match(text, /不是餐厅、旅行社或预约代理/);
});
