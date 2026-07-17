import { buildPhoneScript, confidenceLabel, findCandidates, recommendationLabel } from "./analyzer.js";
import { buildRestaurantQuery, extractionReviewState, formatBudget, isKnownSampleScreenshot, mergeScreenshotSupplemental, normalizeExtraction, sampleTikTokExtraction, selectExtractedRestaurant } from "./screenshot-extraction.js";
import { createSavedPlan, normalizeSavedPlans, PLAN_STATUSES, planStatusLabel, sortSavedPlansByUrgency, updateSavedPlan } from "./saved-plans.js";
import { deleteLocalData, LOCAL_STORAGE_KEY, summarizeLocalData, VISIT_STORAGE_KEY } from "./privacy-data.js";
import { candidateDecision, candidateDecisionCopy, rejectCandidate, restoreCandidates, visibleCandidates } from "./candidate-selection.js";
import { TERMS_EFFECTIVE_DATE, TERMS_SECTIONS } from "./terms-data.js";
import { addRecentAnalysis, createRecentAnalysis, normalizeRecentAnalyses, RECENT_STORAGE_KEY } from "./recent-analyses.js";
import { buildSharePayload } from "./share-result.js";
import { DEFAULT_SETTINGS, loadSettingsFromStorage, normalizeSettings, persistentSettings, pilotAccessHeaders, pilotAccessLocked, pilotAccessRejected, savePilotAccessForSession, settingsFromForm, settingsWithoutPilotAccess, SETTINGS_STORAGE_KEY } from "./settings.js";
import { addPendingRestaurants, normalizePendingAnalyses, parseBatchRestaurantLines, pendingAnalysisToTextExtraction, PENDING_STORAGE_KEY, removePendingAnalysis, restaurantClueKey } from "./analysis-queue.js";
import { parseShareTarget, urlWithoutShareTarget } from "./shared-input.js";
import { createCapabilitiesLoader } from "./capabilities.js";
import { clipboardScreenshotFile, SCREENSHOT_ACCEPT, validateScreenshotFile } from "./image-input.js";
import { sendEvent } from "./event-client.js";
import { pathnameForView, viewFromPathname } from "./client-routes.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const routeStatus = document.querySelector("#route-status");
const loadCapabilities = createCapabilitiesLoader();
const AUDIT_SESSION_KEY = "tabitabi-audit-session-v1";
const initialParams = new URLSearchParams(window.location.search);
if (initialParams.get("audit") === "1") sessionStorage.setItem(AUDIT_SESSION_KEY, "1");
const trafficType = sessionStorage.getItem(AUDIT_SESSION_KEY) === "1" ? "audit" : "product";
const initialSettings = loadSettingsFromStorage(localStorage, sessionStorage);
const initialSharedInput = parseShareTarget(window.location.search);
if (initialParams.get("share") === "1" || initialParams.get("audit") === "1") {
  const cleanUrl = new URL(urlWithoutShareTarget(window.location.href), window.location.origin);
  cleanUrl.searchParams.delete("audit");
  history.replaceState(null, "", `${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}
const state = {
  view: viewFromPathname(window.location.pathname),
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
  exampleInput: false,
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

let lastRenderedView = "";

const VIEW_LABELS = {
  home: "ホーム",
  extraction: "スクリーンショットの確認",
  text_extraction: "入力内容の確認",
  link_guidance: "リンクの確認方法",
  candidates: "店舗候補",
  candidate_confirmed: "確認した店舗",
  loading: "確認中",
  result: "店舗情報",
  saved: "行きたいリスト",
  history: "最近の確認",
  queue: "あとで確認する店舗",
  pilot: "テスト参加",
  privacy: "プライバシーとデータ",
  terms: "利用条件",
  settings: "設定"
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
  document.querySelector('[data-action="saved"]')?.setAttribute("aria-label", `行きたいリスト ${state.saved.length}件`);
}

function syncRecent() {
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(state.recent));
  const count = document.querySelector("#history-count");
  if (count) count.textContent = state.recent.length;
  document.querySelector('[data-action="history"]')?.setAttribute("aria-label", `最近の確認 ${state.recent.length}件`);
}

function syncSettings() {
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(persistentSettings(state.settings)));
  savePilotAccessForSession(state.settings, sessionStorage);
}

function syncPending() {
  localStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify(state.pending));
  const count = document.querySelector("#pending-count");
  if (count) count.textContent = state.pending.length;
}

function render() {
  const viewChanged = state.view !== lastRenderedView;
  if (state.view !== "loading") app.removeAttribute("aria-busy");
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
  if (state.view === "pilot") renderPilot();
  if (state.view === "privacy") renderPrivacy();
  if (state.view === "terms") renderTerms();
  if (state.view === "settings") renderSettings();
  syncSaved();
  syncRecent();
  syncSettings();
  syncPending();
  document.title = state.view === "pilot" ? "クローズドテスト参加 | TabiTabi" : state.view === "privacy" ? "プライバシーとデータ | TabiTabi" : state.view === "terms" ? "利用条件 | TabiTabi" : "TabiTabi | SNSで見つけた店を、次の行動へ";
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  if (viewChanged) {
    routeStatus.textContent = `${VIEW_LABELS[state.view] || "新しいページ"}を開きました`;
    if (lastRenderedView) requestAnimationFrame(() => app.focus({ preventScroll: true }));
    lastRenderedView = state.view;
  }
}

function renderHome() {
  const visionLive = Boolean(state.capabilities?.visionExtraction);
  const visionModel = state.capabilities?.models?.[0]?.model || "";
  const visionFallback = Boolean(state.capabilities?.fallbackAvailable);
  const capabilitiesUnavailable = Boolean(state.capabilities?.capabilitiesUnavailable);
  const offline = navigator.onLine === false;
  const accessLocked = pilotAccessLocked(state.capabilities, state.settings);
  app.innerHTML = `
    <section class="hero">
      <div class="hero-intro">
        <div class="eyebrow">SNSから、お店の入口まで</div>
        <h1>気になる店を、<br><em>次の行動へ。</em></h1>
        <p class="hero-copy">リンク、店名、スクリーンショットから店舗を確認。予約・電話・来店の次の一歩を整理します。</p>
        <div class="hero-route" aria-hidden="true"><span>SNS</span><i></i><span>店舗確認</span><i></i><span>行動</span></div>
      </div>
      <div class="hero-workbench">
      ${state.sharedInputPending ? `<aside class="shared-input-banner"><strong>共有内容を受け取りました</strong><span>共有されたタイトル、文章、リンクを入力欄に反映しました。内容を確認してから開始してください。</span></aside>` : ""}
      ${offline ? `<aside class="offline-banner"><strong>オフラインです</strong><span>保存済みのリストは確認できます。新しい画像解析、店舗検索、公式サイト確認にはインターネット接続が必要です。</span></aside>` : ""}
      ${accessLocked ? `<form id="pilot-access-form" class="pilot-access-card" aria-labelledby="pilot-access-title">
        <div class="pilot-access-copy"><span>クローズドテスト</span><strong id="pilot-access-title">招待アクセスコードを入力</strong><p id="pilot-access-help">管理者から案内されたコードです。このタブを閉じるまでだけ保持し、店舗確認を始めるときに本サービスへ送信します。</p></div>
        <label for="pilot-access-code">招待アクセスコード</label>
        <div class="pilot-access-controls"><input id="pilot-access-code" name="pilotAccessCode" type="password" maxlength="256" autocomplete="off" required aria-describedby="pilot-access-help" placeholder="アクセスコード"><button type="submit">このタブで使用</button></div>
      </form>` : ""}
      <form id="analyze-form" class="input-card">
        <label for="clue">お店の手がかり</label>
        <textarea id="clue" name="clue" rows="4" placeholder="Instagram / TikTok のリンク、または店名を入力…" ${state.analysisError ? 'aria-invalid="true" aria-describedby="analysis-error"' : ""}>${esc(state.input)}</textarea>
        <p class="supported-sources">Instagram・TikTok に最適化。YouTube Shorts・X、LINE で受け取ったリンクや文章にも対応します。</p>
        <div class="input-meta">
          <button type="button" class="upload-button" id="upload-trigger">${icons.upload}<span>${state.uploadName ? esc(state.uploadName) : "スクリーンショットを追加"}</span></button>
          <input type="file" id="screenshot" hidden accept="${SCREENSHOT_ACCEPT}" />
          ${state.uploadName ? '<button type="button" class="remove-upload" id="remove-upload">画像を外す</button>' : '<span class="privacy-note" id="upload-help">画像は店舗確認のためだけに使用します</span>'}
        </div>
        ${state.uploadPreviewUrl ? `<div class="upload-preview"><img src="${state.uploadPreviewUrl}" alt="確認するスクリーンショット"><div><strong>画面全体を確認します</strong><span>店名、住所、価格、投稿者、本文、反応数を分けて扱います。</span></div></div>` : ""}
        ${state.analysisError ? `<aside class="inline-error" id="analysis-error" role="alert"><strong>入力内容を確認できませんでした</strong><span>${esc(state.analysisError)}</span></aside>` : ""}
        <button class="primary-button" type="submit" ${accessLocked ? 'disabled aria-describedby="pilot-access-help"' : ""}>確認をはじめる ${icons.arrow}</button>
      </form>
      <div class="examples">
        <span>デモを試す：</span>
        <button data-example="銀座 鮨 蒼月">予約が必要な寿司店</button>
        <button data-example="新宿 麺処 灯 ラーメン">並んで入るラーメン店</button>
        <button data-example="京都 喫茶 こもれび">情報が不足している喫茶店</button>
      </div>
      </div>
    </section>
    ${state.pending.length ? `<section class="recent-preview queue-preview"><div><p class="overline">あとで確認</p><h2>画像内のほかの店舗を続けて確認</h2></div><div class="recent-preview-list">${state.pending.slice(0, 3).map((item) => `<button data-open-pending="${esc(item.id)}"><strong>${esc(item.clues.name)}</strong><span>${esc([item.clues.branch, item.clues.area || item.clues.address].filter(Boolean).join(" · ") || "場所を要確認")}</span></button>`).join("")}</div><button class="text-button" data-action="queue">全 ${state.pending.length} 件を見る</button></section>` : ""}
    ${state.recent.length ? `<section class="recent-preview"><div><p class="overline">最近の確認</p><h2>前回の店舗をもう一度確認</h2></div><div class="recent-preview-list">${state.recent.slice(0, 3).map((item) => `<button data-open-recent="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>${esc(item.area || "エリアを要確認")} · ${formatClientTime(item.analyzedAt)}</span></button>`).join("")}</div><button class="text-button" data-action="history">全 ${state.recent.length} 件を見る</button></section>` : ""}
    <section class="promise-grid">
      <article><b>まず確認</b><h3>正しい店舗を選ぶ</h3><p>同名店や支店、表記ゆれを確認します。</p></article>
      <article><b>根拠を確認</b><h3>情報源を分けて表示</h3><p>判断の根拠、取得時刻、確度を示します。</p></article>
      <article><b>次に行動</b><h3>予約・電話・来店へ</h3><p>確認できた範囲で、次の行動を案内します。</p></article>
    </section>
    <aside class="demo-banner ${visionLive ? "live" : ""}"><strong>${capabilitiesUnavailable ? "サービス状態を確認できません" : visionLive ? "スクリーンショット解析を利用できます" : "画像解析のデモモード"}</strong><span>${capabilitiesUnavailable ? "一時的な通信エラーを未設定とは判定しません。接続を確認して再試行してください。" : visionLive ? `${esc(visionModel)} で画面全体を確認します。${visionFallback ? "結果の品質が低い場合は予備モデルを使用します" : "予備モデルは未設定のため、確度が低い場合は手動確認が必要です"}。検索前に店名と住所を確認できます。` : "画像解析 API を設定すると任意のスクリーンショットを確認できます。現在はサンプル画像のみデモ解析できます。"}</span></aside>`;

  document.querySelector("#analyze-form").addEventListener("submit", handleAnalyze);
  document.querySelector("#pilot-access-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("pilotAccessCode");
    state.settings = normalizeSettings({ ...state.settings, pilotAccessCode: code });
    if (!state.settings.pilotAccessCode) {
      showToast("招待アクセスコードを入力してください");
      document.querySelector("#pilot-access-code")?.focus();
      return;
    }
    syncSettings();
    state.analysisError = "";
    showToast("アクセスコードを入力しました");
    renderHome();
    document.querySelector("#clue")?.focus();
  });
  document.querySelector("#upload-trigger").addEventListener("click", () => document.querySelector("#screenshot").click());
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
  document.querySelector("#clue").addEventListener("input", () => { state.exampleInput = false; });
  document.querySelector("#remove-upload")?.addEventListener("click", clearUpload);
  document.querySelectorAll("[data-open-recent]").forEach((button) => button.addEventListener("click", () => openRecentAnalysis(button.dataset.openRecent)));
  document.querySelectorAll("[data-open-pending]").forEach((button) => button.addEventListener("click", () => openPendingAnalysis(button.dataset.openPending)));
  document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => {
    state.input = button.dataset.example;
    state.exampleInput = true;
    renderHome();
    document.querySelector("#clue").focus();
  }));
}

function attachScreenshotFile(file, { pasted = false } = {}) {
  if (!file) return;
  state.exampleInput = false;
  const validation = validateScreenshotFile(file);
  if (!validation.ok) {
    state.analysisError = validation.error;
    showToast("この画像形式またはサイズには対応していません");
    renderHome();
    return;
  }
  if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
  state.uploadFile = file;
  state.uploadName = file.name || (pasted ? "貼り付けた画像" : "スクリーンショット");
  state.uploadPreviewUrl = URL.createObjectURL(file);
  state.analysisError = "";
  showToast(pasted ? "クリップボードの画像を追加しました" : "スクリーンショットを追加しました");
  renderHome();
}

async function handleAnalyze(event) {
  event.preventDefault();
  const value = new FormData(event.currentTarget).get("clue").trim();
  if (!value && !state.uploadFile) {
    showToast("店名、リンク、またはスクリーンショットを追加してください");
    return;
  }
  if (navigator.onLine === false) {
    showToast("オフラインです。接続後にもう一度お試しください");
    return;
  }
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable) {
    state.analysisError = "サービス状態を確認できません。通信環境を確認して再試行してください。";
    renderHome();
    return;
  }
  if (pilotAccessLocked(capabilities, state.settings)) {
    state.capabilities = capabilities;
    state.analysisError = "";
    renderHome();
    document.querySelector("#pilot-access-code")?.focus();
    showToast("先に招待アクセスコードを入力してください");
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
  state.analysisSourceMode = state.exampleInput ? "demo" : capabilities.placesSearch ? "live" : "demo";
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
      state.analysisError = error.message || "しばらくしてから再試行するか、店名を入力してください。";
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
    if (recoverFromPilotAccessError(error)) return;
    state.analysisError = error.message || "店舗検索を一時的に利用できません。";
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
  if (!response.ok) throw new Error(payload.error || "入力内容を確認できませんでした。");
  return payload;
}

async function extractWebpageInput(url) {
  const response = await fetch("/api/extract-webpage", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...pilotAccessHeaders(state.settings) },
    body: JSON.stringify({ url })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw apiResponseError(payload, "公開ページから店舗情報を確認できませんでした。店名を入力するか、スクリーンショットを追加してください。");
  return payload;
}

function renderTextExtraction() {
  const parsed = state.textExtraction;
  const clues = parsed.clues;
  const parsedPlatformLabel = parsed.platformLabel || platformLabel(parsed.platform);
  app.innerHTML = `<section class="content-view narrow">
    <button class="back-button" data-action="home">← 入力を修正</button>
    <div class="section-heading"><span class="step-chip">入力内容の整理</span><h2>探す店舗を先に確認</h2><p>日付・時間・人数は予定に反映し、店舗検索のキーワードには混ぜません。</p></div>
    <section class="panel extracted-restaurant"><form id="text-extraction-form">
      <div class="field-pair"><label>店名または検索語<input name="name" value="${esc(clues.name)}" required></label><label>支店名<input name="branch" value="${esc(clues.branch)}"></label></div>
      <div class="field-pair"><label>エリア<input name="area" value="${esc(clues.area)}"></label><label>住所の補足<input name="address" value="${esc(clues.address)}"></label></div>
      ${clues.aliasExpanded ? `<aside class="alias-expansion"><strong>中国語の通称を正式名に置き換えました</strong><span>${esc(clues.originalName)} → ${esc(clues.name)}</span><p>検索には日本語の正式名を使います。エリア・住所・候補画面で支店を確認してください。</p></aside>` : ""}
      <div class="plan-preview"><strong>読み取った予定</strong><span>${parsed.plan.planDate || "日付未定"} · ${parsed.plan.planTime || "時間未定"} · ${state.currentPlanIntent.partySize}名</span></div>
      ${parsed.kind === "pending_analysis" ? `<aside class="link-capability"><strong>この端末の確認待ちリストから開きました</strong><p>店名・支店・場所の手掛かりだけを保存しています。実在する店舗をここから確認します。</p></aside>` : parsed.webpage ? `<aside class="link-capability"><strong>公開ページの手掛かりを確認 · 確度${esc(parsed.webpage.confidence === "high" ? "高" : parsed.webpage.confidence === "medium" ? "中" : "低")}</strong><p>${esc(parsed.webpage.warnings.join(" "))}</p><a href="${esc(safeExternalUrl(parsed.webpage.sourceUrl))}" target="_blank" rel="noreferrer">元ページを開いて確認</a></aside>` : parsed.links.length ? `<aside class="link-capability"><strong>${esc(parsedPlatformLabel)} のリンクも検出しました</strong><p>リンク横に入力された文章だけを店舗の手掛かりとして使います。第三者サイトの投稿本文は読み取らず、候補画面で支店を確認します。</p></aside>` : ""}
      <button class="primary-button" type="submit">実在する店舗候補を検索 ${icons.arrow}</button>
    </form></section>
  </section>`;
  document.querySelector("#text-extraction-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    const search = [form.name, form.branch, form.area, form.address].filter(Boolean).join(" ");
    try { await searchCandidates(search, form); }
    catch (error) {
      if (recoverFromPilotAccessError(error)) return;
      state.view = "text_extraction";
      showToast(error.message || "店舗検索を一時的に利用できません");
      render();
    }
  });
}

function renderLinkGuidance() {
  const parsed = state.textExtraction;
  const reservationPlatform = parsed.kind === "reservation_link";
  const parsedPlatformLabel = parsed.platformLabel || platformLabel(parsed.platform);
  const originalLink = parsed.links?.[0];
  app.innerHTML = `<section class="content-view narrow link-guidance-view">
    <button class="back-button" data-action="home">← 手掛かりを追加</button>
    <div class="section-heading"><span class="step-chip">${esc(parsedPlatformLabel)} のリンク</span><h2>${reservationPlatform ? "リンクは確認できましたが、店舗はまだ特定できません" : "リンクは確認できましたが、投稿内容は読み取っていません"}</h2><p>${reservationPlatform ? "第三者の店舗ページや予約ページだけでは、店舗の同一性や予約成立を判断しません。店名・住所・スクリーンショットを追加してください。" : "SNS 投稿はログインや動的表示が必要な場合があります。店名を推測しないため、次のどちらかを追加してください。"}</p></div>
    ${reservationPlatform && originalLink ? `<aside class="link-capability"><strong>${originalLink.linkType === "booking_flow" ? "予約手続きに見える URL です" : "店舗ページまたは一覧ページの URL です"}</strong><p>ここでは URL の種類だけを判定し、空席、店名、料金、予約状況は読み取っていません。</p><a href="${esc(safeExternalUrl(originalLink.url))}" target="_blank" rel="noreferrer">元のリンクを開いて確認</a></aside>` : ""}
    <div class="guidance-grid"><article><b>おすすめ</b><h3>${reservationPlatform ? "店舗のスクリーンショットを追加" : "投稿のスクリーンショットを追加"}</h3><p>画面全体の画像から店名、住所、見えている文章を確認します。</p></article><article><b>すばやく確認</b><h3>${reservationPlatform ? "リンクと一緒に店名を入力" : "本文または店名を貼り付け"}</h3><p>例：「Instagramで見た六歌仙 新宿本店。8月1日、4名」</p></article></div>
    <aside class="extraction-warning"><strong>まだ確認していないこと</strong><ul>${parsed.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></aside>
    <button class="primary-button" data-action="home">画像または文章を追加</button>
  </section>`;
}

function platformLabel(value) {
  return { tiktok: "TikTok", instagram: "Instagram", youtube: "YouTube Shorts", x: "X", threads: "Threads", lemon8: "Lemon8", line: "LINE", facebook: "Facebook", xiaohongshu: "小紅書", web: "公開ページ", tablecheck: "TableCheck", tabelog: "食べログ", hotpepper: "ホットペッパーグルメ", gurunavi: "楽天ぐるなび", omakase: "OMAKASE", pocket_concierge: "Pocket Concierge", tableall: "TABLEALL", ikyu: "一休.comレストラン", opentable: "OpenTable", google_reserve: "Google で予約", epark: "EPARK", autoreserve: "AutoReserve", hitosara: "ヒトサラ", savor_japan: "SAVOR JAPAN", toreta: "Toreta", ebica: "ebica", paypay_gourmet: "PayPayグルメ", ozmall: "OZmall", retty: "Retty", byfood: "byFood", foodies_reserve: "Foodies Reserve", jpneazy: "JPNEAZY", my_concierge_japan: "My Concierge Japan", japan_food_travel: "JapanFoodTravel", unknown: "画像の手掛かり" }[value] || "予約サービス";
}

function renderLoading() {
  const screenshotMode = state.loadingMode === "screenshot" || (Boolean(state.uploadFile) && !state.loadingMode);
  const detailsMode = state.loadingMode === "details";
  const searchMode = state.loadingMode === "search";
  const webpageMode = state.loadingMode === "webpage";
  app.setAttribute("aria-busy", "true");
  app.innerHTML = `<section class="loading-view" role="status" aria-live="polite">
    <div class="scanner" aria-hidden="true"><span></span><i>た</i></div>
    <p class="eyebrow">${screenshotMode ? "画像全体を確認" : webpageMode ? "公開ページを確認" : detailsMode ? "実在する店舗を確認" : "店舗を検索"}</p>
    <h2>${screenshotMode ? "スクリーンショットを読み取っています" : webpageMode ? "公開ページから店舗の手掛かりを探しています" : detailsMode ? "営業情報と次の行動を確認しています" : "実在する店舗を検索しています"}</h2>
    <div class="loading-steps">${screenshotMode
      ? '<span class="done">多言語の文字を認識</span><span class="active">事実と投稿者の感想を分離</span><span>店舗の手掛かりを整理</span>'
      : webpageMode
        ? '<span class="done">公開 URL を確認</span><span class="active">タイトルと店舗情報を整理</span><span>確認を待っています</span>'
      : detailsMode
        ? '<span class="done">店舗を特定</span><span class="active">営業時間と電話を更新</span><span>根拠と次の行動を整理</span>'
        : '<span class="done">店名と住所を送信</span><span class="active">Google Maps と照合</span><span>確認を待っています</span>'}</div>
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
    ["いいね", e.engagement.likes],
    ["コメント", e.engagement.comments],
    ["保存", e.engagement.saves],
    ["シェア", e.engagement.shares]
  ].filter(([, value]) => Number.isFinite(value));

  app.innerHTML = `<section class="content-view extraction-view">
    <button class="back-button" data-action="home">← 別の画像を選ぶ</button>
    <div class="section-heading extraction-heading"><span class="step-chip">画像の確認 · ${state.extractionMode === "api" ? esc(meta?.model || "画像解析 API") : "端末内サンプル"}</span><h2>画像から読み取った内容</h2><p>店名と住所を確認してから、実在する店舗候補を探します。</p></div>
    <div class="extraction-layout">
      <aside class="screenshot-card"><img src="${state.uploadPreviewUrl}" alt="アップロードした SNS のスクリーンショット"><div><span>${esc(e.platform.toUpperCase())}</span><strong>${esc(e.creator.handle || "アカウント不明")}</strong></div></aside>
      <div class="extraction-content">
        ${e.restaurants.length > 1 ? `<section class="panel extracted-restaurant-picker"><div><p class="overline">${e.restaurants.length} 店舗を検出</p><h3>確認する店舗を1つ選択</h3></div><div class="extracted-restaurant-options" role="group" aria-label="確認する店舗を選択">${e.restaurants.map((restaurant, index) => `<button type="button" data-extracted-restaurant="${index}" class="${restaurantKeyForView(restaurant) === restaurantKeyForView(r) ? "active" : ""}" aria-pressed="${restaurantKeyForView(restaurant) === restaurantKeyForView(r)}"><strong>${esc(restaurant.name || `店舗 ${index + 1}`)}</strong><span>${esc([restaurant.branch, restaurant.area || restaurant.address || restaurant.nearest_station].filter(Boolean).join(" · ") || "場所不明")}</span></button>`).join("")}</div><button type="button" class="queue-extracted" id="queue-extracted" ${queueableRestaurants.length ? "" : "disabled"}>${queueableRestaurants.length ? `ほかの ${queueableRestaurants.length} 店舗をあとで確認` : "ほかの店舗は確認待ちに追加済み"}</button><small class="queue-privacy">店舗の手掛かりだけをこのブラウザに保存し、画像は保存しません。</small></section>` : ""}
        <section class="panel extracted-restaurant"><div class="fact-label"><span class="status-dot dark"></span>照合に使う店舗情報</div>
          <form id="extraction-form">
            <div class="field-pair"><label>店名<input name="restaurant_name" value="${esc(r.name)}" required></label><label>支店名<input name="branch" value="${esc(r.branch)}"></label></div>
            <div class="field-pair"><label>住所<input name="address" value="${esc(r.address)}"></label><label>最寄り駅<input name="nearest_station" value="${esc(r.nearest_station)}" placeholder="例：上野駅"></label></div>
            <div class="extracted-chips"><span>${esc(r.category || "料理ジャンル不明")}</span><span>${formatBudget(r)}</span><span>${esc(r.area || "エリア不明")}</span></div>
            ${review.requiresAcknowledgement ? '<label class="confidence-confirm"><input type="checkbox" name="confirm_extraction" value="yes"><span>画像を見ながら店名・支店・住所を確認しました。</span></label>' : ""}
            <button class="primary-button" type="submit">この店舗を照合する ${icons.arrow}</button>
          </form>
        </section>
        <div class="extraction-subgrid">
        <section class="panel"><p class="overline">画面の文字と投稿者の説明</p><h3>表示内容・投稿上の主張・感想を分けて扱います</h3><div class="claim-list">${e.claims.length ? e.claims.map((claim) => `<p><span>${claim.kind === "opinion" ? "感想" : claim.kind === "visible_fact" ? "画面の文字" : "投稿の主張"}</span>${esc(claim.text)}</p>`).join("") : '<p class="muted">関連する説明は見つかりませんでした。</p>'}</div><p class="fine-print">「画面の文字」は画像に表示されていることだけを示します。営業・閉店・移転・予約状況を公式情報で確認したという意味ではありません。</p></section>
          <section class="panel"><p class="overline">SNS の反応</p><h3>参考表示のみ。予約判断には使いません</h3><div class="engagement-grid">${engagement.length ? engagement.map(([label, value]) => `<div><strong>${new Intl.NumberFormat("ja-JP").format(value)}</strong><span>${label}</span></div>`).join("") : '<p class="muted">反応数は読み取れませんでした。</p>'}</div></section>
        </div>
        ${review.requiresAcknowledgement || !review.canContinue ? `<aside class="extraction-warning"><strong>${review.canContinue ? "手動確認が必要です" : "まだ店舗候補を検索できません"}</strong><p>${esc(review.message)}</p></aside>` : ""}
        <aside class="source-readiness ${placesReady ? "ready" : "pending"}"><strong>${placesReady ? "Google Places で照合できます" : "次はデモ候補を表示します"}</strong><span>${placesReady ? "確認後に実在する店舗候補を検索します。電話や営業時間は、店舗を選んだ後または評価を開いた場合だけ取得します。" : "画像は読み取れますが Google Maps Key が未設定です。デモ候補を実在の検索結果として表示することはありません。"}</span></aside>
        ${e.warnings.length ? `<aside class="extraction-warning"><strong>次に確認すること</strong><ul>${e.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></aside>` : ""}
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
      showToast("画像を見ながら店名と住所を確認してください");
      return;
    }
    state.input = [clues.name, clues.branch, clues.address || clues.area || clues.nearest_station].filter(Boolean).join(" ");
    try {
      await searchCandidates(state.input, clues);
    } catch (error) {
      state.analysisError = error.message || "店舗検索を一時的に利用できません。";
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
    showToast(added ? `${added} 店舗を「あとで確認」に追加しました` : "これらの店舗はすでに追加済みです");
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
    <button class="back-button" data-action="home">← 手掛かりを修正</button>
    <div class="section-heading candidate-heading"><span class="step-chip">店舗を確認</span><h2>${esc(decisionCopy.heading)}</h2><p>${esc(decisionCopy.summary)}</p><aside class="identity-gate"><strong>店舗を特定してから詳細を取得</strong><span>ここでは検索結果だけで店舗を照合します。営業時間、電話、公式サイト、予約方法は確認後に取得します。</span></aside></div>
    <div class="candidate-list">
      ${visible.map((restaurant, index) => {
        const preview = state.candidatePreviews[restaurant.placeId];
        const previewLoading = state.candidatePreviewLoadingId === restaurant.placeId;
        const isSystemLead = !fallback && decision.kind !== "ambiguous" && restaurant.id === decision.leadId;
        const candidateLabel = isSystemLead ? "第一候補" : visible.length === 1 ? "確認してください" : `候補 ${index + 1}/${visible.length}`;
        return `<article class="candidate-card${isSystemLead ? " system-lead" : ""}">
        <div class="restaurant-avatar">${(restaurant.category || "店").slice(0, 1)}</div>
        <div class="candidate-copy"><span class="candidate-label${isSystemLead ? " lead-label" : ""}">${esc(candidateLabel)}</span><small class="candidate-meta">${esc(restaurant.category || "飲食店")}${restaurant.price ? ` · ${esc(restaurant.price)}` : ""}</small><h3>${esc(restaurant.name)}</h3><p>${esc(restaurant.address || [restaurant.area, restaurant.station].filter(Boolean).join(" · "))}</p><small class="business-status status-${esc(String(restaurant.businessStatus || "unknown").toLowerCase())}">${esc(businessStatusLabel(restaurant.businessStatus))}</small>${restaurant.matchReasons?.length ? `<div class="match-reasons">${restaurant.matchReasons.map((reason) => `<small>${esc(reason)}</small>`).join("")}</div>` : restaurant.matchScore ? `<small>入力した店名・場所との一致を確認</small>` : ""}${preview ? `<div class="candidate-rating"><strong>${Number.isFinite(preview.rating) ? `★ ${esc(preview.rating.toFixed(1))}` : "公開評価なし"}</strong>${Number.isInteger(preview.userRatingCount) ? `<span>Google のクチコミ ${esc(preview.userRatingCount.toLocaleString("ja-JP"))}件</span>` : ""}</div>` : ""}${restaurant.attributions?.length ? `<small class="provider-attribution">情報提供：${restaurant.attributions.map((item) => esc(item.provider)).join("、")}</small>` : ""}</div>
        <div class="candidate-actions"><button class="select-button" data-restaurant="${restaurant.id}">この店舗で確認 ${icons.arrow}</button>${live && !preview ? `<button class="preview-button" data-preview-candidate="${restaurant.placeId}" ${previewLoading ? "disabled" : ""}>${previewLoading ? "確認中…" : "評価を確認"}</button>` : ""}<button class="reject-button" data-reject-candidate="${restaurant.id}" aria-label="${esc(restaurant.name)}を候補から外す">別の店舗です</button></div>
      </article>`;
      }).join("")}
    </div>
    ${visible.length ? `<div class="candidate-review-actions"><button data-action="home">どれも不明。検索条件を修正</button>${rejectedCount ? `<button data-restore-candidates>外した ${rejectedCount} 件を戻す</button>` : ""}</div>` : `<div class="empty-state candidate-empty"><span>?</span><h3>該当する店舗がありません</h3><p>候補を戻すか、支店・駅・住所を追加して検索し直してください。</p><div><button data-restore-candidates>すべての候補を戻す</button><button class="primary-button" data-action="home">検索条件を修正 ${icons.arrow}</button></div></div>`}
    ${live ? '<p class="candidate-cost-note">店舗は自動選択せず、端末の位置情報も取得しません。場所は入力された住所やエリアから判断します。Google の評価は「評価を確認」を押した店舗だけ、営業時間・電話・予約方法は店舗確認後だけ取得します。</p><div class="google-attribution" translate="no">Google Maps</div>' : '<p class="fine-print">Google Places が未設定のため、明示した端末内デモ候補を表示しています。</p>'}
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
    <button class="back-button" data-back-to-candidates>← 候補に戻る</button>
    <div class="section-heading"><span class="step-chip">次に確認する内容</span><h2>確認した店舗：${esc(candidate.name)}</h2><p>${esc(candidate.address || [candidate.area, candidate.station].filter(Boolean).join(" · "))}</p></div>
    <aside class="confirmed-identity">${icons.check}<div><strong>この店舗で間違いないことを確認しました</strong><span>以降はこの店舗だけの最新情報を取得し、別支店の情報を混ぜません。</span></div></aside>
    <div class="next-step-grid">
      <button data-confirmed-action="details"><span>店舗情報を見る</span><strong>営業時間、住所、電話、公式情報</strong>${icons.arrow}</button>
      <button data-confirmed-action="reservation"><span>予約方法を見る</span><strong>予約入口、条件、順番待ち、次の行動</strong>${icons.arrow}</button>
    </div>
    <p class="candidate-cost-note">どちらも同じ最新情報を確認し、最初に表示する場所だけが異なります。本サービスが予約を送信することはありません。</p>
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
    <button class="back-button" data-action="home">← 別の店舗を確認</button>
    ${state.pending.length ? `<aside class="result-queue"><div><strong>あと ${state.pending.length} 店舗を確認できます</strong><span>同じ画像やリストにある店舗を続けて確認します。</span></div><button id="continue-pending">次の店舗へ ${icons.arrow}</button></aside>` : ""}
    <div class="result-title"><div><span class="category-line">${[r.category, r.price].filter(Boolean).map(esc).join(" · ")}</span><h1>${esc(r.name)}</h1><p>${[r.reading, r.area].filter(Boolean).map(esc).join(" · ")}</p></div><span class="demo-pill">${r.dataLabel || "デモ情報"}</span></div>
    <div class="decision-grid">
      <article class="decision-card ${esc(r.recommendation)}">
        <div class="status-row"><span class="status-dot"></span><span>${confidenceLabel(r.confidence)}</span></div>
        <p class="overline">確認結果</p><h2>${esc(recommendationLabel(r.recommendation))}</h2><p>${esc(r.summary)}</p>
        <div class="reason-list">${r.reasons.map((reason) => `<span>${icons.check}${esc(reason)}</span>`).join("")}</div>
        ${r.planAdvisory ? `<aside class="plan-advisory"><strong>入力した予定について</strong><p>${esc(r.planAdvisory)}</p></aside>` : ""}
        ${r.decisionEvidence?.length ? `<div class="decision-boundary"><strong>判断できる範囲</strong>${r.decisionEvidence.map((item) => `<p>${esc(item.claim)} · 確度${esc(item.certainty === "high" ? "高" : item.certainty === "medium" ? "中" : "低")}<br><small>${esc(item.limitation)}</small></p>`).join("")}</div>` : ""}
      </article>
      <article class="action-card"><p class="overline">次にすること</p><h3>${esc(r.nextAction)}</h3>
        ${primaryAction ? `<a class="primary-button" id="primary-action" data-action-type="${esc(primaryAction.type || "external")}" href="${esc(actionHref(primaryAction))}" ${primaryAction.type === "phone" ? "" : 'target="_blank" rel="noreferrer"'}>${esc(primaryAction.label)} ${primaryAction.type === "phone" ? icons.phone : icons.arrow}</a>` : r.phone ? `<a class="primary-button" id="primary-action" data-action-type="phone" href="tel:${esc(r.phone)}">${icons.phone} 電話で確認</a>` : `<a class="primary-button" id="primary-action" data-action-type="map" href="${esc(safeExternalUrl(r.mapSearchUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address}`)}`))}" target="_blank" rel="noreferrer">地図で店舗を確認 ${icons.arrow}</a>`}
        ${r.phone && primaryAction?.type !== "phone" ? `<a class="secondary-button" id="phone-action" href="tel:${esc(r.phone)}">${icons.phone} ${esc(r.phone)} · 電話で確認</a>` : ""}
        <button class="secondary-button" id="share-result">この結果を共有</button>
        <button class="secondary-button" id="save-button">${icons.bookmark} ${saved ? "来店予定を編集" : "保存して予定を追加"}</button>
        ${state.planEditorOpen ? renderPlanForm(savedPlan, r) : ""}
      </article>
    </div>
    ${r.conflict ? `<aside class="conflict"><strong>${esc(r.conflictTitle || "情報が一致していません")}</strong><p>${esc(r.conflict)}</p></aside>` : ""}
    ${r.reservationGuidance ? `<section class="panel reservation-guidance"><div><p class="overline">公式サイトの予約条件</p><h2>${esc(r.reservationGuidance.label)}</h2><p>${esc(r.reservationGuidance.excerpt)}</p><small>条件への適合、空席、予約成立は、利用日のページ表示または店舗からの回答をご確認ください。</small></div><a href="${esc(safeExternalUrl(r.reservationGuidance.sourceUrl))}" target="_blank" rel="noreferrer">公式サイトの原文を開く ${icons.arrow}</a></section>` : ""}
    ${reservationOptions.length ? `<section class="panel reservation-options"><div class="panel-heading"><div><p class="overline">予約・確認先</p><h2>信頼できる入口から確認</h2></div><span>予約、予約リクエスト、順番待ち、店舗ページを区別しています</span></div><div class="reservation-option-grid">${reservationOptions.map((option) => `<a class="reservation-option ${reservationOptionClass(option)}" href="${esc(option.url)}" ${option.actionType === "phone" ? "" : 'target="_blank" rel="noreferrer"'} data-reservation-provider="${esc(option.provider)}" data-action-type="${esc(option.actionType)}"><span>${reservationOptionBadge(option)}</span><strong>${esc(option.label)}</strong><small>${esc(option.capability?.label || reservationModeLabel(option.bookingMode))}</small>${option.capability?.confirmation ? `<em>${esc(option.capability.confirmation)}</em>` : ""}${option.feeNote ? `<p>${esc(option.feeNote)}</p>` : ""}</a>`).join("")}</div></section>` : ""}
    ${r.queueGuidance ? `<section class="panel queue-guidance"><div><p class="overline">公式サイトの順番待ちルール</p><h2>${esc(r.queueGuidance.label)}</h2><p>${esc(r.queueGuidance.excerpt)}</p><small>公式サイトで公開された方法だけを示します。現在の空席や待ち時間を示すものではありません。</small></div><a href="${esc(safeExternalUrl(r.queueGuidance.sourceUrl))}" target="_blank" rel="noreferrer">公式サイトの原文を開く ${icons.arrow}</a></section>` : ""}
    ${r.attentionNotices?.length ? `<section class="panel attention-panel"><div class="panel-heading"><div><p class="overline">来店時の注意</p><h2>公式サイトに明記されたルール</h2></div><span>予約送信前にもう一度確認</span></div><div class="attention-grid">${r.attentionNotices.map((notice) => `<article><strong>${esc(notice.label)}</strong><p>${esc(notice.excerpt)}</p><a href="${esc(safeExternalUrl(notice.sourceUrl))}" target="_blank" rel="noreferrer">公式サイトの原文を開く</a></article>`).join("")}</div></section>` : ""}
    <div class="detail-grid">
      <section class="panel"><div class="panel-heading"><div><p class="overline">店舗情報</p><h2>行く前に確認</h2></div><span class="queue-chip">${esc(r.queue)}</span></div>
        <dl class="facts">${Number.isFinite(r.rating) ? `<div><dt>Google の評価</dt><dd>${esc(r.rating)} / 5${Number.isInteger(r.userRatingCount) ? ` · クチコミ ${esc(r.userRatingCount.toLocaleString("ja-JP"))}件` : ""}</dd></div>` : ""}<div><dt>住所</dt><dd>${esc(r.address)}</dd></div>${r.phone ? `<div><dt>電話</dt><dd><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></dd></div>` : ""}${r.officialInstagramUrl ? `<div><dt>公式 Instagram</dt><dd><a href="${esc(safeExternalUrl(r.officialInstagramUrl))}" target="_blank" rel="noreferrer">公式アカウントを開く</a></dd></div>` : ""}<div><dt>最寄り駅</dt><dd>${esc(r.station)}</dd></div><div><dt>営業時間</dt><dd>${esc(r.hours)}</dd></div><div><dt>定休日</dt><dd>${esc(r.closed)}</dd></div></dl>
      </section>
      <section class="panel script-panel"><p class="overline">${scriptMode === "walk_in" ? "電話で営業・待ち時間を確認" : "電話予約のサポート"}</p><h2>このまま読めます</h2><div class="script-tabs" role="group" aria-label="電話用の文例"><button class="${scriptVersion === "standard" ? "active" : ""}" data-script-version="standard" aria-pressed="${scriptVersion === "standard"}">標準</button><button class="${scriptVersion === "short" ? "active" : ""}" data-script-version="short" aria-pressed="${scriptVersion === "short"}">短め</button><button class="${scriptVersion === "easy" ? "active" : ""}" data-script-version="easy" aria-pressed="${scriptVersion === "easy"}">やさしい日本語</button></div><blockquote lang="ja">${esc(visibleScript.ja)}</blockquote><button class="copy-button" data-copy="${esc(visibleScript.ja)}">文例をコピー</button></section>
    </div>
    <section class="panel sources"><div class="panel-heading"><div><p class="overline">情報の根拠</p><h2>この案内の出典</h2></div><span>${r.sourceContext || "確認直後 · デモ"}</span></div>
      ${r.sources.map((source) => `<div class="source-row"><div>${source.url ? `<a href="${esc(safeExternalUrl(source.url))}" target="_blank" rel="noreferrer"><strong>${esc(source.name)}</strong></a>` : `<strong>${esc(source.name)}</strong>`}${source.official ? '<span class="official">公式</span>' : ""}<p>${esc(source.note)}${source.retrievedAt ? ` · ${formatClientTime(source.retrievedAt)}` : ""}</p>${source.attribution ? `<small class="source-attribution" translate="no">${esc(source.attribution)}</small>` : ""}</div><span class="confidence-${["高", "high"].includes(source.confidence) ? "high" : ["中", "medium"].includes(source.confidence) ? "medium" : "low"}">確度${esc(source.confidence === "high" ? "高" : source.confidence === "medium" ? "中" : source.confidence === "low" ? "低" : source.confidence)}</span></div>`).join("")}
      ${r.sources.some((source) => ["Hot Pepper", "ホットペッパーグルメ"].includes(source.name)) ? '<a class="hotpepper-credit" href="https://webservice.recruit.co.jp/" target="_blank" rel="noreferrer"><img src="https://webservice.recruit.co.jp/banner/hotpepper-s.gif" alt="ホットペッパーグルメ Webサービス" width="135" height="17"></a>' : ""}
      <p class="source-disclaimer">外部情報は必要なときに更新します。保存するのは場所の識別子とユーザー自身の手掛かりだけです。</p>
    </section>
    <section class="feedback-card" id="feedback-card"><div><p class="overline">結果について教えてください</p><h3>次の行動に役立ちましたか？</h3><p>入力した回答だけを送信します。元の画像や検索文は含みません。</p></div><form id="feedback-form" class="feedback-form">
      <fieldset><legend>役に立ちましたか？</legend><label><input type="radio" name="helpful" value="yes" required> はい</label><label><input type="radio" name="helpful" value="no"> いいえ</label></fieldset>
      <fieldset><legend>予約できましたか？</legend><label><input type="radio" name="bookingOutcome" value="succeeded" required> 予約できた</label><label><input type="radio" name="bookingOutcome" value="not_succeeded"> 予約できなかった</label><label><input type="radio" name="bookingOutcome" value="not_tried"> まだ試していない</label></fieldset>
      <fieldset><legend>情報は正確でしたか？</legend><label><input type="radio" name="accuracy" value="accurate" required> 正確</label><label><input type="radio" name="accuracy" value="partly_wrong"> 一部違った</label><label><input type="radio" name="accuracy" value="wrong"> 違っていた</label></fieldset>
      <fieldset><legend>このサービスへの支払いを検討しますか？（任意）</legend><label><input type="radio" name="willingnessToPay" value="consider"> 検討する</label><label><input type="radio" name="willingnessToPay" value="depends_on_price"> 価格による</label><label><input type="radio" name="willingnessToPay" value="would_not"> 検討しない</label><label><input type="radio" name="willingnessToPay" value="unsure"> わからない</label></fieldset>
      <label class="feedback-text">改善してほしい点（任意）<textarea name="feedbackText" maxlength="500" rows="3" placeholder="例：営業時間が変わっていた"></textarea></label>
      <button type="submit">回答を送信</button>
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
    button.textContent = "送信中…";
    const accepted = await postEvent("feedback_submitted", {
      helpful: values.helpful === "yes",
      bookingOutcome: values.bookingOutcome,
      accuracy: values.accuracy,
      willingnessToPay: values.willingnessToPay,
      feedbackText: values.feedbackText
    });
    if (!accepted) {
      button.disabled = false;
      button.textContent = "もう一度送信";
      showToast("送信できませんでした。接続を確認して再試行してください");
      return;
    }
    form.replaceWith(Object.assign(document.createElement("p"), { className: "feedback-thanks", textContent: "ありがとうございます。回答を受け付けました。" }));
    showToast("ご回答ありがとうございます。案内の改善に活用します");
  });
  document.querySelectorAll("[data-script-version]").forEach((button) => button.addEventListener("click", () => {
    state.phoneScriptVersion = button.dataset.scriptVersion;
    render();
  }));
  document.querySelector("[data-copy]").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(event.currentTarget.dataset.copy);
    postEvent("phone_script_copied", { actionType: state.phoneScriptVersion });
    showToast("電話用の文例をコピーしました");
  });
}

function focusResultSection() {
  const selector = state.resultFocus === "reservation" ? ".decision-grid" : ".detail-grid";
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }));
}

function reservationModeLabel(value) {
  return { phone: "電話で確認", instant: "即時予約", request: "予約リクエスト", instant_or_request: "即時予約またはリクエスト", provider_determined: "予約サービス側で確定", waitlist: "順番待ち受付", unknown: "リンク先で予約方法を確認" }[value] || "リンク先で予約方法を確認";
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
  if (option.officiality === "user_provided_external") return "入力されたリンク";
  if (option.status === "unverified_link") return "未確認";
  if (option.status === "discovery_only") return "検索のみ";
  if (kind === "online_reservation_flow") return "予約入口";
  if (kind === "provider_booking_flow") return "送信後に確定";
  if (kind === "waitlist_flow") return "順番待ち";
  if (kind === "platform_listing") return "店舗ページ";
  if (kind === "phone_confirmation") return "電話";
  if (kind === "map") return "地図";
  if (option.officiality === "restaurant_official") return "公式サイト";
  if (option.officiality === "google_listed_external") return "外部サイト";
  return "確認済み";
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
  return `<form id="plan-form" class="plan-form"><strong>${savedPlan ? "来店予定を編集" : "予定を追加して保存"}</strong><div class="plan-fields"><label>日付<input type="date" name="planDate" value="${esc(date)}"></label><label>時間<input type="time" name="planTime" value="${esc(time)}"></label><label>人数<input type="number" name="partySize" min="1" max="20" value="${esc(party)}"></label><label>状況<select name="planStatus">${PLAN_STATUSES.map((item) => `<option value="${item.value}" ${item.value === status ? "selected" : ""}>${item.label}</option>`).join("")}</select></label></div><div class="plan-actions"><button type="button" id="cancel-plan">キャンセル</button><button type="submit">${savedPlan ? "変更を保存" : "行きたいリストへ"}</button></div></form>`;
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
  showToast(existing ? "来店予定を更新しました" : "行きたいリストに保存しました");
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
    throw new Error("画像解析サービスの状態を確認できません。接続を確認して再試行してください。");
  }
  if (!capabilities.visionExtraction) {
    if (isKnownSampleScreenshot(file)) {
      await new Promise((resolve) => setTimeout(resolve, 650));
      return { extraction: sampleTikTokExtraction, mode: "sample" };
    }
    throw new Error("画像解析 API が未設定です。DASHSCOPE_API_KEY を設定するか、サンプル画像を使用してください。");
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
    throw apiResponseError(payload, visionErrorMessage(payload));
  } catch (error) {
    if (pilotAccessRejected(error)) throw error;
    if (!isKnownSampleScreenshot(file)) throw error;
  }

  if (isKnownSampleScreenshot(file)) {
    await new Promise((resolve) => setTimeout(resolve, 650));
    return { extraction: sampleTikTokExtraction, mode: "sample" };
  }
  throw new Error("画像解析 API が未設定です。DASHSCOPE_API_KEY を設定するか、サンプル画像を使用してください。");
}

function visionErrorMessage(payload = {}) {
  return {
    VISION_TIMEOUT: "画像解析がタイムアウトしました。初回は時間がかかる場合があります。もう一度お試しください。",
    VISION_RATE_LIMITED: "画像解析が混み合っています。しばらくしてからお試しください。",
    VISION_AUTH_ERROR: "画像解析サービスの認証設定を確認してください。",
    INVALID_IMAGE: "有効な PNG、JPEG、WebP 画像を選んでください。",
    INVALID_MODEL_OUTPUT: "画像は読み取れましたが、結果を安定して整理できませんでした。再試行するか店名を入力してください。"
  }[payload.code] || payload.error || "画像解析サービスを一時的に利用できません。";
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
  if (capabilities.capabilitiesUnavailable) throw new Error("店舗検索サービスの状態を確認できません。接続を確認して再試行してください。");
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
    showToast("Google Places が未設定のためデモ候補を表示します");
    render();
    return;
  }

  const response = await fetch("/api/restaurants/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...pilotAccessHeaders(state.settings) },
    body: JSON.stringify({ query, clues })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw apiResponseError(payload, "実在する店舗を検索できませんでした。");
  if (!payload.candidates?.length) throw new Error("確認できる店舗が見つかりません。店名やエリアを追加してください。");
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
    if (!response.ok) throw apiResponseError(payload, "評価を取得できませんでした。店舗の確認はそのまま続けられます。");
    state.candidatePreviews = { ...state.candidatePreviews, [placeId]: payload.preview };
    postEvent("candidate_preview_loaded", { placeId, sourceMode: state.analysisSourceMode || "live", cacheStatus: payload.cacheStatus });
  } catch (error) {
    if (recoverFromPilotAccessError(error)) return;
    showToast(error.message || "評価を取得できませんでした");
  } finally {
    state.candidatePreviewLoadingId = "";
    if (state.view === "candidates") renderCandidates();
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
    if (!response.ok) throw apiResponseError(payload, "店舗情報を確認できませんでした。");
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
    if (recoverFromPilotAccessError(error)) return;
    state.view = selection.returnView || "candidates";
    showToast(error.message || "店舗情報を確認できませんでした");
    render();
  }
}

function apiResponseError(payload = {}, fallbackMessage) {
  const error = new Error(payload.error || fallbackMessage);
  error.code = typeof payload.code === "string" ? payload.code : "";
  return error;
}

function recoverFromPilotAccessError(error) {
  if (!pilotAccessRejected(error)) return false;
  state.settings = settingsWithoutPilotAccess(state.settings);
  state.loadingMode = "";
  state.analysisError = "アクセスコードが正しくありません。管理者から案内されたコードをもう一度入力してください。";
  state.view = "home";
  syncSettings();
  render();
  requestAnimationFrame(() => document.querySelector("#pilot-access-code")?.focus());
  showToast("アクセスコードが正しくありません");
  return true;
}

function formatClientTime(value) {
  try {
    return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function businessStatusLabel(value) {
  return { OPERATIONAL: "Google Maps：営業中", CLOSED_TEMPORARILY: "Google Maps：臨時休業", CLOSED_PERMANENTLY: "Google Maps：閉業" }[value] || "Google Maps：営業状況を要確認";
}

async function shareCurrentResult() {
  const payload = buildSharePayload(state.restaurant);
  try {
    if (typeof navigator.share === "function") {
      await navigator.share(payload);
      postEvent("share_result_clicked", { actionType: "native_share" });
      showToast("共有画面を開きました");
      return;
    }
    await navigator.clipboard.writeText(payload.text);
    postEvent("share_result_clicked", { actionType: "clipboard" });
    showToast("結果をコピーしました。貼り付けて共有できます");
  } catch (error) {
    if (error?.name !== "AbortError") showToast("共有できませんでした。もう一度お試しください");
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
  return sendEvent(fetch, payload, pilotAccessHeaders(state.settings));
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
  if (/https?:\/\/(?:www\.)?(?:tiktok\.com|vm\.tiktok\.com|instagram\.com|youtube\.com|youtu\.be|threads\.net|lemon8-app\.com|lemon8\.com|line\.me|facebook\.com|fb\.watch|xiaohongshu\.com|xhslink\.com|x\.com|twitter\.com)\b/i.test(text)) return "social_link";
  if (/https?:\/\//i.test(text)) return "webpage";
  return /\s|\d|[，。,.、]/.test(text) ? "text" : "restaurant_name";
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("この画像を読み取れませんでした。"));
    reader.readAsDataURL(file);
  });
}

function renderSaved() {
  const savedPlans = sortSavedPlansByUrgency(state.saved);
  app.innerHTML = `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">← ホームへ</button>
    <div class="section-heading"><span class="step-chip">行きたいリスト</span><h2>来店予定の店舗</h2><p>予約が必要な店舗から確認して、当日の行き違いを減らします。</p></div>
    ${state.saved.length ? `<div class="saved-list">${savedPlans.map((r) => `<article><div class="saved-main"><span class="plan-status status-${esc(r.planStatus)}">${esc(planStatusLabel(r.planStatus))}</span><h3>${esc(r.name)}</h3><p>${r.planDate ? `${esc(r.planDate)}${r.planTime ? ` · ${esc(r.planTime)}` : ""} · ${esc(r.partySize)}名` : `日付未定 · ${esc(r.partySize)}名`}</p><small>最終確認：${r.lastAnalyzedAt ? formatClientTime(r.lastAnalyzedAt) : "記録なし"}</small></div><div class="saved-controls"><select data-plan-status="${esc(r.id)}" aria-label="${esc(r.name)}の状況を更新">${PLAN_STATUSES.map((item) => `<option value="${item.value}" ${item.value === r.planStatus ? "selected" : ""}>${item.label}</option>`).join("")}</select><button data-open-saved="${esc(r.id)}" aria-label="${esc(r.name)}を再確認">${icons.arrow}</button><button class="delete-plan" data-delete-saved="${esc(r.id)}" aria-label="${esc(r.name)}をリストから削除">×</button></div></article>`).join("")}</div>` : `<div class="empty-state"><span>た</span><h3>まだ保存した店舗はありません</h3><p>店舗を確認して保存すると、ここに表示されます。</p><button class="primary-button" data-action="home">店舗を確認する ${icons.arrow}</button></div>`}
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
    showToast("状況を更新しました");
  }));
  document.querySelectorAll("[data-delete-saved]").forEach((button) => button.addEventListener("click", () => {
    state.saved = state.saved.filter((item) => item.id !== button.dataset.deleteSaved);
    postEvent("removed_from_list", { analysisRunId: null });
    showToast("リストから削除しました");
    renderSaved();
    syncSaved();
  }));
}

function renderHistory() {
  app.innerHTML = `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">← ホームへ</button>
    <div class="section-heading"><span class="step-chip">最近の確認</span><h2>前回の続きを確認</h2><p>この端末に最大10件保存します。実在店舗は Place ID、入力した手掛かり、予定だけを保存し、開くたびに外部情報を更新します。</p></div>
    ${state.recent.length ? `<div class="saved-list">${state.recent.map((item) => `<article><div class="saved-main"><span class="plan-status">${item.sourceMode === "live" ? "最新情報を取得" : "デモ"}</span><h3>${esc(item.name)}</h3><p>${esc(item.area || "エリアを要確認")}${item.planDate ? ` · ${esc(item.planDate)}${item.planTime ? ` ${esc(item.planTime)}` : ""} · ${esc(item.partySize)}名` : ""}</p><small>確認日時：${formatClientTime(item.analyzedAt)}</small></div><div class="saved-controls history-controls"><button data-open-recent="${esc(item.id)}" aria-label="${esc(item.name)}をもう一度開く">${icons.arrow}</button><button class="delete-plan" data-delete-recent="${esc(item.id)}" aria-label="${esc(item.name)}の履歴を削除">×</button></div></article>`).join("")}</div>` : `<div class="empty-state"><span>た</span><h3>まだ確認履歴はありません</h3><p>確認を終えた店舗がここに表示されます。</p><button class="primary-button" data-action="home">店舗を確認する ${icons.arrow}</button></div>`}
  </section>`;
  document.querySelectorAll("[data-open-recent]").forEach((button) => button.addEventListener("click", () => openRecentAnalysis(button.dataset.openRecent)));
  document.querySelectorAll("[data-delete-recent]").forEach((button) => button.addEventListener("click", () => {
    state.recent = state.recent.filter((item) => item.id !== button.dataset.deleteRecent);
    syncRecent();
    showToast("履歴を削除しました");
    renderHistory();
  }));
}

function renderQueue() {
  app.innerHTML = `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">← ホームへ</button>
    <div class="section-heading"><span class="step-chip">確認待ち</span><h2>店舗を1件ずつ確認</h2><p>複数店舗の画像や行きたい店リストから残した手掛かりです。確認を終えた店舗は自動的にここから外れます。</p></div>
    <section class="panel batch-queue-panel"><p class="overline">まとめて準備</p><h3>複数の店舗を一度に追加</h3><p>1行に1店舗。「店名｜支店｜エリアまたは住所」でも入力できます。ここでは端末内のリストだけを作り、店舗を開いたときに初めて API を呼び出します。</p><form id="batch-queue-form"><textarea name="restaurants" rows="6" maxlength="10000" placeholder="一蘭 渋谷店&#10;AFURI｜原宿｜東京都渋谷区千駄ヶ谷3-63-1&#10;すし大｜本館｜築地"></textarea><div><small>最大30件。重複する手掛かりは自動でまとめます。</small><button type="submit">確認待ちに追加</button></div></form></section>
    ${state.pending.length ? `<div class="saved-list queue-list">${state.pending.map((item) => `<article><div class="saved-main"><span class="plan-status">${esc(platformLabel(item.sourcePlatform))}</span><h3>${esc(item.clues.name)}</h3><p>${esc([item.clues.branch, item.clues.area || item.clues.address].filter(Boolean).join(" · ") || "場所を要確認")}</p><small>追加日時：${formatClientTime(item.addedAt)}</small></div><div class="saved-controls history-controls"><button data-open-pending="${esc(item.id)}" aria-label="${esc(item.clues.name)}を確認">${icons.arrow}</button><button class="delete-plan" data-delete-pending="${esc(item.id)}" aria-label="${esc(item.clues.name)}の手掛かりを削除">×</button></div></article>`).join("")}</div>` : `<div class="empty-state"><span>✓</span><h3>確認待ちの店舗はありません</h3><p>1枚の画像に複数の店舗がある場合、残りの店舗をここに保存して順番に確認できます。</p><button class="primary-button" data-action="home">画像を追加する ${icons.arrow}</button></div>`}
  </section>`;
  document.querySelector("#batch-queue-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const parsed = parseBatchRestaurantLines(new FormData(event.currentTarget).get("restaurants"));
    if (!parsed.restaurants.length) {
      showToast("店舗を1件以上入力してください");
      return;
    }
    const before = state.pending.length;
    state.pending = addPendingRestaurants(state.pending, parsed.restaurants, { sourcePlatform: "unknown" });
    const added = state.pending.length - before;
    syncPending();
    postEvent("pending_queue_added", { queueCount: state.pending.length, analysisRunId: null });
    renderQueue();
    showToast(parsed.truncated ? `先頭30行を読み取り、${added}件追加しました` : added ? `${added}件を確認待ちに追加しました` : "すでに追加済みか、確認待ちリストが上限です");
  });
  document.querySelectorAll("[data-open-pending]").forEach((button) => button.addEventListener("click", () => openPendingAnalysis(button.dataset.openPending)));
  document.querySelectorAll("[data-delete-pending]").forEach((button) => button.addEventListener("click", () => {
    state.pending = removePendingAnalysis(state.pending, button.dataset.deletePending);
    syncPending();
    postEvent("pending_queue_removed", { queueCount: state.pending.length, analysisRunId: null });
    renderQueue();
    showToast("確認待ちの手掛かりを削除しました");
  }));
}

async function openPendingAnalysis(id) {
  const item = state.pending.find((entry) => entry.id === id);
  if (!item) return;
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable) {
    showToast("解析サービスの状態を確認できません。接続を確認して再試行してください");
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
  const publicInfo = state.capabilities?.publicInfo || {};
  const operator = publicInfo.operatorName || "正式公開前に掲載します";
  const contact = publicInfo.contactEmail || "正式公開前に掲載します";
  const local = summarizeLocalData(state.saved, state.recent, state.pending);
  app.innerHTML = `<section class="content-view narrow privacy-view">
    <button class="back-button" data-action="home">← ホームへ</button>
    <div class="section-heading"><span class="step-chip">プライバシーとデータ</span><h1>この端末のデータを管理できます</h1><p>更新日：${esc(TERMS_EFFECTIVE_DATE)} · 招待制テストが扱うデータと、削除できる範囲を説明します。</p></div>
    <div class="privacy-summary"><article><span>${local.savedPlanCount}</span><strong>保存した予定</strong><p>このブラウザだけに保存。</p></article><article><span>${local.pendingAnalysisCount}</span><strong>確認待ちの店舗</strong><p>画像から得た店舗の手掛かりだけを保存。</p></article><article><span>${local.recentAnalysisCount}</span><strong>最近の確認</strong><p>必要最小限の履歴を最大10件保存。</p></article><article><span>0</span><strong>サーバーに保存する画像</strong><p>リクエスト内で処理し、本サービスのディスクには保存しません。</p></article></div>
    <section class="panel privacy-section"><p class="overline">運営者と連絡先</p><h2>${esc(operator)}</h2><p>${publicInfo.contactEmail ? `<a href="mailto:${esc(contact)}">${esc(contact)}</a>` : esc(contact)}</p></section>
    <section class="panel privacy-section"><p class="overline">この端末に保存</p><h2>行きたいリスト、確認待ち、履歴、設定</h2><ul>${local.fields.map((field) => `<li>${esc(field)}</li>`).join("")}${(local.sessionFields || []).map((field) => `<li>${esc(field)}</li>`).join("")}</ul><p>オフラインでも画面を開けるよう、HTML、フロントエンドモジュール、スタイル、アイコンをブラウザにキャッシュする場合があります。API 応答、店舗結果、外部ページはキャッシュしません。確認待ちリストに元画像、反応数、投稿本文は保存しません。共有されたタイトル・文章・リンクは現在の画面にだけ入力し、アドレス欄からすぐ削除します。「確認をはじめる」を押すまで送信しません。実在店舗の Google Maps 住所・評価・営業時間、ホットペッパーグルメ詳細、入力された予約 URL は長期保存せず、再表示時に Place ID から更新します。</p></section>
    <section class="panel privacy-section"><p class="overline">リクエスト時に外部へ送信</p><h2>画像解析と店舗確認</h2><div class="data-flow-list"><p><strong>Qwen / OpenAI fallback</strong><span>画像を追加した場合だけ受け取ります。本サービスは画像をサーバーファイルへ保存しません。提供会社側の処理とログ期間は各社の規約に従います。</span></p><p><strong>Google Places</strong><span>店舗の検索語と、店舗確認または評価表示時の Place ID を受け取り、候補・住所・電話・評価・営業時間を返します。端末の位置情報は要求しません。</span></p><p><strong>ホットペッパーグルメ</strong><span>確認した店舗の店名・住所・電話を受け取り、店舗ページを照合します。</span></p><p><strong>店舗の公式サイト</strong><span>店舗確認後、検証済み公式サイトの公開 HTML をサーバーが取得し、予約入口、公式 Instagram、明示された予約ルールを探す場合があります。Instagram の投稿本文は自動取得しません。</span></p></div></section>
    <section class="panel privacy-section"><p class="overline">サービス運用記録</p><h2>匿名イベント、回答、技術指標</h2><p>入力の種類、候補確認、評価表示、行動ボタン、保存状況、API の成功状態、店舗確認から結果表示までの時間、token 使用量を記録します。表示した評価点そのものは記録しません。回答を送信した場合は、役立ち度、予約結果、正確性、最大500文字の改善コメントも記録します。画像、元の検索文、具体的な来店日、API Key は記録しません。現在はアカウントがないため、端末データの削除から集計済み運用記録を特定・削除することはできません。</p></section>
    <section class="danger-zone"><div><p class="overline">この端末のデータを削除</p><h2>予定、確認待ち、履歴、設定を消去</h2><p>行きたい予定 ${local.savedPlanCount} 件、確認待ち ${local.pendingAnalysisCount} 件、最近の確認 ${local.recentAnalysisCount} 件、予約名などの端末設定を削除します。Google、ホットペッパーグルメ、Qwen、OpenAI、予約サービス側のデータには影響しません。</p></div>${state.deleteConfirmOpen ? `<div class="delete-confirm"><strong>この端末のデータをすべて完全に削除しますか？</strong><button id="cancel-delete">キャンセル</button><button id="confirm-delete">すべて削除</button></div>` : '<button id="start-delete" class="danger-button">この端末のデータを削除</button>'}</section>
  </section>`;
  document.querySelector("#start-delete")?.addEventListener("click", () => { state.deleteConfirmOpen = true; renderPrivacy(); });
  document.querySelector("#cancel-delete")?.addEventListener("click", () => { state.deleteConfirmOpen = false; renderPrivacy(); });
  document.querySelector("#confirm-delete")?.addEventListener("click", () => {
    deleteLocalData(localStorage, sessionStorage);
    state.saved = [];
    state.recent = [];
    state.pending = [];
    state.activePendingId = null;
    state.settings = { ...DEFAULT_SETTINGS };
    state.phoneScriptVersion = state.settings.defaultPhoneScript;
    state.deleteConfirmOpen = false;
    document.querySelector("#saved-count").textContent = "0";
    postEvent("local_data_deleted", { analysisRunId: null });
    showToast("この端末の予定、確認待ち、履歴、設定を削除しました");
    renderPrivacy();
  });
}

function renderPilot() {
  const publicInfo = state.capabilities?.publicInfo || {};
  const contact = publicInfo.contactEmail || "";
  const subject = encodeURIComponent("TabiTabi クローズドテスト参加希望");
  const body = encodeURIComponent("TabiTabi クローズドテストへの参加を希望します。\n\n普段使うSNS：\n端末：iPhone / Android\n");
  const mailto = contact ? `mailto:${encodeURIComponent(contact)}?subject=${subject}&body=${body}` : "";
  app.innerHTML = `<section class="content-view narrow pilot-view">
    <button class="back-button" data-action="home">← ホームへ</button>
    <div class="pilot-hero">
      <span class="step-chip">クローズドテスト参加者募集</span>
      <h1>SNSで見つけた店を、<br>行ける情報に。</h1>
      <p>日本国内にお住まいで、InstagramやTikTokなどから飲食店を探す方に、15〜20分の試作テストをお願いしています。</p>
    </div>
    <section class="pilot-criteria" aria-label="参加条件">
      <article><span>01</span><strong>18歳以上・日本国内在住</strong><p>普段使っているiPhoneまたはAndroidから参加できます。</p></article>
      <article><span>02</span><strong>自分の本当の店探しで試す</strong><p>公開SNSのスクリーンショットや、覚えている店名を使います。</p></article>
      <article><span>03</span><strong>予約や購入は不要</strong><p>店舗と次の行動を確認し、結果ページから感想を送るところまでです。</p></article>
    </section>
    <section class="panel pilot-task">
      <p class="overline">お願いすること</p>
      <h2>2〜4件の飲食店を確認</h2>
      <ol><li>Instagram・TikTokなどの公開投稿スクリーンショット、または店名を入力</li><li>抽出された店名と支店を確認し、正しい店舗を選択</li><li>公式サイト、電話、予約サービスなどの案内を確認</li><li>結果ページで「役に立ったか」「情報が正確か」を回答</li></ol>
    </section>
    <aside class="pilot-safety"><strong>安全とプライバシー</strong><p>予約の確定、支払い、電話は必要ありません。DM、通知、非公開投稿、他人の個人情報を含む画像は使用しないでください。画像は解析リクエスト内で処理し、TabiTabiのサーバーディスクには保存しません。</p></aside>
    <section class="panel pilot-join">
      <div><p class="overline">参加方法</p><h2>連絡後、招待コードをお送りします</h2><p>参加条件と注意事項を確認したうえで、テスト用アクセスコードをご案内します。コードを公開投稿へ転載しないでください。</p></div>
      <div class="pilot-actions">${mailto ? `<a class="primary-button" href="${esc(mailto)}">メールで参加を相談する ${icons.arrow}</a>` : `<p class="inline-error">連絡先を準備中です。しばらくしてからもう一度ご確認ください。</p>`}<a class="secondary-button" href="/" data-action="home">招待コードをお持ちの方</a></div>
    </section>
    <p class="terms-footer-note">参加前に<a href="/privacy" data-action="privacy">プライバシーとデータ</a>と<a href="/terms" data-action="terms">利用条件</a>をご確認ください。テスト謝礼の有無や条件は、個別の募集案内で事前にお伝えします。</p>
  </section>`;
}

function renderSettings() {
  const capabilities = state.capabilities || {};
  const budget = capabilities.dailyBudget || {};
  const capabilitiesUnavailable = Boolean(capabilities.capabilitiesUnavailable);
  const providerStopped = Boolean(capabilities.emergencyStop || capabilities.providerCircuit?.open);
  const providerStopUntil = capabilities.providerCircuit?.openUntil ? new Date(capabilities.providerCircuit.openUntil).toLocaleString("ja-JP") : "管理者が再開するまで";
  const degradedProviders = Array.isArray(capabilities.providerCircuit?.degradedProviders) ? capabilities.providerCircuit.degradedProviders.map((item) => item.provider).join("、") : "";
  const providerStopMessage = capabilities.emergencyStop ? "すべての外部 API を管理者が緊急停止しています。" : `${degradedProviders || "一部の外部 API"} を自動停止しています。ほかの機能は引き続き利用できます。`;
  const providers = [
    { label: "スクリーンショット解析", ready: Boolean(capabilities.visionExtraction), detail: capabilities.models?.map((item) => `${item.provider}: ${item.model}`).join(" → ") || "未設定" },
    { label: "画像解析の予備モデル", ready: Boolean(capabilities.fallbackAvailable), detail: capabilities.fallbackAvailable ? "主モデルの失敗・無効な出力・低確度時に自動使用" : "現在は画像モデルが1つです。確度が低い場合は手動確認が必要です" },
    { label: "Google Places", ready: Boolean(capabilities.placesSearch), detail: capabilities.placesSearch ? "実在する候補と店舗情報を取得できます" : "デモ候補を使用" },
    { label: "ホットペッパーグルメ", ready: Boolean(capabilities.hotPepper), detail: capabilities.hotPepper ? "店舗情報の補足を利用できます" : "任意の補足情報は未設定" },
    { label: "公開ページの手掛かり", ready: Boolean(capabilities.webpageExtraction), detail: capabilities.webpageExtraction ? "制限付き HTML 取得を利用できます" : "未設定" }
  ];
  app.innerHTML = `<section class="content-view narrow settings-view">
    <button class="back-button" data-action="home">← ホームへ</button>
    <div class="section-heading"><span class="step-chip">設定</span><h2>この端末の設定</h2><p>通常の設定値は現在のブラウザに保存します。招待アクセスコードだけは現在のタブ内に一時保持し、保護されたリクエストの認証ヘッダーとして本サービスへ送信します。</p></div>
    <section class="panel"><p class="overline">来店時の既定値</p><h2>毎回の入力を減らす</h2><form id="settings-form" class="settings-form">
      <label>既定の人数<input type="number" name="defaultPartySize" min="1" max="20" value="${esc(state.settings.defaultPartySize)}"></label>
      <label>電話予約で使う名前（任意）<input type="text" name="reservationName" maxlength="60" autocomplete="name" value="${esc(state.settings.reservationName)}" placeholder="例：山田"><small>このブラウザだけに保存し、電話用の文例に使います。解析 API には送りません。</small></label>
      <label>既定の電話文例<select name="defaultPhoneScript"><option value="standard" ${state.settings.defaultPhoneScript === "standard" ? "selected" : ""}>標準</option><option value="short" ${state.settings.defaultPhoneScript === "short" ? "selected" : ""}>短め</option><option value="easy" ${state.settings.defaultPhoneScript === "easy" ? "selected" : ""}>やさしい日本語</option></select></label>
      <label>招待アクセスコード${capabilities.pilotAccessRequired ? "（必須）" : "（任意）"}<input type="password" name="pilotAccessCode" maxlength="256" autocomplete="off" value="${esc(state.settings.pilotAccessCode)}" placeholder="管理者から案内されたコード"><small>${capabilities.pilotAccessRequired ? "このタブを閉じるまでだけ保持し、保護されたリクエストに送信します。" : "現在は不要です。入力してもこのタブを閉じると消去されます。"}</small></label>
      ${state.settings.pilotAccessCode ? '<button type="button" class="text-button clear-access-code" id="clear-access-code">招待アクセスコードを消去</button>' : ""}
      <label class="settings-toggle"><input type="checkbox" name="saveRecentAnalyses" ${state.settings.saveRecentAnalyses ? "checked" : ""}><span><strong>最近の確認を保存</strong><small>最大10件。実在店舗は Place ID、入力した手掛かり、予定だけを保存します。</small></span></label>
      <button type="submit" class="primary-button">この端末に保存</button>
    </form></section>
    ${providerStopped ? `<aside class="inline-error"><strong>外部 API を安全停止しています</strong><span>${esc(providerStopMessage)} 再開予定：${esc(providerStopUntil)}</span></aside>` : ""}
    <section class="panel capability-panel"><div class="panel-heading"><div><p class="overline">現在利用できる機能</p><h2>API と情報源の状態</h2></div><button type="button" class="text-button" id="refresh-capabilities">状態を更新</button></div>${capabilitiesUnavailable ? '<aside class="inline-error"><strong>サービス状態を取得できません</strong><span>不明な状態を「未設定」とは表示しません。接続後に更新してください。</span></aside>' : `<div class="capability-grid">${providers.map((item) => `<article class="${item.ready ? "ready" : "pending"}"><span>${item.ready ? "利用可能" : "未設定"}</span><strong>${esc(item.label)}</strong><p>${esc(item.detail)}</p></article>`).join("")}</div>`}<p class="source-disclaimer">API Key は表示・返却しません。</p></section>
    ${renderDailyBudget(budget)}
  </section>`;
  document.querySelector("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings = settingsFromForm(Object.fromEntries(new FormData(event.currentTarget)));
    state.phoneScriptVersion = state.settings.defaultPhoneScript;
    syncSettings();
    showToast("設定を保存しました");
    renderSettings();
  });
  document.querySelector("#clear-access-code")?.addEventListener("click", () => {
    state.settings = { ...state.settings, pilotAccessCode: "" };
    syncSettings();
    showToast("招待アクセスコードを消去しました");
    renderSettings();
  });
  document.querySelector("#refresh-capabilities")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const latest = await getCapabilities({ force: true });
    showToast(latest.capabilitiesUnavailable ? "サービス状態を取得できません" : "サービス状態を更新しました");
    renderSettings();
  });
}

function renderDailyBudget(budget = {}) {
  const labels = { vision_requests: "画像解析の総受付枠", vision_qwen_attempts: "Qwen 実呼び出し", vision_openai_fallback_attempts: "OpenAI 予備呼び出し", places_search: "店舗候補の検索", places_details: "店舗情報の取得" };
  const rows = Object.entries(budget.buckets || {}).map(([key, item]) => {
    const limit = Number(item?.limit) || 0;
    const used = Number(item?.used) || 0;
    const remaining = Math.max(Number(item?.remaining) || 0, 0);
    return `<article><div><strong>${esc(labels[key] || key)}</strong><span>本日 ${esc(used)} / ${esc(limit)} 回使用 · 残り ${esc(remaining)} 回</span></div><progress value="${esc(used)}" max="${esc(limit || 1)}"></progress></article>`;
  }).join("");
  if (!rows) return "";
  return `<section class="panel budget-panel"><p class="overline">利用上限</p><h2>本日の API 利用枠</h2><p>日本時間 ${esc(budget.date || "本日")} の集計です。新しい画像解析は総受付枠と実際に使ったモデルの両方に数えられるため、各行を合計しないでください。キャッシュ利用は加算しません。上限に達した機能は翌日まで新規呼び出しを停止します。</p><div class="budget-grid">${rows}</div></section>`;
}

function renderTerms() {
  const publicInfo = state.capabilities?.publicInfo || {};
  app.innerHTML = `<section class="content-view narrow terms-view">
    <button class="back-button" data-action="home">← ホームへ</button>
    <div class="section-heading"><span class="step-chip">利用条件</span><h1>サービスの範囲と責任</h1><p>適用日：${esc(TERMS_EFFECTIVE_DATE)} · 現在の TabiTabi 招待制テストに適用されます。</p></div>
    <aside class="terms-highlight"><strong>最も大切なこと</strong><p>TabiTabi が示すのは次の行動であり、予約の確定ではありません。店舗や予約サービスの最終画面、電話回答、確認メールをご確認ください。</p></aside>
    <div class="terms-list">${TERMS_SECTIONS.map((section, index) => `<section class="panel terms-section"><span>${String(index + 1).padStart(2, "0")}</span><div><h3>${esc(section.title)}</h3>${section.paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}</div></section>`).join("")}</div>
    <p class="terms-footer-note">運営者：${esc(publicInfo.operatorName || "正式公開前に掲載します")} · お問い合わせ：${publicInfo.contactEmail ? `<a href="mailto:${esc(publicInfo.contactEmail)}">${esc(publicInfo.contactEmail)}</a>` : "正式公開前に掲載します"}</p>
    <p class="terms-footer-note">利用を続けることで、上記の範囲をご理解いただいたものとします。データの取り扱いは<a href="/privacy" data-action="privacy">プライバシーとデータ</a>をご覧ください。</p>
  </section>`;
}

document.addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]")?.dataset.action;
  if (!action) return;
  event.preventDefault();
  if (action === "home") state.view = "home";
  if (action === "saved") state.view = "saved";
  if (action === "history") state.view = "history";
  if (action === "queue") state.view = "queue";
  if (action === "pilot") state.view = "pilot";
  if (action === "privacy") state.view = "privacy";
  if (action === "terms") state.view = "terms";
  if (action === "settings") state.view = "settings";
  if (action === "home") state.activePendingId = null;
  const nextPath = pathnameForView(state.view);
  if (window.location.pathname !== nextPath) history.pushState(null, "", nextPath);
  render();
  if (action === "settings") getCapabilities({ force: true }).then(() => { if (state.view === "settings") renderSettings(); });
});

window.addEventListener("popstate", () => {
  state.view = viewFromPathname(window.location.pathname);
  render();
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
