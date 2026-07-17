import test from "node:test";
import assert from "node:assert/strict";
import { buildSharePayload } from "../src/share-result.js";

test("builds a bounded share message with the booking confirmation boundary", () => {
  const payload = buildSharePayload({
    name: "ホームズパスタ 上野店",
    area: "上野",
    recommendation: "recommended",
    summary: "已发现预约入口，但尚未核对目标日期空位。",
    nextAction: "打开预约页面核对日期和人数。",
    address: "東京都台東区上野4-8-9",
    mapSearchUrl: "https://maps.google.com/?cid=demo",
    phone: "03-0000-0000"
  });
  assert.match(payload.text, /予約をおすすめ/);
  assert.match(payload.text, /予約成立/);
  assert.match(payload.text, /確認通知/);
  assert.equal(payload.url, "https://maps.google.com/?cid=demo");
  assert.doesNotMatch(payload.text, /03-0000-0000/);
});

test("does not share telephone or unsafe action URLs as web links", () => {
  const payload = buildSharePayload({ name: "Demo", primaryAction: { url: "tel:03-0000-0000" } });
  assert.equal("url" in payload, false);
  assert.doesNotMatch(payload.text, /tel:/);
});
