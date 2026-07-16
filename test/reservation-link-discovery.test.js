import test from "node:test";
import assert from "node:assert/strict";
import { discoverReservationLinks, extractOfficialContact, extractOfficialDiningNotices, extractOfficialOperationalStatus, extractOfficialQueuePolicy, extractOfficialReservationPolicy, validatePublicWebsiteUrl } from "../server/reservation-link-discovery.mjs";

test("discovers known reservation providers linked by the restaurant website", async () => {
  const result = await discoverReservationLinks({
    websiteUri: "https://restaurant.example/",
    fetchImpl: async () => new Response(`<!doctype html><a href="https://www.tablecheck.com/en/shops/demo/reserve">予約</a><a href='https://tabelog.com/rstLst/'>食べログ</a>`, { headers: { "content-type": "text/html" } })
  });
  assert.equal(result.status, "success");
  assert.deepEqual(result.links.map((item) => item.provider), ["tablecheck", "tabelog"]);
});

test("blocks private DNS results before reservation-link discovery", async () => {
  let requested = false;
  const result = await discoverReservationLinks({
    websiteUri: "https://internal.example/",
    lookupImpl: async () => [{ address: "10.0.0.5", family: 4 }],
    fetchImpl: async () => { requested = true; return new Response("ok"); }
  });
  assert.equal(result.status, "unsafe_redirect");
  assert.equal(requested, false);
});

test("discovers a same-origin official booking flow only from an explicit reservation anchor", async () => {
  const result = await discoverReservationLinks({
    websiteUri: "https://store.gosso.co.jp/detail/nikulemon_ueno/",
    lookupImpl: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: async () => new Response(`
      <a href="/detail/nikulemon_ueno/plan_list/">予約する</a>
      <a href="/detail/nikulemon_ueno/plan/1/">プランを見る</a>
      <a href="/detail/nikulemon_ueno/menu/">メニュー</a>
    `, { headers: { "content-type": "text/html" } })
  });
  assert.deepEqual(result.links, [{
    provider: "official_booking",
    label: "官网预约",
    url: "https://store.gosso.co.jp/detail/nikulemon_ueno/plan_list/"
  }]);
});

test("discovers only Instagram profile links and leaves posts unread", async () => {
  const result = await discoverReservationLinks({
    websiteUri: "https://restaurant.example/",
    fetchImpl: async () => new Response(`
      <a href="https://www.instagram.com/demo_restaurant/?igsh=official">Instagram</a>
      <a href="https://www.instagram.com/p/POST123/">post</a>
      <a href="https://www.instagram.com/reel/REEL123/">reel</a>
      <a href="https://www.instagram.com/">root</a>
    `, { headers: { "content-type": "text/html" } })
  });
  assert.deepEqual(result.socialLinks, [{ provider: "instagram", label: "Instagram", handle: "@demo_restaurant", url: "https://www.instagram.com/demo_restaurant/" }]);
});

test("keeps the strongest same-provider reservation link instead of the first listing link", async () => {
  const result = await discoverReservationLinks({
    websiteUri: "https://restaurant.example/",
    fetchImpl: async () => new Response(`
      <a href="https://www.tablecheck.com/en/shops/demo">店舗</a>
      <a href="https://www.tablecheck.com/en/shops/demo/reserve">予約</a>
    `, { headers: { "content-type": "text/html" } })
  });
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].url, "https://www.tablecheck.com/en/shops/demo/reserve");
});

test("keeps direct booking paths for Tabelog, Gurunavi, PayPay Gourmet, and OZmall", async () => {
  const pairs = [
    ["https://tabelog.com/tokyo/A0000/", "https://yoyaku.tabelog.com/yoyaku/net_booking_form/index?rcd=13000000"],
    ["https://r.gnavi.co.jp/g000000/", "https://r.gnavi.co.jp/plan/g000000/plan-reserve/plan/plan_list/"],
    ["https://paypaygourmet.yahoo.co.jp/148418/", "https://paypaygourmet.yahoo.co.jp/148418/plan12526287"],
    ["https://www.ozmall.co.jp/restaurant/1413/", "https://www.ozmall.co.jp/restaurant/1413/plan/646078/"]
  ];
  const result = await discoverReservationLinks({
    websiteUri: "https://restaurant.example/",
    fetchImpl: async () => new Response(pairs.flat().map((url) => `<a href="${url}">予約</a>`).join(""), { headers: { "content-type": "text/html" } })
  });
  assert.deepEqual(result.links.map((item) => item.url), pairs.map((pair) => pair[1]));
});

test("discovers direct, high-end, international, proxy, and waitlist providers", async () => {
  const links = [
    "https://restaurant.ikyu.com/123456/plan123/",
    "https://omakase.in/r/demo",
    "https://www.pocket-concierge.jp/en/restaurants/123",
    "https://www.opentable.jp/r/demo-tokyo",
    "https://www.tableall.com/restaurant/49",
    "https://www.google.com/maps/reserve/v/dine/c/demo",
    "https://autoreserve.com/en/restaurants/demo",
    "https://epark.jp/gourmet/detail/waitlist/123",
    "https://r.gnavi.co.jp/demo/"
  ];
  const result = await discoverReservationLinks({
    websiteUri: "https://restaurant.example/",
    fetchImpl: async () => new Response(links.map((url) => `<a href="${url}">予約</a>`).join(""), { headers: { "content-type": "text/html" } })
  });
  assert.deepEqual(result.links.map((item) => item.provider), ["ikyu", "omakase", "pocket_concierge", "opentable", "tableall", "google_reserve", "autoreserve", "epark", "gurunavi"]);
});

test("discovers inbound concierge providers and keeps the direct My Concierge booking link", async () => {
  const links = [
    "https://www.foodies-reserve.com/en/restaurants/RS54ELV7QJP0Y8OK",
    "https://jpneazy.com/jp/restaurants/35495",
    "https://myconciergejapan.com/restaurants/sushi-ryoma/",
    "https://mycon-jp.net/reservation/sushi-ryoma/en",
    "https://www.japanfood.travel/"
  ];
  const result = await discoverReservationLinks({
    websiteUri: "https://restaurant.example/",
    fetchImpl: async () => new Response(links.map((url) => `<a href="${url}">予約</a>`).join(""), { headers: { "content-type": "text/html" } })
  });
  assert.deepEqual(result.links.map((item) => item.provider), ["foodies_reserve", "jpneazy", "my_concierge_japan", "japan_food_travel"]);
  assert.equal(result.links.find((item) => item.provider === "my_concierge_japan")?.url, "https://mycon-jp.net/reservation/sushi-ryoma/en");
});

test("extracts an explicit no-reservations rule with a source excerpt", async () => {
  const result = await discoverReservationLinks({
    websiteUri: "https://restaurant.example/access",
    fetchImpl: async () => new Response(`<main><h2>店舗情報</h2><p>当店ではご予約を承っておりません。直接ご来店ください。</p></main>`, { headers: { "content-type": "text/html" } })
  });
  assert.equal(result.reservationPolicy.status, "not_accepted");
  assert.equal(result.reservationPolicy.sourceUrl, "https://restaurant.example/access");
  assert.match(result.reservationPolicy.excerpt, /ご予約を承っておりません/);
});

test("extracts an indefinite temporary closure from a store-specific official page", () => {
  const status = extractOfficialOperationalStatus(`
    <main><h1>ＭＫレストラン 佐世保大塔店</h1>
    <p>設備故障のため、安全確認および復旧作業を行っております。</p>
    <p>つきましては、誠に勝手ながら当面の間休業とさせていただきます。</p>
    <p>営業再開の時期はホームページで改めてご案内します。</p></main>
  `, "https://restaurant.example/store");
  assert.equal(status.businessStatus, "CLOSED_TEMPORARILY");
  assert.equal(status.certainty, "high");
  assert.match(status.excerpt, /当面の間休業/);
});

test("does not borrow a temporary closure from a later related-store notice", () => {
  const status = extractOfficialOperationalStatus(`
    <main><h1>本店</h1><p>当店は通常通り営業しております。</p></main>
    <aside><h2>別館</h2><p>別館は当面の間休業とさせていただきます。</p></aside>
  `, "https://restaurant.example/main");
  assert.equal(status, null);
  assert.equal(extractOfficialOperationalStatus(`<p>2026年4月20日から23日まで臨時休業します。</p>`, "https://restaurant.example/old"), null);
});

test("does not confuse available reservations or date-specific wording with a global no-reservations rule", () => {
  for (const html of [
    `<p>オンライン予約可能です。</p>`,
    `<p>予約不可の日時はカレンダーでご確認ください。</p>`,
    `<script>const label = "予約不可";</script>`,
    `<p>ご予約を受け付けております。</p>`
  ]) assert.equal(extractOfficialReservationPolicy(html, "https://restaurant.example/"), null);
});

test("extracts explicit limited reservation rules without turning them into no-reservation claims", () => {
  const weekdays = extractOfficialReservationPolicy(`<p>ご予約は平日のみ受け付けております。</p>`, "https://restaurant.example/store");
  assert.equal(weekdays.status, "limited");
  assert.equal(weekdays.restrictionType, "weekdays_only");
  assert.equal(weekdays.label, "仅平日接受预约");

  const lunch = extractOfficialReservationPolicy(`<p>ランチタイムのご予約はお受けしておりません。</p>`, "https://restaurant.example/store");
  assert.equal(lunch.status, "limited");
  assert.equal(lunch.restrictionType, "lunch_unavailable");

  const party = extractOfficialReservationPolicy(`<p>ご予約は6名様以上から受け付けております。</p>`, "https://restaurant.example/store");
  assert.equal(party.status, "limited");
  assert.equal(party.minimumParty, 6);
});

test("does not borrow a limited reservation rule from a later related-store card", () => {
  const policy = extractOfficialReservationPolicy(`
    <main><h1>本店</h1><p>ご予約可能です。</p></main>
    <aside><h2>別館</h2><p>ご予約は平日のみ受け付けております。</p></aside>
  `, "https://restaurant.example/main");
  assert.equal(policy, null);
});

test("prefers the current store no-reservations field over a later related-store limited rule", () => {
  const policy = extractOfficialReservationPolicy(`
    <main><h1>新世界総本店</h1><dl><dt>予約</dt><dd>不可</dd></dl></main>
    <aside><a>なんば本店 予約:平日のみ2名様から可能</a></aside>
  `, "https://restaurant.example/shinsekai");
  assert.equal(policy.status, "not_accepted");
  assert.match(policy.excerpt, /予約 不可/);
  assert.doesNotMatch(policy.excerpt, /なんば本店/);
});

test("recognizes a structured official store field that says reservations are unavailable", () => {
  const policy = extractOfficialReservationPolicy(`<dl><dt>予約可否</dt><dd>予約：不可</dd></dl>`, "https://restaurant.example/store");
  assert.equal(policy.status, "not_accepted");
  assert.match(policy.excerpt, /予約可否 予約:不可/);
});

test("extracts a labeled Japanese official phone number without scanning arbitrary digits", () => {
  const contact = extractOfficialContact(`<dl><dt>電話番号</dt><dd>06-6645-7056</dd><dt>住所</dt><dd>2-3-9</dd></dl>`, "https://restaurant.example/store");
  assert.equal(contact.phone, "06-6645-7056");
  assert.equal(contact.sourceUrl, "https://restaurant.example/store");
  assert.match(contact.excerpt, /電話番号 06-6645-7056/);
  assert.equal(extractOfficialContact(`<p>大阪市浪速区2-3-9</p>`, "https://restaurant.example/store"), null);
});

test("extracts only explicit official dining restrictions and fees", () => {
  const notices = extractOfficialDiningNotices(`
    <main><p>お支払いは現金のみとなります。</p><p>未就学児のご入店はお断りしております。</p>
    <p>テーブルチャージ お一人様 550円</p><p>店内は全席禁煙です。</p></main>
  `, "https://restaurant.example/store");
  assert.deepEqual(notices.map((item) => item.type), ["cash_only", "children_restriction", "seat_charge", "non_smoking"]);
  assert.ok(notices.every((item) => item.sourceUrl === "https://restaurant.example/store" && item.certainty === "high"));
  assert.deepEqual(extractOfficialDiningNotices(`<p>現金もカードも使えます。お子様メニューがあります。</p>`, "https://restaurant.example/"), []);
});

test("extracts only explicit official queue modes without inventing a wait time", () => {
  const tickets = extractOfficialQueuePolicy(`<main><p>混雑時は午前9時より店頭で整理券を配布いたします。</p></main>`, "https://restaurant.example/queue");
  assert.equal(tickets.mode, "numbered_ticket");
  assert.equal(tickets.label, "整理券取号");
  assert.match(tickets.excerpt, /整理券を配布/);
  assert.equal("waitMinutes" in tickets, false);

  const names = extractOfficialQueuePolicy(`<p>店舗入口の受付表にお名前をご記入ください。順番にお呼びします。</p>`, "https://restaurant.example/queue");
  assert.equal(names.mode, "name_list");
  const app = extractOfficialQueuePolicy(`<p>EPARKのアプリから順番待ち受付をご利用いただけます。</p>`, "https://restaurant.example/queue");
  assert.equal(app.mode, "app_waitlist");
  assert.equal(extractOfficialQueuePolicy(`<p>週末は混雑する場合があります。</p>`, "https://restaurant.example/queue"), null);
});

test("keeps the main store minimum-party rule without borrowing a later store no-reservations rule", () => {
  const policy = extractOfficialReservationPolicy(`
    <main><h1>なんば店</h1><dl><dt>予約</dt><dd>2名様から可能</dd></dl></main>
    <aside><a>通天閣店 予約：不可</a></aside>
  `, "https://restaurant.example/namba");
  assert.equal(policy.status, "limited");
  assert.equal(policy.restrictionType, "minimum_party");
  assert.equal(policy.minimumParty, 2);
  assert.doesNotMatch(policy.excerpt, /通天閣店.*不可/);
});

test("blocks local and private literal website URLs and unsafe redirects", async () => {
  for (const value of ["http://localhost/", "http://127.0.0.1/", "http://10.0.0.1/", "http://192.168.1.2/", "file:///etc/passwd"]) assert.equal(validatePublicWebsiteUrl(value), "");
  const result = await discoverReservationLinks({
    websiteUri: "https://restaurant.example/",
    fetchImpl: async () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } })
  });
  assert.equal(result.status, "unsafe_redirect");
});
