import { buildPhoneScript, confidenceLabel, findCandidates, recommendationLabel } from "./analyzer.js";
import { buildRestaurantQuery, extractionReviewState, formatBudget, isKnownSampleScreenshot, mergeScreenshotSupplemental, normalizeExtraction, sampleTikTokExtraction, selectExtractedRestaurant } from "./screenshot-extraction.js";
import { createSavedPlan, normalizeSavedPlans, PLAN_STATUSES, planStatusLabel, sortSavedPlansByUrgency, updateSavedPlan } from "./saved-plans.js";
import { deleteLocalData, LOCAL_STORAGE_KEY, summarizeLocalData, VISIT_STORAGE_KEY } from "./privacy-data.js";
import { candidateDecision, candidateDecisionCopy, rejectCandidate, restoreCandidates, visibleCandidates } from "./candidate-selection.js";
import { TERMS_EFFECTIVE_DATE, TERMS_SECTIONS } from "./terms-data.js";
import { addRecentAnalysis, createRecentAnalysis, normalizeRecentAnalyses, RECENT_STORAGE_KEY } from "./recent-analyses.js";
import { buildSharePayload } from "./share-result.js";
import { DEFAULT_SETTINGS, normalizeSettings, pilotAccessHeaders, settingsFromForm, SETTINGS_STORAGE_KEY } from "./settings.js";
import { addPendingRestaurants, normalizePendingAnalyses, parseBatchRestaurantLines, pendingAnalysisToTextExtraction, PENDING_STORAGE_KEY, removePendingAnalysis, restaurantClueKey } from "./analysis-queue.js";
import { parseShareTarget, urlWithoutShareTarget } from "./shared-input.js";
import { createCapabilitiesLoader } from "./capabilities.js";
import { clipboardScreenshotFile, SCREENSHOT_ACCEPT, validateScreenshotFile } from "./image-input.js";
import { sendEvent } from "./event-client.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const loadCapabilities = createCapabilitiesLoader();
const AUDIT_SESSION_KEY = "tabitabi-audit-session-v1";
const initialParams = new URLSearchParams(window.location.search);
if (initialParams.get("audit") === "1") sessionStorage.setItem(AUDIT_SESSION_KEY, "1");
const trafficType = sessionStorage.getItem(AUDIT_SESSION_KEY) === "1" ? "audit" : "product";
const initialSettings = normalizeSettings(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) || "{}"));
const initialSharedInput = parseShareTarget(window.location.search);
if (initialParams.get("share") === "1" || initialParams.get("audit") === "1") {
  const cleanUrl = new URL(urlWithoutShareTarget(window.location.href), window.location.origin);
  cleanUrl.searchParams.delete("audit");
  history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}
const state = {
  view: "home",
  input: initialSharedInput.value,
  sharedInputPending: initialSharedInput.accepted,
  uploadName: "",
  uploadFile: null,
  uploadPreviewUrl: "",
  extraction: null,
  extractionMode: "",
  extractionMeta: null,
  textExtraction: null,
  currentPlanIntent: {},
  capabilities: null,
  analysisError: "",
  loadingMode: "",
  candidateMode: "demo",
  currentClues: {},
  userProvidedReservationLinks: [],
  candidates: [],
  candidatePreviews: {},
  candidatePreviewLoadingId: "",
  analysisStartedAt: null,
  analysisRunId: "",
  analysisSourceMode: "",
  rejectedCandidateIds: [],
  confirmedCandidate: null,
  resultFocus: "",
  restaurant: null,
  phoneScriptVersion: initialSettings.defaultPhoneScript,
  planEditorOpen: false,
  deleteConfirmOpen: false,
  saved: normalizeSavedPlans(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "[]")),
  recent: normalizeRecentAnalyses(JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || "[]")),
  pending: normalizePendingAnalyses(JSON.parse(localStorage.getItem(PENDING_STORAGE_KEY) || "[]")),
  activePendingId: null,
  settings: initialSettings
};

const icons = {
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  upload: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m0 0L7 9m5-5 5 5M5 14v5h14v-5"/></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h12v16l-6-4-6 4z"/></svg>',
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h4l2 5-3 2c1.3 2.6 2.8 4.1 5.5 5.4l2-3 4.5 2V18c0 1.7-1.3 3-3 3C10 20.5 3.5 14 3 6c0-1.7 1.3-3 3-3Z"/></svg>'
};

function esc(value = "") {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2200);
}

function syncSaved() {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state.saved));
  document.querySelector("#saved-count").textContent = state.saved.length;
}

function syncRecent() {
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(state.recent));
  const count = document.querySelector("#history-count");
  if (count) count.textContent = state.recent.length;
}

function syncSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(state.settings));
}

function syncPending() {
  localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(state.pending));
  const count = document.querySelector("#pending-count");
  if (count) count.textContent = state.pending.length;
}

function render() {
  if (state.view === "home") renderHome();
  if (state.view === "extraction") renderExtraction();
  if (state.view === "text_extraction") renderTextExtraction();
  if (state.view === "link_guidance") renderLinkGuidance();
  if (state.view === "candidates") renderCandidates();
  if (state.view === "candidate_confirmed") renderCandidateConfirmed();
  if (state.view === "loading") renderLoading();
  if (state.view === "result") renderResult();
  if (state.view === "saved") renderSaved();
  if (state.view === "history") renderHistory();
  if (state.view === "queue") renderQueue();
  if (state.view === "privacy") renderPrivacy();
  if (state.view === "terms") renderTerms();
  if (state.view === "settings") renderSettings();
  syncSaved();
  syncRecent();
  syncSettings();
  syncPending();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderHome() {
  const visionLive = Boolean(state.capabilities?.visionExtraction);
  const visionModel = state.capabilities?.models?.[0]?.model || "";
  const visionFallback = Boolean(state.capabilities?.fallbackAvailable);
  const capabilitiesUnavailable = Boolean(state.capabilities?.capabilitiesUnavailable);
  const offline = navigator.onLine === false;
  app.innerHTML = `
    <section class="hero">
      <div class="eyebrow"><span></span> JAPAN DINING, SIMPLIFIED</div>
      <h1>看到想吃的店，<br><em>下一步交给我们。</em></h1>
      <p class="hero-copy">粘贴链接、店名或上传截图。我们帮你确认是哪家店、需不需要预约，以及现在最该做什么。</p>
      ${state.sharedInputPending ? `<aside class="shared-input-banner"><strong>已接收系统分享</strong><span>分享来的标题、文字或链接已填入下方。请先检查内容，再开始分析。</span></aside>` : ""}
      ${offline ? `<aside class="offline-banner"><strong>当前处于离线状态</strong><span>仍可打开应用和查看保存在本机的清单；新的截图识别、餐厅搜索与官网核对需要联网。</span></aside>` : ""}
      <form id="analyze-form" class="input-card">
        <label for="clue">餐厅线索</label>
        <textarea id="clue" name="clue" rows="4" placeholder="粘贴 TikTok / 小红书链接，或输入：银座 蒼月 寿司…">${esc(state.input)}</textarea>
        <div class="input-meta">
          <label class="upload-button">
            ${icons.upload}<span>${state.uploadName ? esc(state.uploadName) : "上传截图"}</span>
            <input type="file" id="screenshot" accept="${SCREENSHOT_ACCEPT}" hidden />
          </label>
          ${state.uploadName ? '<button type="button" class="remove-upload" id="remove-upload">移除</button>' : '<span class="privacy-note">截图仅用于识别</span>'}
        </div>
        ${state.uploadPreviewUrl ? `<div class="upload-preview"><img src="${state.uploadPreviewUrl}" alt="待分析的截图预览"><div><strong>整张截图都会读取</strong><span>店名、地址、预算、账号、正文和互动数字会分开处理。</span></div></div>` : ""}
        ${state.analysisError ? `<aside class="inline-error"><strong>截图解析没有完成</strong><span>${esc(state.analysisError)}</span></aside>` : ""}
        <button class="primary-button" type="submit">开始分析 ${icons.arrow}</button>
      </form>
      <div class="examples">
        <span>试试演示：</span>
        <button data-example="银座 鮨 蒼月">需要预约的寿司店</button>
        <button data-example="新宿 麺処 灯 拉面">只能排队的拉面店</button>
        <button data-example="京都 喫茶 こもれび">信息不足的咖啡店</button>
      </div>
    </section>
    ${state.pending.length ? `<section class="recent-preview queue-preview"><div><p class="overline">待分析</p><h2>继续处理截图里的其他餐厅</h2></div><div class="recent-preview-list">${state.pending.slice(0, 3).map((item) => `<button data-open-pending="${esc(item.id)}"><strong>${esc(item.clues.name)}</strong><span>${esc([item.clues.branch, item.clues.area || item.clues.address].filter(Boolean).join(" · ") || "位置待确认")}</span></button>`).join("")}</div><button class="text-button" data-action="queue">查看全部 ${state.pending.length} 家</button></section>` : ""}
    ${state.recent.length ? `<section class="recent-preview"><div><p class="overline">最近分析</p><h2>继续上次的餐厅</h2></div><div class="recent-preview-list">${state.recent.slice(0, 3).map((item) => `<button data-open-recent="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>${esc(item.area || "地区待确认")} · ${formatClientTime(item.analyzedAt)}</span></button>`).join("")}</div><button class="text-button" data-action="history">查看全部 ${state.recent.length} 条</button></section>` : ""}
    <section class="promise-grid">
      <article><b>01</b><h3>确认正确店铺</h3><p>处理同名店、分店和多语言店名。</p></article>
      <article><b>02</b><h3>说明信息依据</h3><p>每个结论都显示来源、时间与置信度。</p></article>
      <article><b>03</b><h3>给出下一步</h3><p>预约入口、电话话术或现场排队建议。</p></article>
    </section>
    <aside class="demo-banner ${visionLive ? "live" : ""}"><strong>${capabilitiesUnavailable ? "暂时无法确认服务状态" : visionLive ? "实时截图理解已启用" : "截图理解演示模式"}</strong><span>${capabilitiesUnavailable ? "不会把临时网络或服务错误误报为 API 未配置；请联网后重试。" : visionLive ? `当前使用 ${esc(visionModel)} 读取整张截图；${visionFallback ? "低质量结果会自动调用备用识别" : "备用识别尚未配置，低置信度时会要求人工确认"}。提交前仍会让你确认店名与地址。` : "配置视觉 API 后可读取任意截图；本次提供的 TikTok 截图可使用本地示例解析。"}</span></aside>`;

  document.querySelector("#analyze-form").addEventListener("submit", handleAnalyze);
  document.querySelector("#screenshot").addEventListener("change", (event) => attachScreenshotFile(event.target.files[0] || null));
  document.querySelector("#clue").addEventListener("paste", (event) => {
    const file = clipboardScreenshotFile(event.clipboardData);
    if (!file) return;
    const textarea = event.currentTarget;
    setTimeout(() => {
      state.input = textarea.value;
      attachScreenshotFile(file, { pasted: true });
    }, 0);
  });
  document.querySelector("#remove-upload")?.addEventListener("click", clearUpload);
  document.querySelectorAll("[data-open-recent]").forEach((button) => button.addEventListener("click", () => openRecentAnalysis(button.dataset.openRecent)));
  document.querySelectorAll("[data-open-pending]").forEach((button) => button.addEventListener("click", () => openPendingAnalysis(button.dataset.openPending)));
  document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => {
    state.input = button.dataset.example;
    renderHome();
    document.querySelector("#clue").focus();
  }));
}

function attachScreenshotFile(file, { pasted = false } = {}) {
  if (!file) return;
  const validation = validateScreenshotFile(file);
  if (!validation.ok) {
    state.analysisError = validation.error;
    showToast("图片格式或大小不支持");
    renderHome();
    return;
  }
  if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
  state.uploadFile = file;
  state.uploadName = file.name || (pasted ? "已粘贴截图" : "截图");
  state.uploadPreviewUrl = URL.createObjectURL(file);
  state.analysisError = "";
  showToast(pasted ? "已从剪贴板附加截图" : "截图已添加，将读取整张画面");
  renderHome();
}

async function handleAnalyze(event) {
  event.preventDefault();
  const value = new FormData(event.currentTarget).get("clue").trim();
  if (!value && !state.uploadFile) {
    showToast("请先输入店名、链接或上传截图");
    return;
  }
  if (navigator.onLine === false) {
    showToast("当前离线，联网后才能开始新的分析");
    return;
  }
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable) {
    state.analysisError = "暂时无法确认分析服务状态，请检查网络后重试。";
    renderHome();
    return;
  }
  state.input = value || state.uploadName;
  state.sharedInputPending = false;
  state.activePendingId = null;
  state.userProvidedReservationLinks = [];
  state.analysisError = "";
  state.restaurant = null;
  state.currentPlanIntent = { planDate: "", planTime: "", partySize: state.settings.defaultPartySize };
  state.analysisRunId = createAnalysisRunId();
  state.analysisSourceMode = capabilities.placesSearch ? "live" : "demo";
  postEvent("input_submitted", {
    inputType: classifyInputType(value, Boolean(state.uploadFile)),
    sourceMode: state.analysisSourceMode
  });

  if (state.uploadFile) {
    state.loadingMode = "screenshot";
    state.view = "loading";
    render();
    try {
      const result = await extractScreenshot(state.uploadFile);
      if (result.mode === "sample") state.analysisSourceMode = "demo";
      const supplemental = value ? await extractTextInput(value) : null;
      state.extraction = mergeScreenshotSupplemental(result.extraction, supplemental);
      if (supplemental) state.currentPlanIntent = withDefaultPlan(supplemental.plan);
      state.extractionMode = result.mode;
      state.extractionMeta = result.meta || null;
      if (state.extraction.restaurant?.name) postEvent("restaurant_identified", { inputType: "screenshot", sourceMode: state.analysisSourceMode });
      state.loadingMode = "";
      state.input = buildRestaurantQuery(state.extraction) || value || state.uploadName;
      state.view = "extraction";
      render();
    } catch (error) {
      state.analysisError = error.message || "请稍后再试，或补充店名文字。";
      state.loadingMode = "";
      state.view = "home";
      render();
    }
    return;
  }

  try {
    const parsed = await extractTextInput(value);
    state.textExtraction = parsed;
    state.userProvidedReservationLinks = (parsed.links || []).filter((link) => link.linkType).map((link) => ({ url: link.url }));
    state.currentPlanIntent = withDefaultPlan(parsed.plan);
    if (parsed.requiresWebpage) {
      state.loadingMode = "webpage";
      state.view = "loading";
      render();
      const webpage = await extractWebpageInput(parsed.links[0]?.url);
      state.textExtraction = {
        ...parsed,
        kind: "webpage_clues",
        contentRead: true,
        requiresWebpage: false,
        webpage,
        clues: webpage.clues,
        searchQuery: [webpage.clues.name, webpage.clues.branch, webpage.clues.area, webpage.clues.address].filter(Boolean).join(" ")
      };
      state.loadingMode = "";
      if (webpage.clues?.name) postEvent("restaurant_identified", { inputType: "webpage", sourceMode: state.analysisSourceMode });
      state.view = "text_extraction";
      render();
      return;
    }
    if (parsed.clues?.name) postEvent("restaurant_identified", { inputType: classifyInputType(value, false), sourceMode: state.analysisSourceMode });
    if (parsed.requiresContent) {
      state.view = "link_guidance";
      render();
      return;
    }
    state.view = "text_extraction";
    render();
  } catch (error) {
    state.analysisError = error.message || "餐厅搜索暂时不可用。";
    state.view = "home";
    render();
  }
}

async function extractTextInput(text) {
  const response = await fetch("/api/extract-text", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "文字线索解析失败。");
  return payload;
}

async function extractWebpageInput(url) {
  const response = await fetch("/api/extract-webpage", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...pilotAccessHeaders(state.settings) },
    body: JSON.stringify({ url })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "公开网页线索提取失败。请改为粘贴店名或上传截图。");
  return payload;
}

function renderTextExtraction() {
  const parsed = state.textExtraction;
  const clues = parsed.clues;
  const parsedPlatformLabel = parsed.platformLabel || platformLabel(parsed.platform);
  app.innerHTML = `<section class="content-view narrow">
    <button class="back-button" data-action="home">← 修改输入</button>
    <div class="section-heading"><span class="step-chip">文字线索整理</span><h2>先确认要找的餐厅</h2><p>日期、时间和人数会带入用餐计划，不会混进餐厅搜索词。</p></div>
    <section class="panel extracted-restaurant"><form id="text-extraction-form">
      <div class="field-pair"><label>餐厅名或搜索词<input name="name" value="${esc(clues.name)}" required></label><label>分店<input name="branch" value="${esc(clues.branch)}"></label></div>
      <div class="field-pair"><label>地区<input name="area" value="${esc(clues.area)}"></label><label>地址补充<input name="address" value="${esc(clues.address)}"></label></div>
      ${clues.aliasExpanded ? `<aside class="alias-expansion"><strong>已识别中文常用名</strong><span>${esc(clues.originalName)} → ${esc(clues.name)}</span><p>日文正式名用于搜索，仍需通过地区、地址和候选页确认具体分店。</p></aside>` : ""}
      <div class="plan-preview"><strong>识别到的计划</strong><span>${parsed.plan.planDate || "日期未定"} · ${parsed.plan.planTime || "时间未定"} · ${state.currentPlanIntent.partySize} 人</span></div>
      ${parsed.kind === "pending_analysis" ? `<aside class="link-capability"><strong>来自本机待分析队列</strong><p>只保存了餐厅名、分店和位置线索；现在仍需确认真实店铺。</p></aside>` : parsed.webpage ? `<aside class="link-capability"><strong>已读取用户提交的公开网页线索 · ${esc(parsed.webpage.confidence === "high" ? "高" : parsed.webpage.confidence === "medium" ? "中" : "低")}置信度</strong><p>${esc(parsed.webpage.warnings.join(" "))}</p><a href="${esc(safeExternalUrl(parsed.webpage.sourceUrl))}" target="_blank" rel="noreferrer">打开原网页核对</a></aside>` : parsed.links.length ? `<aside class="link-capability"><strong>同时识别到 ${esc(parsedPlatformLabel)} 链接</strong><p>只使用你在链接旁边提供的文字作为餐厅线索，不读取第三方平台页面正文；仍需在候选页确认分店。</p></aside>` : ""}
      <button class="primary-button" type="submit">搜索真实餐厅候选 ${icons.arrow}</button>
    </form></section>
  </section>`;
  document.querySelector("#text-extraction-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const search = [form.name, form.branch, form.area, form.address].filter(Boolean).join(" ");
    try { await searchCandidates(search, form); }
    catch (error) { state.view = "text_extraction"; showToast(error.message || "餐厅搜索暂时不可用"); render(); }
  });
}

function renderLinkGuidance() {
  const parsed = state.textExtraction;
  const reservationPlatform = parsed.kind === "reservation_link";
  const parsedPlatformLabel = parsed.platformLabel || platformLabel(parsed.platform);
  const originalLink = parsed.links?.[0];
  app.innerHTML = `<section class="content-view narrow link-guidance-view">
    <button class="back-button" data-action="home">← 返回补充线索</button>
    <div class="section-heading"><span class="step-chip">${esc(parsedPlatformLabel)} 链接</span><h2>${reservationPlatform ? "平台链接已识别，但还不能确认餐厅" : "链接已识别，但帖子内容还没有读取"}</h2><p>${reservationPlatform ? "第三方店铺或预约页面不会被当作餐厅身份与预约成功的证据。请补充店名、地址或截图后继续核对。" : "社交平台帖子可能需要登录或动态加载。为了避免猜测店名，请再提供以下任一项。"}</p></div>
    ${reservationPlatform && originalLink ? `<aside class="link-capability"><strong>${originalLink.linkType === "booking_flow" ? "URL 形式像预约路径" : "当前是平台店铺或列表链接"}</strong><p>这里只识别 URL 类型，没有读取页面库存、店名、费用或确认状态。</p><a href="${esc(safeExternalUrl(originalLink.url))}" target="_blank" rel="noreferrer">打开原平台链接核对</a></aside>` : ""}
    <div class="guidance-grid"><article><b>推荐</b><h3>${reservationPlatform ? "补充餐厅截图" : "上传帖子截图"}</h3><p>返回首页上传完整截图，Qwen 会读取画面中的店名、地址和可见文字。</p></article><article><b>更快捷</b><h3>${reservationPlatform ? "在链接旁写上店名" : "粘贴正文或店名"}</h3><p>把链接和餐厅文字一起粘贴，例如“这个是六歌仙新宿本店，8 月 1 日四个人”。</p></article></div>
    <aside class="extraction-warning"><strong>当前没有发生的事情</strong><ul>${parsed.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></aside>
    <button class="primary-button" data-action="home">补充截图或文字</button>
  </section>`;
}

function platformLabel(value) {
  return { tiktok: "TikTok", instagram: "Instagram", xiaohongshu: "小红书", x: "X", web: "公开网页", tablecheck: "TableCheck", tabelog: "Tabelog", hotpepper: "Hot Pepper", gurunavi: "Gurunavi", omakase: "OMAKASE", pocket_concierge: "Pocket Concierge", tableall: "TABLEALL", ikyu: "一休餐厅", opentable: "OpenTable", google_reserve: "Reserve with Google", epark: "EPARK", autoreserve: "AutoReserve", hitosara: "ヒトサラ", savor_japan: "SAVOR JAPAN", toreta: "Toreta", ebica: "ebica", paypay_gourmet: "PayPay Gourmet", ozmall: "OZmall", retty: "Retty", byfood: "byFood", foodies_reserve: "Foodies Reserve", jpneazy: "JPNEAZY", my_concierge_japan: "My Concierge Japan", japan_food_travel: "JapanFoodTravel", unknown: "截图线索" }[value] || "预约平台";
}

function renderLoading() {
  const screenshotMode = state.loadingMode === "screenshot" || (Boolean(state.uploadFile) && !state.loadingMode);
  const detailsMode = state.loadingMode === "details";
  const searchMode = state.loadingMode === "search";
  const webpageMode = state.loadingMode === "webpage";
  app.innerHTML = `<section class="loading-view">
    <div class="scanner"><span></span><i>た</i></div>
    <p class="eyebrow">${screenshotMode ? "READING THE FULL SCREENSHOT" : webpageMode ? "READING PUBLIC PAGE CLUES" : detailsMode ? "VERIFYING THE PLACE" : "SEARCHING REAL PLACES"}</p>
    <h2>${screenshotMode ? "正在读取整张截图" : webpageMode ? "正在提取公开网页中的餐厅线索" : detailsMode ? "正在核对营业与行动信息" : "正在搜索真实餐厅"}</h2>
    <div class="loading-steps">${screenshotMode
      ? '<span class="done">识别多语言文字</span><span class="active">区分事实与帖子描述</span><span>整理餐厅线索</span>'
      : webpageMode
        ? '<span class="done">检查公开网址</span><span class="active">读取标题和结构化餐厅字段</span><span>等待用户确认</span>'
      : detailsMode
        ? '<span class="done">确认店铺身份</span><span class="active">刷新营业与电话</span><span>整理证据和下一步</span>'
        : '<span class="done">提交店名与地址</span><span class="active">匹配 Google Maps</span><span>等待用户确认</span>'}</div>
  </section>`;
}

function renderExtraction() {
  const e = state.extraction;
  const r = e.restaurant;
  const meta = state.extractionMeta;
  const needsConfirmation = Boolean(meta?.requiresUserConfirmation);
  const review = extractionReviewState(e, meta);
  const placesReady = Boolean(state.capabilities?.placesSearch);
  const currentKey = restaurantClueKey(r);
  const queuedKeys = new Set(state.pending.map((item) => restaurantClueKey(item.clues)));
  const queueableRestaurants = e.restaurants.filter((restaurant) => restaurantClueKey(restaurant) !== currentKey && !queuedKeys.has(restaurantClueKey(restaurant)) && restaurant.name);
  const engagement = [
    ["点赞", e.engagement.likes],
    ["评论", e.engagement.comments],
    ["收藏", e.engagement.saves],
    ["分享", e.engagement.shares]
  ].filter(([, value]) => Number.isFinite(value));

  app.innerHTML = `<section class="content-view extraction-view">
    <button class="back-button" data-action="home">← 换一张截图</button>
    <div class="section-heading extraction-heading"><span class="step-chip">截图理解 · ${state.extractionMode === "api" ? esc(meta?.model || "视觉 API") : "本地示例"}</span><h2>截图里识别到这些</h2><p>先检查店名和地址，再进入餐厅候选匹配。</p></div>
    <div class="extraction-layout">
      <aside class="screenshot-card"><img src="${state.uploadPreviewUrl}" alt="上传的社交媒体截图"><div><span>${esc(e.platform.toUpperCase())}</span><strong>${esc(e.creator.handle || "未识别账号")}</strong></div></aside>
      <div class="extraction-content">
        ${e.restaurants.length > 1 ? `<section class="panel extracted-restaurant-picker"><div><p class="overline">识别到 ${e.restaurants.length} 家餐厅</p><h3>先选择要继续核对的一家</h3></div><div class="extracted-restaurant-options">${e.restaurants.map((restaurant, index) => `<button type="button" data-extracted-restaurant="${index}" class="${restaurantKeyForView(restaurant) === restaurantKeyForView(r) ? "active" : ""}"><strong>${esc(restaurant.name || `餐厅 ${index + 1}`)}</strong><span>${esc([restaurant.branch, restaurant.area || restaurant.address || restaurant.nearest_station].filter(Boolean).join(" · ") || "位置未识别")}</span></button>`).join("")}</div><button type="button" class="queue-extracted" id="queue-extracted" ${queueableRestaurants.length ? "" : "disabled"}>${queueableRestaurants.length ? `把其余 ${queueableRestaurants.length} 家加入待分析` : "其余餐厅已在待分析队列"}</button><small class="queue-privacy">仅在当前浏览器保存餐厅线索，不保存截图。</small></section>` : ""}
        <section class="panel extracted-restaurant"><div class="fact-label"><span class="status-dot dark"></span>可用于匹配的店铺信息</div>
          <form id="extraction-form">
            <div class="field-pair"><label>店名<input name="restaurant_name" value="${esc(r.name)}" required></label><label>分店<input name="branch" value="${esc(r.branch)}"></label></div>
            <div class="field-pair"><label>地址<input name="address" value="${esc(r.address)}"></label><label>最近车站<input name="nearest_station" value="${esc(r.nearest_station)}" placeholder="例如：上野駅"></label></div>
            <div class="extracted-chips"><span>${esc(r.category || "料理类型未识别")}</span><span>${formatBudget(r)}</span><span>${esc(r.area || "地区未识别")}</span></div>
            ${review.requiresAcknowledgement ? '<label class="confidence-confirm"><input type="checkbox" name="confirm_extraction" value="yes"><span>我已根据截图核对店名、分店和地址，愿意继续查看候选。</span></label>' : ""}
            <button class="primary-button" type="submit">继续核对这家店 ${icons.arrow}</button>
          </form>
        </section>
        <div class="extraction-subgrid">
        <section class="panel"><p class="overline">截图文字与作者描述</p><h3>画面文字、帖子说法与观点分开处理</h3><div class="claim-list">${e.claims.length ? e.claims.map((claim) => `<p><span>${claim.kind === "opinion" ? "观点" : claim.kind === "visible_fact" ? "画面文字" : "帖子称"}</span>${esc(claim.text)}</p>`).join("") : '<p class="muted">没有识别到相关描述。</p>'}</div><p class="fine-print">“画面文字”只表示截图中确实出现，不代表营业、闭店、搬迁或预约状态已经由当前官方来源确认。</p></section>
          <section class="panel"><p class="overline">社交互动</p><h3>只记录，不用于预约判断</h3><div class="engagement-grid">${engagement.length ? engagement.map(([label, value]) => `<div><strong>${new Intl.NumberFormat("zh-CN").format(value)}</strong><span>${label}</span></div>`).join("") : '<p class="muted">没有识别到互动数字。</p>'}</div></section>
        </div>
        ${review.requiresAcknowledgement || !review.canContinue ? `<aside class="extraction-warning"><strong>${review.canContinue ? "需要人工确认" : "还不能搜索候选"}</strong><p>${esc(review.message)}</p></aside>` : ""}
        <aside class="source-readiness ${placesReady ? "ready" : "pending"}"><strong>${placesReady ? "Google Places 实时核验已就绪" : "下一步将使用演示候选"}</strong><span>${placesReady ? "确认后会搜索真实餐厅候选；电话和营业时间只在选择店铺或主动展开该候选评分后读取。" : "Qwen 已能读取截图，但尚未配置 Google Maps Key；当前不会把演示候选伪装成真实结果。"}</span></aside>
        ${e.warnings.length ? `<aside class="extraction-warning"><strong>接下来要核对</strong><ul>${e.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></aside>` : ""}
      </div>
    </div>
  </section>`;

  document.querySelector("#extraction-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const clues = {
      name: String(form.get("restaurant_name") || ""),
      branch: String(form.get("branch") || ""),
      address: String(form.get("address") || ""),
      nearest_station: String(form.get("nearest_station") || ""),
      area: r.area,
      category: r.category
    };
    const submittedReview = extractionReviewState({ ...e, restaurant: { ...r, name: clues.name, branch: clues.branch, address: clues.address, nearest_station: clues.nearest_station } }, meta);
    if (!submittedReview.canContinue) {
      showToast(submittedReview.message);
      return;
    }
    if (submittedReview.requiresAcknowledgement && form.get("confirm_extraction") !== "yes") {
      showToast("请先确认你已经人工核对截图中的店名和地址");
      return;
    }
    state.input = [clues.name, clues.branch, clues.address || clues.area || clues.nearest_station].filter(Boolean).join(" ");
    try {
      await searchCandidates(state.input, clues);
    } catch (error) {
      state.analysisError = error.message || "餐厅搜索暂时不可用。";
      state.view = "extraction";
      showToast(state.analysisError);
      render();
    }
  });
  document.querySelectorAll("[data-extracted-restaurant]").forEach((button) => button.addEventListener("click", () => {
    state.extraction = selectExtractedRestaurant(state.extraction, Number(button.dataset.extractedRestaurant));
    state.input = buildRestaurantQuery(state.extraction);
    renderExtraction();
  }));
  document.querySelector("#queue-extracted")?.addEventListener("click", () => {
    const before = state.pending.length;
    state.pending = addPendingRestaurants(state.pending, e.restaurants, { excludeRestaurant: r, sourcePlatform: e.platform });
    const added = state.pending.length - before;
    syncPending();
    postEvent("pending_queue_added", { queueCount: state.pending.length });
    renderExtraction();
    showToast(added ? `已加入 ${added} 家待分析餐厅` : "这些餐厅已经在待分析队列");
  });
}

function restaurantKeyForView(restaurant) {
  return [restaurant?.name, restaurant?.branch, restaurant?.address].map((value) => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")).join("|");
}

function renderCandidates() {
  const fallback = state.candidates[0]?.isFallback;
  const live = state.candidateMode === "live";
  const visible = visibleCandidates(state.candidates, state.rejectedCandidateIds);
  const rejectedCount = state.candidates.length - visible.length;
  const decision = candidateDecision(visible);
  const decisionCopy = candidateDecisionCopy({ fallback, decision, candidateCount: visible.length, input: state.input });
  app.innerHTML = `<section class="content-view narrow">
    <button class="back-button" data-action="home">← 修改线索</button>
    <div class="section-heading candidate-heading"><span class="step-chip">第 1 步 · 确认门店</span><h2>${esc(decisionCopy.heading)}</h2><p>${esc(decisionCopy.summary)}</p><aside class="identity-gate"><strong>先确认身份，再读取详情</strong><span>当前只使用搜索结果核对门店。确认后，系统才会读取营业时间、电话、官网和预约方式。</span></aside></div>
    <div class="candidate-list">
      ${visible.map((restaurant, index) => {
        const preview = state.candidatePreviews[restaurant.placeId];
        const previewLoading = state.candidatePreviewLoadingId === restaurant.placeId;
        const isSystemLead = !fallback && decision.kind !== "ambiguous" && restaurant.id === decision.leadId;
        const candidateLabel = isSystemLead ? "系统首选" : visible.length === 1 ? "待你确认" : `可能性 ${index + 1}/${visible.length}`;
        return `<article class="candidate-card${isSystemLead ? " system-lead" : ""}">
        <div class="restaurant-avatar">${(restaurant.category || "餐").slice(0, 1)}</div>
        <div class="candidate-copy"><span class="candidate-label${isSystemLead ? " lead-label" : ""}">${esc(candidateLabel)}</span><small class="candidate-meta">${esc(restaurant.category || "餐厅")}${restaurant.price ? ` · ${esc(restaurant.price)}` : ""}</small><h3>${esc(restaurant.name)}</h3><p>${esc(restaurant.address || [restaurant.area, restaurant.station].filter(Boolean).join(" · "))}</p><small class="business-status status-${esc(String(restaurant.businessStatus || "unknown").toLowerCase())}">${esc(businessStatusLabel(restaurant.businessStatus))}</small>${restaurant.matchReasons?.length ? `<div class="match-reasons">${restaurant.matchReasons.map((reason) => `<small>${esc(reason)}</small>`).join("")}</div>` : restaurant.matchScore ? `<small>匹配了 ${restaurant.matchScore} 分线索</small>` : ""}${preview ? `<div class="candidate-rating"><strong>${Number.isFinite(preview.rating) ? `★ ${esc(preview.rating.toFixed(1))}` : "暂无公开评分"}</strong>${Number.isInteger(preview.userRatingCount) ? `<span>${esc(preview.userRatingCount.toLocaleString("zh-CN"))} 条 Google 评价</span>` : ""}</div>` : ""}${restaurant.attributions?.length ? `<small class="provider-attribution">数据提供：${restaurant.attributions.map((item) => esc(item.provider)).join("、")}</small>` : ""}</div>
        <div class="candidate-actions"><button class="select-button" data-restaurant="${restaurant.id}">确认是这家 ${icons.arrow}</button>${live && !preview ? `<button class="preview-button" data-preview-candidate="${restaurant.placeId}" ${previewLoading ? "disabled" : ""}>${previewLoading ? "查询中…" : "按需查看评分"}</button>` : ""}<button class="reject-button" data-reject-candidate="${restaurant.id}" aria-label="排除 ${esc(restaurant.name)}">不是这家</button></div>
      </article>`;
      }).join("")}
    </div>
    ${visible.length ? `<div class="candidate-review-actions"><button data-action="home">都不确定，修改搜索线索</button>${rejectedCount ? `<button data-restore-candidates>恢复已排除的 ${rejectedCount} 家</button>` : ""}</div>` : `<div class="empty-state candidate-empty"><span>?</span><h3>这些候选都不是</h3><p>可以恢复候选重新查看，或补充分店、车站和地址后再搜索。</p><div><button data-restore-candidates>恢复全部候选</button><button class="primary-button" data-action="home">修改搜索线索 ${icons.arrow}</button></div></div>`}
    ${live ? '<p class="candidate-cost-note">不会自动选择门店，也不请求设备定位。位置判断来自你提供的地址或地区线索；Google 评分只在你点击“按需查看评分”后查询这一家。营业时间、电话和预约方式则只在你确认门店后读取。</p><div class="google-attribution" translate="no">Google Maps</div>' : '<p class="fine-print">当前未配置 Google Places，以上为明确标注的本地演示候选。</p>'}
  </section>`;
  document.querySelectorAll("[data-preview-candidate]").forEach((button) => button.addEventListener("click", async () => {
    await loadCandidatePreview(button.dataset.previewCandidate);
  }));
  document.querySelectorAll("[data-restaurant]").forEach((button) => button.addEventListener("click", async () => {
    const candidate = state.candidates.find((item) => item.id === button.dataset.restaurant);
    state.confirmedCandidate = candidate;
    state.resultFocus = "";
    postEvent("candidate_confirmed", { placeId: live ? candidate.placeId : undefined, sourceMode: state.analysisSourceMode || state.candidateMode, selectedRank: candidate.rank || 1, candidateCount: state.candidates.length });
    state.view = "candidate_confirmed";
    render();
  }));
  document.querySelectorAll("[data-reject-candidate]").forEach((button) => button.addEventListener("click", () => {
    state.rejectedCandidateIds = rejectCandidate(state.candidates, state.rejectedCandidateIds, button.dataset.rejectCandidate);
    const rejected = state.candidates.find((item) => item.id === button.dataset.rejectCandidate);
    postEvent("candidate_rejected", { placeId: button.dataset.rejectCandidate, sourceMode: state.analysisSourceMode || state.candidateMode, selectedRank: rejected?.rank || null, candidateCount: state.candidates.length });
    renderCandidates();
  }));
  document.querySelectorAll("[data-restore-candidates]").forEach((button) => button.addEventListener("click", () => {
    state.rejectedCandidateIds = restoreCandidates();
    renderCandidates();
  }));
}

function renderCandidateConfirmed() {
  const candidate = state.confirmedCandidate;
  if (!candidate) {
    state.view = "candidates";
    render();
    return;
  }
  app.innerHTML = `<section class="content-view narrow confirmed-view">
    <button class="back-button" data-back-to-candidates>← 返回候选</button>
    <div class="section-heading"><span class="step-chip">第 2 步 · 选择下一步</span><h2>已确认：${esc(candidate.name)}</h2><p>${esc(candidate.address || [candidate.area, candidate.station].filter(Boolean).join(" · "))}</p></div>
    <aside class="confirmed-identity">${icons.check}<div><strong>门店身份已由你确认</strong><span>系统现在可以只针对这家店读取实时详情，不会混用其他分店的信息。</span></div></aside>
    <div class="next-step-grid">
      <button data-confirmed-action="details"><span>查看门店详情</span><strong>营业时间、地址、电话与官方信息</strong>${icons.arrow}</button>
      <button data-confirmed-action="reservation"><span>查看预约方式</span><strong>预约入口、限制、排队规则与行动建议</strong>${icons.arrow}</button>
    </div>
    <p class="candidate-cost-note">两个入口会核对同一组实时来源，只是优先带你到不同内容；系统不会代替你提交预约。</p>
  </section>`;
  document.querySelector("[data-back-to-candidates]").addEventListener("click", () => {
    state.view = "candidates";
    render();
  });
  document.querySelectorAll("[data-confirmed-action]").forEach((button) => button.addEventListener("click", async () => {
    await openConfirmedCandidate(button.dataset.confirmedAction);
  }));
}

async function openConfirmedCandidate(focus) {
  const candidate = state.confirmedCandidate;
  if (!candidate) return;
  state.resultFocus = focus === "reservation" ? "reservation" : "details";
  if (state.candidateMode === "live") {
    await loadRestaurantDetails(candidate, {
      recordConfirmation: false,
      selectedRank: candidate.rank,
      candidateCount: state.candidates.length,
      returnView: "candidate_confirmed"
    });
    return;
  }
  state.analysisStartedAt = Date.now();
  state.restaurant = candidate;
  completeActivePendingAnalysis();
  rememberCurrentAnalysis();
  state.view = "result";
  render();
  focusResultSection();
  postEvent("analysis_completed", { analysisDurationMs: Math.max(0, Date.now() - state.analysisStartedAt) });
  state.analysisStartedAt = null;
}

function renderResult() {
  const r = state.restaurant;
  const saved = state.saved.some((item) => item.id === r.id);
  const scriptMode = r.recommendation === "walk_in_ok" ? "walk_in" : "reservation";
  const script = buildPhoneScript({ date: state.currentPlanIntent.planDate, time: state.currentPlanIntent.planTime, party: state.currentPlanIntent.partySize || state.settings.defaultPartySize, name: state.settings.reservationName, mode: scriptMode });
  const scriptVersion = ["standard", "short", "easy"].includes(state.phoneScriptVersion) ? state.phoneScriptVersion : "standard";
  const visibleScript = scriptVersion === "short"
    ? { ja: script.jaShort, zh: script.zhShort }
    : scriptVersion === "easy"
      ? { ja: script.jaEasy, zh: script.zhEasy }
      : { ja: script.ja, zh: script.zh };
  const primaryAction = r.primaryAction || (r.booking ? { label: r.booking.label, url: r.booking.url } : null);
  const reservationOptions = Array.isArray(r.reservationOptions) ? r.reservationOptions : [];
  const savedPlan = state.saved.find((item) => item.id === r.id);
  app.innerHTML = `<section class="content-view result-view">
    <button class="back-button" data-action="home">← 分析另一家</button>
    ${state.pending.length ? `<aside class="result-queue"><div><strong>还有 ${state.pending.length} 家待分析</strong><span>继续处理同一张截图或旅行清单里的餐厅。</span></div><button id="continue-pending">继续下一家 ${icons.arrow}</button></aside>` : ""}
    <div class="result-title"><div><span class="category-line">${[r.category, r.price].filter(Boolean).map(esc).join(" · ")}</span><h1>${esc(r.name)}</h1><p>${[r.reading, r.area].filter(Boolean).map(esc).join(" · ")}</p></div><span class="demo-pill">${r.dataLabel || "演示数据"}</span></div>
    <div class="decision-grid">
      <article class="decision-card ${esc(r.recommendation)}">
        <div class="status-row"><span class="status-dot"></span><span>${confidenceLabel(r.confidence)}</span></div>
        <p class="overline">结论</p><h2>${esc(recommendationLabel(r.recommendation))}</h2><p>${esc(r.summary)}</p>
        <div class="reason-list">${r.reasons.map((reason) => `<span>${icons.check}${esc(reason)}</span>`).join("")}</div>
        ${r.planAdvisory ? `<aside class="plan-advisory"><strong>结合你的计划</strong><p>${esc(r.planAdvisory)}</p></aside>` : ""}
        ${r.decisionEvidence?.length ? `<div class="decision-boundary"><strong>判断边界</strong>${r.decisionEvidence.map((item) => `<p>${esc(item.claim)} · ${esc(item.certainty === "high" ? "高" : item.certainty === "medium" ? "中" : "低")}可信<br><small>${esc(item.limitation)}</small></p>`).join("")}</div>` : ""}
      </article>
      <article class="action-card"><p class="overline">现在最该做</p><h3>${esc(r.nextAction)}</h3>
        ${primaryAction ? `<a class="primary-button" id="primary-action" data-action-type="${esc(primaryAction.type || "external")}" href="${esc(actionHref(primaryAction))}" ${primaryAction.type === "phone" ? "" : 'target="_blank" rel="noreferrer"'}>${esc(primaryAction.label)} ${primaryAction.type === "phone" ? icons.phone : icons.arrow}</a>` : r.phone ? `<a class="primary-button" id="primary-action" data-action-type="phone" href="tel:${esc(r.phone)}">${icons.phone} 拨打电话确认</a>` : `<a class="primary-button" id="primary-action" data-action-type="map" href="${esc(safeExternalUrl(r.mapSearchUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address}`)}`))}" target="_blank" rel="noreferrer">在地图核对店铺 ${icons.arrow}</a>`}
        ${r.phone && primaryAction?.type !== "phone" ? `<a class="secondary-button" id="phone-action" href="tel:${esc(r.phone)}">${icons.phone} ${esc(r.phone)} · 拨打确认</a>` : ""}
        <button class="secondary-button" id="share-result">分享这份行动建议</button>
        <button class="secondary-button" id="save-button">${icons.bookmark} ${saved ? "编辑用餐计划" : "保存并制定计划"}</button>
        ${state.planEditorOpen ? renderPlanForm(savedPlan, r) : ""}
      </article>
    </div>
    ${r.conflict ? `<aside class="conflict"><strong>${esc(r.conflictTitle || "信息有冲突")}</strong><p>${esc(r.conflict)}</p></aside>` : ""}
    ${r.reservationGuidance ? `<section class="panel reservation-guidance"><div><p class="overline">官网预约限制</p><h2>${esc(r.reservationGuidance.label)}</h2><p>${esc(r.reservationGuidance.excerpt)}</p><small>是否符合条件、是否有位和是否预约成功，仍以目标日期的页面或餐厅答复为准。</small></div><a href="${esc(safeExternalUrl(r.reservationGuidance.sourceUrl))}" target="_blank" rel="noreferrer">打开官网原文 ${icons.arrow}</a></section>` : ""}
    ${reservationOptions.length ? `<section class="panel reservation-options"><div class="panel-heading"><div><p class="overline">预约入口</p><h2>从可信入口开始</h2></div><span>预约、代订、排队与店铺页分别标注</span></div><div class="reservation-option-grid">${reservationOptions.map((option) => `<a class="reservation-option ${reservationOptionClass(option)}" href="${esc(option.url)}" ${option.actionType === "phone" ? "" : 'target="_blank" rel="noreferrer"'} data-reservation-provider="${esc(option.provider)}" data-action-type="${esc(option.actionType)}"><span>${reservationOptionBadge(option)}</span><strong>${esc(option.label)}</strong><small>${esc(option.capability?.label || reservationModeLabel(option.bookingMode))}</small>${option.capability?.confirmation ? `<em>${esc(option.capability.confirmation)}</em>` : ""}${option.feeNote ? `<p>${esc(option.feeNote)}</p>` : ""}</a>`).join("")}</div></section>` : ""}
    ${r.queueGuidance ? `<section class="panel queue-guidance"><div><p class="overline">官网排队规则</p><h2>${esc(r.queueGuidance.label)}</h2><p>${esc(r.queueGuidance.excerpt)}</p><small>只说明官网公开的排队方式，不代表实时有位，也不估算等待时间。</small></div><a href="${esc(safeExternalUrl(r.queueGuidance.sourceUrl))}" target="_blank" rel="noreferrer">打开官网原文 ${icons.arrow}</a></section>` : ""}
    ${r.attentionNotices?.length ? `<section class="panel attention-panel"><div class="panel-heading"><div><p class="overline">到店注意事项</p><h2>官网明确写了这些规则</h2></div><span>提交预约前再次核对</span></div><div class="attention-grid">${r.attentionNotices.map((notice) => `<article><strong>${esc(notice.label)}</strong><p>${esc(notice.excerpt)}</p><a href="${esc(safeExternalUrl(notice.sourceUrl))}" target="_blank" rel="noreferrer">打开官网原文</a></article>`).join("")}</div></section>` : ""}
    <div class="detail-grid">
      <section class="panel"><div class="panel-heading"><div><p class="overline">到店信息</p><h2>去之前，确认这些</h2></div><span class="queue-chip">${esc(r.queue)}</span></div>
        <dl class="facts">${Number.isFinite(r.rating) ? `<div><dt>Google 评分</dt><dd>${esc(r.rating)} / 5${Number.isInteger(r.userRatingCount) ? ` · ${esc(r.userRatingCount.toLocaleString())} 条评价` : ""}</dd></div>` : ""}<div><dt>地址</dt><dd>${esc(r.address)}</dd></div>${r.phone ? `<div><dt>电话</dt><dd><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></dd></div>` : ""}${r.officialInstagramUrl ? `<div><dt>官方 Instagram</dt><dd><a href="${esc(safeExternalUrl(r.officialInstagramUrl))}" target="_blank" rel="noreferrer">打开官方账号</a></dd></div>` : ""}<div><dt>最近车站</dt><dd>${esc(r.station)}</dd></div><div><dt>营业时间</dt><dd>${esc(r.hours)}</dd></div><div><dt>定休日</dt><dd>${esc(r.closed)}</dd></div></dl>
      </section>
      <section class="panel script-panel"><p class="overline">${scriptMode === "walk_in" ? "电话到店确认助手" : "电话预约助手"}</p><h2>照着说就可以</h2><div class="script-tabs" role="group" aria-label="电话话术版本"><button class="${scriptVersion === "standard" ? "active" : ""}" data-script-version="standard" aria-pressed="${scriptVersion === "standard"}">标准版</button><button class="${scriptVersion === "short" ? "active" : ""}" data-script-version="short" aria-pressed="${scriptVersion === "short"}">简短版</button><button class="${scriptVersion === "easy" ? "active" : ""}" data-script-version="easy" aria-pressed="${scriptVersion === "easy"}">日语不熟练</button></div><blockquote lang="ja">${esc(visibleScript.ja)}</blockquote><p class="translation">${esc(visibleScript.zh)}</p><button class="copy-button" data-copy="${esc(visibleScript.ja)}">复制当前日语话术</button></section>
    </div>
    <section class="panel sources"><div class="panel-heading"><div><p class="overline">证据链</p><h2>这份建议来自哪里</h2></div><span>${r.sourceContext || "刚刚核对 · 演示"}</span></div>
      ${r.sources.map((source) => `<div class="source-row"><div>${source.url ? `<a href="${esc(safeExternalUrl(source.url))}" target="_blank" rel="noreferrer"><strong>${esc(source.name)}</strong></a>` : `<strong>${esc(source.name)}</strong>`}${source.official ? '<span class="official">官方</span>' : ""}<p>${esc(source.note)}${source.retrievedAt ? ` · ${formatClientTime(source.retrievedAt)}` : ""}</p>${source.attribution ? `<small class="source-attribution" translate="no">${esc(source.attribution)}</small>` : ""}</div><span class="confidence-${source.confidence === "高" ? "high" : source.confidence === "中" ? "medium" : "low"}">${source.confidence}可信</span></div>`).join("")}
      ${r.sources.some((source) => source.name === "Hot Pepper") ? '<a class="hotpepper-credit" href="https://webservice.recruit.co.jp/" target="_blank" rel="noreferrer"><img src="https://webservice.recruit.co.jp/banner/hotpepper-s.gif" alt="ホットペッパーグルメ Webサービス" width="135" height="17"></a>' : ""}
      <p class="source-disclaimer">第三方信息按需刷新。保存清单只长期保留地点标识和用户自己的线索。</p>
    </section>
    <section class="feedback-card" id="feedback-card"><div><p class="overline">结果反馈</p><h3>这次建议最终是否帮你完成行动？</h3><p>只提交你主动填写的反馈，不包含原始截图或搜索文字。</p></div><form id="feedback-form" class="feedback-form">
      <fieldset><legend>结果有帮助吗？</legend><label><input type="radio" name="helpful" value="yes" required> 有帮助</label><label><input type="radio" name="helpful" value="no"> 没有帮助</label></fieldset>
      <fieldset><legend>最后预约成功了吗？</legend><label><input type="radio" name="bookingOutcome" value="succeeded" required> 成功</label><label><input type="radio" name="bookingOutcome" value="not_succeeded"> 没成功</label><label><input type="radio" name="bookingOutcome" value="not_tried"> 没尝试</label></fieldset>
      <fieldset><legend>信息准确吗？</legend><label><input type="radio" name="accuracy" value="accurate" required> 准确</label><label><input type="radio" name="accuracy" value="partly_wrong"> 部分错误</label><label><input type="radio" name="accuracy" value="wrong"> 完全不对</label></fieldset>
      <label class="feedback-text">哪里需要改进？（可选）<textarea name="feedbackText" maxlength="500" rows="3" placeholder="例如：营业时间已经变化"></textarea></label>
      <button type="submit">提交反馈</button>
    </form></section>
  </section>`;
  document.querySelector("#save-button").addEventListener("click", toggleSaved);
  document.querySelector("#continue-pending")?.addEventListener("click", () => openPendingAnalysis(state.pending[0]?.id));
  document.querySelector("#plan-form")?.addEventListener("submit", savePlanFromForm);
  document.querySelector("#cancel-plan")?.addEventListener("click", () => { state.planEditorOpen = false; render(); });
  document.querySelector("#primary-action")?.addEventListener("click", (event) => {
    const actionType = event.currentTarget.dataset.actionType;
    postEvent("primary_action_clicked", { actionType });
    if (actionType === "phone") postEvent("phone_button_clicked", { actionType });
    else if (actionType === "open_booking_source") postEvent("booking_link_clicked", { actionType });
  });
  document.querySelector("#phone-action")?.addEventListener("click", () => {
    postEvent("primary_action_clicked", { actionType: "phone" });
    postEvent("phone_button_clicked", { actionType: "phone" });
  });
  document.querySelector("#share-result")?.addEventListener("click", shareCurrentResult);
  document.querySelectorAll("[data-reservation-provider]").forEach((link) => link.addEventListener("click", () => {
    const actionType = link.dataset.actionType || "reservation_option";
    postEvent("primary_action_clicked", { actionType });
    if (actionType === "phone") postEvent("phone_button_clicked", { actionType });
    else if (actionType === "open_booking_source") postEvent("booking_link_clicked", { actionType });
  }));
  document.querySelector("#feedback-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    button.disabled = true;
    button.textContent = "正在提交…";
    const accepted = await postEvent("feedback_submitted", {
      helpful: values.helpful === "yes",
      bookingOutcome: values.bookingOutcome,
      accuracy: values.accuracy,
      feedbackText: values.feedbackText
    });
    if (!accepted) {
      button.disabled = false;
      button.textContent = "重新提交反馈";
      showToast("反馈暂未提交，请检查网络后重试");
      return;
    }
    form.replaceWith(Object.assign(document.createElement("p"), { className: "feedback-thanks", textContent: "谢谢，你的预约结果和准确性反馈已提交。" }));
    showToast("感谢反馈，这会帮助我们校准结果");
  });
  document.querySelectorAll("[data-script-version]").forEach((button) => button.addEventListener("click", () => {
    state.phoneScriptVersion = button.dataset.scriptVersion;
    render();
  }));
  document.querySelector("[data-copy]").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(event.currentTarget.dataset.copy);
    postEvent("phone_script_copied", { actionType: state.phoneScriptVersion });
    showToast("日语话术已复制");
  });
}

function focusResultSection() {
  const selector = state.resultFocus === "reservation" ? ".decision-grid" : ".detail-grid";
  requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function reservationModeLabel(value) {
  return { phone: "电话确认", instant: "即时预约", request: "请求预约", instant_or_request: "即时或请求预约", provider_determined: "由平台决定确认方式", waitlist: "排队取号", unknown: "进入后确认预约方式" }[value] || "进入后确认预约方式";
}

function reservationOptionClass(option) {
  const kind = option.capability?.kind;
  if (option.status === "unverified_link" || option.officiality === "user_provided_external") return "unverified";
  if (option.status === "discovery_only") return "discovery";
  if (kind === "waitlist_flow") return "waitlist";
  if (kind === "provider_booking_flow") return "managed";
  if (kind === "platform_listing") return "listing";
  return "verified";
}

function reservationOptionBadge(option) {
  const kind = option.capability?.kind;
  if (option.officiality === "user_provided_external") return "用户提供";
  if (option.status === "unverified_link") return "未独立核验";
  if (option.status === "discovery_only") return "仅查找";
  if (kind === "online_reservation_flow") return "预约入口";
  if (kind === "provider_booking_flow") return "提交后确认";
  if (kind === "waitlist_flow") return "排队取号";
  if (kind === "platform_listing") return "店铺页";
  if (kind === "phone_confirmation") return "电话";
  if (kind === "map") return "地图";
  if (option.officiality === "restaurant_official") return "官网";
  if (option.officiality === "google_listed_external") return "外部网站";
  return "已核对";
}

function toggleSaved() {
  state.planEditorOpen = !state.planEditorOpen;
  render();
}

function renderPlanForm(savedPlan, restaurant) {
  const date = savedPlan?.planDate || state.currentPlanIntent.planDate || "";
  const time = savedPlan?.planTime || state.currentPlanIntent.planTime || "";
  const party = savedPlan?.partySize || state.currentPlanIntent.partySize || state.settings.defaultPartySize;
  const status = savedPlan?.planStatus || createSavedPlan({ restaurant }).planStatus;
  return `<form id="plan-form" class="plan-form"><strong>${savedPlan ? "编辑用餐计划" : "保存前补充计划"}</strong><div class="plan-fields"><label>日期<input type="date" name="planDate" value="${esc(date)}"></label><label>时间<input type="time" name="planTime" value="${esc(time)}"></label><label>人数<input type="number" name="partySize" min="1" max="20" value="${esc(party)}"></label><label>状态<select name="planStatus">${PLAN_STATUSES.map((item) => `<option value="${item.value}" ${item.value === status ? "selected" : ""}>${item.label}</option>`).join("")}</select></label></div><div class="plan-actions"><button type="button" id="cancel-plan">取消</button><button type="submit">${savedPlan ? "保存修改" : "加入清单"}</button></div></form>`;
}

function savePlanFromForm(event) {
  event.preventDefault();
  const values = Object.fromEntries(new FormData(event.currentTarget));
  const existing = state.saved.find((item) => item.id === state.restaurant.id);
  const item = existing
    ? updateSavedPlan(existing, values)
    : createSavedPlan({ restaurant: state.restaurant, userClues: state.currentClues, userLabel: state.extraction?.restaurant?.name || state.restaurant.userLabel || state.input, plan: values });
  state.saved = existing ? state.saved.map((saved) => saved.id === item.id ? item : saved) : [...state.saved, item];
  state.planEditorOpen = false;
  postEvent(existing ? "saved_plan_updated" : "saved_to_list", { planStatus: item.planStatus, hasDate: Boolean(item.planDate) });
  showToast(existing ? "用餐计划已更新" : "已保存到想去清单");
  render();
}

function clearUpload() {
  if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
  state.uploadFile = null;
  state.uploadName = "";
  state.uploadPreviewUrl = "";
  state.extraction = null;
  state.extractionMode = "";
  state.extractionMeta = null;
  state.analysisError = "";
  renderHome();
}

async function extractScreenshot(file) {
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable && !isKnownSampleScreenshot(file)) {
    throw new Error("暂时无法确认截图服务状态，请检查网络后重试。");
  }
  if (!capabilities.visionExtraction) {
    if (isKnownSampleScreenshot(file)) {
      await new Promise((resolve) => setTimeout(resolve, 650));
      return { extraction: sampleTikTokExtraction, mode: "sample" };
    }
    throw new Error("尚未配置视觉 API。请设置 DASHSCOPE_API_KEY，或使用本次提供的 TikTok 示例截图。");
  }

  const imageDataUrl = await readFileAsDataUrl(file);
  try {
    const response = await fetch("/api/extract-screenshot", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...pilotAccessHeaders(state.settings) },
      body: JSON.stringify({ imageDataUrl })
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && payload.extraction) return {
      extraction: payload.extraction,
      mode: "api",
      meta: {
        provider: payload.provider,
        model: payload.model,
        fallbackUsed: Boolean(payload.fallbackUsed),
        fallbackReason: payload.fallbackReason || null,
        requiresUserConfirmation: Boolean(payload.requiresUserConfirmation)
      }
    };
    throw new Error(visionErrorMessage(payload));
  } catch (error) {
    if (!isKnownSampleScreenshot(file)) throw error;
  }

  if (isKnownSampleScreenshot(file)) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    return { extraction: sampleTikTokExtraction, mode: "sample" };
  }
  throw new Error("尚未配置视觉 API。请设置 DASHSCOPE_API_KEY，或使用本次提供的 TikTok 示例截图。");
}

function visionErrorMessage(payload = {}) {
  return {
    VISION_TIMEOUT: "截图识别超时，请重试一次。首次调用可能需要更长时间。",
    VISION_RATE_LIMITED: "截图识别请求较多，请稍后重试。",
    VISION_AUTH_ERROR: "视觉服务密钥需要重新配置。",
    INVALID_IMAGE: "请上传有效的 PNG、JPEG 或 WebP 截图。",
    INVALID_MODEL_OUTPUT: "已经读到截图，但结构化结果不稳定，请重试或补充店名文字。"
  }[payload.code] || payload.error || "视觉解析服务暂时不可用。";
}

async function getCapabilities({ force = false } = {}) {
  try {
    const capabilities = await loadCapabilities({ force });
    state.capabilities = capabilities;
    return capabilities;
  } catch {
    const unavailable = { capabilitiesUnavailable: true, visionExtraction: false, placesSearch: false };
    state.capabilities = unavailable;
    return unavailable;
  }
}

async function searchCandidates(query, clues = {}) {
  state.loadingMode = "search";
  state.currentClues = clues;
  state.view = "loading";
  render();
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable) throw new Error("暂时无法确认餐厅搜索服务状态，请检查网络后重试。");
  if (!capabilities.placesSearch) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    state.candidates = findCandidates(query);
    state.candidatePreviews = {};
    state.candidatePreviewLoadingId = "";
    state.rejectedCandidateIds = [];
    state.confirmedCandidate = null;
    state.resultFocus = "";
    state.candidateMode = "demo";
    state.view = "candidates";
    showToast("未配置 Google Places，正在使用演示降级");
    render();
    return;
  }

  const response = await fetch("/api/restaurants/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...pilotAccessHeaders(state.settings) },
    body: JSON.stringify({ query, clues })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "真实餐厅搜索失败。");
  if (!payload.candidates?.length) throw new Error("没有找到可确认的餐厅，请补充店名或地区。");
  state.candidates = payload.candidates;
  state.candidatePreviews = {};
  state.candidatePreviewLoadingId = "";
  state.rejectedCandidateIds = [];
  state.confirmedCandidate = null;
  state.resultFocus = "";
  state.candidateMode = "live";
  state.view = "candidates";
  render();
}

async function loadCandidatePreview(placeId) {
  if (!placeId || state.candidatePreviews[placeId] || state.candidatePreviewLoadingId) return;
  state.candidatePreviewLoadingId = placeId;
  postEvent("candidate_preview_requested", { placeId, sourceMode: state.analysisSourceMode || "live" });
  renderCandidates();
  try {
    const response = await fetch("/api/restaurants/candidate-preview", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...pilotAccessHeaders(state.settings) },
      body: JSON.stringify({ placeId })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "评分查询失败。稍后仍可直接确认餐厅。");
    state.candidatePreviews = { ...state.candidatePreviews, [placeId]: payload.preview };
    postEvent("candidate_preview_loaded", { placeId, sourceMode: state.analysisSourceMode || "live", cacheStatus: payload.cacheStatus });
  } catch (error) {
    showToast(error.message || "评分查询失败");
  } finally {
    state.candidatePreviewLoadingId = "";
    renderCandidates();
  }
}

async function loadRestaurantDetails(candidate, selection = {}) {
  const recordsNewAnalysis = selection.recordCompletion !== false;
  if (recordsNewAnalysis) state.analysisStartedAt = Date.now();
  state.loadingMode = "details";
  state.view = "loading";
  render();
  try {
    const response = await fetch("/api/restaurants/details", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...pilotAccessHeaders(state.settings) },
      body: JSON.stringify({ placeId: candidate.placeId, clues: state.currentClues, plan: state.currentPlanIntent, userProvidedLinks: state.userProvidedReservationLinks })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "餐厅详情核对失败。");
    if (selection.recordConfirmation !== false) postEvent("candidate_confirmed", { placeId: candidate.placeId, sourceMode: state.analysisSourceMode || "live", selectedRank: selection.selectedRank || null, candidateCount: selection.candidateCount || null });
    state.restaurant = payload.restaurant;
    if (state.restaurant.conflict) postEvent("source_conflict_seen");
    completeActivePendingAnalysis();
    rememberCurrentAnalysis();
    state.view = "result";
    render();
    focusResultSection();
    if (recordsNewAnalysis) {
      postEvent("analysis_completed", { analysisDurationMs: Math.max(0, Date.now() - state.analysisStartedAt) });
      state.analysisStartedAt = null;
    }
  } catch (error) {
    if (recordsNewAnalysis) state.analysisStartedAt = null;
    state.view = selection.returnView || "candidates";
    showToast(error.message || "餐厅详情核对失败");
    render();
  }
}

function formatClientTime(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function businessStatusLabel(value) {
  return { OPERATIONAL: "Google Maps：营业中", CLOSED_TEMPORARILY: "Google Maps：暂停营业", CLOSED_PERMANENTLY: "Google Maps：永久停业" }[value] || "Google Maps：营业状态待确认";
}

async function shareCurrentResult() {
  const payload = buildSharePayload(state.restaurant);
  try {
    if (typeof navigator.share === "function") {
      await navigator.share(payload);
      postEvent("share_result_clicked", { actionType: "native_share" });
      showToast("已打开系统分享");
      return;
    }
    await navigator.clipboard.writeText(payload.text);
    postEvent("share_result_clicked", { actionType: "clipboard" });
    showToast("行动建议已复制，可以粘贴分享");
  } catch (error) {
    if (error?.name !== "AbortError") showToast("分享没有完成，请稍后重试");
  }
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "#";
  } catch {
    return "#";
  }
}

function actionHref(action = {}) {
  if (action.type === "phone" && /^tel:[+\d()\-]+$/i.test(String(action.url || ""))) return action.url;
  return safeExternalUrl(action.url);
}

function postEvent(event, extra = {}) {
  const payload = {
    event,
    placeId: state.restaurant?.placeId || null,
    sourceMode: state.analysisSourceMode || state.restaurant?.sourceMode || "demo",
    trafficType,
    analysisRunId: state.analysisRunId || null,
    ...extra
  };
  return sendEvent(fetch, payload);
}

function createAnalysisRunId() {
  return globalThis.crypto?.randomUUID?.() || `run_${Date.now()}_${Math.random().toString(36).slice(2, 14)}`;
}

function recordVisit(now = Date.now()) {
  if (trafficType !== "product") return;
  let visit = {};
  try { visit = JSON.parse(localStorage.getItem(VISIT_STORAGE_KEY) || "{}"); } catch { visit = {}; }
  const firstSeenAt = Number(visit.firstSeenAt);
  const lastSeenAt = Number(visit.lastSeenAt);
  if (!Number.isFinite(firstSeenAt)) {
    localStorage.setItem(VISIT_STORAGE_KEY, JSON.stringify({ firstSeenAt: now, lastSeenAt: now, returnWithin7DaysRecorded: false, returnAfter7DaysRecorded: false }));
    postEvent("app_visit", { visitType: "first_open", analysisRunId: null });
    return;
  }
  const elapsedSinceLast = now - lastSeenAt;
  const elapsedSinceFirst = now - firstSeenAt;
  const next = { ...visit, firstSeenAt, lastSeenAt: now };
  if (elapsedSinceLast >= 30 * 60 * 1_000 && elapsedSinceFirst <= 7 * 24 * 60 * 60 * 1_000 && !visit.returnWithin7DaysRecorded) {
    next.returnWithin7DaysRecorded = true;
    postEvent("app_visit", { visitType: "return_within_7d", analysisRunId: null });
  } else if (elapsedSinceLast >= 30 * 60 * 1_000 && elapsedSinceFirst > 7 * 24 * 60 * 60 * 1_000 && !visit.returnAfter7DaysRecorded) {
    next.returnAfter7DaysRecorded = true;
    postEvent("app_visit", { visitType: "return_after_7d", analysisRunId: null });
  }
  localStorage.setItem(VISIT_STORAGE_KEY, JSON.stringify(next));
}

function classifyInputType(value, hasUpload) {
  if (hasUpload) return "screenshot";
  const text = String(value || "").trim();
  if (/https?:\/\/(?:www\.)?(?:tiktok\.com|instagram\.com|xiaohongshu\.com|xhslink\.com|x\.com|twitter\.com)\b/i.test(text)) return "social_link";
  if (/https?:\/\//i.test(text)) return "webpage";
  return /\s|\d|[，。,.、]/.test(text) ? "text" : "restaurant_name";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("无法读取这张截图。"));
    reader.readAsDataURL(file);
  });
}

function renderSaved() {
  const savedPlans = sortSavedPlansByUrgency(state.saved);
  app.innerHTML = `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">← 返回首页</button>
    <div class="section-heading"><span class="step-chip">YOUR SHORTLIST</span><h2>想去清单</h2><p>先处理最需要预约的餐厅，减少临时落空。</p></div>
    ${state.saved.length ? `<div class="saved-list">${savedPlans.map((r) => `<article><div class="saved-main"><span class="plan-status status-${esc(r.planStatus)}">${esc(planStatusLabel(r.planStatus))}</span><h3>${esc(r.name)}</h3><p>${r.planDate ? `${esc(r.planDate)}${r.planTime ? ` · ${esc(r.planTime)}` : ""} · ${esc(r.partySize)} 人` : `日期未定 · ${esc(r.partySize)} 人`}</p><small>最后分析：${r.lastAnalyzedAt ? formatClientTime(r.lastAnalyzedAt) : "尚未记录"}</small></div><div class="saved-controls"><select data-plan-status="${esc(r.id)}" aria-label="更新 ${esc(r.name)} 的状态">${PLAN_STATUSES.map((item) => `<option value="${item.value}" ${item.value === r.planStatus ? "selected" : ""}>${item.label}</option>`).join("")}</select><button data-open-saved="${esc(r.id)}" title="重新核对">${icons.arrow}</button><button class="delete-plan" data-delete-saved="${esc(r.id)}" title="从清单删除">×</button></div></article>`).join("")}</div>` : `<div class="empty-state"><span>た</span><h3>清单还是空的</h3><p>分析一家餐厅并保存，它会出现在这里。</p><button class="primary-button" data-action="home">去分析一家店 ${icons.arrow}</button></div>`}
  </section>`;
  document.querySelectorAll("[data-open-saved]").forEach((button) => button.addEventListener("click", async () => {
    const item = state.saved.find((saved) => saved.id === button.dataset.openSaved);
    resetAnalysisAttribution();
    state.userProvidedReservationLinks = [];
    if (item.requiresRefresh && item.placeId) {
      state.currentClues = item.userClues || { name: item.name };
      state.currentPlanIntent = { planDate: item.planDate || "", planTime: item.planTime || "", partySize: item.partySize || null };
      await loadRestaurantDetails({ placeId: item.placeId }, { recordConfirmation: false, recordCompletion: false });
    } else {
      state.restaurant = item.snapshot || item;
      state.view = "result";
      render();
    }
  }));
  document.querySelectorAll("[data-plan-status]").forEach((select) => select.addEventListener("change", () => {
    state.saved = state.saved.map((item) => item.id === select.dataset.planStatus ? updateSavedPlan(item, { planStatus: select.value }) : item);
    syncSaved();
    postEvent("saved_plan_status_changed", { planStatus: select.value, analysisRunId: null });
    renderSaved();
    showToast("状态已更新");
  }));
  document.querySelectorAll("[data-delete-saved]").forEach((button) => button.addEventListener("click", () => {
    state.saved = state.saved.filter((item) => item.id !== button.dataset.deleteSaved);
    postEvent("removed_from_list", { analysisRunId: null });
    showToast("已从清单移除");
    renderSaved();
    syncSaved();
  }));
}

function renderHistory() {
  app.innerHTML = `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">← 返回首页</button>
    <div class="section-heading"><span class="step-chip">RECENT ANALYSES</span><h2>最近分析</h2><p>最多保留 10 条本机历史。实时餐厅只保存 Place ID、你的线索和计划，打开时重新核对第三方信息。</p></div>
    ${state.recent.length ? `<div class="saved-list">${state.recent.map((item) => `<article><div class="saved-main"><span class="plan-status">${item.sourceMode === "live" ? "实时刷新" : "演示"}</span><h3>${esc(item.name)}</h3><p>${esc(item.area || "地区待确认")}${item.planDate ? ` · ${esc(item.planDate)}${item.planTime ? ` ${esc(item.planTime)}` : ""} · ${esc(item.partySize)} 人` : ""}</p><small>分析时间：${formatClientTime(item.analyzedAt)}</small></div><div class="saved-controls history-controls"><button data-open-recent="${esc(item.id)}" title="重新打开">${icons.arrow}</button><button class="delete-plan" data-delete-recent="${esc(item.id)}" title="删除历史">×</button></div></article>`).join("")}</div>` : `<div class="empty-state"><span>た</span><h3>还没有分析历史</h3><p>分析完成的餐厅会出现在这里。</p><button class="primary-button" data-action="home">去分析一家店 ${icons.arrow}</button></div>`}
  </section>`;
  document.querySelectorAll("[data-open-recent]").forEach((button) => button.addEventListener("click", () => openRecentAnalysis(button.dataset.openRecent)));
  document.querySelectorAll("[data-delete-recent]").forEach((button) => button.addEventListener("click", () => {
    state.recent = state.recent.filter((item) => item.id !== button.dataset.deleteRecent);
    syncRecent();
    showToast("已删除这条分析历史");
    renderHistory();
  }));
}

function renderQueue() {
  app.innerHTML = `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">← 返回首页</button>
    <div class="section-heading"><span class="step-chip">TO ANALYZE</span><h2>待分析餐厅</h2><p>从多餐厅截图或旅行清单保留下来的线索。逐家确认后，它们会自动离开这里。</p></div>
    <section class="panel batch-queue-panel"><p class="overline">旅行前批量准备</p><h3>一次粘贴多家餐厅</h3><p>每行一家；也可以使用“店名｜分店｜地区或地址”。这里只建立本机队列，打开某一家时才请求 API。</p><form id="batch-queue-form"><textarea name="restaurants" rows="6" maxlength="10000" placeholder="一蘭 渋谷店&#10;AFURI｜原宿｜東京都渋谷区千駄ヶ谷3-63-1&#10;すし大｜本館｜築地"></textarea><div><small>最多保留 30 家；重复线索会自动合并。</small><button type="submit">加入待分析</button></div></form></section>
    ${state.pending.length ? `<div class="saved-list queue-list">${state.pending.map((item) => `<article><div class="saved-main"><span class="plan-status">${esc(platformLabel(item.sourcePlatform))}</span><h3>${esc(item.clues.name)}</h3><p>${esc([item.clues.branch, item.clues.area || item.clues.address].filter(Boolean).join(" · ") || "位置待确认")}</p><small>加入时间：${formatClientTime(item.addedAt)}</small></div><div class="saved-controls history-controls"><button data-open-pending="${esc(item.id)}" title="开始分析">${icons.arrow}</button><button class="delete-plan" data-delete-pending="${esc(item.id)}" title="删除线索">×</button></div></article>`).join("")}</div>` : `<div class="empty-state"><span>✓</span><h3>没有待分析餐厅</h3><p>当一张截图出现多家店时，可以把其余餐厅保存在这里逐家处理。</p><button class="primary-button" data-action="home">上传一张截图 ${icons.arrow}</button></div>`}
  </section>`;
  document.querySelector("#batch-queue-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const parsed = parseBatchRestaurantLines(new FormData(event.currentTarget).get("restaurants"));
    if (!parsed.restaurants.length) {
      showToast("请至少输入一家餐厅");
      return;
    }
    const before = state.pending.length;
    state.pending = addPendingRestaurants(state.pending, parsed.restaurants, { sourcePlatform: "unknown" });
    const added = state.pending.length - before;
    syncPending();
    postEvent("pending_queue_added", { queueCount: state.pending.length, analysisRunId: null });
    renderQueue();
    showToast(parsed.truncated ? `已读取前 30 行，新增 ${added} 家` : added ? `已加入 ${added} 家待分析餐厅` : "这些餐厅已经在队列中或队列已满");
  });
  document.querySelectorAll("[data-open-pending]").forEach((button) => button.addEventListener("click", () => openPendingAnalysis(button.dataset.openPending)));
  document.querySelectorAll("[data-delete-pending]").forEach((button) => button.addEventListener("click", () => {
    state.pending = removePendingAnalysis(state.pending, button.dataset.deletePending);
    syncPending();
    postEvent("pending_queue_removed", { queueCount: state.pending.length, analysisRunId: null });
    renderQueue();
    showToast("已删除这条待分析线索");
  }));
}

async function openPendingAnalysis(id) {
  const item = state.pending.find((entry) => entry.id === id);
  if (!item) return;
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable) {
    showToast("暂时无法确认分析服务状态，请检查网络后重试");
    return;
  }
  const parsed = pendingAnalysisToTextExtraction(item, state.settings.defaultPartySize);
  if (!parsed) return;
  state.analysisRunId = createAnalysisRunId();
  state.analysisSourceMode = capabilities.placesSearch ? "live" : "demo";
  state.activePendingId = item.id;
  state.userProvidedReservationLinks = [];
  state.textExtraction = parsed;
  state.currentPlanIntent = withDefaultPlan(parsed.plan);
  state.input = parsed.searchQuery;
  state.view = "text_extraction";
  postEvent("input_submitted", { inputType: "restaurant_name", sourceMode: state.analysisSourceMode });
  postEvent("restaurant_identified", { inputType: "restaurant_name", sourceMode: state.analysisSourceMode });
  postEvent("pending_queue_opened", { queueCount: state.pending.length });
  render();
}

function completeActivePendingAnalysis() {
  if (!state.activePendingId) return;
  state.pending = removePendingAnalysis(state.pending, state.activePendingId);
  state.activePendingId = null;
  syncPending();
  postEvent("pending_queue_completed", { queueCount: state.pending.length });
}

async function openRecentAnalysis(id) {
  const item = state.recent.find((entry) => entry.id === id);
  if (!item) return;
  resetAnalysisAttribution();
  state.userProvidedReservationLinks = [];
  state.currentClues = item.userClues || { name: item.name };
  state.currentPlanIntent = { planDate: item.planDate || "", planTime: item.planTime || "", partySize: item.partySize || null };
  if (item.requiresRefresh && item.placeId) await loadRestaurantDetails({ placeId: item.placeId }, { recordConfirmation: false, recordCompletion: false });
  else if (item.snapshot) { state.restaurant = item.snapshot; state.view = "result"; render(); }
}

function resetAnalysisAttribution() {
  state.analysisRunId = "";
  state.analysisSourceMode = "";
  state.analysisStartedAt = null;
}

function rememberCurrentAnalysis() {
  if (!state.restaurant || !state.settings.saveRecentAnalyses) return;
  const entry = createRecentAnalysis({ restaurant: state.restaurant, userClues: state.currentClues, plan: state.currentPlanIntent });
  state.recent = addRecentAnalysis(state.recent, entry);
  syncRecent();
}

function withDefaultPlan(plan = {}) {
  return { planDate: plan.planDate || "", planTime: plan.planTime || "", partySize: plan.partySize || state.settings.defaultPartySize };
}

function renderPrivacy() {
  const local = summarizeLocalData(state.saved, state.recent, state.pending);
  app.innerHTML = `<section class="content-view narrow privacy-view">
    <button class="back-button" data-action="home">← 返回首页</button>
    <div class="section-heading"><span class="step-chip">PRIVACY & DATA</span><h2>隐私与数据</h2><p>这里说明当前原型实际处理什么，以及你能删除什么。</p></div>
    <div class="privacy-summary"><article><span>${local.savedPlanCount}</span><strong>条本机计划</strong><p>只保存在当前浏览器。</p></article><article><span>${local.pendingAnalysisCount}</span><strong>家待分析餐厅</strong><p>只保存用户截图中的餐厅线索。</p></article><article><span>${local.recentAnalysisCount}</span><strong>条最近分析</strong><p>最多保留 10 条隐私最小化历史。</p></article><article><span>0</span><strong>张服务器留存截图</strong><p>截图在请求内处理，本应用不写入磁盘。</p></article></div>
    <section class="panel privacy-section"><p class="overline">保存在这台设备</p><h2>想去清单、待分析、历史与设置</h2><ul>${local.fields.map((field) => `<li>${esc(field)}</li>`).join("")}</ul><p>浏览器可能缓存 HTML、前端模块、样式和图标，让应用离线时仍能打开；不会缓存 API 响应、餐厅结果或第三方页面。待分析队列不保存原图、互动数字或帖子正文。系统分享来的标题、文字和链接只会预填当前页面，并立即从地址栏移除；点击开始分析前不会发送。实时餐厅不会长期保存 Google Maps 地址、评分、营业时间、Hot Pepper 详情或用户粘贴的预约平台 URL；重新打开时会按 Place ID 刷新。</p></section>
    <section class="panel privacy-section"><p class="overline">请求时发送给第三方</p><h2>识别与餐厅核对</h2><div class="data-flow-list"><p><strong>Qwen / OpenAI fallback</strong><span>仅在上传截图时接收图片；本应用不把图片写入服务器文件。供应商侧处理与日志期限以其服务条款为准。</span></p><p><strong>Google Places</strong><span>接收餐厅搜索词，以及你确认餐厅或主动展开评分时对应的 Place ID，用于候选、地址、电话、评分和营业时间。展开评分不会请求设备定位。</span></p><p><strong>Hot Pepper</strong><span>接收已确认餐厅的店名、地址或电话，用于匹配店铺页面。</span></p><p><strong>餐厅官网</strong><span>确认餐厅后，服务器可能读取已核验官网的公开 HTML，用于发现预约入口、官方 Instagram 链接或明确的预约规则；不会自动读取 Instagram 帖子。</span></p><p><strong>Google Fonts</strong><span>浏览器可能连接 Google 字体服务以加载页面字体。</span></p></div></section>
    <section class="panel privacy-section"><p class="overline">服务运行记录</p><h2>匿名事件、反馈与技术指标</h2><p>服务端记录输入类型、候选确认、是否按需展开评分、行动点击、保存计划状态、API 成功状态、确认候选到结果出现的耗时和 token 用量；不会记录展开后的评分值。你主动提交反馈时，还会记录有用性、预约结果、准确性和最多 500 字的改进说明。不会记录截图、原始搜索文字、具体用餐日期或 API Key。由于当前没有账号，本机删除操作无法定位或删除已汇总的服务运行记录。</p></section>
    <section class="danger-zone"><div><p class="overline">删除本机数据</p><h2>清空这台浏览器的计划、队列、历史与设置</h2><p>会删除 ${local.savedPlanCount} 条想去计划、${local.pendingAnalysisCount} 家待分析餐厅、${local.recentAnalysisCount} 条最近分析，以及预约姓名等本机偏好。不会影响 Google、Hot Pepper、Qwen、OpenAI 或餐厅平台上的数据。</p></div>${state.deleteConfirmOpen ? `<div class="delete-confirm"><strong>确定永久删除全部本机数据？</strong><button id="cancel-delete">取消</button><button id="confirm-delete">确认全部删除</button></div>` : '<button id="start-delete" class="danger-button">删除本机数据</button>'}</section>
  </section>`;
  document.querySelector("#start-delete")?.addEventListener("click", () => { state.deleteConfirmOpen = true; renderPrivacy(); });
  document.querySelector("#cancel-delete")?.addEventListener("click", () => { state.deleteConfirmOpen = false; renderPrivacy(); });
  document.querySelector("#confirm-delete")?.addEventListener("click", () => {
    deleteLocalData(localStorage);
    state.saved = [];
    state.recent = [];
    state.pending = [];
    state.activePendingId = null;
    state.settings = { ...DEFAULT_SETTINGS };
    state.phoneScriptVersion = state.settings.defaultPhoneScript;
    state.deleteConfirmOpen = false;
    document.querySelector("#saved-count").textContent = "0";
    postEvent("local_data_deleted", { analysisRunId: null });
    showToast("本机计划、队列、历史与设置已全部删除");
    renderPrivacy();
  });
}

function renderSettings() {
  const capabilities = state.capabilities || {};
  const budget = capabilities.dailyBudget || {};
  const capabilitiesUnavailable = Boolean(capabilities.capabilitiesUnavailable);
  const providers = [
    { label: "截图理解", ready: Boolean(capabilities.visionExtraction), detail: capabilities.models?.map((item) => `${item.provider}: ${item.model}`).join(" → ") || "未配置" },
    { label: "截图备用识别", ready: Boolean(capabilities.fallbackAvailable), detail: capabilities.fallbackAvailable ? "主模型失败、输出无效或低置信度时自动启用" : "当前只有一个视觉模型；低置信度结果必须人工确认" },
    { label: "Google Places", ready: Boolean(capabilities.placesSearch), detail: capabilities.placesSearch ? "真实候选与详情已启用" : "使用演示候选" },
    { label: "Hot Pepper", ready: Boolean(capabilities.hotPepper), detail: capabilities.hotPepper ? "店铺信息补充已启用" : "可选补充未启用" },
    { label: "公开网页线索", ready: Boolean(capabilities.webpageExtraction), detail: capabilities.webpageExtraction ? "受限 HTML 提取已启用" : "未启用" }
  ];
  app.innerHTML = `<section class="content-view narrow settings-view">
    <button class="back-button" data-action="home">← 返回首页</button>
    <div class="section-heading"><span class="step-chip">SETTINGS</span><h2>设置</h2><p>这些偏好只保存在当前浏览器，不会上传到服务端。</p></div>
    <section class="panel"><p class="overline">默认用餐偏好</p><h2>减少每次重复填写</h2><form id="settings-form" class="settings-form">
      <label>默认人数<input type="number" name="defaultPartySize" min="1" max="20" value="${esc(state.settings.defaultPartySize)}"></label>
      <label>电话预约姓名（可选）<input type="text" name="reservationName" maxlength="60" autocomplete="name" value="${esc(state.settings.reservationName)}" placeholder="例如：Guo"><small>仅保存在当前浏览器，用于生成电话话术，不会发送给分析 API。</small></label>
      <label>默认电话话术<select name="defaultPhoneScript"><option value="standard" ${state.settings.defaultPhoneScript === "standard" ? "selected" : ""}>标准版</option><option value="short" ${state.settings.defaultPhoneScript === "short" ? "selected" : ""}>简短版</option><option value="easy" ${state.settings.defaultPhoneScript === "easy" ? "selected" : ""}>日语不熟练</option></select></label>
      <label>试点访问码（可选）<input type="password" name="pilotAccessCode" maxlength="256" autocomplete="off" value="${esc(state.settings.pilotAccessCode)}" placeholder="由试点管理员提供"><small>${capabilities.pilotAccessRequired ? "当前服务要求访问码；保存后会随受保护请求发送。" : "当前服务未要求；仅保存在这个浏览器。"}</small></label>
      <label class="settings-toggle"><input type="checkbox" name="saveRecentAnalyses" ${state.settings.saveRecentAnalyses ? "checked" : ""}><span><strong>保存最近分析</strong><small>最多 10 条；实时餐厅仅保存 Place ID、你的线索和计划。</small></span></label>
      <button type="submit" class="primary-button">保存本机设置</button>
    </form></section>
    <section class="panel capability-panel"><div class="panel-heading"><div><p class="overline">当前服务能力</p><h2>API 与数据源状态</h2></div><button type="button" class="text-button" id="refresh-capabilities">刷新状态</button></div>${capabilitiesUnavailable ? '<aside class="inline-error"><strong>服务状态暂时不可用</strong><span>下面不会把未知状态当作未配置；联网后刷新即可重试。</span></aside>' : `<div class="capability-grid">${providers.map((item) => `<article class="${item.ready ? "ready" : "pending"}"><span>${item.ready ? "已启用" : "未启用"}</span><strong>${esc(item.label)}</strong><p>${esc(item.detail)}</p></article>`).join("")}</div>`}<p class="source-disclaimer">这里不会显示或返回任何 API Key。</p></section>
    ${renderDailyBudget(budget)}
  </section>`;
  document.querySelector("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings = settingsFromForm(Object.fromEntries(new FormData(event.currentTarget)));
    state.phoneScriptVersion = state.settings.defaultPhoneScript;
    syncSettings();
    showToast("本机设置已保存");
    renderSettings();
  });
  document.querySelector("#refresh-capabilities")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const latest = await getCapabilities({ force: true });
    showToast(latest.capabilitiesUnavailable ? "暂时无法读取服务状态" : "服务状态已刷新");
    renderSettings();
  });
}

function renderDailyBudget(budget = {}) {
  const labels = { vision_requests: "截图识别", places_search: "餐厅候选搜索", places_details: "餐厅详情读取" };
  const rows = Object.entries(budget.buckets || {}).map(([key, item]) => {
    const limit = Number(item?.limit) || 0;
    const used = Number(item?.used) || 0;
    const remaining = Math.max(Number(item?.remaining) || 0, 0);
    return `<article><div><strong>${esc(labels[key] || key)}</strong><span>今日已用 ${esc(used)} / ${esc(limit)} · 剩余 ${esc(remaining)}</span></div><progress value="${esc(used)}" max="${esc(limit || 1)}"></progress></article>`;
  }).join("");
  if (!rows) return "";
  return `<section class="panel budget-panel"><p class="overline">费用保护</p><h2>今日 API 应用预算</h2><p>按日本时间 ${esc(budget.date || "今日")} 统计；缓存命中不计入。达到上限后会停止对应的新调用，次日自动恢复。</p><div class="budget-grid">${rows}</div></section>`;
}

function renderTerms() {
  app.innerHTML = `<section class="content-view narrow terms-view">
    <button class="back-button" data-action="home">← 返回首页</button>
    <div class="section-heading"><span class="step-chip">TERMS OF USE</span><h2>服务条款与使用边界</h2><p>生效日期：${esc(TERMS_EFFECTIVE_DATE)} · 适用于当前 TabiTabi 原型。</p></div>
    <aside class="terms-highlight"><strong>最重要的一点</strong><p>TabiTabi 给出的是行动建议，不是预约确认。请以餐厅或预约平台最终显示、电话答复或确认邮件为准。</p></aside>
    <div class="terms-list">${TERMS_SECTIONS.map((section, index) => `<section class="panel terms-section"><span>${String(index + 1).padStart(2, "0")}</span><div><h3>${esc(section.title)}</h3>${section.paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}</div></section>`).join("")}</div>
    <p class="terms-footer-note">继续使用本原型表示你理解上述能力边界。隐私与数据处理方式请查看“隐私与数据”页面。</p>
  </section>`;
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  if (action === "home") state.view = "home";
  if (action === "saved") state.view = "saved";
  if (action === "history") state.view = "history";
  if (action === "queue") state.view = "queue";
  if (action === "privacy") state.view = "privacy";
  if (action === "terms") state.view = "terms";
  if (action === "settings") state.view = "settings";
  if (action === "home") state.activePendingId = null;
  render();
  if (action === "settings") getCapabilities({ force: true }).then(() => { if (state.view === "settings") renderSettings(); });
});

window.addEventListener("online", () => {
  getCapabilities({ force: true }).finally(() => render());
});

window.addEventListener("offline", () => {
  if (state.view === "home") renderHome();
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

recordVisit();
getCapabilities().finally(render);
