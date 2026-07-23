import test from "node:test";
import assert from "node:assert/strict";
import { buildReservationOptions, normalizeUserProvidedReservationLinks, platformForUrl, primaryReservationAction } from "../server/reservation-options.mjs";

test("builds verified links separately from platform discovery links", () => {
  const options = buildReservationOptions({ place: { name: "ホームズパスタ 上野店", address: "東京都台東区上野4-8-9", websiteUri: "https://homespasta1986.com/", googleMapsUri: "https://maps.google.com/?cid=1", phone: "03-5812-4960" } });
  assert.equal(options.find((item) => item.provider === "external_website").status, "verified_link");
  assert.equal(options.find((item) => item.provider === "external_website").officiality, "google_listed_external");
  assert.equal(options.find((item) => item.provider === "phone").bookingMode, "phone");
  assert.equal(options.find((item) => item.id === "tabelog_discovery").status, "discovery_only");
  assert.equal(options.find((item) => item.id === "tabelog_discovery").capability.kind, "discovery");
  assert.match(options.find((item) => item.id === "tabelog_discovery").feeNote, /示すものではなく/);
  assert.match(options.find((item) => item.id === "tabelog_discovery").feeNote, /システム利用料/);
  const tabelogDiscovery = options.find((item) => item.id === "tabelog_discovery");
  const tabelogSearchUrl = new URL(tabelogDiscovery.url);
  assert.equal(tabelogDiscovery.label, "食べログで店舗を検索");
  assert.equal(tabelogSearchUrl.hostname, "tabelog.com");
  assert.equal(tabelogSearchUrl.pathname, "/rst/rstsearch/");
  assert.equal(tabelogSearchUrl.searchParams.get("sk"), "ホームズパスタ 上野店 東京都台東区上野4-8-9");
  assert.equal(tabelogDiscovery.url.includes("google.com/search"), false);
});

test("recognizes known reservation platforms and avoids duplicate discovery", () => {
  assert.equal(platformForUrl("https://www.tablecheck.com/en/shops/demo/reserve").provider, "tablecheck");
  const options = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://www.tablecheck.com/en/shops/demo/reserve", googleMapsUri: "https://maps.google.com/?cid=1", phone: "03-0000-0000" }, hotPepperMatch: { url: "https://www.hotpepper.jp/strJ000000000/" } });
  assert.equal(options.filter((item) => item.provider === "tablecheck").length, 1);
  assert.equal(options.find((item) => item.provider === "hotpepper").status, "verified_listing");
  assert.equal(options.find((item) => item.provider === "tablecheck").capability.kind, "online_reservation_flow");
  assert.equal(options.find((item) => item.provider === "tablecheck").capability.recommended, false);
  assert.equal(primaryReservationAction(options).provider, "phone");
});

test("never promotes a Google-listed third-party platform link without independent restaurant association", () => {
  const options = buildReservationOptions({
    place: { name: "Demo", websiteUri: "https://autoreserve.com/en/restaurants/demo/reserve", phone: "03-0000-0000" }
  });
  const autoReserve = options.find((item) => item.provider === "autoreserve");
  assert.equal(autoReserve.status, "unverified_link");
  assert.equal(autoReserve.officiality, "google_listed_external");
  assert.equal(autoReserve.capability.kind, "provider_booking_flow");
  assert.equal(autoReserve.capability.recommended, false);
  assert.equal(autoReserve.capability.certainty, "low");
  assert.match(autoReserve.feeNote, /店舗公式サイト|未確認/);
  assert.equal(primaryReservationAction(options).provider, "phone");
  assert.equal(options[0].provider, "phone");
});

test("promotes a direct platform flow only when the verified restaurant website links it", () => {
  const options = buildReservationOptions({
    place: { name: "Demo", websiteUri: "https://restaurant.example/store", phone: "03-0000-0000" },
    officialWebsiteUri: "https://restaurant.example/store",
    discoveredLinks: [{ provider: "tablecheck", label: "TableCheck", url: "https://www.tablecheck.com/shops/demo/reserve", sourceVerified: true }]
  });
  const tablecheck = options.find((item) => item.provider === "tablecheck");
  assert.equal(tablecheck.officiality, "linked_from_restaurant_website");
  assert.equal(tablecheck.capability.recommended, true);
  assert.equal(tablecheck.capability.certainty, "high");
  assert.equal(primaryReservationAction(options).provider, "tablecheck");
  assert.equal(options[0].provider, "tablecheck");
});

test("does not claim that a platform listing is a confirmed online reservation flow", () => {
  const options = buildReservationOptions({
    place: { name: "Demo", websiteUri: "https://demo.example/", phone: "03-0000-0000" },
    hotPepperMatch: { url: "https://www.hotpepper.jp/strJ000000000/" }
  });
  assert.equal(options.find((item) => item.provider === "hotpepper").capability.kind, "platform_listing");
  assert.equal(options.find((item) => item.provider === "hotpepper").capability.recommended, true);
  assert.notEqual(options.find((item) => item.provider === "hotpepper").capability.kind, "online_reservation_flow");
  assert.equal(primaryReservationAction(options).provider, "phone");
});

test("classifies a gorp hosted page as Gurunavi and keeps a separately verified brand page official", () => {
  const options = buildReservationOptions({
    place: { name: "Demo", websiteUri: "https://k000000.gorp.jp/" },
    officialWebsiteUri: "https://restaurant.example/store"
  });
  assert.equal(options.find((item) => item.url === "https://k000000.gorp.jp/")?.provider, "gurunavi");
  const official = options.find((item) => item.id === "verified_official_website");
  assert.equal(official?.officiality, "restaurant_official");
  assert.equal(official?.capability.kind, "official_information");
});

test("recognizes the major Japanese reservation and waitlist providers", () => {
  const samples = [
    ["https://www.tablecheck.com/en/shops/demo/reserve", "tablecheck", "online_reservation_flow"],
    ["https://tablecheck.jp/en/shops/sushi-shikon/reserve", "tablecheck", "online_reservation_flow"],
    ["https://omakase.in/r/demo", "omakase", "online_reservation_flow"],
    ["https://restaurant.ikyu.com/123456/plan12345678/", "ikyu", "online_reservation_flow"],
    ["https://www.pocket-concierge.jp/en/restaurants/12345/reservation", "pocket_concierge", "online_reservation_flow"],
    ["https://www.tableall.com/restaurant/49", "tableall", "provider_booking_flow"],
    ["https://www.opentable.jp/r/demo-tokyo", "opentable", "online_reservation_flow"],
    ["https://www.google.com/maps/reserve/v/dine/c/demo", "google_reserve", "provider_booking_flow"],
    ["https://www.hotpepper.jp/strJ000000000/yoyaku/", "hotpepper", "provider_booking_flow"],
    ["https://yoyaku.tabelog.com/yoyaku/net_booking_form/index?rcd=13000000", "tabelog", "online_reservation_flow"],
    ["https://tabelog.com/booking/form/new?member=2&rcd=13299475&visit_date=20260716&visit_time=1900", "tabelog", "online_reservation_flow"],
    ["https://r.gnavi.co.jp/plan/g000000/plan-reserve/plan/plan_list/", "gurunavi", "online_reservation_flow"],
    ["https://plan.gnavi.co.jp/g853147/plan-reserve/plan/plan_list/", "gurunavi", "online_reservation_flow"],
    ["https://epark.jp/gourmet/detail/waitlist/123", "epark", "waitlist_flow"],
    ["https://autoreserve.com/en/restaurants/demo/reserve", "autoreserve", "provider_booking_flow"],
    ["https://yoyaku.toreta.in/demo", "toreta", "online_reservation_flow"],
    ["https://booking.ebica.jp/webrsv/search/e014001401/1", "ebica", "online_reservation_flow"],
    ["https://savorjapan.com/reservation/demo", "savor_japan", "provider_booking_flow"],
    ["https://paypaygourmet.yahoo.co.jp/148418/plan12526287", "paypay_gourmet", "online_reservation_flow"],
    ["https://www.ozmall.co.jp/restaurant/1413/plan/646078/", "ozmall", "online_reservation_flow"],
    ["https://www.foodies-reserve.com/en/restaurants/RS54ELV7QJP0Y8OK", "foodies_reserve", "provider_booking_flow"],
    ["https://jpneazy.com/jp/restaurants/35495", "jpneazy", "provider_booking_flow"],
    ["https://mycon-jp.net/reservation/sushi-ryoma/en", "my_concierge_japan", "provider_booking_flow"]
  ];
  for (const [url, provider, kind] of samples) {
    assert.equal(platformForUrl(url)?.provider, provider);
    const option = buildReservationOptions({ place: { name: "Demo", websiteUri: url } }).find((item) => item.provider === provider);
    assert.equal(option?.capability.kind, kind, `${provider} capability`);
  }
});

test("keeps discovery pages separate from booking, proxy, and waitlist flows", () => {
  const samples = [
    ["https://tabelog.com/tokyo/A1301/rstLst/", "tabelog"],
    ["https://www.hotpepper.jp/strJ000000000/", "hotpepper"],
    ["https://r.gnavi.co.jp/demo/", "gurunavi"],
    ["https://www.epark.jp/gourmet/", "epark"],
    ["https://autoreserve.com/en/", "autoreserve"],
    ["https://autoreserve.com/en/restaurants/demo", "autoreserve"],
    ["https://www.pocket-concierge.jp/en/restaurants/12345", "pocket_concierge"],
    ["https://www.tableall.com/", "tableall"],
    ["https://www.ozmall.co.jp/restaurant/1413/", "ozmall"],
    ["https://myconciergejapan.com/restaurants/sushi-ryoma/", "my_concierge_japan"],
    ["https://www.japanfood.travel/", "japan_food_travel"]
  ];
  for (const [url, provider] of samples) {
    const option = buildReservationOptions({ place: { name: "Demo", websiteUri: url } }).find((item) => item.provider === provider);
    assert.equal(option?.capability.kind, "platform_listing", `${provider} listing`);
    assert.match(option?.capability.confirmation || "", /限りません|未確認/);
  }
});

test("shows provider-specific fee and confirmation boundaries", () => {
  const omakase = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://omakase.in/r/demo" } })[0];
  assert.match(omakase.feeNote, /カード|事前決済|キャンセル待ち/);
  assert.match(omakase.capability.confirmation, /確認通知/);

  const autoReserve = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://autoreserve.com/en/restaurants/demo/reserve" } })[0];
  assert.match(autoReserve.feeNote, /代行料|キャンセル料/);
  assert.match(autoReserve.capability.confirmation, /未確定/);

  const epark = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://epark.jp/gourmet/detail/waitlist/123" } })[0];
  assert.match(epark.feeNote, /座席予約ではなく/);
  assert.equal(epark.bookingMode, "waitlist");
  assert.match(epark.capability.confirmation, /座席予約ではありません/);

  const tableall = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://www.tableall.com/restaurant/49" } })[0];
  assert.match(tableall.feeNote, /予約手数料|総額/);
  assert.equal(tableall.bookingMode, "provider_determined");
  assert.match(tableall.capability.confirmation, /確保済み席|予約リクエスト/);

  const googleReserve = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://www.google.com/maps/reserve/v/dine/c/demo" } })[0];
  assert.equal(googleReserve.provider, "google_reserve");
  assert.equal(googleReserve.bookingMode, "provider_determined");
  assert.match(googleReserve.capability.confirmation, /確認通知/);
});

test("keeps ordinary Google pages out of Reserve with Google classification", () => {
  assert.equal(platformForUrl("https://www.google.com/search?q=restaurant"), null);
  assert.equal(platformForUrl("https://www.google.com/maps/place/demo"), null);
  assert.equal(platformForUrl("https://www.google.com/maps/reserve/v/dine/c/demo")?.provider, "google_reserve");
});

test("distinguishes Tabelog request booking from its regular network booking form", () => {
  const request = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://tabelog.com/ai_request_booking/guide/index" } })[0];
  assert.equal(request.provider, "tabelog");
  assert.equal(request.capability.kind, "provider_booking_flow");
  assert.equal(request.bookingMode, "request");
  assert.match(request.capability.confirmation, /成立通知.*予約成立ではありません/);

  const network = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://yoyaku.tabelog.com/yoyaku/net_booking_form/index?rcd=13000000" } })[0];
  assert.equal(network.capability.kind, "online_reservation_flow");
  assert.equal(network.bookingMode, "instant_or_request");

  const currentNetwork = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://tabelog.com/booking/form/new?member=2&rcd=13299475&visit_date=20260716&visit_time=1900" } })[0];
  assert.equal(currentNetwork.capability.kind, "online_reservation_flow");
  assert.equal(currentNetwork.bookingMode, "instant_or_request");
  assert.match(currentNetwork.capability.confirmation, /確認/);
});

test("recognizes additional Japanese and inbound reservation platforms without calling listings direct booking", () => {
  const listings = [
    ["https://hitosara.com/0000000000/", "hitosara"],
    ["https://paypaygourmet.yahoo.co.jp/place/demo", "paypay_gourmet"],
    ["https://retty.me/area/PRE13/ARE1/SUB101/100000000/", "retty"],
    ["https://www.byfood.com/restaurant/demo", "byfood"]
  ];
  for (const [url, provider] of listings) {
    const option = buildReservationOptions({ place: { name: "Demo", websiteUri: url } })[0];
    assert.equal(option.provider, provider);
    assert.equal(option.capability.kind, "platform_listing");
  }
});

test("keeps inbound concierge requests separate from confirmed reservations", () => {
  const foodies = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://www.foodies-reserve.com/en/restaurants/RS54ELV7QJP0Y8OK" } })[0];
  assert.equal(foodies.provider, "foodies_reserve");
  assert.equal(foodies.bookingMode, "provider_determined");
  assert.match(foodies.capability.confirmation, /確認メール/);
  assert.match(foodies.feeNote, /手数料|事前決済/);

  const jpneazy = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://jpneazy.com/jp/restaurants/35495" } })[0];
  assert.equal(jpneazy.provider, "jpneazy");
  assert.equal(jpneazy.bookingMode, "request");
  assert.match(jpneazy.capability.confirmation, /連絡|手配/);
  assert.match(jpneazy.feeNote, /有料|料金/);

  const myConciergeListing = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://myconciergejapan.com/restaurants/sushi-ryoma/" } })[0];
  assert.equal(myConciergeListing.capability.kind, "platform_listing");
  const myConciergeBooking = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://mycon-jp.net/reservation/sushi-ryoma/en" } })[0];
  assert.equal(myConciergeBooking.capability.kind, "provider_booking_flow");
  assert.match(myConciergeBooking.feeNote, /サービス料|事前決済/);

  const support = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://www.japanfood.travel/" } })[0];
  assert.equal(support.provider, "japan_food_travel");
  assert.equal(support.capability.kind, "platform_listing");
  assert.match(support.feeNote, /予約代行|サービス/);
});

test("prefers a direct official-site platform link over an earlier generic platform listing", () => {
  const options = buildReservationOptions({
    place: { name: "Demo" },
    hotPepperMatch: { url: "https://www.hotpepper.jp/strJ000000000/" },
    discoveredLinks: [{ provider: "hotpepper", label: "Hot Pepper", url: "https://www.hotpepper.jp/strJ000000000/yoyaku/" }]
  });
  const hotPepper = options.find((item) => item.provider === "hotpepper");
  assert.equal(options.filter((item) => item.provider === "hotpepper").length, 1);
  assert.equal(hotPepper.url, "https://www.hotpepper.jp/strJ000000000/yoyaku/");
  assert.equal(hotPepper.officiality, "linked_from_restaurant_website");
  assert.equal(hotPepper.capability.kind, "provider_booking_flow");
  assert.equal(hotPepper.capability.certainty, "high");
});

test("shows but does not recommend a direct platform link discovered on an unverified website", () => {
  const options = buildReservationOptions({
    place: { name: "Demo", phone: "03-0000-0000" },
    discoveredLinks: [{ provider: "tablecheck", label: "TableCheck", url: "https://www.tablecheck.com/shops/wrong-store/reserve", sourceVerified: false }]
  });
  const tablecheck = options.find((item) => item.provider === "tablecheck");
  assert.equal(tablecheck.status, "unverified_link");
  assert.equal(tablecheck.officiality, "google_listed_external");
  assert.equal(tablecheck.capability.kind, "online_reservation_flow");
  assert.equal(tablecheck.capability.certainty, "low");
  assert.equal(tablecheck.capability.recommended, false);
  assert.match(tablecheck.capability.confirmation, /対応は未確認/);
  assert.equal(primaryReservationAction(options).provider, "phone");
});

test("recommends a same-origin booking flow discovered on a verified restaurant website", () => {
  const options = buildReservationOptions({
    place: { name: "Demo", websiteUri: "https://restaurant.example/store", phone: "03-0000-0000" },
    officialWebsiteUri: "https://restaurant.example/store",
    discoveredLinks: [{
      provider: "official_booking",
      label: "官网预约",
      url: "https://restaurant.example/store/plan_list/",
      sourceVerified: true
    }]
  });
  const booking = options.find((item) => item.provider === "official_booking");
  assert.equal(booking.capability.kind, "online_reservation_flow");
  assert.equal(booking.capability.certainty, "high");
  assert.equal(primaryReservationAction(options).provider, "official_booking");
});

test("sanitizes user-provided platform links and never trusts a spoofed provider", () => {
  const links = normalizeUserProvidedReservationLinks([
    { provider: "tablecheck", url: "https://www.hotpepper.jp/strJ000000000/yoyaku/" },
    { provider: "tablecheck", url: "https://restaurant.example/reserve" },
    { provider: "tablecheck", url: "javascript:alert(1)" },
    { provider: "tablecheck", url: "https://user:password@www.tablecheck.com/shops/demo/reserve" },
    { provider: "tablecheck", url: "https://www.tablecheck.com:8443/shops/demo/reserve" },
    { provider: "tabelog", url: "https://www.google.com/maps/place/demo" }
  ]);
  assert.deepEqual(links, [{
    provider: "hotpepper",
    label: "ホットペッパーグルメ",
    url: "https://www.hotpepper.jp/strJ000000000/yoyaku/",
    sourceVerified: false,
    source: "user_provided"
  }]);
});

test("shows a user-provided booking path at low confidence without making it primary", () => {
  const [link] = normalizeUserProvidedReservationLinks([{ url: "https://www.tablecheck.com/shops/demo/reserve" }]);
  const options = buildReservationOptions({
    place: { name: "Demo", phone: "03-0000-0000" },
    discoveredLinks: [link]
  });
  const tablecheck = options.find((item) => item.provider === "tablecheck");
  assert.equal(tablecheck.officiality, "user_provided_external");
  assert.equal(tablecheck.capability.kind, "online_reservation_flow");
  assert.equal(tablecheck.capability.certainty, "low");
  assert.equal(tablecheck.capability.recommended, false);
  assert.match(tablecheck.feeNote, /入力時に追加/);
  assert.equal(primaryReservationAction(options).provider, "phone");
});

test("keeps an official-site link when a user supplied a stronger-looking URL for the same provider", () => {
  const [userLink] = normalizeUserProvidedReservationLinks([{ url: "https://www.tablecheck.com/shops/wrong/reserve" }]);
  const options = buildReservationOptions({
    place: { name: "Demo" },
    discoveredLinks: [
      { provider: "tablecheck", label: "TableCheck", url: "https://www.tablecheck.com/shops/correct/reserve", sourceVerified: true },
      userLink
    ]
  });
  const tablecheck = options.find((item) => item.provider === "tablecheck");
  assert.equal(tablecheck.url, "https://www.tablecheck.com/shops/correct/reserve");
  assert.equal(tablecheck.officiality, "linked_from_restaurant_website");
  assert.equal(tablecheck.capability.certainty, "high");
});

test("only treats an independently verified unknown domain as the restaurant official website", () => {
  const unverified = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://linktr.ee/demo" } })[0];
  assert.equal(unverified.provider, "external_website");
  assert.equal(unverified.capability.kind, "external_information");
  assert.equal(unverified.confidence, "medium");

  const verified = buildReservationOptions({ place: { name: "Demo", websiteUri: "https://restaurant.example/store" }, officialWebsiteUri: "https://restaurant.example/store" })[0];
  assert.equal(verified.provider, "official_website");
  assert.equal(verified.officiality, "restaurant_official");
  assert.equal(verified.capability.kind, "official_information");
});
