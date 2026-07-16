import test from "node:test";
import assert from "node:assert/strict";
import { findVerifiedOfficialSource } from "../server/verified-official-sources.mjs";

test("matches a verified official source only when both restaurant and address agree", () => {
  const matched = findVerifiedOfficialSource({
    name: "串かつだるま 新世界総本店",
    address: "〒556-0002 大阪府大阪市浪速区恵美須東２丁目３−９"
  });
  assert.equal(matched?.url, "https://www.kushikatu-daruma.com/location/shinsekai");
  assert.equal(findVerifiedOfficialSource({ name: "串かつだるま 通天閣店", address: "大阪府大阪市浪速区恵美須東1-6-8" }), null);
});

test("matches the verified GOSSO Ueno store without borrowing another branch", () => {
  const matched = findVerifiedOfficialSource({
    name: "肉ときどきレモンサワー。上野駅前店",
    address: "〒110-0005 東京都台東区上野６丁目１３−２ 渡辺上野ビル 4F"
  });
  assert.equal(matched?.url, "https://store.gosso.co.jp/detail/nikulemon_ueno/");
  assert.equal(findVerifiedOfficialSource({
    name: "肉ときどきレモンサワー。新宿店",
    address: "東京都新宿区新宿1-2-3"
  }), null);
});

test("matches the verified MK Sasebo Daito store page without borrowing another branch", () => {
  const matched = findVerifiedOfficialSource({
    name: "MKレストラン 佐世保大塔店",
    address: "〒857-1161 長崎県佐世保市大塔町18-16"
  });
  assert.match(matched?.url || "", /mkrestaurants.*70007/);
  assert.equal(findVerifiedOfficialSource({ name: "MKレストラン 大野モール店", address: "長崎県佐世保市瀬戸越4-6-1" }), null);
});

test("matches the current TsuruTonTan Roppongi store after relocation", () => {
  const matched = findVerifiedOfficialSource({
    name: "TsuruTonTan UDON NOODLE Brasserie 六本木",
    address: "東京都港区六本木7丁目8-6 アクソール六本木7F"
  });
  assert.equal(matched?.url, "https://www.tsurutontan.co.jp/shop/roppongi/");
  assert.equal(findVerifiedOfficialSource({ name: "つるとんたん 六本木店", address: "東京都港区六本木3-14-12" }), null);
});
