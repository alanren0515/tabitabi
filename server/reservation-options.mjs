const PLATFORM_HOSTS = [
  { provider: "tablecheck", label: "TableCheck", hosts: ["tablecheck.com", "tablecheck.jp"] },
  { provider: "tabelog", label: "食べログ", hosts: ["tabelog.com"] },
  { provider: "hotpepper", label: "ホットペッパーグルメ", hosts: ["hotpepper.jp"] },
  { provider: "gurunavi", label: "楽天ぐるなび", hosts: ["gurunavi.com", "gnavi.co.jp", "gorp.jp"] },
  { provider: "omakase", label: "OMAKASE", hosts: ["omakase.in"] },
  { provider: "pocket_concierge", label: "Pocket Concierge", hosts: ["pocket-concierge.jp"] },
  { provider: "tableall", label: "TABLEALL", hosts: ["tableall.com"] },
  { provider: "ikyu", label: "一休レストラン", hosts: ["restaurant.ikyu.com"] },
  { provider: "opentable", label: "OpenTable", hosts: ["opentable.jp", "opentable.com"] },
  { provider: "google_reserve", label: "Reserve with Google", hosts: ["google.com", "google.co.jp"], pathPattern: /^\/maps\/reserve\//i },
  { provider: "epark", label: "EPARK", hosts: ["epark.jp"] },
  { provider: "autoreserve", label: "AutoReserve", hosts: ["autoreserve.com"] },
  { provider: "hitosara", label: "ヒトサラ", hosts: ["hitosara.com", "reserve.hitosara.com"] },
  { provider: "savor_japan", label: "SAVOR JAPAN", hosts: ["savorjapan.com"] },
  { provider: "toreta", label: "Toreta", hosts: ["yoyaku.toreta.in"] },
  { provider: "ebica", label: "ebica", hosts: ["booking.ebica.jp"] },
  { provider: "paypay_gourmet", label: "PayPay Gourmet", hosts: ["paypaygourmet.yahoo.co.jp"] },
  { provider: "ozmall", label: "OZmall", hosts: ["ozmall.co.jp"] },
  { provider: "retty", label: "Retty", hosts: ["retty.me"] },
  { provider: "byfood", label: "byFood", hosts: ["byfood.com"] },
  { provider: "foodies_reserve", label: "Foodies Reserve", hosts: ["foodies-reserve.com"] },
  { provider: "jpneazy", label: "JPNEAZY", hosts: ["jpneazy.com"] },
  { provider: "my_concierge_japan", label: "My Concierge Japan", hosts: ["myconciergejapan.com", "mycon-jp.net"] },
  { provider: "japan_food_travel", label: "JapanFoodTravel", hosts: ["japanfood.travel"] }
];

const PROVIDER_NOTES = {
  tabelog: "食べログの店舗ページだけではネット予約の可否は分かりません。予約時に人数分のシステム利用料がかかる場合があるため、申込画面で確認してください。",
  hotpepper: "ホットペッパーグルメの店舗ページは即時予約、リクエスト予約、情報掲載のみのいずれかです。予約ボタンと最終通知を確認してください。",
  tablecheck: "TableCheck ではカード保証、事前決済、キャンセル規定への同意が必要な場合があります。送信前に確認してください。",
  gurunavi: "楽天ぐるなびの店舗ページがあってもネット予約可能とは限りません。日付と人数を選べるか確認してください。",
  ikyu: "一休のプランには事前決済、サービス料、キャンセル条件が含まれる場合があります。申込画面で確認してください。",
  omakase: "OMAKASE ではログイン、カード、事前決済、キャンセル待ちが必要な場合があります。サービス上で確定して初めて予約成立です。",
  pocket_concierge: "Pocket Concierge は即時確定または店舗確認待ちの場合があり、オンライン決済が必要なこともあります。予約状態を確認してください。",
  tableall: "TABLEALL は確保済み席または店舗へのリクエストを提供し、席ごとの予約手数料がかかる場合があります。総額と最終確定状態を確認してください。",
  opentable: "OpenTable は確認画面の完了または確認通知を受け取って初めて予約成立です。",
  google_reserve: "Google で予約は即時予約、リクエスト、提携サービスへの移動のいずれかです。確認通知を受け取って初めて予約成立です。",
  epark: "EPARK は順番待ち受付の場合があります。受付番号は座席予約ではなく、実際の入店時刻も変わることがあります。",
  autoreserve: "AutoReserve は店舗公式サイトが明確に案内している場合だけ候補にします。代行料やキャンセル料がかかる場合があり、店舗またはサービスの明確な確認で初めて成立します。",
  hitosara: "ヒトサラの店舗ページは即時予約、リクエスト、情報掲載のみのいずれかです。予約フォームと最終通知を確認してください。",
  savor_japan: "SAVOR JAPAN は即時予約またはリクエスト予約の場合があります。リクエスト送信後も店舗の確認が必要です。",
  toreta: "Toreta は店舗が利用するオンライン予約フォームです。確認画面の完了または確認通知で初めて予約成立です。",
  ebica: "ebica は店舗が利用するオンライン予約フォームです。支店、日付、人数、キャンセル規定を確認してください。",
  paypay_gourmet: "PayPayグルメの店舗ページだけでは予約可能な席があるとは限りません。日付と人数の選択画面で確認してください。",
  ozmall: "OZmall の店舗・プランページには限定プラン、オンライン決済、サービス料、キャンセル条件が含まれる場合があります。申込画面で確認してください。",
  retty: "Retty は即時予約またはリクエスト予約の場合があります。リクエストは店舗の回答を待つ必要があります。",
  byfood: "byFood は事前決済プランや有料の予約代行を提供する場合があります。料金、キャンセル規定、最終確定状態を確認してください。",
  foodies_reserve: "Foodies Reserve はログイン、手数料、カード、事前決済が必要な場合があります。確認メールを受け取って初めて予約成立です。",
  jpneazy: "JPNEAZY は有料のリクエスト予約・代行サービスです。送信だけでは成立せず、確認後に料金とキャンセル条件が適用される場合があります。",
  my_concierge_japan: "My Concierge Japan はサービス料と事前決済が必要な場合があります。飲食代、キャンセル条件、最終確定状態を確認してください。",
  japan_food_travel: "JapanFoodTravel は有料の予約代行サービスです。問い合わせ送信だけでは店舗の予約成立になりません。"
};

export function buildReservationOptions({ place, hotPepperMatch = null, discoveredLinks = [], officialWebsiteUri = "", userClues = {} }) {
  const options = [];
  const query = [place?.name || userClues.name, place?.address || userClues.address].filter(Boolean).join(" ");
  const website = safeHttpUrl(place?.websiteUri);
  const verifiedOfficialWebsite = safeHttpUrl(officialWebsiteUri);
  const websiteIsVerifiedOfficial = Boolean(website && verifiedOfficialWebsite === website);
  const websitePlatform = website ? platformForUrl(website) : null;

  if (website) {
    const googleListedPlatform = Boolean(websitePlatform && !websiteIsVerifiedOfficial);
    options.push(withCapability({
      id: websitePlatform?.provider || (websiteIsVerifiedOfficial ? "official_website" : "external_website"),
      provider: websitePlatform?.provider || (websiteIsVerifiedOfficial ? "official_website" : "external_website"),
      label: websitePlatform ? websitePlatform.label : websiteIsVerifiedOfficial ? "店舗公式サイト" : "Google Maps 掲載サイト",
      url: website,
      actionType: "open_booking_source",
      bookingMode: "unknown",
      status: googleListedPlatform ? "unverified_link" : "verified_link",
      officiality: googleListedPlatform ? "google_listed_external" : websitePlatform ? "reservation_platform" : websiteIsVerifiedOfficial ? "restaurant_official" : "google_listed_external",
      confidence: websitePlatform || !websiteIsVerifiedOfficial ? "medium" : "high",
      feeNote: websitePlatform
        ? [googleListedPlatform ? "Google Maps 掲載のリンクで、現在の支店との対応を店舗公式サイトでは確認できていません。" : "この入口の情報源は確認済みです。", providerNote(websitePlatform.provider)].join(" ")
        : websiteIsVerifiedOfficial ? "店名と住所で確認済みの公式ページです。" : "Google Maps 掲載のリンクですが、店舗公式サイトとしては未確認です。",
      prepaymentRequired: null
    }));
  }

  if (verifiedOfficialWebsite && verifiedOfficialWebsite !== website) {
    options.push(withCapability({
      id: "verified_official_website",
      provider: "official_website",
      label: "店舗公式ページ",
      url: verifiedOfficialWebsite,
      actionType: "open_booking_source",
      bookingMode: "unknown",
      status: "verified_link",
      officiality: "restaurant_official",
      confidence: "high",
      feeNote: "店名と住所で確認済みの公式ページです。",
      prepaymentRequired: null
    }));
  }

  if (hotPepperMatch?.url && !options.some((item) => item.provider === "hotpepper")) {
    options.push(withCapability({ id: "hotpepper", provider: "hotpepper", label: "ホットペッパーグルメ", url: hotPepperMatch.url, actionType: "open_booking_source", bookingMode: "unknown", status: "verified_listing", officiality: "reservation_platform", confidence: "medium", feeNote: providerNote("hotpepper"), prepaymentRequired: null }));
  }

  for (const link of discoveredLinks) {
    if (!link?.url || !link?.provider) continue;
    const sourceVerified = link.sourceVerified !== false;
    const userProvided = link.source === "user_provided";
    const existingIndex = options.findIndex((item) => item.provider === link.provider);
    if (existingIndex >= 0) {
      const existingVerified = options[existingIndex].status !== "unverified_link";
      if (existingVerified && !sourceVerified) continue;
      if (!existingVerified && sourceVerified) {
        options.splice(existingIndex, 1);
      } else {
        const existingPriority = reservationLinkPriority(link.provider, options[existingIndex].url);
        const discoveredPriority = reservationLinkPriority(link.provider, link.url);
        if (discoveredPriority <= existingPriority) continue;
        options.splice(existingIndex, 1);
      }
    }
    options.push(withCapability({
      id: link.provider, provider: link.provider, label: link.label || link.provider, url: link.url,
      actionType: "open_booking_source", bookingMode: "unknown", status: sourceVerified ? "verified_link" : "unverified_link",
      officiality: sourceVerified ? "linked_from_restaurant_website" : userProvided ? "user_provided_external" : "google_listed_external", confidence: sourceVerified ? "high" : userProvided ? "low" : "medium",
      feeNote: [sourceVerified ? "確認済みの店舗公式サイトから直接リンクされています。" : userProvided ? "入力時に追加されたリンクで、現在の店舗・支店との対応は未確認です。" : "Google Maps 掲載サイトから見つかった未確認の入口です。店名と支店を確認してください。", providerNote(link.provider)].filter(Boolean).join(" "),
      prepaymentRequired: null
    }));
  }

  if (place?.googleMapsUri) {
    options.push(withCapability({ id: "google_maps", provider: "google_maps", label: "Google Maps", url: place.googleMapsUri, actionType: "open_map", bookingMode: "unknown", status: "verified_link", officiality: "map_platform", confidence: "medium", feeNote: "", prepaymentRequired: null }));
  }

  if (place?.phone) {
    options.push(withCapability({ id: "phone", provider: "phone", label: "電話で確認", url: `tel:${String(place.phone).replace(/[^\d+()-]/g, "")}`, actionType: "phone", bookingMode: "phone", status: "verified_contact", officiality: "direct_restaurant", confidence: "medium", feeNote: "予約は店舗から明確な回答を受けた時点で成立します。", prepaymentRequired: false }));
  }

  for (const platform of PLATFORM_HOSTS.filter((item) => ["tabelog", "tablecheck", "gurunavi"].includes(item.provider))) {
    if (options.some((item) => item.provider === platform.provider)) continue;
    options.push(withCapability({
      id: `${platform.provider}_discovery`, provider: platform.provider, label: platform.label,
      url: siteSearchUrl(platform.hosts[0], query), actionType: "discover_platform", bookingMode: "unknown",
      status: "discovery_only", officiality: "unverified_discovery", confidence: "low",
      feeNote: platform.provider === "tabelog" ? "店舗を探すための入口です。食べログ予約対応を示すものではなく、予約時にシステム利用料がかかる場合があります。" : "店舗を探すための入口です。このサービスで予約受付中とは限りません。",
      prepaymentRequired: null
    }));
  }
  return options.sort((a, b) => {
    const recommendationOrder = Number(Boolean(b.capability.recommended)) - Number(Boolean(a.capability.recommended));
    return recommendationOrder || b.capability.priority - a.capability.priority;
  });
}

export function primaryReservationAction(options = []) {
  const option = options.find((item) => item.capability?.recommended);
  if (!option) return null;
  return { label: option.capability.primaryLabel, url: option.url, type: option.provider === "official_website" ? "official_website" : option.actionType, provider: option.provider };
}

export function platformForUrl(value) {
  const url = safeHttpUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  return PLATFORM_HOSTS.find((platform) => {
    const hostMatches = platform.hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
    return hostMatches && (!platform.pathPattern || platform.pathPattern.test(parsed.pathname));
  }) || null;
}

export function normalizeUserProvidedReservationLinks(value) {
  if (!Array.isArray(value)) return [];
  const links = [];
  for (const item of value.slice(0, 5)) {
    const url = safeHttpUrl(item?.url);
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.username || parsed.password || parsed.port || url.length > 2_048) continue;
    const platform = platformForUrl(url);
    if (!url || !platform) continue;
    if (links.some((link) => link.provider === platform.provider && link.url === url)) continue;
    links.push({ provider: platform.provider, label: platform.label, url, sourceVerified: false, source: "user_provided" });
  }
  return links;
}

function siteSearchUrl(host, query) {
  const url = new URL("https://www.google.com/search");
  url.searchParams.set("q", `site:${host} ${query}`.trim());
  return url.href;
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch { return ""; }
}

function withCapability(option) {
  const derived = reservationCapability(option);
  return { ...option, bookingMode: derived.bookingMode || option.bookingMode, capability: derived };
}

function reservationCapability(option) {
  if (option.actionType === "phone") {
    return capability("phone_confirmation", "電話で確認", "medium", 55, true, "店舗へ電話して確認", "phone", "店舗から明確な回答を受けた時点で予約成立です");
  }
  if (option.status === "discovery_only") {
    return capability("discovery", "店舗ページを検索", "low", 10, false, "店舗ページを探す", "unknown", "この店舗の予約可能なページはまだ確認できていません");
  }
  if (option.actionType === "open_map") {
    return capability("map", "地図情報", "medium", 20, false, "地図で確認", "unknown", "地図上の予約ボタンは、実際の提供元と確定状況を確認してください");
  }
  const flow = reservationFlowForUrl(option.provider, option.url);
  if (flow) {
    const sourceAssociationVerified = option.status !== "unverified_link";
    const certainty = option.officiality === "linked_from_restaurant_website" ? "high" : sourceAssociationVerified ? "medium" : "low";
    const confirmation = sourceAssociationVerified ? flow.confirmation : `現在の店舗との対応は未確認です。店名と支店を確認してください。${flow.confirmation}`;
    return capability(flow.kind, flow.label, certainty, flow.priority, sourceAssociationVerified, flow.primaryLabel || `${option.label} で予約を確認`, flow.bookingMode, confirmation, flow.payment);
  }
  if (option.officiality === "restaurant_official") {
    return capability("official_information", "公式サイトで確認", "high", 60, true, "公式サイトで予約方法を確認", "unknown", "予約できる席はまだ確認できていません");
  }
  if (option.officiality === "google_listed_external" && platformForUrl(option.url)) {
    return capability("platform_listing", "予約サービスの店舗ページ", "low", 50, false, `${option.label} で確認`, "unknown", "現在の店舗・支店との対応は未確認で、予約対応も示しません");
  }
  if (option.officiality === "google_listed_external") {
    return capability("external_information", "外部サイトで確認", "medium", 45, true, "Google Maps 掲載サイトを開く", "unknown", "店舗公式サイトとして未確認で、予約対応も示しません");
  }
  if (option.officiality === "user_provided_external") {
    return capability("external_information", "入力された外部リンク", "low", 35, false, "入力されたリンクを開く", "unknown", "現在の店舗・支店との対応は未確認で、予約成立も示しません");
  }
  const sourceAssociationVerified = option.status !== "unverified_link";
  const confirmation = sourceAssociationVerified
    ? "店舗ページがあっても予約対応とは限りません"
    : "現在の店舗・支店との対応は未確認で、予約対応も示しません";
  return capability("platform_listing", "予約サービスの店舗ページ", sourceAssociationVerified ? option.confidence || "medium" : "low", 50, sourceAssociationVerified, `${option.label} で確認`, "unknown", confirmation);
}

function capability(kind, label, certainty, priority, recommended, primaryLabel, bookingMode = "unknown", confirmation = "予約できる席はまだ確認できていません", payment = "unknown") {
  return {
    kind,
    label,
    certainty,
    priority,
    recommended,
    primaryLabel,
    bookingMode,
    confirmation,
    payment
  };
}

function reservationFlowForUrl(provider, value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  const path = `${url.pathname}${url.search}`.toLowerCase();
  const online = (label = "オンライン予約") => ({ kind: "online_reservation_flow", label, priority: 100, bookingMode: "instant_or_request", confirmation: "確認画面の完了または確認通知を受け取って初めて予約成立です", payment: "unknown" });
  if (provider === "official_booking" && /(?:^|\/)(?:reserve|reservation|booking|yoyaku|plan(?:_list)?)(?:[\/_.-]|$)/.test(path)) {
    return online("店舗公式の予約ページ");
  }
  if (provider === "tablecheck" && /\/shops\/[^/]+\/(reserve|reservation)(?:\/|$|\?)/.test(path)) return online();
  if (provider === "google_reserve" && /^\/maps\/reserve\//.test(path)) {
    return { kind: "provider_booking_flow", label: "Google で予約", priority: 92, bookingMode: "provider_determined", confirmation: "即時確定、店舗確認待ち、提携サービスへの移動のいずれかです。確認通知を受け取って初めて予約成立です", payment: "unknown" };
  }
  if (provider === "tabelog" && /\/ai_request_booking\/(?:guide|request|entry|form|shops?|restaurants?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "食べログ 予約リクエスト", priority: 88, bookingMode: "request", confirmation: "サービスが店舗へ確認します。成立通知を受け取るまでは予約成立ではありません", payment: "unknown" };
  }
  if (provider === "tabelog" && (/\/yoyaku\/net_booking_form\/(?:index)?(?:\/|$|\?)/.test(path) || /^\/booking\/form\/new(?:\?|$)/.test(path))) return online("食べログ ネット予約");
  if (provider === "gurunavi" && /\/(?:plan\/)?[a-z0-9_-]+\/plan-reserve\/(?:plan\/)?(?:plan_list)?(?:\/|$|\?)/.test(path)) return online("楽天ぐるなび予約");
  if (provider === "omakase" && /\/(r|reserve|reservation)\/[a-z0-9_-]+/.test(path)) return online("高級店の予約ページ");
  if (provider === "ikyu" && (/\/\d+\/plan(?:\d+)?(?:\/|$|\?)/.test(path) || /\/(reserve|reservation)(?:\/|$|\?)/.test(path))) return online("プラン予約");
  if (provider === "pocket_concierge" && /\/(?:[a-z]{2}\/)?restaurants\/[a-z0-9_-]+\/(?:reserve|reservation|booking)(?:\/|$|\?)/.test(path)) return online("予約・オンライン決済");
  if (provider === "tableall" && /\/restaurant\/\d+(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "高級店の即時予約またはリクエスト", priority: 88, bookingMode: "provider_determined", confirmation: "確保済み席または予約リクエストの場合があります。予約成立表示または確認通知で初めて成立です", payment: "required_or_unknown" };
  }
  if (provider === "opentable" && /\/r\/[^/?]+/.test(path)) return online();
  if (provider === "hotpepper" && /\/str[^/]+\/(?:yoyaku|course[^/]*\/reserve)(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "予約サービスの手続き", priority: 95, bookingMode: "provider_determined", confirmation: "即時予約またはリクエストの場合があります。画面と店舗の最終通知を確認してください", payment: "unknown" };
  }
  if (provider === "epark" && /\/(?:gourmet\/)?[^?]*(?:waitlist|faspa|junban|queue)/.test(path)) {
    return { kind: "waitlist_flow", label: "順番待ち受付", priority: 70, bookingMode: "waitlist", primaryLabel: "EPARK で順番待ちを確認", confirmation: "受付番号は座席予約ではありません。呼び出し時に不在の場合は取消になることがあります", payment: "unknown" };
  }
  if (provider === "autoreserve" && /\/(?:[a-z]{2}\/)?restaurants\/[a-z0-9_-]+\/(?:reserve|reservation|booking)(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "即時予約または予約代行", priority: 85, bookingMode: "provider_determined", confirmation: "送信時点では未確定の場合があります。AutoReserve の予約確認を受け取って初めて成立です", payment: "unknown" };
  }
  if (provider === "toreta" && !/^\/?(?:[a-z]{2}\/?)?$/.test(path)) return online("店舗のオンライン予約フォーム");
  if (provider === "ebica" && /\/(?:webrsv|reserve|reservation|booking)(?:\/|$|\?)/.test(path)) return online("店舗のオンライン予約フォーム");
  if (provider === "savor_japan" && /\/(?:reserve|reservation|booking)(?:\/|$|\?)/.test(path)) return { kind: "provider_booking_flow", label: "即時予約またはリクエスト", priority: 90, bookingMode: "provider_determined", confirmation: "リクエスト予約は店舗の確認が必要です。最終通知を確認してください", payment: "unknown" };
  if (provider === "paypay_gourmet" && /^\/\d+\/plan\d+(?:\/|$|\?)/.test(path)) return online("PayPayグルメ プラン予約");
  if (provider === "ozmall" && /\/restaurant\/\d+\/plan\/\d+(?:\/|$|\?)/.test(path)) return online("OZmall プラン予約");
  if (provider === "foodies_reserve" && /\/(?:[a-z]{2}\/)?restaurants\/[a-z0-9_-]+(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "店舗予約・決済", priority: 88, bookingMode: "provider_determined", confirmation: "Foodies Reserve の確認メールを受け取って初めて予約成立です", payment: "required_or_unknown" };
  }
  if (provider === "jpneazy" && /\/(?:[a-z]{2}\/)?restaurants\/\d+(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "有料の予約リクエスト", priority: 86, bookingMode: "request", confirmation: "サービスが店舗へ連絡・手配します。確認を受け取り、必要な支払いを完了して初めて成立です", payment: "required_or_unknown" };
  }
  if (provider === "my_concierge_japan" && url.hostname.toLowerCase().replace(/^www\./, "").endsWith("mycon-jp.net") && /\/reservation\/[a-z0-9_-]+\/(?:[a-z]{2})(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "高級店の予約代行・事前決済", priority: 88, bookingMode: "provider_determined", confirmation: "サービス上で成立表示または確認通知を受け取って初めて予約成立です", payment: "required_or_unknown" };
  }
  return null;
}

export function reservationLinkPriority(provider, value) {
  return reservationFlowForUrl(provider, value)?.priority || 50;
}

function providerNote(provider) {
  return PROVIDER_NOTES[provider] || "";
}
