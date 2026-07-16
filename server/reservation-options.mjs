const PLATFORM_HOSTS = [
  { provider: "tablecheck", label: "TableCheck", hosts: ["tablecheck.com", "tablecheck.jp"] },
  { provider: "tabelog", label: "Tabelog", hosts: ["tabelog.com"] },
  { provider: "hotpepper", label: "Hot Pepper", hosts: ["hotpepper.jp"] },
  { provider: "gurunavi", label: "Gurunavi", hosts: ["gurunavi.com", "gnavi.co.jp", "gorp.jp"] },
  { provider: "omakase", label: "OMAKASE", hosts: ["omakase.in"] },
  { provider: "pocket_concierge", label: "Pocket Concierge", hosts: ["pocket-concierge.jp"] },
  { provider: "tableall", label: "TABLEALL", hosts: ["tableall.com"] },
  { provider: "ikyu", label: "一休餐厅", hosts: ["restaurant.ikyu.com"] },
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
  tabelog: "Tabelog 的店铺页不一定支持网络预约；部分预约可能按人数收取系统使用费，请以下单页为准。",
  hotpepper: "Hot Pepper 店铺页可能是即时预约、请求预约或仅展示信息；必须以页面上的预约按钮和最终通知为准。",
  tablecheck: "TableCheck 可能要求信用卡担保、预付或接受取消条款，请在提交前核对。",
  gurunavi: "Gurunavi 店铺页不代表已经开放网络预约，请确认页面是否有可选日期和人数。",
  ikyu: "一休套餐可能包含预付、服务费或取消条件，请以下单页显示为准。",
  omakase: "OMAKASE 可能要求登录、信用卡、预付或候补；完成平台确认后才算预约成立。",
  pocket_concierge: "Pocket Concierge 可能即时确认或等待餐厅确认，也可能要求在线结算，请核对订单状态。",
  tableall: "TABLEALL 可能提供预购席位或代为向餐厅请求预约，并可能收取按席位计算的预约费；请核对总价和最终确认状态。",
  opentable: "OpenTable 只有在完成确认页面或收到确认通知后才算预约成功。",
  google_reserve: "Google 预约可能是即时预约、请求预约或跳转合作平台；收到确认邮件后才算预约成立。",
  epark: "EPARK 可能只是顺番待ち（排队取号）；取号不等于保留座位，实际入店时间可能变化。",
  autoreserve: "AutoReserve 仅在餐厅官网明确提供该入口时才建议考虑；店铺页不一定开放或获得餐厅认可，且可能产生代订费或取消费用。只有餐厅或平台明确确认后才算成立。",
  hitosara: "ヒトサラ 店铺页可能支持即时预约、请求预约或仅展示信息，请以预约表单和最终通知为准。",
  savor_japan: "SAVOR JAPAN 可能提供即时预约或请求预约；请求提交后仍需等待餐厅确认。",
  toreta: "Toreta 是餐厅常用的在线预约表单；完成确认页面或收到确认通知后才算预约成功。",
  ebica: "ebica 是餐厅常用的在线预约表单；请核对分店、日期、人数和取消条款。",
  paypay_gourmet: "PayPay Gourmet 店铺页不一定有可预约席位，请以日期和人数选择页为准。",
  ozmall: "OZmall 的餐厅或套餐页可能包含限定方案、在线支付、服务费或取消条件，请以下单页为准。",
  retty: "Retty 可能是即时预约或请求预约；请求预约需等待餐厅答复。",
  byfood: "byFood 可能提供预付套餐或付费代联络服务，请核对费用、取消规则和最终确认状态。",
  foodies_reserve: "Foodies Reserve 可能要求登录、预约手续费、信用卡或预付款；只有收到平台确认邮件后才算预约成立。",
  jpneazy: "JPNEAZY 是请求预约与代订服务，可能包含餐费及平台手续费；提交请求不等于成功，确认后费用和取消条件可能生效。",
  my_concierge_japan: "My Concierge Japan 可能收取 concierge 服务费并要求预付；请核对餐费、取消条件和最终确认状态。",
  japan_food_travel: "JapanFoodTravel 是付费人工代订服务，按页面公布的服务费执行；提交咨询不等于餐厅已接受预约。"
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
      label: websitePlatform ? websitePlatform.label : websiteIsVerifiedOfficial ? "餐厅官网" : "Google Maps 所列网站",
      url: website,
      actionType: "open_booking_source",
      bookingMode: "unknown",
      status: googleListedPlatform ? "unverified_link" : "verified_link",
      officiality: googleListedPlatform ? "google_listed_external" : websitePlatform ? "reservation_platform" : websiteIsVerifiedOfficial ? "restaurant_official" : "google_listed_external",
      confidence: websitePlatform || !websiteIsVerifiedOfficial ? "medium" : "high",
      feeNote: websitePlatform
        ? [googleListedPlatform ? "该平台链接来自 Google Maps，但尚未由餐厅官网独立确认与当前分店的关联。" : "该平台入口已完成来源核验。", providerNote(websitePlatform.provider)].join(" ")
        : websiteIsVerifiedOfficial ? "该官方页面已按店名与地址核验。" : "该链接来自 Google Maps，但尚未独立核验为餐厅官网。",
      prepaymentRequired: null
    }));
  }

  if (verifiedOfficialWebsite && verifiedOfficialWebsite !== website) {
    options.push(withCapability({
      id: "verified_official_website",
      provider: "official_website",
      label: "餐厅官方门店页",
      url: verifiedOfficialWebsite,
      actionType: "open_booking_source",
      bookingMode: "unknown",
      status: "verified_link",
      officiality: "restaurant_official",
      confidence: "high",
      feeNote: "该官方页面已按店名与地址核验。",
      prepaymentRequired: null
    }));
  }

  if (hotPepperMatch?.url && !options.some((item) => item.provider === "hotpepper")) {
    options.push(withCapability({ id: "hotpepper", provider: "hotpepper", label: "Hot Pepper", url: hotPepperMatch.url, actionType: "open_booking_source", bookingMode: "unknown", status: "verified_listing", officiality: "reservation_platform", confidence: "medium", feeNote: providerNote("hotpepper"), prepaymentRequired: null }));
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
      feeNote: [sourceVerified ? "该入口由已核验餐厅官网直接链接。" : userProvided ? "这是你输入时提供的链接，尚未独立核验与当前餐厅或分店的关联。" : "该入口来自 Google Maps 所列但未独立核验的网站，请先核对店名和分店。", providerNote(link.provider)].filter(Boolean).join(" "),
      prepaymentRequired: null
    }));
  }

  if (place?.googleMapsUri) {
    options.push(withCapability({ id: "google_maps", provider: "google_maps", label: "Google Maps", url: place.googleMapsUri, actionType: "open_map", bookingMode: "unknown", status: "verified_link", officiality: "map_platform", confidence: "medium", feeNote: "", prepaymentRequired: null }));
  }

  if (place?.phone) {
    options.push(withCapability({ id: "phone", provider: "phone", label: "电话确认", url: `tel:${String(place.phone).replace(/[^\d+()-]/g, "")}`, actionType: "phone", bookingMode: "phone", status: "verified_contact", officiality: "direct_restaurant", confidence: "medium", feeNote: "可能需要日语沟通，预约是否成立以餐厅确认为准。", prepaymentRequired: false }));
  }

  for (const platform of PLATFORM_HOSTS.filter((item) => ["tabelog", "tablecheck", "gurunavi"].includes(item.provider))) {
    if (options.some((item) => item.provider === platform.provider)) continue;
    options.push(withCapability({
      id: `${platform.provider}_discovery`, provider: platform.provider, label: platform.label,
      url: siteSearchUrl(platform.hosts[0], query), actionType: "discover_platform", bookingMode: "unknown",
      status: "discovery_only", officiality: "unverified_discovery", confidence: "low",
      feeNote: platform.provider === "tabelog" ? "这是查找入口，不代表该店支持 Tabelog 预约；部分预约可能另收系统使用费。" : "这是查找入口，不代表该店已在该平台开放预约。",
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
    return capability("phone_confirmation", "电话确认", "medium", 55, true, "拨打电话确认预约", "phone", "餐厅明确答复后才算预约成功");
  }
  if (option.status === "discovery_only") {
    return capability("discovery", "仅查找平台页面", "low", 10, false, "查找平台页面", "unknown", "尚未确认是否存在该店的可预约页面");
  }
  if (option.actionType === "open_map") {
    return capability("map", "地图信息", "medium", 20, false, "在地图核对", "unknown", "地图中的预约按钮仍需核对实际服务商和确认状态");
  }
  const flow = reservationFlowForUrl(option.provider, option.url);
  if (flow) {
    const sourceAssociationVerified = option.status !== "unverified_link";
    const certainty = option.officiality === "linked_from_restaurant_website" ? "high" : sourceAssociationVerified ? "medium" : "low";
    const confirmation = sourceAssociationVerified ? flow.confirmation : `该入口与当前餐厅的关联尚未独立核验；请先核对店名和分店。${flow.confirmation}`;
    return capability(flow.kind, flow.label, certainty, flow.priority, sourceAssociationVerified, flow.primaryLabel || `通过 ${option.label} 开始预约`, flow.bookingMode, confirmation, flow.payment);
  }
  if (option.officiality === "restaurant_official") {
    return capability("official_information", "官网核对", "high", 60, true, "打开官网核对预约方式", "unknown", "尚未确认可预约名额");
  }
  if (option.officiality === "google_listed_external" && platformForUrl(option.url)) {
    return capability("platform_listing", "平台店铺页面", "low", 50, false, `在 ${option.label} 核对预约`, "unknown", "该平台页与当前餐厅或分店的关联尚未独立核验，也不能证明支持预约");
  }
  if (option.officiality === "google_listed_external") {
    return capability("external_information", "外部网站核对", "medium", 45, true, "打开 Google Maps 所列网站核对", "unknown", "该网站尚未独立核验为餐厅官网，也不能证明支持预约");
  }
  if (option.officiality === "user_provided_external") {
    return capability("external_information", "用户提供的外部链接", "low", 35, false, "打开用户提供的链接核对", "unknown", "该链接与当前餐厅或分店的关联尚未独立核验，也不能证明预约已经成立");
  }
  const sourceAssociationVerified = option.status !== "unverified_link";
  const confirmation = sourceAssociationVerified
    ? "店铺页存在不代表支持预约"
    : "该平台页与当前餐厅或分店的关联尚未独立核验，也不能证明支持预约";
  return capability("platform_listing", "平台店铺页面", sourceAssociationVerified ? option.confidence || "medium" : "low", 50, sourceAssociationVerified, `在 ${option.label} 核对预约`, "unknown", confirmation);
}

function capability(kind, label, certainty, priority, recommended, primaryLabel, bookingMode = "unknown", confirmation = "尚未确认可预约名额", payment = "unknown") {
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
  const online = (label = "线上预约流程") => ({ kind: "online_reservation_flow", label, priority: 100, bookingMode: "instant_or_request", confirmation: "完成平台确认页面或收到确认通知后才算预约成功", payment: "unknown" });
  if (provider === "official_booking" && /(?:^|\/)(?:reserve|reservation|booking|yoyaku|plan(?:_list)?)(?:[\/_.-]|$)/.test(path)) {
    return online("餐厅官网预约流程");
  }
  if (provider === "tablecheck" && /\/shops\/[^/]+\/(reserve|reservation)(?:\/|$|\?)/.test(path)) return online();
  if (provider === "google_reserve" && /^\/maps\/reserve\//.test(path)) {
    return { kind: "provider_booking_flow", label: "Google 预约流程", priority: 92, bookingMode: "provider_determined", confirmation: "可能即时确认、等待餐厅确认或转到合作平台；收到确认邮件后才算预约成立", payment: "unknown" };
  }
  if (provider === "tabelog" && /\/ai_request_booking\/(?:guide|request|entry|form|shops?|restaurants?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "食べログ请求预约", priority: 88, bookingMode: "request", confirmation: "平台会代为向餐厅确认；收到成立通知前不算预约成功", payment: "unknown" };
  }
  if (provider === "tabelog" && (/\/yoyaku\/net_booking_form\/(?:index)?(?:\/|$|\?)/.test(path) || /^\/booking\/form\/new(?:\?|$)/.test(path))) return online("食べログ网络预约流程");
  if (provider === "gurunavi" && /\/(?:plan\/)?[a-z0-9_-]+\/plan-reserve\/(?:plan\/)?(?:plan_list)?(?:\/|$|\?)/.test(path)) return online("楽天ぐるなび预约流程");
  if (provider === "omakase" && /\/(r|reserve|reservation)\/[a-z0-9_-]+/.test(path)) return online("高端餐厅预约流程");
  if (provider === "ikyu" && (/\/\d+\/plan(?:\d+)?(?:\/|$|\?)/.test(path) || /\/(reserve|reservation)(?:\/|$|\?)/.test(path))) return online("套餐预约流程");
  if (provider === "pocket_concierge" && /\/(?:[a-z]{2}\/)?restaurants\/[a-z0-9_-]+\/(?:reserve|reservation|booking)(?:\/|$|\?)/.test(path)) return online("预约与在线结算流程");
  if (provider === "tableall" && /\/restaurant\/\d+(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "高端餐厅即时或请求预约", priority: 88, bookingMode: "provider_determined", confirmation: "页面可能是预购席位或代为请求；只有显示预约成立或收到确认通知后才算成功", payment: "required_or_unknown" };
  }
  if (provider === "opentable" && /\/r\/[^/?]+/.test(path)) return online();
  if (provider === "hotpepper" && /\/str[^/]+\/(?:yoyaku|course[^/]*\/reserve)(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "平台预约流程", priority: 95, bookingMode: "provider_determined", confirmation: "可能是即时预约或请求预约；以页面和餐厅最终通知为准", payment: "unknown" };
  }
  if (provider === "epark" && /\/(?:gourmet\/)?[^?]*(?:waitlist|faspa|junban|queue)/.test(path)) {
    return { kind: "waitlist_flow", label: "排队取号流程", priority: 70, bookingMode: "waitlist", primaryLabel: "打开 EPARK 查看排队取号", confirmation: "取号不等于订座，过号或未到店可能被取消", payment: "unknown" };
  }
  if (provider === "autoreserve" && /\/(?:[a-z]{2}\/)?restaurants\/[a-z0-9_-]+\/(?:reserve|reservation|booking)(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "即时预约或代订流程", priority: 85, bookingMode: "provider_determined", confirmation: "提交时可能尚未确认；收到 AutoReserve 的预约确认后才算成功", payment: "unknown" };
  }
  if (provider === "toreta" && !/^\/?(?:[a-z]{2}\/?)?$/.test(path)) return online("餐厅在线预约表单");
  if (provider === "ebica" && /\/(?:webrsv|reserve|reservation|booking)(?:\/|$|\?)/.test(path)) return online("餐厅在线预约表单");
  if (provider === "savor_japan" && /\/(?:reserve|reservation|booking)(?:\/|$|\?)/.test(path)) return { kind: "provider_booking_flow", label: "即时或请求预约流程", priority: 90, bookingMode: "provider_determined", confirmation: "请求预约需要餐厅确认；以最终通知为准", payment: "unknown" };
  if (provider === "paypay_gourmet" && /^\/\d+\/plan\d+(?:\/|$|\?)/.test(path)) return online("PayPay Gourmet 套餐预约流程");
  if (provider === "ozmall" && /\/restaurant\/\d+\/plan\/\d+(?:\/|$|\?)/.test(path)) return online("OZmall 套餐预约流程");
  if (provider === "foodies_reserve" && /\/(?:[a-z]{2}\/)?restaurants\/[a-z0-9_-]+(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "餐厅预约与结算流程", priority: 88, bookingMode: "provider_determined", confirmation: "收到 Foodies Reserve 的确认邮件后才算预约成立", payment: "required_or_unknown" };
  }
  if (provider === "jpneazy" && /\/(?:[a-z]{2}\/)?restaurants\/\d+(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "付费请求预约流程", priority: 86, bookingMode: "request", confirmation: "平台需联系或安排餐厅；收到确认且按要求完成付款后才算成立", payment: "required_or_unknown" };
  }
  if (provider === "my_concierge_japan" && url.hostname.toLowerCase().replace(/^www\./, "").endsWith("mycon-jp.net") && /\/reservation\/[a-z0-9_-]+\/(?:[a-z]{2})(?:\/|$|\?)/.test(path)) {
    return { kind: "provider_booking_flow", label: "高端餐厅代订与预付流程", priority: 88, bookingMode: "provider_determined", confirmation: "只有平台显示成立或发出确认通知后才算预约成功", payment: "required_or_unknown" };
  }
  return null;
}

export function reservationLinkPriority(provider, value) {
  return reservationFlowForUrl(provider, value)?.priority || 50;
}

function providerNote(provider) {
  return PROVIDER_NOTES[provider] || "";
}
