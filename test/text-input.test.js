import test from "node:test";
import assert from "node:assert/strict";
import { parseTextInput, TextInputError } from "../server/text-input.mjs";

test("extracts restaurant search clues and dining plan from multilingual text", () => {
  const result = parseTextInput("8月1日 19:30 4个人想去六歌仙新宿本店");
  assert.equal(result.kind, "text_clues");
  assert.equal(result.plan.planDate.endsWith("-08-01"), true);
  assert.equal(result.plan.planTime, "19:30");
  assert.equal(result.plan.partySize, 4);
  assert.match(result.clues.name, /六歌仙新宿本店/);
  assert.equal(result.clues.branch, "");
});

test("extracts a nearest-station clue without folding it into the restaurant name", () => {
  const result = parseTextInput("ホームズパスタ 上野駅附近");
  assert.equal(result.clues.name, "ホームズパスタ");
  assert.equal(result.clues.nearest_station, "上野駅");
  assert.equal(result.searchQuery, "ホームズパスタ 上野駅");
});

test("parses an area and named social platform as supplemental screenshot metadata", () => {
  const result = parseTextInput("神保町，来自instagram");
  assert.equal(result.platform, "instagram");
  assert.equal(result.platformLabel, "Instagram");
  assert.equal(result.clues.area, "神保町");
  assert.equal(result.clues.name, "");
});

test("recognizes contextual X source metadata without folding it into the restaurant name", () => {
  const result = parseTextInput("日本料理 一元 千葉県佐倉市臼井間野1851-1，来自 X");
  assert.equal(result.platform, "x");
  assert.equal(result.platformLabel, "X");
  assert.equal(result.clues.name, "日本料理 一元");
  assert.equal(result.clues.address, "千葉県佐倉市臼井間野1851-1");
  assert.equal(result.searchQuery, "日本料理 一元 千葉県佐倉市臼井間野1851-1");
});

test("does not treat an ordinary standalone X token as social metadata", () => {
  const result = parseTextInput("Restaurant X 銀座");
  assert.equal(result.platform, "other");
  assert.equal(result.clues.name, "Restaurant X");
  assert.equal(result.clues.area, "銀座");
});

test("expands a controlled Chinese restaurant alias while preserving the branch", () => {
  const result = parseTextInput("想去一兰拉面 难波御堂筋店 大阪 2人");
  assert.equal(result.clues.name, "一蘭");
  assert.equal(result.clues.branch, "なんば御堂筋店");
  assert.equal(result.clues.area, "大阪");
  assert.equal(result.clues.originalName, "一兰拉面");
  assert.equal(result.clues.aliasExpanded, true);
  assert.match(result.searchQuery, /^一蘭 なんば御堂筋店 大阪$/);
});

test("does not interpret a Japanese street address as a dining date", () => {
  const result = parseTextInput("串かつだるま 新世界総本店 大阪市浪速区恵美須東2-3-9");
  assert.equal(result.plan.planDate, "");
  assert.equal(result.clues.name, "串かつだるま");
  assert.match(result.clues.address, /恵美須東2-3-9/);
  assert.match(result.searchQuery, /恵美須東2-3-9/);
});

test("keeps a city word inside a restaurant name instead of treating it as an area", () => {
  const result = parseTextInput("味の札幌 大西 青森県青森市古川1-15-6");
  assert.equal(result.clues.name, "味の札幌 大西");
  assert.equal(result.clues.area, "");
  assert.equal(result.clues.address, "青森県青森市古川1-15-6");
});

test("removes a street address from the restaurant name used for candidate ranking", () => {
  const result = parseTextInput("六厘舎 東京駅 東京都千代田区丸の内1-9-1");
  assert.equal(result.clues.name, "六厘舎");
  assert.equal(result.clues.nearest_station, "東京駅");
  assert.equal(result.clues.address, "東京都千代田区丸の内1-9-1");
});

test("still accepts explicit Japanese, slash, and ISO-style dates", () => {
  assert.match(parseTextInput("8月1日 六歌仙").plan.planDate, /-08-01$/);
  assert.match(parseTextInput("8/1 六歌仙").plan.planDate, /-08-01$/);
  assert.equal(parseTextInput("2026-08-01 六歌仙").plan.planDate, "2026-08-01");
});

test("labels a standalone social URL without claiming to read post content", () => {
  const result = parseTextInput("https://www.tiktok.com/@food/video/123");
  assert.equal(result.kind, "social_link");
  assert.equal(result.platform, "tiktok");
  assert.equal(result.contentRead, false);
  assert.equal(result.requiresContent, true);
  assert.match(result.warnings[0], /未读取/);
});

test("applies the same link-only boundary to Instagram", () => {
  const result = parseTextInput("https://www.instagram.com/reel/ABC123/");
  assert.equal(result.kind, "social_link");
  assert.equal(result.platform, "instagram");
  assert.equal(result.contentRead, false);
  assert.equal(result.requiresContent, true);
  assert.ok(result.warnings.every((warning) => !/已读取帖子正文/.test(warning)));
});

test("uses caption text beside a social URL as user-provided clues", () => {
  const result = parseTextInput("https://xhslink.com/demo ホームズパスタ 上野店 2名");
  assert.equal(result.kind, "text_clues");
  assert.equal(result.platform, "xiaohongshu");
  assert.equal(result.plan.partySize, 2);
  assert.match(result.searchQuery, /ホームズパスタ/);
});

test("uses multilingual text beside an X link without claiming the post itself was read", () => {
  const result = parseTextInput("https://x.com/tokyofood/status/123 六歌仙 新宿本店 8月1日 19:30 4位");
  assert.equal(result.kind, "text_clues");
  assert.equal(result.platform, "x");
  assert.equal(result.contentRead, false);
  assert.match(result.searchQuery, /六歌仙/);
  assert.match(result.plan.planDate, /-08-01$/);
  assert.equal(result.plan.planTime, "19:30");
  assert.equal(result.plan.partySize, 4);
});

test("routes a standalone ordinary webpage to the bounded public-page extractor", () => {
  const result = parseTextInput("https://restaurant.example/shop");
  assert.equal(result.kind, "webpage_link");
  assert.equal(result.platform, "web");
  assert.equal(result.requiresWebpage, true);
  assert.equal(result.requiresContent, false);
  assert.equal(result.links[0].url, "https://restaurant.example/shop");
  assert.match(result.warnings.join(" "), /结构化数据|Google Maps/);
});

test("recognizes a standalone reservation-platform URL without sending it to webpage extraction", () => {
  const result = parseTextInput("https://yoyaku.tabelog.com/yoyaku/net_booking_form/index?rcd=13000000");
  assert.equal(result.kind, "reservation_link");
  assert.equal(result.platform, "tabelog");
  assert.equal(result.platformLabel, "Tabelog");
  assert.equal(result.requiresContent, true);
  assert.equal(result.requiresWebpage, false);
  assert.equal(result.links[0].linkType, "booking_flow");
  assert.match(result.warnings.join(" "), /不会抓取.*页面正文/);
  assert.match(result.warnings.join(" "), /预约已经成立/);

  const currentTabelog = parseTextInput("https://tabelog.com/booking/form/new?member=2&rcd=13299475&visit_date=20260716&visit_time=1900");
  assert.equal(currentTabelog.kind, "reservation_link");
  assert.equal(currentTabelog.platform, "tabelog");
  assert.equal(currentTabelog.links[0].linkType, "booking_flow");
  assert.equal(currentTabelog.requiresWebpage, false);
});

test("keeps a platform listing separate from an explicit booking path", () => {
  const listing = parseTextInput("https://www.hotpepper.jp/strJ000000000/");
  assert.equal(listing.kind, "reservation_link");
  assert.equal(listing.links[0].linkType, "listing");

  const withClues = parseTextInput("https://www.tablecheck.com/en/shops/demo/reserve Demo Restaurant Ginza");
  assert.equal(withClues.kind, "text_clues");
  assert.equal(withClues.requiresWebpage, false);
  assert.equal(withClues.links[0].platform, "tablecheck");
  assert.equal(withClues.links[0].linkType, "booking_flow");
  assert.match(withClues.searchQuery, /Demo Restaurant Ginza/);
});

test("routes inbound concierge links away from the ordinary webpage extractor", () => {
  const samples = [
    ["https://www.foodies-reserve.com/en/restaurants/RS54ELV7QJP0Y8OK", "foodies_reserve", "booking_flow"],
    ["https://jpneazy.com/jp/restaurants/35495", "jpneazy", "booking_flow"],
    ["https://mycon-jp.net/reservation/sushi-ryoma/en", "my_concierge_japan", "booking_flow"],
    ["https://www.japanfood.travel/", "japan_food_travel", "listing"]
  ];
  for (const [url, platform, linkType] of samples) {
    const result = parseTextInput(url);
    assert.equal(result.kind, "reservation_link", platform);
    assert.equal(result.platform, platform);
    assert.equal(result.links[0].linkType, linkType);
    assert.equal(result.requiresWebpage, false);
    assert.match(result.warnings.join(" "), /不会抓取.*页面正文/);
  }
});

test("does not classify ordinary Google Maps pages as Reserve with Google", () => {
  const result = parseTextInput("https://www.google.com/maps/place/demo");
  assert.equal(result.kind, "webpage_link");
  assert.equal(result.platform, "web");
  assert.equal(result.requiresWebpage, true);
});

test("rejects oversized text input", () => {
  assert.throws(() => parseTextInput("a".repeat(4001)), (error) => error instanceof TextInputError && error.code === "INPUT_TOO_LONG");
});
