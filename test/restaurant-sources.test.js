import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRestaurantResult,
  detectOfficialContactConflicts,
  detectUserClueConflicts,
  DataSourceError,
  detectSourceConflicts,
  getGooglePlaceDetails,
  searchGooglePlaces,
  searchHotPepper
} from "../server/restaurant-sources.mjs";

test("does not flag a compatible partial street address as a relocation conflict", () => {
  const conflicts = detectUserClueConflicts(
    { address: "日本、〒160-0021 東京都新宿区歌舞伎町1丁目25-3" },
    { address: "歌舞伎町1-25" }
  );
  assert.deepEqual(conflicts, []);
});

test("keeps an area-only clue as a search hint without overriding the current mapped area", () => {
  const place = {
    placeId: "jincook",
    name: "カリー屋 ジンコック",
    address: "東京都千代田区神田須田町1丁目2-3 山勝ビル",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=jincook",
    websiteUri: "",
    phone: "03-3251-1795",
    hours: [],
    category: "カレー店",
    retrievedAt: "2026-07-14T06:00:00.000Z",
    attributions: []
  };
  const result = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    userClues: { name: "カリー屋 ジンコック", area: "神保町" }
  });
  assert.equal(result.area, "東京都千代田区");
  assert.equal(result.risks.find((item) => item.field === "area")?.severity, "medium");
  assert.match(result.conflict, /広い呼び方|位置のずれ/);
  assert.doesNotMatch(result.address, /神保町/);
});

test("carries Google Maps current opening status without inferring it from regular hours", () => {
  const result = buildRestaurantResult({
    place: {
      placeId: "open-status", name: "営業状況テスト", address: "東京都千代田区", businessStatus: "OPERATIONAL",
      googleMapsUri: "https://maps.google.com/?cid=open-status", websiteUri: "", phone: "", hours: ["月曜日: 11:00～22:00"],
      currentOpeningHours: { openNow: false, nextOpenTime: "2026-08-01T11:00:00+09:00", nextCloseTime: "", retrievedAt: "2026-07-31T06:00:00.000Z" },
      category: "飲食店", retrievedAt: "2026-07-31T06:00:00.000Z", attributions: []
    },
    hotPepperResult: { available: false, match: null }
  });
  assert.equal(result.currentOpeningHours.openNow, false);
  assert.equal(result.currentOpeningHours.nextOpenTime, "2026-08-01T11:00:00+09:00");
  assert.ok(result.evidenceFacts.some((fact) => fact.field === "current_opening_status" && fact.value === "closed"));
});

test("flags a specific old address that differs from the current address", () => {
  const conflicts = detectUserClueConflicts(
    { address: "東京都港区六本木7丁目8-6 アクソール六本木7F" },
    { address: "東京都港区六本木3-14-12" }
  );
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].severity, "high");
  assert.equal(conflicts[0].resolvedByOfficial, false);
  assert.match(conflicts[0].message, /古い投稿|移転/);
});

test("marks an old-address conflict resolved when the current store has a verified official page", () => {
  const conflicts = detectUserClueConflicts(
    { address: "東京都港区六本木7丁目8-6 アクソール六本木7F" },
    { address: "東京都港区六本木3-14-12" },
    { url: "https://www.tsurutontan.co.jp/shop/roppongi/" }
  );
  assert.equal(conflicts[0].resolvedByOfficial, true);
  assert.match(conflicts[0].message, /店舗公式ページで現住所を確認済み/);
});

test("keeps a current official booking link but clearly resolves a relocation-era input address", () => {
  const officialUrl = "https://www.tsurutontan.co.jp/shop/roppongi/";
  const place = {
    placeId: "tsurutontan-roppongi",
    name: "TsuruTonTan UDON NOODLE Brasserie 六本木",
    address: "東京都港区六本木7丁目8-6 アクソール六本木7F",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=tsurutontan",
    websiteUri: officialUrl,
    phone: "03-5786-2626",
    hours: [],
    category: "うどん店",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const result = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    userClues: { name: "つるとんたん", branch: "六本木", address: "東京都港区六本木3-14-12" },
    verifiedOfficialSource: { url: officialUrl, label: "つるとんたん六本木店官方门店页" },
    officialWebsiteDiscovery: {
      sourceVerified: true,
      links: [{ provider: "tablecheck", label: "TableCheck", url: "https://www.tablecheck.com/shops/tsurutontan-roppongi/reserve" }]
    }
  });
  assert.equal(result.recommendation, "recommended");
  assert.equal(result.primaryAction.provider, "tablecheck");
  assert.equal(result.address, place.address);
  assert.match(result.summary, /旧住所/);
  assert.match(result.conflict, /移転前/);
  assert.equal(result.risks.find((item) => item.field === "address")?.resolvedByOfficial, true);
});

test("does not make a booking link primary while an address identity conflict is unresolved", () => {
  const result = buildRestaurantResult({
    place: {
      placeId: "same-name-current",
      name: "同名レストラン 六本木店",
      address: "東京都港区六本木7-8-6",
      businessStatus: "OPERATIONAL",
      googleMapsUri: "https://maps.google.com/?cid=same-name-current",
      websiteUri: "https://restaurant.example/",
      phone: "",
      hours: [],
      category: "レストラン",
      retrievedAt: "2026-07-13T07:00:00.000Z",
      attributions: []
    },
    hotPepperResult: { available: false, match: null },
    userClues: { name: "同名レストラン", address: "東京都港区六本木3-14-12" },
    discoveredReservationLinks: [{ provider: "tablecheck", label: "TableCheck", url: "https://www.tablecheck.com/shops/same-name/reserve" }]
  });
  assert.equal(result.recommendation, "unknown");
  assert.equal(result.primaryAction.type, "map");
  assert.match(result.nextAction, /同じ店舗/);
});

test("shows explicit dining notices only when they came from a verified official store page", () => {
  const place = {
    placeId: "notice-store",
    name: "Notice Restaurant",
    address: "東京都中央区1-2-3",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=notice-store",
    websiteUri: "https://restaurant.example/store",
    phone: "03-0000-0000",
    hours: [],
    category: "レストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const diningNotices = [{ type: "cash_only", label: "仅限现金", excerpt: "お支払いは現金のみ", sourceUrl: place.websiteUri, certainty: "high" }];
  const verified = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    verifiedOfficialSource: { url: place.websiteUri, label: "Official store" },
    officialWebsiteDiscovery: { sourceVerified: true, links: [], diningNotices }
  });
  assert.equal(verified.attentionNotices[0].type, "cash_only");
  assert.ok(verified.evidenceFacts.some((fact) => fact.field === "dining_notice:cash_only" && fact.isOfficial));
  assert.ok(verified.sources.some((source) => /来店時の注意/.test(source.note)));

  const unverified = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    officialWebsiteDiscovery: { sourceVerified: false, links: [], diningNotices }
  });
  assert.deepEqual(unverified.attentionNotices, []);
  assert.ok(!unverified.evidenceFacts.some((fact) => String(fact.field).startsWith("dining_notice:")));
});

test("exposes an official queue rule only after the store page source is verified", () => {
  const place = {
    placeId: "queue-store",
    name: "Queue Restaurant",
    address: "東京都中央区1-2-3",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=queue-store",
    websiteUri: "https://restaurant.example/queue",
    phone: "03-0000-0000",
    hours: [],
    category: "レストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const queuePolicy = { mode: "numbered_ticket", label: "整理券取号", excerpt: "午前9時より店頭で整理券を配布", sourceUrl: place.websiteUri, certainty: "high" };
  const verified = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    verifiedOfficialSource: { url: place.websiteUri, label: "Official store" },
    officialWebsiteDiscovery: { sourceVerified: true, links: [], queuePolicy }
  });
  assert.equal(verified.queueGuidance.mode, "numbered_ticket");
  assert.equal(verified.queue, "整理券取号");
  assert.ok(verified.evidenceFacts.some((fact) => fact.field === "queue_policy" && fact.isOfficial));
  assert.ok(verified.sources.some((source) => /順番待ちルール/.test(source.note)));

  const unverified = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    officialWebsiteDiscovery: { sourceVerified: false, links: [], queuePolicy }
  });
  assert.equal(unverified.queueGuidance, null);
  assert.ok(!unverified.evidenceFacts.some((fact) => fact.field === "queue_policy"));
});

test("exposes a limited reservation rule as result guidance only from a verified official page", () => {
  const place = {
    placeId: "limited-store",
    name: "Limited Restaurant",
    address: "東京都中央区1-2-3",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=limited-store",
    websiteUri: "https://restaurant.example/limited",
    phone: "03-0000-0000",
    hours: [], category: "レストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z", attributions: []
  };
  const reservationPolicy = { status: "limited", restrictionType: "weekdays_only", label: "仅平日接受预约", excerpt: "ご予約は平日のみ受け付けております", sourceUrl: place.websiteUri, certainty: "high" };
  const verified = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    verifiedOfficialSource: { url: place.websiteUri, label: "Official store" },
    officialWebsiteDiscovery: { sourceVerified: true, links: [], reservationPolicy }
  });
  assert.equal(verified.reservationGuidance.restrictionType, "weekdays_only");
  assert.equal(verified.recommendation, "unknown");
  assert.match(verified.summary, /仅平日接受预约/);

  const unverified = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    officialWebsiteDiscovery: { sourceVerified: false, links: [], reservationPolicy }
  });
  assert.equal(unverified.reservationGuidance, null);
});

test("Places search requests only candidate fields and returns explainable matches", async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url, options };
    return Response.json({
      places: [{
        id: "ChIJ-demo-ueno",
        displayName: { text: "ホームズパスタ 上野店", languageCode: "ja" },
        formattedAddress: "日本、〒110-0005 東京都台東区上野4丁目8-9 OAKビル 2F",
        primaryTypeDisplayName: { text: "イタリア料理店" },
        businessStatus: "OPERATIONAL",
        googleMapsUri: "https://maps.google.com/?cid=demo",
        attributions: [{ provider: "Example Data", providerUri: "https://provider.example" }]
      }]
    });
  };

  const result = await searchGooglePlaces({
    query: "ホームズパスタ 上野店 東京都台東区上野4-8-9",
    clues: { name: "ホームズパスタ", branch: "上野店", address: "東京都台東区上野4-8-9" },
    apiKey: "test-key",
    fetchImpl
  });

  assert.equal(result.candidates[0].placeId, "ChIJ-demo-ueno");
  assert.equal(result.candidates[0].rank, 1);
  assert.equal(result.candidates[0].candidateCount, 1);
  assert.ok(result.candidates[0].matchReasons.includes("支店名が一致"));
  assert.equal(result.candidates[0].attributions[0].provider, "Example Data");
  assert.match(captured.options.headers["X-Goog-FieldMask"], /places\.id/);
  assert.doesNotMatch(captured.options.headers["X-Goog-FieldMask"], /rating|reviews|regularOpeningHours/);
  assert.equal(JSON.parse(captured.options.body).pageSize, 3);
});

test("filters an exact station result instead of ranking it above a nearby restaurant", async () => {
  const result = await searchGooglePlaces({
    query: "ビーフメン東武練馬 東武練馬駅",
    clues: { name: "ビーフメン東武練馬", nearest_station: "東武練馬駅" },
    apiKey: "test-key",
    fetchImpl: async () => Response.json({ places: [
      {
        id: "station",
        displayName: { text: "東武練馬駅" },
        formattedAddress: "東京都板橋区徳丸2-2-14",
        primaryTypeDisplayName: { text: "駅" },
        businessStatus: "OPERATIONAL"
      },
      {
        id: "beef-men",
        displayName: { text: "油そばBEEF-MEN Noodle&Rice" },
        formattedAddress: "東京都板橋区徳丸3-1-3 和ビル 江が1F",
        primaryTypeDisplayName: { text: "ラーメン屋" },
        businessStatus: "OPERATIONAL"
      }
    ] })
  });
  assert.equal(result.candidates[0].placeId, "beef-men");
  assert.ok(!result.candidates.some((candidate) => candidate.placeId === "station"));
});

test("ranks an exact restaurant above a generic dining area at the same address", async () => {
  const result = await searchGooglePlaces({
    query: "六厘舎 東京駅 東京都千代田区丸の内1-9-1",
    clues: { name: "六厘舎", address: "東京都千代田区丸の内1-9-1", nearest_station: "東京駅" },
    apiKey: "test-key",
    fetchImpl: async () => Response.json({ places: [
      {
        id: "ramen-street",
        displayName: { text: "東京ラーメンストリート" },
        formattedAddress: "東京都千代田区丸の内1丁目9-1 東京駅一番街 B1",
        primaryTypeDisplayName: { text: "ラーメン屋" },
        businessStatus: "OPERATIONAL"
      },
      {
        id: "rokurinsha",
        displayName: { text: "六厘舎 東京ラーメンストリート店" },
        formattedAddress: "東京都千代田区丸の内1丁目9-1 東京駅一番街 B1F",
        primaryTypeDisplayName: { text: "ラーメン屋" },
        businessStatus: "OPERATIONAL"
      }
    ] })
  });
  assert.equal(result.candidates[0].placeId, "rokurinsha");
  assert.ok(result.candidates[0].matchReasons.includes("店名がほぼ完全に一致"));
});

test("matches a Japanese restaurant and branch from only a partial street address", async () => {
  const result = await searchGooglePlaces({
    query: "牛かつもと村 新宿本店 歌舞伎町1-25",
    clues: { name: "牛かつもと村", branch: "新宿本店", address: "歌舞伎町1-25" },
    apiKey: "test-key",
    fetchImpl: async () => Response.json({
      places: [{
        id: "motomura-shinjuku",
        displayName: { text: "牛かつもと村 新宿本店" },
        formattedAddress: "日本、〒160-0021 東京都新宿区歌舞伎町1丁目25-3",
        primaryTypeDisplayName: { text: "牛カツ店" },
        businessStatus: "OPERATIONAL",
        googleMapsUri: "https://maps.google.com/?cid=motomura"
      }]
    })
  });
  assert.equal(result.candidates[0].name, "牛かつもと村 新宿本店");
  assert.ok(result.candidates[0].matchReasons.includes("支店名が一致"));
  assert.ok(result.candidates[0].matchReasons.includes("住所の手掛かりが一致"));
});

test("uses a concrete station clue to explain a matching branch candidate", async () => {
  const result = await searchGooglePlaces({
    query: "ホームズパスタ 上野駅",
    clues: { name: "ホームズパスタ", nearest_station: "上野駅" },
    apiKey: "test-key",
    fetchImpl: async () => Response.json({
      places: [{
        id: "homes-pasta-ueno-station",
        displayName: { text: "ホームズパスタ 上野店" },
        formattedAddress: "東京都台東区上野4-8-9",
        businessStatus: "OPERATIONAL"
      }]
    })
  });
  assert.ok(result.candidates[0].matchReasons.includes("駅の手掛かりと支店名が一致"));
});

test("reranks same-brand candidates using the canonical branch instead of Google order alone", async () => {
  const result = await searchGooglePlaces({
    query: "一蘭 なんば御堂筋店 大阪",
    clues: { name: "一蘭", branch: "なんば御堂筋店", area: "大阪", originalName: "一兰拉面" },
    apiKey: "test-key",
    fetchImpl: async () => Response.json({
      places: [
        { id: "ichiran-shibuya", displayName: { text: "一蘭 渋谷店" }, formattedAddress: "東京都渋谷区神南1-22-7", businessStatus: "OPERATIONAL" },
        { id: "ichiran-namba", displayName: { text: "一蘭 なんば御堂筋店" }, formattedAddress: "大阪府大阪市中央区心斎橋筋2-4-2", businessStatus: "OPERATIONAL" }
      ]
    })
  });
  assert.equal(result.candidates[0].placeId, "ichiran-namba");
  assert.deepEqual(result.candidates.map((item) => item.rank), [1, 2]);
  assert.ok(result.candidates.every((item) => item.candidateCount === 2));
  assert.ok(result.candidates[0].matchReasons.includes("支店名が一致"));
  assert.ok(result.candidates[0].matchScore > result.candidates[1].matchScore);
});

test("Places details are fetched only after a confirmed place id", async () => {
  let capturedOptions;
  const fetchImpl = async (url, options) => {
    capturedOptions = options;
    assert.match(url, /ChIJ-confirmed/);
    assert.match(options.headers["X-Goog-FieldMask"], /regularOpeningHours/);
    return Response.json({
      id: "ChIJ-confirmed",
      displayName: { text: "ホームズパスタ 上野店" },
      formattedAddress: "東京都台東区上野4-8-9",
      businessStatus: "OPERATIONAL",
      googleMapsUri: "https://maps.google.com/?cid=confirmed",
      websiteUri: "https://example-restaurant.jp",
      nationalPhoneNumber: "03-1234-5678",
      regularOpeningHours: { weekdayDescriptions: ["月曜日: 11:00～22:00"] },
      currentOpeningHours: { openNow: true, nextCloseTime: "2026-07-31T22:00:00+09:00", nextOpenTime: "2026-08-01T11:00:00+09:00" },
      rating: 4.2,
      userRatingCount: 128,
      primaryTypeDisplayName: { text: "イタリア料理店" },
      attributions: [{ provider: "Example Data", providerUri: "https://provider.example" }]
    });
  };

  const place = await getGooglePlaceDetails({ placeId: "ChIJ-confirmed", apiKey: "test-key", fetchImpl });
  assert.equal(place.name, "ホームズパスタ 上野店");
  assert.equal(place.phone, "03-1234-5678");
  assert.equal(place.hours.length, 1);
  assert.equal(place.currentOpeningHours.openNow, true);
  assert.equal(place.currentOpeningHours.nextCloseTime, "2026-07-31T22:00:00+09:00");
  assert.equal(place.currentOpeningHours.retrievedAt, place.retrievedAt);
  assert.equal(place.rating, 4.2);
  assert.equal(place.userRatingCount, 128);
  assert.match(capturedOptions.headers["X-Goog-FieldMask"], /rating/);
  assert.match(capturedOptions.headers["X-Goog-FieldMask"], /currentOpeningHours/);
  assert.equal(place.attributions[0].provider, "Example Data");
});

test("Hot Pepper matching requires a meaningful name or address match", async () => {
  const fetchImpl = async () => Response.json({
    results: {
      shop: [
        { id: "J-wrong", name: "別の店", address: "東京都新宿区", urls: { pc: "https://hotpepper.jp/wrong" } },
        {
          id: "J-right",
          name: "ホームズパスタ 上野店",
          address: "東京都台東区上野4-8-9",
          station_name: "上野",
          access: "上野駅徒歩5分",
          urls: { pc: "https://hotpepper.jp/right" },
          open: "11:00～22:00",
          close: "不定休",
          budget: { name: "2001～3000円" }
        }
      ]
    }
  });

  const result = await searchHotPepper({
    name: "ホームズパスタ 上野店",
    address: "東京都台東区上野4-8-9",
    apiKey: "hp-key",
    fetchImpl
  });
  assert.equal(result.match.id, "J-right");
  assert.equal(result.match.url, "https://hotpepper.jp/right");
});

test("Hot Pepper does not accept an address-only collision as the same restaurant", async () => {
  const fetchImpl = async () => Response.json({
    results: {
      shop: [{
        id: "J-collision",
        name: "完全に別の店",
        address: "東京都台東区上野4-8-9",
        urls: { pc: "https://hotpepper.jp/collision" }
      }]
    }
  });
  const result = await searchHotPepper({
    name: "ホームズパスタ 上野店",
    address: "東京都台東区上野4-8-9",
    apiKey: "hp-key",
    fetchImpl
  });
  assert.equal(result.match, null);
});

test("Hot Pepper rejects the same name when the known street address conflicts", async () => {
  const result = await searchHotPepper({
    name: "MKレストラン 佐世保大塔店",
    address: "長崎県佐世保市大塔町18-16",
    apiKey: "hp-key",
    fetchImpl: async () => Response.json({ results: { shop: [{
      id: "old-address",
      name: "MKレストラン 佐世保大塔店",
      address: "長崎県佐世保市大塔町15-22",
      urls: { pc: "https://www.hotpepper.jp/strJ000000000/" }
    }] } })
  });
  assert.equal(result.match, null);
});

test("Hot Pepper falls back from an empty phone lookup to name and address", async () => {
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (String(url).includes("tel=")) return Response.json({ results: { shop: [] } });
    return Response.json({
      results: {
        shop: [{
          id: "J-keyword",
          name: "ホームズパスタ 上野店",
          address: "東京都台東区上野4-8-9",
          urls: { pc: "https://hotpepper.jp/keyword" },
          budget: { name: "2001～3000円" }
        }]
      }
    });
  };

  const result = await searchHotPepper({
    name: "ホームズパスタ 上野店",
    address: "東京都台東区上野4-8-9",
    phone: "03-5812-4960",
    apiKey: "hp-key",
    fetchImpl
  });

  assert.equal(urls.length, 2);
  assert.match(urls[0], /tel=0358124960/);
  assert.match(urls[1], /keyword=/);
  assert.equal(result.match.id, "J-keyword");
});

test("Hot Pepper relaxes an over-specific address keyword to the restaurant name", async () => {
  const urls = [];
  let admittedRequests = 0;
  const fetchImpl = async (url) => {
    urls.push(String(url));
    if (urls.length < 3) return Response.json({ results: { shop: [] } });
    return Response.json({
      results: {
        shop: [{
          id: "J001178343",
          name: "HUB ハブ 上野店",
          address: "東京都台東区上野６-8-8 POKKE B1F",
          urls: { pc: "https://www.hotpepper.jp/strJ001178343/" }
        }]
      }
    });
  };

  const result = await searchHotPepper({
    name: "HUB 上野店",
    address: "東京都台東区上野6-8-8 POKKE B1F",
    phone: "03-0000-0000",
    apiKey: "hp-key",
    fetchImpl,
    beforeRequest: async () => { admittedRequests += 1; }
  });

  assert.equal(urls.length, 3);
  assert.equal(admittedRequests, 3);
  assert.match(decodeURIComponent(urls[2]), /keyword=HUB\+?上野店|keyword=HUB 上野店/);
  assert.equal(result.match.id, "J001178343");
});

test("decision engine keeps reservation unknown and attaches field-level evidence", () => {
  const place = {
    placeId: "ChIJ-confirmed",
    name: "ホームズパスタ 上野店",
    address: "東京都台東区上野4-8-9",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=confirmed",
    websiteUri: "https://example-restaurant.jp",
    phone: "03-1234-5678",
    hours: ["月曜日: 11:00～22:00"],
    category: "イタリア料理店",
    retrievedAt: "2026-07-10T07:00:00.000Z"
  };
  const hotPepperResult = {
    available: true,
    retrievedAt: "2026-07-10T07:00:01.000Z",
    match: {
      url: "https://hotpepper.jp/right",
      station: "上野駅",
      open: "11:00～22:00",
      close: "不定休",
      budget: "2001～3000円",
      access: "上野駅徒歩5分"
    }
  };

  const result = buildRestaurantResult({ place, hotPepperResult, userClues: { name: "ホームズパスタ", area: "上野" } });
  assert.equal(result.recommendation, "unknown");
  assert.equal(result.primaryAction.type, "phone");
  assert.ok(result.evidenceFacts.some((fact) => fact.field === "phone" && fact.sourceType === "google_places"));
  assert.ok(result.evidenceFacts.some((fact) => fact.field === "budget" && fact.sourceType === "hotpepper"));
  assert.ok(result.evidenceFacts.some((fact) => fact.field === "station" && fact.value === "上野駅"));
  assert.equal(result.station, "上野駅");
  assert.equal(result.sources.length, 2);
});

test("decision result remains usable when optional Hot Pepper enrichment fails", () => {
  const place = {
    placeId: "ChIJ-google-only",
    name: "Google Only Restaurant",
    address: "東京都渋谷区",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=google-only",
    websiteUri: "",
    phone: "03-0000-0000",
    hours: [],
    category: "レストラン",
    retrievedAt: "2026-07-10T07:00:00.000Z"
  };
  const result = buildRestaurantResult({
    place,
    hotPepperResult: { available: true, match: null, error: true },
    userClues: { name: "Google Only Restaurant" }
  });
  assert.equal(result.name, "Google Only Restaurant");
  assert.equal(result.sources.length, 1);
  assert.ok(result.reasons.includes("ホットペッパーグルメとの照合を一時的に利用できません"));
});

test("permanent closure overrides a still-live third-party listing in the full result", () => {
  const place = {
    placeId: "closed-demo",
    name: "Closed Restaurant",
    address: "東京都中央区1-2-3",
    businessStatus: "CLOSED_PERMANENTLY",
    googleMapsUri: "https://maps.google.com/?cid=closed-demo",
    websiteUri: "",
    phone: "03-0000-0000",
    hours: [],
    category: "レストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const result = buildRestaurantResult({
    place,
    hotPepperResult: {
      available: true,
      retrievedAt: "2026-07-13T07:00:01.000Z",
      match: { url: "https://www.hotpepper.jp/strJ000000000/", open: "11:00～22:00", close: "無休", budget: "2000円", access: "駅前" }
    }
  });
  assert.equal(result.recommendation, "temporarily_unavailable");
  assert.equal(result.primaryAction.type, "map");
  assert.match(result.conflict, /第三者サービスにページが残っていても/);
  assert.ok(result.reservationOptions.some((item) => item.provider === "hotpepper"));
  assert.ok(result.evidenceFacts.some((fact) => fact.field === "business_status" && fact.value === "CLOSED_PERMANENTLY"));
});

test("verified official temporary closure overrides Google and a live booking listing", () => {
  const place = {
    placeId: "mk-sasebo-daito",
    name: "MKレストラン 佐世保大塔店",
    address: "長崎県佐世保市大塔町18-16",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=mk-sasebo",
    websiteUri: "https://store.mkrestaurants.co.jp/b/mkrestaurants/info/70007/",
    phone: "0956-26-1411",
    hours: ["月曜日: 11:00～23:00"],
    category: "しゃぶしゃぶレストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const officialUrl = place.websiteUri;
  const result = buildRestaurantResult({
    place,
    hotPepperResult: { available: true, retrievedAt: place.retrievedAt, match: { url: "https://www.hotpepper.jp/strJ000000000/", open: "11:00～23:00", close: "無休", budget: "2000円", access: "大塔" } },
    verifiedOfficialSource: { url: officialUrl, label: "MKレストラン官方门店页" },
    officialWebsiteDiscovery: {
      sourceVerified: true,
      sourceUrl: officialUrl,
      links: [{ provider: "hotpepper", label: "Hot Pepper", url: "https://www.hotpepper.jp/strJ000000000/" }],
      operationalStatus: { businessStatus: "CLOSED_TEMPORARILY", status: "temporarily_closed", certainty: "high", excerpt: "当面の間休業とさせていただきます", sourceUrl: officialUrl }
    }
  });
  assert.equal(result.recommendation, "temporarily_unavailable");
  assert.equal(result.primaryAction.type, "official_website");
  assert.equal(result.confidence, "high");
  assert.match(result.summary, /公式サイト.*一時休業/);
  assert.match(result.conflict, /公式サイト.*一時休業/);
  assert.ok(result.sources.some((source) => source.official && /営業状況/.test(source.note)));
  assert.ok(result.evidenceFacts.some((fact) => fact.sourceType === "official_website" && fact.value === "CLOSED_TEMPORARILY" && fact.confidence === "high" && fact.isOfficial));
});

test("carries an official no-reservations policy into sources, evidence, and the action decision", () => {
  const place = {
    placeId: "walk-in-only",
    name: "Walk-in Restaurant",
    address: "大阪府大阪市浪速区",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=walk-in-only",
    websiteUri: "https://restaurant.example/store",
    phone: "06-0000-0000",
    hours: ["月曜日: 11:00～22:00"],
    category: "レストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const result = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    verifiedOfficialSource: { url: place.websiteUri, label: "Verified official store" },
    officialWebsiteDiscovery: {
      sourceVerified: true,
      links: [],
      reservationPolicy: { status: "not_accepted", certainty: "high", excerpt: "予約可否 予約不可", sourceUrl: place.websiteUri }
    }
  });
  assert.equal(result.recommendation, "walk_in_ok");
  assert.ok(result.sources.some((source) => source.official && /予約ルール/.test(source.note)));
  assert.ok(result.evidenceFacts.some((fact) => fact.field === "reservation_policy"));
  assert.match(result.decisionEvidence[0].limitation, /希望時間の営業や空席は保証しません/);
});

test("does not promote reservation rules or links from an unverified Google-listed website", () => {
  const place = {
    placeId: "unverified-site",
    name: "Unverified Restaurant",
    address: "東京都新宿区1-2-3",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=unverified-site",
    websiteUri: "https://unverified.example/store",
    phone: "03-0000-0000",
    hours: [],
    category: "レストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const result = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    officialWebsiteDiscovery: {
      sourceVerified: false,
      reservationPolicy: { status: "not_accepted", certainty: "high", excerpt: "ご予約はできません", sourceUrl: place.websiteUri },
      links: [{ provider: "tablecheck", label: "TableCheck", url: "https://www.tablecheck.com/shops/wrong-store/reserve" }]
    }
  });
  const tablecheck = result.reservationOptions.find((item) => item.provider === "tablecheck");
  assert.ok(!result.evidenceFacts.some((fact) => fact.field === "reservation_policy"));
  assert.ok(!result.sources.some((source) => source.official && /予約ルール/.test(source.note)));
  assert.equal(tablecheck.status, "unverified_link");
  assert.equal(tablecheck.capability.certainty, "low");
  assert.equal(tablecheck.capability.recommended, false);
  assert.notEqual(result.primaryAction.provider, "tablecheck");
  assert.notEqual(result.recommendation, "walk_in_ok");
});

test("merges a user-provided platform link without overriding an official-site link", () => {
  const place = {
    placeId: "user-link-merge",
    name: "Demo Restaurant",
    address: "東京都中央区銀座1-1-1",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=user-link-merge",
    websiteUri: "https://restaurant.example/store",
    phone: "03-0000-0000",
    hours: [],
    category: "レストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const result = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    discoveredReservationLinks: [{ provider: "tablecheck", label: "TableCheck", url: "https://www.tablecheck.com/shops/wrong/reserve", sourceVerified: false, source: "user_provided" }],
    officialWebsiteDiscovery: {
      sourceVerified: true,
      links: [{ provider: "tablecheck", label: "TableCheck", url: "https://www.tablecheck.com/shops/correct/reserve" }]
    },
    verifiedOfficialSource: { url: place.websiteUri, label: "Demo official store" }
  });
  const tablecheck = result.reservationOptions.find((item) => item.provider === "tablecheck");
  assert.equal(tablecheck.url, "https://www.tablecheck.com/shops/correct/reserve");
  assert.equal(tablecheck.officiality, "linked_from_restaurant_website");
  assert.equal(result.primaryAction.provider, "tablecheck");
});

test("shows an Instagram profile only when it is linked by a verified official store page", () => {
  const place = {
    placeId: "official-social",
    name: "Official Social Restaurant",
    address: "東京都渋谷区1-2-3",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/?cid=official-social",
    websiteUri: "https://restaurant.example/store",
    phone: "03-0000-0000",
    hours: [],
    category: "レストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const socialLinks = [{ provider: "instagram", label: "Instagram", handle: "@official_restaurant", url: "https://www.instagram.com/official_restaurant/" }];
  const verified = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    verifiedOfficialSource: { url: place.websiteUri, label: "Verified official store" },
    officialWebsiteDiscovery: { sourceVerified: true, links: [], socialLinks }
  });
  assert.equal(verified.officialInstagramUrl, socialLinks[0].url);
  assert.ok(verified.sources.some((source) => source.name === "公式 Instagram" && source.official));
  assert.ok(verified.evidenceFacts.some((fact) => fact.field === "official_social:instagram" && fact.isOfficial));

  const unverified = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    officialWebsiteDiscovery: { sourceVerified: false, links: [], socialLinks }
  });
  assert.equal(unverified.officialInstagramUrl, "");
  assert.ok(!unverified.sources.some((source) => source.name === "公式 Instagram"));
});

test("prefers a verified official phone and exposes a conflict with a platform forwarding number", () => {
  const place = {
    placeId: "official-phone",
    name: "Demo Restaurant",
    address: "大阪府大阪市1-2-3",
    businessStatus: "OPERATIONAL",
    googleMapsUri: "https://maps.google.com/demo",
    websiteUri: "https://demo.gorp.jp/",
    phone: "050-0000-0000",
    hours: [],
    category: "レストラン",
    retrievedAt: "2026-07-13T07:00:00.000Z",
    attributions: []
  };
  const result = buildRestaurantResult({
    place,
    hotPepperResult: { available: false, match: null },
    verifiedOfficialSource: { url: "https://restaurant.example/store" },
    officialWebsiteDiscovery: {
      sourceVerified: true,
      sourceUrl: "https://restaurant.example/store",
      links: [],
      officialContact: { phone: "06-1111-2222", sourceUrl: "https://restaurant.example/store" }
    }
  });
  assert.equal(result.phone, "06-1111-2222");
  assert.match(result.conflict, /050-0000-0000.*06-1111-2222/);
  assert.ok(result.reservationOptions.some((item) => item.actionType === "phone" && item.url === "tel:06-1111-2222"));
  assert.equal(detectOfficialContactConflicts(place, { phone: "05000000000" }).length, 0);
});

test("source conflict detection catches branch address and closed-day disagreements", () => {
  const conflicts = detectSourceConflicts(
    {
      address: "東京都台東区上野4-8-9",
      hours: ["月曜日: 11:00～22:00", "火曜日: 11:00～22:00"]
    },
    {
      address: "東京都新宿区西新宿1-1-1",
      close: "月曜日"
    }
  );
  assert.ok(conflicts.some((item) => item.field === "address" && item.severity === "high"));
  assert.ok(conflicts.some((item) => item.field === "opening_hours" && item.severity === "medium"));
});

test("missing Places credentials fail explicitly instead of pretending results are live", async () => {
  await assert.rejects(
    searchGooglePlaces({ query: "test", apiKey: "" }),
    (error) => error instanceof DataSourceError && error.status === 503
  );
});

test("upstream network failures are classified by data source", async () => {
  await assert.rejects(
    searchGooglePlaces({
      query: "ホームズパスタ 上野店",
      apiKey: "test-key",
      fetchImpl: async () => { throw new TypeError("fetch failed"); }
    }),
    (error) => error instanceof DataSourceError && error.source === "google_places" && error.status === 502 && /network request failed/.test(error.message)
  );
});

test("separates result computation, Places retrieval and cached official retrieval times", () => {
  const googleTime="2026-09-30T10:00:00.000Z";
  const officialTime="2026-09-29T02:00:00.000Z";
  const place={placeId:"time-test",name:"時刻検証店",address:"東京都千代田区",businessStatus:"OPERATIONAL",websiteUri:"https://restaurant.example/",googleMapsUri:"https://maps.google.com/?cid=test",hours:[],category:"飲食店",retrievedAt:googleTime,attributions:[]};
  const build = (time) => buildRestaurantResult({place,hotPepperResult:{available:false,match:null},officialSource:{verified:true,url:place.websiteUri},officialWebsiteDiscovery:{sourceVerified:true,retrievedAt:time,links:[],reservationPolicy:{status:"not_accepted",excerpt:"予約を受け付けておりません",sourceUrl:place.websiteUri}}});
  const result=build(officialTime);
  assert.ok(Date.parse(result.verification.resultGeneratedAt)>Date.parse(googleTime));
  assert.equal(result.verification.identityConfirmedAt,null); // Server retrieval cannot infer a user's selection time.
  assert.equal(result.sources.find(source=>source.name==="Google Maps").retrievedAt,googleTime);
  assert.ok(result.sources.some(source=>source.name==="店舗公式サイト"));
  assert.ok(result.evidenceFacts.some(fact=>fact.field==="reservation_policy"));
  assert.ok(result.sources.filter(source=>source.name==="店舗公式サイト").every(source=>source.retrievedAt===officialTime));
  assert.ok(result.evidenceFacts.filter(fact=>fact.sourceUrl===place.websiteUri && fact.field==="reservation_policy").every(fact=>fact.retrievedAt===officialTime));
  const cached=build(officialTime);
  assert.deepEqual(cached.verification.sources,result.verification.sources);
  for(const invalid of [null,"2026-02-30T10:00:00Z","2099-01-01T00:00:00Z","2026-01-01T24:00:00Z"]) {
    const unknown=build(invalid);
    assert.ok(unknown.verification.sources.filter(source=>source.name==="店舗公式サイト").every(source=>source.retrievedAt===null));
  }
});
