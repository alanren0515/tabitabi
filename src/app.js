import { confidenceLabel, recommendationLabel } from "./analyzer.js";
import { buildRestaurantQuery, extractionReviewState, formatBudget, isKnownSampleScreenshot, mergeScreenshotSupplemental, normalizeExtraction, sampleTikTokExtraction, selectExtractedRestaurant } from "./screenshot-extraction.js";
import { createSavedPlan, normalizeSavedPlans, PLAN_STATUSES, sortSavedPlansByUrgency, updateSavedPlan } from "./saved-plans.js";
import { deleteLocalData, LOCAL_STORAGE_KEY, summarizeLocalData, VISIT_STORAGE_KEY } from "./privacy-data.js";
import { candidateDecision, candidateDecisionCopy, rejectCandidate, restoreCandidates, visibleCandidates } from "./candidate-selection.js";
import { PUBLIC_TERMS_SECTIONS, TERMS_EFFECTIVE_DATE, TERMS_SECTIONS } from "./terms-data.js";
import { addRecentAnalysis, createRecentAnalysis, normalizeRecentAnalyses, RECENT_STORAGE_KEY } from "./recent-analyses.js";
import { buildSharePayload } from "./share-result.js";
import { DEFAULT_SETTINGS, loadSettingsFromStorage, normalizeSettings, persistentSettings, pilotAccessHeaders, pilotAccessLocked, pilotAccessRejected, savePilotAccessForSession, settingsFromForm, settingsWithoutPilotAccess, SETTINGS_STORAGE_KEY } from "./settings.js";
import { addPendingRestaurants, normalizePendingAnalyses, parseBatchRestaurantLines, pendingAnalysisToTextExtraction, PENDING_STORAGE_KEY, removePendingAnalysis, restaurantClueKey } from "./analysis-queue.js";
import { parseShareTarget, urlWithoutShareTarget } from "./shared-input.js";
import { createCapabilitiesLoader } from "./capabilities.js";
import { clipboardScreenshotFile, optimizeScreenshotFile, SCREENSHOT_ACCEPT, validateScreenshotFile } from "./image-input.js";
import { sendEvent } from "./event-client.js";
import { pathnameForView, viewFromPathname } from "./client-routes.js";
import { SUPPORTED_LOCALES, localeNumberFormat, translate } from "./i18n.js";
import { localizedLegalContent } from "./legal-content.js";
import { createExampleCandidates, isExampleRestaurant } from "./example-experience.js";

const app = document.querySelector("#app");
const toast = document.querySelector("#toast");
const routeStatus = document.querySelector("#route-status");
const loadCapabilities = createCapabilitiesLoader();
const AUDIT_SESSION_KEY = "tabitabi-audit-session-v1";
const DEFAULT_PUBLIC_OPERATOR_NAME = "Ren";
const DEFAULT_PUBLIC_CONTACT_EMAIL = "rgq.alan515@gmail.com";
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
  uploadOptimization: null,
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
  analysisInputType: "",
  exampleInput: false,
  searchRecovery: null,
  homeRecoveryNotice: "",
  rejectedCandidateIds: [],
  confirmedCandidate: null,
  resultFocus: "",
  restaurant: null,
  planEditorOpen: false,
  deleteConfirmOpen: false,
  saved: normalizeSavedPlans(JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY) || "[]")),
  recent: normalizeRecentAnalyses(JSON.parse(localStorage.getItem(RECENT_STORAGE_KEY) || "[]")),
  pending: normalizePendingAnalyses(JSON.parse(localStorage.getItem(PENDING_STORAGE_KEY) || "[]")),
  activePendingId: null,
  settings: initialSettings
};

let lastRenderedView = "";
let lastRenderedLocale = "";
let uploadOptimizationJob = 0;
let uploadOptimizationController = null;

const VIEW_LABEL_KEYS = {
  home: "route.home",
  extraction: "route.extraction",
  text_extraction: "route.textExtraction",
  link_guidance: "route.linkGuidance",
  candidates: "route.candidates",
  loading: "route.loading",
  result: "route.result",
  saved: "route.saved",
  history: "route.history",
  queue: "route.queue",
  pilot: "route.pilot",
  privacy: "route.privacy",
  terms: "route.terms",
  settings: "route.settings",
  search_recovery: "route.searchRecovery"
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

function t(key, variables = {}) {
  return translate(state.settings.locale, key, variables);
}

function currentLocale() {
  return state.settings.locale || "ja";
}

function currentPublicInfo() {
  const publicInfo = state.capabilities?.publicInfo || {};
  return {
    operatorName: publicInfo.operatorName || DEFAULT_PUBLIC_OPERATOR_NAME,
    contactEmail: publicInfo.contactEmail || DEFAULT_PUBLIC_CONTACT_EMAIL
  };
}

function isPublicRelease() {
  return state.capabilities?.publicReleaseMode === true;
}

function currentLegalContent() {
  return localizedLegalContent(currentLocale(), { publicRelease: isPublicRelease() });
}

function resultInputSourceLabel(restaurant = state.restaurant) {
  if (isExampleRestaurant(restaurant)) return t("result.inputSourceExample");
  return t({
    screenshot: "result.inputSourceScreenshot",
    webpage: "result.inputSourceWebpage",
    social_link: "result.inputSourceLink",
    text: "result.inputSourceText",
    restaurant_name: "result.inputSourceText"
  }[state.analysisInputType] || "result.inputSourceGeneric");
}

function localizedPlanStatus(value) {
  return t({
    needs_reservation: "plan.needsReservation",
    reserved: "plan.reserved",
    walk_in: "plan.walkIn",
    information_needed: "plan.infoNeeded",
    not_recommended: "plan.skip"
  }[value] || "plan.infoNeeded");
}

function syncShellLanguage() {
  const locale = currentLocale();
  document.documentElement.lang = locale;
  document.querySelector('meta[name="description"]')?.setAttribute("content", t("meta.description"));
  document.querySelector(".brand")?.setAttribute("aria-label", t("shell.home"));
  const languageSelect = document.querySelector("#language-select");
  if (languageSelect) {
    languageSelect.value = locale;
    languageSelect.setAttribute("aria-label", t("shell.language"));
    languageSelect.closest("label")?.querySelector("span")?.replaceChildren(t("shell.language"));
  }
  const historyButton = document.querySelector('[data-action="history"]');
  const savedButton = document.querySelector('[data-action="saved"]');
  historyButton?.querySelector(".saved-label")?.replaceChildren(t("shell.history"));
  savedButton?.querySelector(".saved-label")?.replaceChildren(t("shell.saved"));
  document.querySelector(".top-actions")?.setAttribute("aria-label", `${t("shell.history")} / ${t("shell.saved")}`);
  const footer = document.querySelector("footer");
  if (footer) {
    footer.children[1]?.replaceChildren(t("shell.promise"));
    const labels = {
      queue: t("shell.queue"), settings: t("shell.settings"), pilot: isPublicRelease() ? ({ ja: "公開ベータについて", en: "About this beta", "zh-CN": "关于公开测试" }[locale] || t("shell.pilot")) : t("shell.pilot"),
      privacy: t("shell.privacy"), terms: t("shell.terms")
    };
    for (const [action, label] of Object.entries(labels)) {
      const element = footer.querySelector(`[data-action="${action}"]`);
      if (!element) continue;
      if (action === "queue") element.firstChild.textContent = `${label} `;
      else element.textContent = label;
    }
  }
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2200);
}

function syncSaved() {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state.saved));
  document.querySelector("#saved-count").textContent = state.saved.length;
  document.querySelector('[data-action="saved"]')?.setAttribute("aria-label", t("shell.count", { label: t("route.saved"), count: state.saved.length }));
}

function syncRecent() {
  localStorage.setItem(RECENT_STORAGE_KEY, JSON.stringify(state.recent));
  const count = document.querySelector("#history-count");
  if (count) count.textContent = state.recent.length;
  document.querySelector('[data-action="history"]')?.setAttribute("aria-label", t("shell.count", { label: t("route.history"), count: state.recent.length }));
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
  const localeChanged = currentLocale() !== lastRenderedLocale;
  if (state.view !== "loading") app.removeAttribute("aria-busy");
  if (state.view === "home") renderHome();
  if (state.view === "extraction") renderExtraction();
  if (state.view === "text_extraction") renderTextExtraction();
  if (state.view === "link_guidance") renderLinkGuidance();
  if (state.view === "candidates") renderCandidates();
  if (state.view === "loading") renderLoading();
  if (state.view === "result") renderResult();
  if (state.view === "saved") renderSaved();
  if (state.view === "history") renderHistory();
  if (state.view === "queue") renderQueue();
  if (state.view === "pilot") renderPilot();
  if (state.view === "privacy") renderPrivacy();
  if (state.view === "terms") renderTerms();
  if (state.view === "settings") renderSettings();
  if (state.view === "search_recovery") renderSearchRecovery();
  syncShellLanguage();
  syncSaved();
  syncRecent();
  syncSettings();
  syncPending();
  document.title = state.view === "pilot" ? (isPublicRelease() ? ({ ja: "公開ベータについて | TabiTabi", en: "About the public beta | TabiTabi", "zh-CN": "关于公开测试 | TabiTabi" }[currentLocale()] || t("meta.pilotTitle")) : t("meta.pilotTitle")) : state.view === "privacy" ? t("meta.privacyTitle") : state.view === "terms" ? t("meta.termsTitle") : t("meta.title");
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  if (viewChanged || localeChanged) {
    const viewLabel = state.view === "pilot" && isPublicRelease()
      ? ({ ja: "公開ベータについて", en: "About the public beta", "zh-CN": "关于公开测试" }[currentLocale()] || t("route.pilot"))
      : VIEW_LABEL_KEYS[state.view] ? t(VIEW_LABEL_KEYS[state.view]) : t("route.new");
    routeStatus.textContent = t("route.opened", { label: viewLabel });
    if (viewChanged && lastRenderedView) requestAnimationFrame(() => app.focus({ preventScroll: true }));
    lastRenderedView = state.view;
    lastRenderedLocale = currentLocale();
  }
}

function renderHome() {
  const offline = navigator.onLine === false;
  const accessLocked = pilotAccessLocked(state.capabilities, state.settings);
  const uploadBlocked = ["optimizing", "failed"].includes(state.uploadOptimization?.status);
  app.innerHTML = `
    <section class="hero">
      <div class="hero-intro">
        <div class="eyebrow">${t("home.eyebrow")}</div>
        <h1>${t("home.title")}</h1>
        <p class="hero-copy">${t("home.copy")}</p>
        <div class="hero-route" aria-hidden="true"><span>SNS</span><i></i><span>${t("home.routeIdentify")}</span><i></i><span>${t("home.routeAct")}</span></div>
      </div>
      <div class="hero-workbench">
      ${state.sharedInputPending ? `<aside class="shared-input-banner"><strong>${t("home.sharedTitle")}</strong><span>${t("home.sharedBody")}</span></aside>` : ""}
      ${offline ? `<aside class="offline-banner"><strong>${t("home.offlineTitle")}</strong><span>${t("home.offlineBody")}</span></aside>` : ""}
      ${accessLocked ? `<form id="pilot-access-form" class="pilot-access-card" aria-labelledby="pilot-access-title">
        <div class="pilot-access-copy"><span>${t("home.accessEyebrow")}</span><strong id="pilot-access-title">${t("home.accessTitle")}</strong><p id="pilot-access-help">${t("home.accessHelp")}</p></div>
        <label for="pilot-access-code">${t("home.accessLabel")}</label>
        <div class="pilot-access-controls"><input id="pilot-access-code" name="pilotAccessCode" type="password" maxlength="256" autocomplete="off" required aria-describedby="pilot-access-help" placeholder="${t("home.accessPlaceholder")}"><button type="submit">${t("home.accessSubmit")}</button></div>
      </form>` : ""}
      ${state.homeRecoveryNotice ? `<aside class="recovery-banner" role="status"><strong>${t("home.noMatchTitle")}</strong><span>${esc(state.homeRecoveryNotice)}</span><small>${t("home.noMatchHelp")}</small></aside>` : ""}
      <form id="analyze-form" class="input-card">
        <div class="input-intro"><strong>${t("home.clueLabel")}</strong><span>${t("home.methodHelp")}</span></div>
        <div class="input-method-grid">
          <label class="input-method-card text-method" for="clue">
            <span class="input-method-heading"><b aria-hidden="true">Aa</b><span><strong>${t("home.textMethod")}</strong><small>${t("home.textMethodHint")}</small></span></span>
            <textarea id="clue" name="clue" rows="4" placeholder="${t("home.cluePlaceholder")}" ${state.analysisError ? 'aria-invalid="true" aria-describedby="analysis-error"' : ""}>${esc(state.input)}</textarea>
          </label>
          <section class="input-method-card image-method" aria-labelledby="image-method-title">
            <div class="input-method-heading"><b aria-hidden="true">▧</b><span><strong id="image-method-title">${t("home.imageMethod")}</strong><small>${t("home.imageMethodHint")}</small></span></div>
            <button type="button" class="upload-button" id="upload-trigger" ${state.uploadOptimization?.status === "optimizing" ? "disabled" : ""}>${icons.upload}<span>${state.uploadOptimization?.status === "optimizing" ? t("home.preparingScreenshot") : state.uploadName ? t("home.replaceScreenshot") : t("home.addScreenshot")}</span></button>
            <input type="file" id="screenshot" hidden accept="${SCREENSHOT_ACCEPT}" />
            ${state.uploadPreviewUrl ? `<div class="upload-preview"><img src="${state.uploadPreviewUrl}" alt="${t("home.previewAlt")}"><div><strong>${esc(state.uploadName)}</strong><span>${t("home.previewTitle")}</span></div></div>` : ""}
            ${renderUploadOptimizationStatus()}
            <div class="image-method-footer">${state.uploadName ? `<button type="button" class="remove-upload" id="remove-upload">${t("home.removeScreenshot")}</button>` : `<span class="privacy-note" id="upload-help">${t("home.imagePrivacy")}</span>`}</div>
          </section>
        </div>
        <p class="supported-sources">${t("home.sources")}</p>
        ${state.analysisError ? `<aside class="inline-error" id="analysis-error" role="alert"><strong>${t("home.errorTitle")}</strong><span>${esc(state.analysisError)}</span></aside>` : ""}
        <button class="primary-button" type="submit" ${accessLocked ? 'disabled aria-describedby="pilot-access-help"' : uploadBlocked ? 'disabled aria-describedby="upload-optimization-status"' : ""}>${t("home.start")} ${icons.arrow}</button>
      </form>
      ${currentLocale() !== "ja" ? `<aside class="language-beta-note"><strong>${t("language.beta")}</strong><span>${t("result.originalLanguageNotice")}</span></aside>` : ""}
      <details class="examples">
        <summary>${t("home.demo")}</summary>
        <div>
          <button data-example="銀座 鮨 蒼月">${t("home.demoSushi")}</button>
          <button data-example="新宿 麺処 灯 ラーメン">${t("home.demoRamen")}</button>
          <button data-example="京都 喫茶 こもれび">${t("home.demoCafe")}</button>
        </div>
      </details>
      </div>
    </section>
    ${state.pending.length ? `<section class="recent-preview queue-preview"><div><p class="overline">${t("home.queueOverline")}</p><h2>${t("home.queueTitle")}</h2></div><div class="recent-preview-list">${state.pending.slice(0, 3).map((item) => `<button data-open-pending="${esc(item.id)}"><strong>${esc(item.clues.name)}</strong><span>${esc([item.clues.branch, item.clues.area || item.clues.address].filter(Boolean).join(" · ") || t("queue.locationUnknown"))}</span></button>`).join("")}</div><button class="text-button" data-action="queue">${t("home.viewAll", { count: state.pending.length })}</button></section>` : ""}
    ${state.recent.length ? `<section class="recent-preview"><div><p class="overline">${t("home.recentOverline")}</p><h2>${t("home.recentTitle")}</h2></div><div class="recent-preview-list">${state.recent.slice(0, 3).map((item) => `<button data-open-recent="${esc(item.id)}"><strong>${esc(item.name)}</strong><span>${esc(item.area || t("history.areaUnknown"))} · ${formatClientTime(item.analyzedAt)}</span></button>`).join("")}</div><button class="text-button" data-action="history">${t("home.viewAll", { count: state.recent.length })}</button></section>` : ""}
    `;

  document.querySelector("#analyze-form").addEventListener("submit", handleAnalyze);
  document.querySelector("#pilot-access-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(event.currentTarget).get("pilotAccessCode");
    state.settings = normalizeSettings({ ...state.settings, pilotAccessCode: code });
    if (!state.settings.pilotAccessCode) {
      showToast(t("home.accessMissing"));
      document.querySelector("#pilot-access-code")?.focus();
      return;
    }
    syncSettings();
    state.analysisError = "";
    showToast(t("home.accessSaved"));
    renderHome();
    document.querySelector("#clue")?.focus();
  });
  document.querySelector("#upload-trigger").addEventListener("click", () => document.querySelector("#screenshot").click());
  document.querySelector("#screenshot").addEventListener("change", (event) => { void attachScreenshotFile(event.target.files[0] || null); });
  document.querySelector("#clue").addEventListener("paste", (event) => {
    const file = clipboardScreenshotFile(event.clipboardData);
    if (!file) return;
    const textarea = event.currentTarget;
    setTimeout(() => {
      state.input = textarea.value;
      void attachScreenshotFile(file, { pasted: true });
    }, 0);
  });
  document.querySelector("#clue").addEventListener("input", (event) => {
    state.input = event.currentTarget.value;
    state.exampleInput = false;
    state.analysisError = "";
    state.homeRecoveryNotice = "";
    event.currentTarget.removeAttribute("aria-invalid");
    document.querySelector("#analysis-error")?.remove();
  });
  document.querySelector("#remove-upload")?.addEventListener("click", clearUpload);
  document.querySelectorAll("[data-open-recent]").forEach((button) => button.addEventListener("click", () => openRecentAnalysis(button.dataset.openRecent)));
  document.querySelectorAll("[data-open-pending]").forEach((button) => button.addEventListener("click", () => openPendingAnalysis(button.dataset.openPending)));
  document.querySelectorAll("[data-example]").forEach((button) => button.addEventListener("click", () => openExampleExperience(button.dataset.example)));
}

async function attachScreenshotFile(file, { pasted = false } = {}) {
  if (!file) return;
  state.exampleInput = false;
  state.homeRecoveryNotice = "";
  const validation = validateScreenshotFile(file);
  if (!validation.ok) {
    state.analysisError = currentLocale() === "ja" ? validation.error : t("error.imageUnsupported");
    showToast(t("error.imageUnsupported"));
    renderHome();
    return;
  }
  uploadOptimizationController?.abort();
  const controller = new AbortController();
  uploadOptimizationController = controller;
  const job = ++uploadOptimizationJob;
  if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
  state.uploadFile = null;
  state.uploadName = file.name || (pasted ? t("upload.pastedName") : t("upload.screenshotName"));
  state.uploadPreviewUrl = URL.createObjectURL(file);
  state.uploadOptimization = { status: "optimizing", phase: "decoding" };
  state.analysisError = "";
  renderHome();
  try {
    const result = await optimizeScreenshotFile(file, {
      signal: controller.signal,
      onProgress(progress) {
        if (job !== uploadOptimizationJob) return;
        if (progress.phase === state.uploadOptimization?.phase) return;
        state.uploadOptimization = { status: "optimizing", ...progress };
        renderHome();
      }
    });
    if (job !== uploadOptimizationJob) return;
    uploadOptimizationController = null;
    if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
    state.uploadFile = result.file;
    state.uploadPreviewUrl = URL.createObjectURL(result.file);
    state.uploadOptimization = result.optimized ? { status: "complete", ...result } : null;
    state.analysisError = "";
    showToast(result.optimized ? t("home.screenshotPrepared") : (pasted ? t("error.imagePasted") : t("error.imageAdded")));
  } catch (error) {
    if (job !== uploadOptimizationJob) return;
    if (error?.name === "AbortError" || error?.code === "ABORTED") return;
    uploadOptimizationController = null;
    state.uploadFile = null;
    state.uploadOptimization = { status: "failed" };
    state.analysisError = t("error.imageOptimizeFailed");
    showToast(t("error.imageOptimizeFailed"));
  }
  renderHome();
}

function renderUploadOptimizationStatus() {
  const optimization = state.uploadOptimization;
  if (!optimization) return "";
  if (optimization.status === "optimizing") {
    const body = optimization.phase === "encoding" ? t("home.preparingScreenshotEncoding") : t("home.preparingScreenshotBody");
    return `<aside class="upload-optimization" id="upload-optimization-status" role="status" aria-live="polite"><strong>${t("home.preparingScreenshot")}</strong><span>${body}</span></aside>`;
  }
  if (optimization.status === "complete") {
    return `<aside class="upload-optimization upload-optimization-complete" id="upload-optimization-status" role="status"><strong>${t("home.screenshotPrepared")}</strong><span>${t("home.screenshotPreparedBody", { original: formatImageBytes(optimization.originalBytes), optimized: formatImageBytes(optimization.outputBytes) })}</span></aside>`;
  }
  return `<aside class="upload-optimization upload-optimization-error" id="upload-optimization-status" role="alert"><strong>${t("home.screenshotPrepareFailed")}</strong><span>${t("home.screenshotPrepareFailedBody")}</span></aside>`;
}

function formatImageBytes(value) {
  const megabytes = Number(value) / 1024 / 1024;
  return `${localeNumberFormat(currentLocale()).format(Math.max(0.1, Math.round(megabytes * 10) / 10))} MB`;
}

async function handleAnalyze(event) {
  event.preventDefault();
  if (state.uploadOptimization?.status === "optimizing") {
    showToast(t("home.preparingScreenshot"));
    return;
  }
  if (state.uploadOptimization?.status === "failed") {
    showToast(t("error.imageOptimizeFailed"));
    document.querySelector("#upload-trigger")?.focus();
    return;
  }
  const value = new FormData(event.currentTarget).get("clue").trim();
  if (!value && !state.uploadFile) {
    state.analysisError = t("error.inputRequired");
    renderHome();
    requestAnimationFrame(() => document.querySelector("#clue")?.focus());
    return;
  }
  if (navigator.onLine === false) {
    showToast(t("error.offline"));
    return;
  }
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable) {
    state.analysisError = t("error.service");
    renderHome();
    return;
  }
  if (pilotAccessLocked(capabilities, state.settings)) {
    state.capabilities = capabilities;
    state.analysisError = "";
    renderHome();
    document.querySelector("#pilot-access-code")?.focus();
    showToast(t("error.accessFirst"));
    return;
  }
  state.input = value || state.uploadName;
  state.sharedInputPending = false;
  state.activePendingId = null;
  state.userProvidedReservationLinks = [];
  state.analysisError = "";
  state.homeRecoveryNotice = "";
  state.searchRecovery = null;
  state.restaurant = null;
  state.currentPlanIntent = { planDate: "", planTime: "", partySize: state.settings.defaultPartySize };
  state.analysisRunId = createAnalysisRunId();
  state.analysisInputType = classifyInputType(value, Boolean(state.uploadFile));
  state.analysisSourceMode = state.exampleInput ? "demo" : "live";
  postEvent("input_submitted", {
    inputType: state.analysisInputType,
    sourceMode: state.analysisSourceMode
  });

  if (state.uploadFile) {
    state.loadingMode = "screenshot";
    state.view = "loading";
    render();
    try {
      const result = await extractScreenshot(state.uploadFile);
      if (result.mode === "sample") {
        state.analysisSourceMode = "demo";
        state.exampleInput = true;
      }
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
      state.analysisError = error.message || t("error.retryOrName");
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
    state.analysisError = error.message || t("error.searchUnavailable");
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
  if (!response.ok) throw apiResponseError(payload, t("error.inputCheck"));
  return payload;
}

async function extractWebpageInput(url) {
  const response = await fetch("/api/extract-webpage", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...pilotAccessHeaders(state.settings) },
    body: JSON.stringify({ url })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw apiResponseError(payload, t("error.webpage"));
  return payload;
}

function renderTextExtraction() {
  const parsed = state.textExtraction;
  const clues = parsed.clues;
  const parsedPlatformLabel = parsed.platformLabel || platformLabel(parsed.platform);
  const hasPlanDetails = Boolean(parsed.plan.planDate || parsed.plan.planTime || state.currentPlanIntent.partySize !== state.settings.defaultPartySize);
  const compactLocation = [clues.area, clues.address].filter(Boolean).join(" · ");
  app.innerHTML = `<section class="content-view narrow">
    <button class="back-button" data-action="home">${t("review.back")}</button>
    <div class="section-heading"><span class="step-chip">${t("review.step")}</span><h2>${t("review.title")}</h2><p>${t("review.body")}</p></div>
    <section class="panel extracted-restaurant"><form id="text-extraction-form">
      <div class="field-pair"><label>${t("review.name")}<input name="name" value="${esc(clues.name)}" required></label><label>${t("review.branch")}<input name="branch" value="${esc(clues.branch)}"></label></div>
      ${compactLocation ? `<p class="review-location-summary"><strong>${t("review.locationSummary")}</strong><span>${esc(compactLocation)}</span></p>` : ""}
      <details class="review-more"><summary>${t("review.more")}</summary><div class="field-pair"><label>${t("review.area")}<input name="area" value="${esc(clues.area)}"></label><label>${t("review.address")}<input name="address" value="${esc(clues.address)}"></label></div></details>
      ${clues.aliasExpanded ? `<aside class="alias-expansion"><strong>${t("review.aliasTitle")}</strong><span>${esc(clues.originalName)} → ${esc(clues.name)}</span><p>${t("review.aliasBody")}</p></aside>` : ""}
      ${hasPlanDetails ? `<div class="plan-preview"><strong>${t("review.plan")}</strong><span>${parsed.plan.planDate || t("review.dateUnknown")} · ${parsed.plan.planTime || t("review.timeUnknown")} · ${t("review.people", { count: state.currentPlanIntent.partySize })}</span></div>` : ""}
      ${parsed.kind === "pending_analysis" ? `<aside class="link-capability"><p>${t("review.pendingNotice")}</p></aside>` : parsed.webpage ? `<aside class="link-capability"><p>${t("review.webNotice")}</p><a href="${esc(safeExternalUrl(parsed.webpage.sourceUrl))}" target="_blank" rel="noreferrer">${t("result.sourceLanguage")}</a></aside>` : parsed.links.length ? `<aside class="link-capability"><strong>${esc(parsedPlatformLabel)}</strong><p>${t("review.linkNotice")}</p></aside>` : ""}
      <button class="primary-button" type="submit">${t("review.search")} ${icons.arrow}</button>
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
      showToast(error.message || t("error.searchUnavailable"));
      render();
    }
  });
}

function enterSearchRecovery({ reason = "unavailable", query = state.input, clues = state.currentClues } = {}) {
  state.loadingMode = "";
  state.candidates = [];
  state.candidateMode = "live";
  state.searchRecovery = { reason, query: String(query || ""), clues: { ...clues } };
  state.view = "search_recovery";
  render();
}

function renderSearchRecovery() {
  const recovery = state.searchRecovery || { reason: "unavailable", query: state.input, clues: state.currentClues };
  const noResults = recovery.reason === "no_results";
  app.innerHTML = `<section class="content-view narrow search-recovery-view">
    <button class="back-button" data-edit-clues>${t("common.backClues")}</button>
    <section class="panel recovery-card" role="alert">
      <span class="recovery-mark" aria-hidden="true">?</span>
      <div><p class="overline">${t("recovery.overline")}</p><h2>${t(noResults ? "recovery.noResultsTitle" : "recovery.unavailableTitle")}</h2><p>${t(noResults ? "recovery.noResultsBody" : "recovery.unavailableBody")}</p></div>
      <ul><li>${t("recovery.tipName")}</li><li>${t("recovery.tipLocation")}</li><li>${t("recovery.tipBranch")}</li></ul>
      <div class="recovery-actions"><button class="primary-button" id="retry-search">${t("recovery.retry")}</button><button class="secondary-button" data-edit-clues>${t("recovery.edit")}</button></div>
    </section>
    <details class="examples recovery-examples"><summary>${t("recovery.exampleTitle")}</summary><p>${t("recovery.exampleBody")}</p><div><button data-recovery-example="銀座 鮨 蒼月">${t("home.demoSushi")}</button><button data-recovery-example="新宿 麺処 灯 ラーメン">${t("home.demoRamen")}</button><button data-recovery-example="京都 喫茶 こもれび">${t("home.demoCafe")}</button></div></details>
  </section>`;
  document.querySelector("#retry-search")?.addEventListener("click", async () => {
    try { await searchCandidates(recovery.query, recovery.clues); }
    catch (error) {
      if (recoverFromPilotAccessError(error)) return;
      enterSearchRecovery({ reason: "unavailable", query: recovery.query, clues: recovery.clues });
    }
  });
  document.querySelectorAll("[data-edit-clues]").forEach((button) => button.addEventListener("click", () => returnToClues(noResults ? "no_results" : "unavailable")));
  document.querySelectorAll("[data-recovery-example]").forEach((button) => button.addEventListener("click", () => openExampleExperience(button.dataset.recoveryExample)));
}

function returnToClues(reason = "no_match") {
  state.homeRecoveryNotice = reason === "example" ? "" : t(reason === "unavailable" ? "home.searchUnavailableNotice" : "home.noMatchNotice");
  state.analysisError = "";
  state.searchRecovery = null;
  state.view = "home";
  render();
  requestAnimationFrame(() => document.querySelector("#clue")?.focus());
}

function openExampleExperience(query) {
  state.input = String(query || "");
  state.exampleInput = true;
  state.analysisInputType = "example";
  state.analysisSourceMode = "demo";
  state.analysisRunId = createAnalysisRunId();
  state.searchRecovery = null;
  state.homeRecoveryNotice = "";
  state.currentClues = { name: state.input };
  state.candidates = createExampleCandidates(state.input, { inputType: "example" });
  state.candidatePreviews = {};
  state.candidatePreviewLoadingId = "";
  state.rejectedCandidateIds = [];
  state.confirmedCandidate = null;
  state.candidateMode = "demo";
  state.view = "candidates";
  postEvent("input_submitted", { inputType: "example", sourceMode: "demo" });
  render();
}

function renderLinkGuidance() {
  const parsed = state.textExtraction;
  const reservationPlatform = parsed.kind === "reservation_link";
  const parsedPlatformLabel = parsed.platformLabel || platformLabel(parsed.platform);
  const originalLink = parsed.links?.[0];
  app.innerHTML = `<section class="content-view narrow link-guidance-view">
    <button class="back-button" data-action="home">${t("link.addClue")}</button>
    <div class="section-heading"><span class="step-chip">${t("link.detected", { platform: esc(parsedPlatformLabel) })}</span><h2>${reservationPlatform ? t("link.bookingTitle") : t("link.postTitle")}</h2><p>${reservationPlatform ? t("link.bookingBody") : t("link.postBody")}</p></div>
    ${reservationPlatform && originalLink ? `<aside class="link-capability"><p>${t("link.urlBoundary")}</p><a href="${esc(safeExternalUrl(originalLink.url))}" target="_blank" rel="noreferrer">${t("result.sourceLanguage")}</a></aside>` : ""}
    <div class="guidance-grid"><article><b>${t("link.recommend")}</b><h3>${t("link.screenshot")}</h3><p>${t("link.screenshotBody")}</p></article><article><b>${t("link.quick")}</b><h3>${t("link.text")}</h3></article></div>
    <aside class="extraction-warning"><strong>${t("link.notChecked")}</strong>${currentLocale() === "ja" ? `<ul>${parsed.warnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>` : `<p>${reservationPlatform ? t("link.bookingBody") : t("link.postBody")}</p>`}</aside>
    <button class="primary-button" data-action="home">${t("link.addInput")}</button>
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
    <p class="eyebrow">${screenshotMode ? t("loading.screenshotOverline") : webpageMode ? t("loading.webOverline") : detailsMode ? t("loading.detailsOverline") : t("loading.searchOverline")}</p>
    <h2>${screenshotMode ? t("loading.screenshotTitle") : webpageMode ? t("loading.webTitle") : detailsMode ? t("loading.detailsTitle") : t("loading.searchTitle")}</h2>
    <div class="loading-steps">${screenshotMode
      ? `<span class="done">${t("loading.stepRead")}</span><span class="active">${t("loading.stepSeparate")}</span><span>${t("loading.stepClues")}</span>`
      : webpageMode
        ? `<span class="done">${t("loading.stepUrl")}</span><span class="active">${t("loading.stepPage")}</span><span>${t("loading.stepWait")}</span>`
      : detailsMode
        ? `<span class="done">${t("loading.stepIdentity")}</span><span class="active">${t("loading.stepDetails")}</span><span>${t("loading.stepDecision")}</span>`
        : `<span class="done">${t("loading.stepQuery")}</span><span class="active">${t("loading.stepPlaces")}</span><span>${t("loading.stepWait")}</span>`}</div>
  </section>`;
}

function renderExtraction() {
  const e = state.extraction;
  const r = e.restaurant;
  const meta = state.extractionMeta;
  const review = extractionReviewState(e, meta);
  const placesReady = Boolean(state.capabilities?.placesSearch);
  const currentKey = restaurantClueKey(r);
  const queuedKeys = new Set(state.pending.map((item) => restaurantClueKey(item.clues)));
  const queueableRestaurants = e.restaurants.filter((restaurant) => restaurantClueKey(restaurant) !== currentKey && !queuedKeys.has(restaurantClueKey(restaurant)) && restaurant.name);
  const engagement = [
    [t("extraction.likes"), e.engagement.likes],
    [t("extraction.comments"), e.engagement.comments],
    [t("extraction.saves"), e.engagement.saves],
    [t("extraction.shares"), e.engagement.shares]
  ].filter(([, value]) => Number.isFinite(value));
  const locationSummary = [r.branch, r.address || r.area || r.nearest_station].filter(Boolean).join(" · ") || t("extraction.locationUnknown");
  const { identity: identityWarnings, secondary: secondaryWarnings } = partitionExtractionWarnings(e.warnings);
  const secondaryDetailCount = e.claims.length + engagement.length + secondaryWarnings.length;

  app.innerHTML = `<section class="content-view extraction-view">
    <button class="back-button" data-action="home">${t("extraction.back")}</button>
    <div class="section-heading extraction-heading"><span class="step-chip">${t("extraction.step")}</span><h2>${t("extraction.title")}</h2><p>${t("extraction.body")}</p></div>
    <div class="extraction-layout">
      <aside class="screenshot-card"><button type="button" class="screenshot-image-button" data-view-screenshot aria-label="${t("extraction.viewImage")}"><img src="${state.uploadPreviewUrl}" alt="${t("extraction.imageAlt")}"><span>${t("extraction.viewImage")}</span></button><div><span>${esc(e.platform.toUpperCase())}</span><strong>${esc(e.creator.handle || t("extraction.accountUnknown"))}</strong></div></aside>
      <div class="extraction-content">
        ${e.restaurants.length > 1 ? `<details class="panel extracted-restaurant-picker"><summary><span><strong>${t("extraction.multiFound", { count: e.restaurants.length })}</strong><small>${t("extraction.multiSelected", { name: r.name || t("common.unknown") })}</small></span><b>${t("extraction.multiChange")}</b></summary><div class="extracted-restaurant-picker-body"><div class="extracted-restaurant-options" role="group" aria-label="${t("extraction.multiTitle")}">${e.restaurants.map((restaurant, index) => `<button type="button" data-extracted-restaurant="${index}" class="${restaurantKeyForView(restaurant) === restaurantKeyForView(r) ? "active" : ""}" aria-pressed="${restaurantKeyForView(restaurant) === restaurantKeyForView(r)}"><strong>${esc(restaurant.name || `${t("common.restaurant")} ${index + 1}`)}</strong><span>${esc([restaurant.branch, restaurant.area || restaurant.address || restaurant.nearest_station].filter(Boolean).join(" · ") || t("common.unknown"))}</span></button>`).join("")}</div><button type="button" class="queue-extracted" id="queue-extracted" ${queueableRestaurants.length ? "" : "disabled"}>${queueableRestaurants.length ? t("extraction.queueOther", { count: queueableRestaurants.length }) : t("extraction.queueDone")}</button><small class="queue-privacy">${t("extraction.queuePrivacy")}</small></div></details>` : ""}
        <section class="panel extracted-restaurant"><div class="fact-label"><span class="status-dot dark"></span>${t("extraction.identity")}</div>
          <form id="extraction-form" novalidate>
            <div class="identity-summary" aria-label="${t("extraction.identity")}"><strong>${esc(r.name || t("extraction.nameUnknown"))}</strong><span>${esc(locationSummary)}</span></div>
            <details class="identity-editor" ${review.needsAttention ? "open" : ""}>
              <summary>${t("extraction.editIdentity")}</summary>
              <div class="identity-fields">
                <div class="field-pair"><label>${t("extraction.name")}<input name="restaurant_name" value="${esc(r.name)}" required></label><label>${t("extraction.branch")}<input name="branch" value="${esc(r.branch)}"></label></div>
                <div class="field-pair"><label>${t("extraction.address")}<input name="address" value="${esc(r.address)}"></label><label>${t("extraction.station")}<input name="nearest_station" value="${esc(r.nearest_station)}"></label></div>
              </div>
            </details>
            ${review.needsAttention ? `<aside class="extraction-warning extraction-warning-critical"><strong>${review.canContinue ? t("extraction.manualTitle") : t("extraction.blockedTitle")}</strong><p>${currentLocale() === "ja" ? esc(review.message) : t("extraction.sourceNotice")}</p></aside>` : ""}
            ${identityWarnings.length ? `<aside class="identity-warning"><strong>${t("extraction.identityWarning")}</strong><ul>${identityWarnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul></aside>` : ""}
            ${review.requiresAcknowledgement ? `<label class="confidence-confirm"><input type="checkbox" name="confirm_extraction" value="yes" required aria-describedby="confirm-extraction-error"><span>${t("extraction.confirm")}</span></label><small class="confirmation-error" id="confirm-extraction-error" hidden>${t("error.confirmImage")}</small>` : ""}
            <button class="primary-button" type="submit">${t("extraction.submit")} ${icons.arrow}</button>
            <small class="match-next-step">${placesReady ? t("extraction.matchNext") : t("extraction.demoBody")}</small>
          </form>
        </section>
        <details class="extraction-details">
          <summary><span>${t("extraction.details")}</span><small>${t("extraction.detailsSummary", { count: secondaryDetailCount })}</small></summary>
          <div class="extraction-details-body">
            <div class="extracted-chips"><span>${esc(r.category || t("extraction.categoryUnknown"))}</span><span>${formatBudget(r)}</span><span>${esc(r.area || t("extraction.areaUnknown"))}</span></div>
            ${e.claims.length ? `<section><p class="overline">${t("extraction.claims")}</p><div class="claim-list">${e.claims.map((claim) => `<p><span>${claim.kind === "opinion" ? t("extraction.claimOpinion") : claim.kind === "visible_fact" ? t("extraction.claimVisible") : t("extraction.claimPost")}</span>${esc(claim.text)}</p>`).join("")}</div></section>` : ""}
            ${engagement.length ? `<section><p class="overline">${t("extraction.engagement")}</p><div class="engagement-grid">${engagement.map(([label, value]) => `<div><strong>${localeNumberFormat(currentLocale()).format(value)}</strong><span>${label}</span></div>`).join("")}</div></section>` : ""}
            ${secondaryWarnings.length ? `<aside class="extraction-warning"><strong>${t("extraction.nextCheck")}</strong>${currentLocale() === "ja" ? `<ul>${secondaryWarnings.map((warning) => `<li>${esc(warning)}</li>`).join("")}</ul>` : `<p>${t("extraction.sourceNotice")}</p>`}</aside>` : ""}
            <p class="fine-print">${t("extraction.sourceNotice")}</p>
            <p class="model-note">${t("extraction.modelNote", { model: state.extractionMode === "api" ? meta?.model || "Vision API" : "Sample" })}</p>
          </div>
        </details>
      </div>
    </div>
    <dialog class="screenshot-dialog" id="screenshot-dialog"><div><button type="button" data-close-screenshot>${t("extraction.closeImage")}</button><img src="${state.uploadPreviewUrl}" alt="${t("extraction.imageAlt")}"></div></dialog>
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
      const checkbox = event.currentTarget.elements.confirm_extraction;
      const error = document.querySelector("#confirm-extraction-error");
      if (error) error.hidden = false;
      checkbox?.setAttribute("aria-invalid", "true");
      checkbox?.focus();
      return;
    }
    state.input = [clues.name, clues.branch, clues.address || clues.area || clues.nearest_station].filter(Boolean).join(" ");
    try {
      await searchCandidates(state.input, clues);
    } catch (error) {
      state.analysisError = error.message || t("error.searchUnavailable");
      state.view = "extraction";
      showToast(state.analysisError);
      render();
    }
  });
  document.querySelector('[name="confirm_extraction"]')?.addEventListener("change", (event) => {
    const error = document.querySelector("#confirm-extraction-error");
    if (error) error.hidden = event.currentTarget.checked;
    event.currentTarget.removeAttribute("aria-invalid");
  });
  const screenshotDialog = document.querySelector("#screenshot-dialog");
  document.querySelector("[data-view-screenshot]")?.addEventListener("click", () => screenshotDialog?.showModal());
  document.querySelector("[data-close-screenshot]")?.addEventListener("click", () => screenshotDialog?.close());
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
    showToast(added ? t("queue.addedOther", { count: added }) : t("queue.duplicateOther"));
  });
}

function restaurantKeyForView(restaurant) {
  return [restaurant?.name, restaurant?.branch, restaurant?.address].map((value) => String(value || "").normalize("NFKC").toLowerCase().replace(/\s+/g, "")).join("|");
}

function partitionExtractionWarnings(warnings = []) {
  const identityPattern = /(店名|支店|住所|場所|最寄り|駅|判読|読み取れ|低解像|低画質|不鮮明|ぼや|restaurant name|branch|address|location|station|low.resolution|blurry|餐厅名|店名|分店|地址|地点|车站|低清|模糊)/iu;
  return warnings.reduce((groups, warning) => {
    groups[identityPattern.test(String(warning || "")) ? "identity" : "secondary"].push(warning);
    return groups;
  }, { identity: [], secondary: [] });
}

function renderCandidates() {
  const exampleMode = state.candidateMode === "demo";
  const fallback = !exampleMode && state.candidates[0]?.isFallback;
  const live = state.candidateMode === "live";
  const visible = visibleCandidates(state.candidates, state.rejectedCandidateIds);
  const rejectedCount = state.candidates.length - visible.length;
  const decision = candidateDecision(visible);
  const decisionCopy = exampleMode
    ? { heading: t("candidate.exampleHeading"), summary: t("candidate.exampleSummary") }
    : localizedCandidateDecisionCopy({ fallback, decision, candidateCount: visible.length, input: state.input });
  app.innerHTML = `<section class="content-view narrow">
    <button class="back-button" data-edit-clues>${t("common.backClues")}</button>
    ${exampleMode ? `<aside class="example-mode-banner" role="status"><strong>${t("example.bannerTitle")}</strong><span>${t("example.bannerBody")}</span></aside>` : ""}
    <div class="section-heading candidate-heading"><span class="step-chip">${t("candidate.step")}</span><h2>${esc(decisionCopy.heading)}</h2><p>${esc(decisionCopy.summary)}</p></div>
    <div class="candidate-list">
      ${visible.map((restaurant, index) => {
        const preview = state.candidatePreviews[restaurant.placeId];
        const isSystemLead = !exampleMode && !fallback && decision.kind !== "ambiguous" && restaurant.id === decision.leadId;
        const candidateLabel = exampleMode ? t("example.badge") : isSystemLead ? t("candidate.lead") : visible.length === 1 ? t("candidate.confirm") : t("candidate.position", { index: index + 1, count: visible.length });
        return `<article class="candidate-card${isSystemLead ? " system-lead" : ""}${exampleMode ? " example-card" : ""}">
        <div class="restaurant-avatar">${(restaurant.category || "店").slice(0, 1)}</div>
        <div class="candidate-copy"><span class="candidate-label${isSystemLead ? " lead-label" : ""}">${esc(candidateLabel)}</span><small class="candidate-meta">${esc(restaurant.category || t("common.restaurant"))}${restaurant.price ? ` · ${esc(restaurant.price)}` : ""}</small><h3>${esc(restaurant.name)}</h3><p>${esc(restaurant.address || [restaurant.area, restaurant.station].filter(Boolean).join(" · "))}</p><small class="business-status status-${esc(String(restaurant.businessStatus || "unknown").toLowerCase())}">${esc(businessStatusLabel(restaurant.businessStatus))}</small>${preview ? `<div class="candidate-rating"><strong>${Number.isFinite(preview.rating) ? `★ ${esc(preview.rating.toFixed(1))}` : t("candidate.noRating")}</strong>${Number.isInteger(preview.userRatingCount) ? `<span>Google ${esc(localeNumberFormat(currentLocale()).format(preview.userRatingCount))}</span>` : ""}</div>` : ""}${restaurant.matchReasons?.length || restaurant.attributions?.length ? `<details class="candidate-evidence"><summary>${t("candidate.why")}</summary>${restaurant.matchReasons?.length && currentLocale() === "ja" ? `<div class="match-reasons">${restaurant.matchReasons.map((reason) => `<small>${esc(reason)}</small>`).join("")}</div>` : restaurant.matchScore ? `<small>${t("candidate.match")}</small>` : ""}${restaurant.attributions?.length ? `<small class="provider-attribution">${t("candidate.attribution", { providers: restaurant.attributions.map((item) => esc(item.provider)).join(", ") })}</small>` : ""}</details>` : ""}</div>
        <div class="candidate-actions"><button class="select-button" data-restaurant="${restaurant.id}">${t("candidate.select")} ${icons.arrow}</button><button class="reject-button" data-reject-candidate="${restaurant.id}" aria-label="${esc(restaurant.name)}: ${t("candidate.reject")}">${t("candidate.reject")}</button></div>
      </article>`;
      }).join("")}
    </div>
    ${visible.length ? `<div class="candidate-review-actions"><button data-edit-clues>${t("candidate.edit")}</button>${rejectedCount ? `<button data-restore-candidates>${t("candidate.restore", { count: rejectedCount })}</button>` : ""}</div>` : `<div class="empty-state candidate-empty"><span>?</span><h3>${t("candidate.noneTitle")}</h3><p>${t("candidate.noneBody")}</p><div><button data-restore-candidates>${t("candidate.restoreAll")}</button><button class="primary-button" data-edit-clues>${t("candidate.searchEdit")} ${icons.arrow}</button></div></div>`}
    ${live ? `<div class="google-attribution" translate="no">Google Maps</div>` : `<p class="fine-print">${t("example.candidateNote")}</p>`}
  </section>`;
  document.querySelectorAll("[data-edit-clues]").forEach((button) => button.addEventListener("click", () => returnToClues(exampleMode ? "example" : "no_match")));
  document.querySelectorAll("[data-preview-candidate]").forEach((button) => button.addEventListener("click", async () => {
    await loadCandidatePreview(button.dataset.previewCandidate);
  }));
  document.querySelectorAll("[data-restaurant]").forEach((button) => button.addEventListener("click", async () => {
    const candidate = state.candidates.find((item) => item.id === button.dataset.restaurant);
    state.confirmedCandidate = candidate;
    state.resultFocus = "";
    postEvent("candidate_confirmed", { placeId: live ? candidate.placeId : undefined, sourceMode: state.analysisSourceMode || state.candidateMode, selectedRank: candidate.rank || 1, candidateCount: state.candidates.length });
    await openConfirmedCandidate("details");
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

function localizedCandidateDecisionCopy({ fallback = false, decision, candidateCount = 0, input = "" } = {}) {
  if (currentLocale() === "ja") return candidateDecisionCopy({ fallback, decision, candidateCount, input });
  if (fallback) return { heading: t("candidate.fallbackHeading"), summary: t("candidate.fallbackSummary") };
  if (decision?.kind === "likely_single") return { heading: t("candidate.singleHeading"), summary: t("candidate.singleSummary", { input }) };
  if (decision?.kind === "likely_with_alternatives") return { heading: t("candidate.leadHeading"), summary: t("candidate.leadSummary", { input }) };
  if (candidateCount === 1) return { heading: t("candidate.uncertainHeading"), summary: t("candidate.uncertainSummary", { input }) };
  return { heading: t("candidate.ambiguousHeading"), summary: t("candidate.ambiguousSummary", { input }) };
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
      returnView: "candidates"
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
  const exampleMode = isExampleRestaurant(r);
  const saved = state.saved.some((item) => item.id === r.id);
  const primaryAction = r.primaryAction || (r.booking ? { label: r.booking.label, url: r.booking.url } : null);
  const reservationOptions = Array.isArray(r.reservationOptions) ? r.reservationOptions : [];
  const savedPlan = state.saved.find((item) => item.id === r.id);
  app.innerHTML = `<section class="content-view result-view">
    <button class="back-button" data-action="home">${t("result.back")}</button>
    ${exampleMode ? `<aside class="example-mode-banner result-example-banner" role="status"><strong>${t("example.bannerTitle")}</strong><span>${t("example.resultBody")}</span></aside>` : ""}
    ${currentLocale() !== "ja" ? `<aside class="language-beta-note result-language-note"><strong>${t("language.beta")}</strong><span>${t("result.dynamicNotice")}</span></aside>` : ""}
    ${state.pending.length ? `<aside class="result-queue"><div><strong>${t("result.moreQueue", { count: state.pending.length })}</strong><span>${t("result.moreQueueBody")}</span></div><button id="continue-pending">${t("result.nextQueue")} ${icons.arrow}</button></aside>` : ""}
    <div class="result-title"><div><span class="category-line">${[r.category, r.price].filter(Boolean).map(esc).join(" · ")}</span><h1>${esc(r.name)}</h1><p>${[r.reading, r.area].filter(Boolean).map(esc).join(" · ")}</p></div>${exampleMode ? `<span class="demo-pill">${t("example.badge")}</span>` : ""}</div>
    <div class="decision-grid">
      <article class="decision-card ${esc(r.recommendation)}">
        <div class="status-row"><span class="status-dot"></span><span>${localizedConfidenceLabel(r.confidence)}</span></div>
        <p class="overline">${t("result.checkResult")}</p><h2>${esc(localizedRecommendationLabel(r.recommendation))}</h2>${currentLocale() === "ja" ? `<p>${esc(r.summary)}</p>` : `<p>${t("result.dynamicNotice")}</p>`}
        ${r.planAdvisory ? `<aside class="plan-advisory"><strong>${t("result.planAdvisory")}</strong><p lang="ja">${esc(r.planAdvisory)}</p></aside>` : ""}
        <details class="decision-details"><summary>${t("result.why")}</summary><div>${currentLocale() === "ja" ? `<div class="reason-list">${r.reasons.map((reason) => `<span>${icons.check}${esc(reason)}</span>`).join("")}</div>` : `<div class="source-language-details"><p lang="ja">${esc(r.summary)}</p><div class="reason-list" lang="ja">${r.reasons.map((reason) => `<span>${icons.check}${esc(reason)}</span>`).join("")}</div></div>`}${r.decisionEvidence?.length ? `<div class="decision-boundary"><strong>${t("result.boundary")}</strong>${r.decisionEvidence.map((item) => `<p lang="ja">${esc(item.claim)} · ${t("result.confidence", { level: localizedConfidenceLevel(item.certainty) })}<br><small>${esc(item.limitation)}</small></p>`).join("")}</div>` : ""}</div></details>
      </article>
      <article class="action-card"><p class="overline">${t("result.next")}</p><h3>${t(primaryAction?.type === "phone" ? "result.actionPhone" : primaryAction ? "result.actionBooking" : "result.actionMap")}</h3>
        ${primaryAction ? `<a class="primary-button" id="primary-action" data-action-type="${esc(primaryAction.type || "external")}" href="${esc(actionHref(primaryAction))}" ${primaryAction.type === "phone" ? "" : 'target="_blank" rel="noreferrer"'}>${currentLocale() === "ja" ? esc(primaryAction.label) : t(primaryAction.type === "phone" ? "result.actionPhone" : "result.actionBooking")} ${primaryAction.type === "phone" ? icons.phone : icons.arrow}</a>` : r.phone ? `<a class="primary-button" id="primary-action" data-action-type="phone" href="tel:${esc(r.phone)}">${icons.phone} ${t("result.actionPhone")}</a>` : `<a class="primary-button" id="primary-action" data-action-type="map" href="${esc(safeExternalUrl(r.mapSearchUrl || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${r.name} ${r.address}`)}`))}" target="_blank" rel="noreferrer">${t("result.actionMap")} ${icons.arrow}</a>`}
        <details class="action-more" ${state.planEditorOpen ? "open" : ""}><summary>${t("result.otherActions")}</summary><div>
          ${r.phone && primaryAction?.type !== "phone" ? `<a class="secondary-button" id="phone-action" href="tel:${esc(r.phone)}">${icons.phone} ${esc(r.phone)} · ${t("result.phone")}</a>` : ""}
          <button class="secondary-button" id="share-result">${t("result.share")}</button>
          <button class="secondary-button" id="save-button">${icons.bookmark} ${saved ? t("result.editPlan") : t("result.savePlan")}</button>
          ${state.planEditorOpen ? renderPlanForm(savedPlan, r) : ""}
        </div></details>
      </article>
    </div>
    ${r.conflict ? `<aside class="conflict"><strong>${currentLocale() === "ja" ? esc(r.conflictTitle || "情報が一致していません") : t("result.conflict")}</strong><p lang="ja">${esc(r.conflict)}</p></aside>` : ""}
    <details class="result-more"><summary><span>${t("result.moreTitle")}</span><small>${t("result.moreBody")}</small></summary><div class="result-more-body">
    ${r.reservationGuidance ? `<section class="panel reservation-guidance"><div><p class="overline">${t("result.reservationRules")}</p><h2 lang="ja">${esc(r.reservationGuidance.label)}</h2><p lang="ja">${esc(r.reservationGuidance.excerpt)}</p><small>${t("result.ruleBoundary")}</small></div><a href="${esc(safeExternalUrl(r.reservationGuidance.sourceUrl))}" target="_blank" rel="noreferrer">${t("result.openOriginal")} ${icons.arrow}</a></section>` : ""}
    ${reservationOptions.length ? `<section class="panel reservation-options"><div class="panel-heading"><div><p class="overline">${t("result.options")}</p><h2>${t("result.optionsTitle")}</h2></div><span>${t("result.optionsBody")}</span></div><div class="reservation-option-grid">${reservationOptions.map((option) => `<a class="reservation-option ${reservationOptionClass(option)}" href="${esc(option.url)}" ${option.actionType === "phone" ? "" : 'target="_blank" rel="noreferrer"'} data-reservation-provider="${esc(option.provider)}" data-action-type="${esc(option.actionType)}"><span>${reservationOptionBadge(option)}</span><strong>${esc(option.label)}</strong><small>${esc(currentLocale() === "ja" ? option.capability?.label || reservationModeLabel(option.bookingMode) : reservationModeLabel(option.bookingMode))}</small>${option.capability?.confirmation ? `<em lang="ja">${esc(option.capability.confirmation)}</em>` : ""}${option.feeNote ? `<p lang="ja">${esc(option.feeNote)}</p>` : ""}</a>`).join("")}</div></section>` : ""}
    ${r.queueGuidance ? `<section class="panel queue-guidance"><div><p class="overline">${t("result.queueRules")}</p><h2 lang="ja">${esc(r.queueGuidance.label)}</h2><p lang="ja">${esc(r.queueGuidance.excerpt)}</p><small>${t("result.queueBoundary")}</small></div><a href="${esc(safeExternalUrl(r.queueGuidance.sourceUrl))}" target="_blank" rel="noreferrer">${t("result.openOriginal")} ${icons.arrow}</a></section>` : ""}
    ${r.attentionNotices?.length ? `<section class="panel attention-panel"><div class="panel-heading"><div><p class="overline">${t("result.attention")}</p><h2>${t("result.attentionTitle")}</h2></div><span>${t("result.attentionBody")}</span></div><div class="attention-grid">${r.attentionNotices.map((notice) => `<article lang="ja"><strong>${esc(notice.label)}</strong><p>${esc(notice.excerpt)}</p><a href="${esc(safeExternalUrl(notice.sourceUrl))}" target="_blank" rel="noreferrer">${t("result.openOriginal")}</a></article>`).join("")}</div></section>` : ""}
    <div class="detail-grid single-panel">
      <section class="panel"><div class="panel-heading"><div><p class="overline">${t("result.restaurantInfo")}</p><h2>${t("result.beforeVisit")}</h2></div><span class="queue-chip">${esc(r.queue)}</span></div>
        <dl class="facts">${Number.isFinite(r.rating) ? `<div><dt>Google</dt><dd>${esc(r.rating)} / 5${Number.isInteger(r.userRatingCount) ? ` · ${esc(localeNumberFormat(currentLocale()).format(r.userRatingCount))}` : ""}</dd></div>` : ""}<div><dt>${t("result.address")}</dt><dd>${esc(r.address)}</dd></div>${r.phone ? `<div><dt>${t("result.phoneLabel")}</dt><dd><a href="tel:${esc(r.phone)}">${esc(r.phone)}</a></dd></div>` : ""}${r.officialInstagramUrl ? `<div><dt>Instagram</dt><dd><a href="${esc(safeExternalUrl(r.officialInstagramUrl))}" target="_blank" rel="noreferrer">Instagram</a></dd></div>` : ""}<div><dt>${t("result.station")}</dt><dd>${esc(r.station)}</dd></div><div><dt>${t("result.hours")}</dt><dd>${esc(r.hours)}</dd></div><div><dt>${t("result.closed")}</dt><dd>${esc(r.closed)}</dd></div></dl>
      </section>
    </div>
    <section class="panel sources"><div class="panel-heading"><div><p class="overline">${t("result.sources")}</p><h2>${t("result.sourcesTitle")}</h2></div><span>${resultInputSourceLabel(r)}</span></div>
      ${r.sources.map((source) => `<div class="source-row"><div>${source.url ? `<a href="${esc(safeExternalUrl(source.url))}" target="_blank" rel="noreferrer"><strong>${esc(source.name)}</strong></a>` : `<strong>${esc(source.name)}</strong>`}${source.official ? `<span class="official">${t("result.official")}</span>` : ""}<p lang="ja">${esc(source.note)}${source.retrievedAt ? ` · ${formatClientTime(source.retrievedAt)}` : ""}</p>${source.attribution ? `<small class="source-attribution" translate="no">${esc(source.attribution)}</small>` : ""}</div><span class="confidence-${["高", "high"].includes(source.confidence) ? "high" : ["中", "medium"].includes(source.confidence) ? "medium" : "low"}">${t("result.confidence", { level: localizedConfidenceLevel(source.confidence) })}</span></div>`).join("")}
      ${r.sources.some((source) => ["Hot Pepper", "ホットペッパーグルメ"].includes(source.name)) ? '<a class="hotpepper-credit" href="https://webservice.recruit.co.jp/" target="_blank" rel="noreferrer"><img src="https://webservice.recruit.co.jp/banner/hotpepper-s.gif" alt="ホットペッパーグルメ Webサービス" width="135" height="17"></a>' : ""}
      <p class="source-disclaimer">${t("result.sourceDisclaimer")}</p>
    </section>
    </div></details>
    <section class="feedback-card" id="feedback-card"><div><p class="overline">${t("feedback.overline")}</p><h3>${t("feedback.title")}</h3><p>${t("feedback.privacy")}</p></div><form id="feedback-form" class="feedback-form">
      <fieldset class="feedback-primary"><legend>${t("feedback.helpful")}</legend><label><input type="radio" name="helpful" value="yes" required> ${t("feedback.yes")}</label><label><input type="radio" name="helpful" value="no"> ${t("feedback.no")}</label></fieldset>
      <details class="feedback-more"><summary>${t("feedback.more")}</summary><div class="feedback-more-body">
        <fieldset><legend>${t("feedback.booking")}</legend><label><input type="radio" name="bookingOutcome" value="succeeded"> ${t("feedback.succeeded")}</label><label><input type="radio" name="bookingOutcome" value="not_succeeded"> ${t("feedback.notSucceeded")}</label><label><input type="radio" name="bookingOutcome" value="not_tried"> ${t("feedback.notTried")}</label></fieldset>
        <fieldset><legend>${t("feedback.accuracy")}</legend><label><input type="radio" name="accuracy" value="accurate"> ${t("feedback.accurate")}</label><label><input type="radio" name="accuracy" value="partly_wrong"> ${t("feedback.partlyWrong")}</label><label><input type="radio" name="accuracy" value="wrong"> ${t("feedback.wrong")}</label></fieldset>
        <fieldset><legend>${t("feedback.pay")}</legend><label><input type="radio" name="willingnessToPay" value="consider"> ${t("feedback.consider")}</label><label><input type="radio" name="willingnessToPay" value="depends_on_price"> ${t("feedback.depends")}</label><label><input type="radio" name="willingnessToPay" value="would_not"> ${t("feedback.wouldNot")}</label><label><input type="radio" name="willingnessToPay" value="unsure"> ${t("feedback.unsure")}</label></fieldset>
        <label class="feedback-text">${t("feedback.comment")}<textarea name="feedbackText" maxlength="500" rows="3" placeholder="${t("feedback.placeholder")}"></textarea></label>
      </div></details>
      <button type="submit" disabled>${t("feedback.submit")}</button>
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
    button.textContent = t("feedback.sending");
    const accepted = await postEvent("feedback_submitted", {
      helpful: values.helpful === "yes",
      bookingOutcome: values.bookingOutcome,
      accuracy: values.accuracy,
      willingnessToPay: values.willingnessToPay,
      feedbackText: values.feedbackText
    });
    if (!accepted) {
      button.disabled = false;
      button.textContent = t("feedback.retry");
      showToast(t("feedback.failed"));
      return;
    }
    form.replaceWith(Object.assign(document.createElement("p"), { className: "feedback-thanks", textContent: t("feedback.accepted") }));
    showToast(t("feedback.accepted"));
  });
  document.querySelectorAll('#feedback-form [name="helpful"]').forEach((input) => input.addEventListener("change", () => {
    const button = document.querySelector('#feedback-form button[type="submit"]');
    if (button) button.disabled = false;
  }));
}

function focusResultSection() {
  const selector = state.resultFocus === "reservation" ? ".decision-grid" : ".detail-grid";
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  requestAnimationFrame(() => document.querySelector(selector)?.scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth", block: "start" }));
}

function reservationModeLabel(value) {
  if (currentLocale() === "en") return { phone: "Confirm by phone", instant: "Instant booking", request: "Booking request", instant_or_request: "Instant booking or request", provider_determined: "Confirmed by the booking service", waitlist: "Waitlist", unknown: "Check the method on the linked page" }[value] || "Check the method on the linked page";
  if (currentLocale() === "zh-CN") return { phone: "电话确认", instant: "即时预约", request: "预约申请", instant_or_request: "即时预约或申请", provider_determined: "由预约平台确认", waitlist: "候位登记", unknown: "请在链接页面确认方式" }[value] || "请在链接页面确认方式";
  return { phone: "電話で確認", instant: "即時予約", request: "予約リクエスト", instant_or_request: "即時予約またはリクエスト", provider_determined: "予約サービス側で確定", waitlist: "順番待ち受付", unknown: "リンク先で予約方法を確認" }[value] || "リンク先で予約方法を確認";
}

function localizedRecommendationLabel(value) {
  if (currentLocale() === "ja") return recommendationLabel(value);
  return {
    strongly_recommended: t("result.recommendStrong"),
    recommended: t("result.recommend"),
    walk_in_ok: t("result.walkIn"),
    temporarily_unavailable: t("result.unavailable"),
    unknown: t("result.unknown")
  }[value] || t("result.unknown");
}

function localizedConfidenceLabel(value) {
  if (currentLocale() === "ja") return confidenceLabel(value);
  return { high: t("result.confidenceHigh"), medium: t("result.confidenceMedium"), low: t("result.confidenceLow") }[value] || t("result.confidenceLow");
}

function localizedConfidenceLevel(value) {
  const normalized = ["高", "high"].includes(value) ? "high" : ["中", "medium"].includes(value) ? "medium" : "low";
  if (currentLocale() === "en") return { high: "high", medium: "medium", low: "low" }[normalized];
  if (currentLocale() === "zh-CN") return { high: "高", medium: "中", low: "低" }[normalized];
  return { high: "高", medium: "中", low: "低" }[normalized];
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
  if (currentLocale() !== "ja") {
    const labels = currentLocale() === "en"
      ? { input: "User-provided link", unverified: "Unverified", discovery: "Search only", booking: "Booking flow", managed: "Confirmed after submission", waitlist: "Waitlist", listing: "Restaurant page", phone: "Phone", map: "Map", official: "Official site", external: "External site", verified: "Verified" }
      : { input: "用户提供的链接", unverified: "未核实", discovery: "仅搜索", booking: "预约入口", managed: "提交后确认", waitlist: "候位", listing: "店铺页面", phone: "电话", map: "地图", official: "官网", external: "外部网站", verified: "已核实" };
    if (option.officiality === "user_provided_external") return labels.input;
    if (option.status === "unverified_link") return labels.unverified;
    if (option.status === "discovery_only") return labels.discovery;
    if (kind === "online_reservation_flow") return labels.booking;
    if (kind === "provider_booking_flow") return labels.managed;
    if (kind === "waitlist_flow") return labels.waitlist;
    if (kind === "platform_listing") return labels.listing;
    if (kind === "phone_confirmation") return labels.phone;
    if (kind === "map") return labels.map;
    if (option.officiality === "restaurant_official") return labels.official;
    if (option.officiality === "google_listed_external") return labels.external;
    return labels.verified;
  }
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
  return `<form id="plan-form" class="plan-form"><strong>${savedPlan ? t("plan.edit") : t("plan.add")}</strong><div class="plan-fields"><label>${t("plan.date")}<input type="date" name="planDate" value="${esc(date)}"></label><label>${t("plan.time")}<input type="time" name="planTime" value="${esc(time)}"></label><label>${t("plan.party")}<input type="number" name="partySize" min="1" max="20" value="${esc(party)}"></label><label>${t("plan.status")}<select name="planStatus">${PLAN_STATUSES.map((item) => `<option value="${item.value}" ${item.value === status ? "selected" : ""}>${localizedPlanStatus(item.value)}</option>`).join("")}</select></label></div><div class="plan-actions"><button type="button" id="cancel-plan">${t("plan.cancel")}</button><button type="submit">${savedPlan ? t("plan.saveChanges") : t("plan.addSaved")}</button></div></form>`;
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
  showToast(existing ? t("plan.updated") : t("plan.saved"));
  render();
}

function clearUpload() {
  uploadOptimizationJob += 1;
  uploadOptimizationController?.abort();
  uploadOptimizationController = null;
  if (state.uploadPreviewUrl) URL.revokeObjectURL(state.uploadPreviewUrl);
  state.uploadFile = null;
  state.uploadName = "";
  state.uploadPreviewUrl = "";
  state.uploadOptimization = null;
  state.extraction = null;
  state.extractionMode = "";
  state.extractionMeta = null;
  state.analysisError = "";
  renderHome();
}

async function extractScreenshot(file) {
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable && !isKnownSampleScreenshot(file)) {
    throw new Error(t("error.visionState"));
  }
  if (!capabilities.visionExtraction) {
    if (isKnownSampleScreenshot(file)) {
      await new Promise((resolve) => setTimeout(resolve, 650));
      return { extraction: sampleTikTokExtraction, mode: "sample" };
    }
    throw new Error(t("error.visionMissing"));
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
  throw new Error(t("error.visionMissing"));
}

function visionErrorMessage(payload = {}) {
  return {
    VISION_TIMEOUT: t("error.visionTimeout"),
    VISION_RATE_LIMITED: t("error.visionBusy"),
    VISION_AUTH_ERROR: t("error.visionAuth"),
    INVALID_IMAGE: t("error.invalidImage"),
    INVALID_MODEL_OUTPUT: t("error.invalidModel")
  }[payload.code] || (currentLocale() === "ja" ? payload.error : "") || t("error.visionTemporary");
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
  if (state.exampleInput) {
    state.candidates = createExampleCandidates(query, { inputType: state.analysisInputType || "example" });
    state.candidatePreviews = {};
    state.candidatePreviewLoadingId = "";
    state.rejectedCandidateIds = [];
    state.confirmedCandidate = null;
    state.resultFocus = "";
    state.candidateMode = "demo";
    state.view = "candidates";
    render();
    return;
  }
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable || !capabilities.placesSearch) {
    enterSearchRecovery({ reason: "unavailable", query, clues });
    return;
  }
  let response;
  let payload;
  try {
    response = await fetch("/api/restaurants/search", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...pilotAccessHeaders(state.settings) },
      body: JSON.stringify({ query, clues })
    });
    payload = await response.json().catch(() => ({}));
  } catch {
    enterSearchRecovery({ reason: "failed", query, clues });
    return;
  }
  if (!response.ok) {
    const error = apiResponseError(payload, t("error.realSearch"));
    if (pilotAccessRejected(error)) throw error;
    enterSearchRecovery({ reason: "failed", query, clues });
    return;
  }
  if (!payload.candidates?.length) {
    enterSearchRecovery({ reason: "no_results", query, clues });
    return;
  }
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
    if (!response.ok) throw apiResponseError(payload, t("error.rating"));
    state.candidatePreviews = { ...state.candidatePreviews, [placeId]: payload.preview };
    postEvent("candidate_preview_loaded", { placeId, sourceMode: state.analysisSourceMode || "live", cacheStatus: payload.cacheStatus });
  } catch (error) {
    if (recoverFromPilotAccessError(error)) return;
    showToast(error.message || t("error.ratingShort"));
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
    if (!response.ok) throw apiResponseError(payload, t("error.details"));
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
    showToast(error.message || t("error.detailsShort"));
    render();
  }
}

function apiResponseError(payload = {}, fallbackMessage) {
  const error = new Error(currentLocale() === "ja" ? payload.error || fallbackMessage : fallbackMessage);
  error.code = typeof payload.code === "string" ? payload.code : "";
  return error;
}

function recoverFromPilotAccessError(error) {
  if (!pilotAccessRejected(error)) return false;
  state.settings = settingsWithoutPilotAccess(state.settings);
  state.loadingMode = "";
  state.analysisError = t("error.accessInvalidBody");
  state.view = "home";
  syncSettings();
  render();
  requestAnimationFrame(() => document.querySelector("#pilot-access-code")?.focus());
  showToast(t("error.accessInvalid"));
  return true;
}

function formatClientTime(value) {
  try {
    return new Intl.DateTimeFormat(currentLocale(), { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
  } catch {
    return value;
  }
}

function businessStatusLabel(value) {
  const labels = currentLocale() === "en"
    ? { OPERATIONAL: "Google Maps: Open", CLOSED_TEMPORARILY: "Google Maps: Temporarily closed", CLOSED_PERMANENTLY: "Google Maps: Permanently closed", unknown: "Google Maps: Check operating status" }
    : currentLocale() === "zh-CN"
      ? { OPERATIONAL: "Google Maps：营业中", CLOSED_TEMPORARILY: "Google Maps：临时停业", CLOSED_PERMANENTLY: "Google Maps：已停业", unknown: "Google Maps：营业状态待确认" }
      : { OPERATIONAL: "Google Maps：営業中", CLOSED_TEMPORARILY: "Google Maps：臨時休業", CLOSED_PERMANENTLY: "Google Maps：閉業", unknown: "Google Maps：営業状況を要確認" };
  return labels[value] || labels.unknown;
}

async function shareCurrentResult() {
  const payload = buildSharePayload(state.restaurant);
  try {
    if (typeof navigator.share === "function") {
      await navigator.share(payload);
      postEvent("share_result_clicked", { actionType: "native_share" });
      showToast(t("share.opened"));
      return;
    }
    await navigator.clipboard.writeText(payload.text);
    postEvent("share_result_clicked", { actionType: "clipboard" });
    showToast(t("share.copied"));
  } catch (error) {
    if (error?.name !== "AbortError") showToast(t("share.failed"));
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
    reader.onerror = () => reject(new Error(t("error.fileUnreadable")));
    reader.readAsDataURL(file);
  });
}

function renderSaved() {
  const savedPlans = sortSavedPlansByUrgency(state.saved);
  app.innerHTML = `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">${t("common.backHome")}</button>
    <div class="section-heading"><span class="step-chip">${t("saved.step")}</span><h2>${t("saved.title")}</h2><p>${t("saved.body")}</p></div>
    ${state.saved.length ? `<div class="saved-list">${savedPlans.map((r) => `<article><div class="saved-main"><span class="plan-status status-${esc(r.planStatus)}">${esc(localizedPlanStatus(r.planStatus))}</span>${r.sourceMode === "demo" ? `<span class="example-list-badge">${t("example.badge")}</span>` : ""}<h3>${esc(r.name)}</h3><p>${r.planDate ? `${esc(r.planDate)}${r.planTime ? ` · ${esc(r.planTime)}` : ""} · ${t("saved.people", { count: esc(r.partySize) })}` : `${t("saved.dateUnknown")} · ${t("saved.people", { count: esc(r.partySize) })}`}</p><small>${t("saved.lastCheck", { time: r.lastAnalyzedAt ? formatClientTime(r.lastAnalyzedAt) : t("saved.noRecord") })}</small></div><div class="saved-controls"><select data-plan-status="${esc(r.id)}" aria-label="${t("saved.updateAria", { name: esc(r.name) })}">${PLAN_STATUSES.map((item) => `<option value="${item.value}" ${item.value === r.planStatus ? "selected" : ""}>${localizedPlanStatus(item.value)}</option>`).join("")}</select><button data-open-saved="${esc(r.id)}" aria-label="${t("saved.recheckAria", { name: esc(r.name) })}">${icons.arrow}</button><button class="delete-plan" data-delete-saved="${esc(r.id)}" aria-label="${t("saved.deleteAria", { name: esc(r.name) })}">×</button></div></article>`).join("")}</div>` : `<div class="empty-state"><span>た</span><h3>${t("saved.emptyTitle")}</h3><p>${t("saved.emptyBody")}</p><button class="primary-button" data-action="home">${t("saved.start")} ${icons.arrow}</button></div>`}
  </section>`;
  document.querySelectorAll("[data-open-saved]").forEach((button) => button.addEventListener("click", async () => {
    const item = state.saved.find((saved) => saved.id === button.dataset.openSaved);
    resetAnalysisAttribution();
    state.analysisInputType = "restaurant_name";
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
    showToast(t("saved.statusUpdated"));
  }));
  document.querySelectorAll("[data-delete-saved]").forEach((button) => button.addEventListener("click", () => {
    state.saved = state.saved.filter((item) => item.id !== button.dataset.deleteSaved);
    postEvent("removed_from_list", { analysisRunId: null });
    showToast(t("saved.removed"));
    renderSaved();
    syncSaved();
  }));
}

function renderHistory() {
  app.innerHTML = `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">${t("common.backHome")}</button>
    <div class="section-heading"><span class="step-chip">${t("history.step")}</span><h2>${t("history.title")}</h2><p>${t("history.body")}</p></div>
    ${state.recent.length ? `<div class="saved-list">${state.recent.map((item) => `<article><div class="saved-main"><span class="plan-status">${item.sourceMode === "live" ? t("history.live") : t("history.demo")}</span><h3>${esc(item.name)}</h3><p>${esc(item.area || t("history.areaUnknown"))}${item.planDate ? ` · ${esc(item.planDate)}${item.planTime ? ` ${esc(item.planTime)}` : ""} · ${t("saved.people", { count: esc(item.partySize) })}` : ""}</p><small>${t("history.checkedAt", { time: formatClientTime(item.analyzedAt) })}</small></div><div class="saved-controls history-controls"><button data-open-recent="${esc(item.id)}" aria-label="${t("history.openAria", { name: esc(item.name) })}">${icons.arrow}</button><button class="delete-plan" data-delete-recent="${esc(item.id)}" aria-label="${t("history.deleteAria", { name: esc(item.name) })}">×</button></div></article>`).join("")}</div>` : `<div class="empty-state"><span>た</span><h3>${t("history.emptyTitle")}</h3><p>${t("history.emptyBody")}</p><button class="primary-button" data-action="home">${t("saved.start")} ${icons.arrow}</button></div>`}
  </section>`;
  document.querySelectorAll("[data-open-recent]").forEach((button) => button.addEventListener("click", () => openRecentAnalysis(button.dataset.openRecent)));
  document.querySelectorAll("[data-delete-recent]").forEach((button) => button.addEventListener("click", () => {
    state.recent = state.recent.filter((item) => item.id !== button.dataset.deleteRecent);
    syncRecent();
    showToast(t("history.removed"));
    renderHistory();
  }));
}

function renderQueue() {
  app.innerHTML = `<section class="content-view narrow saved-view">
    <button class="back-button" data-action="home">${t("common.backHome")}</button>
    <div class="section-heading"><span class="step-chip">${t("queue.step")}</span><h2>${t("queue.title")}</h2><p>${t("queue.body")}</p></div>
    <section class="panel batch-queue-panel"><p class="overline">${t("queue.batch")}</p><h3>${t("queue.batchTitle")}</h3><p>${t("queue.batchBody")}</p><form id="batch-queue-form"><textarea name="restaurants" rows="6" maxlength="10000" placeholder="${esc(t("queue.placeholder"))}"></textarea><div><small>${t("queue.limit")}</small><button type="submit">${t("queue.add")}</button></div></form></section>
    ${state.pending.length ? `<div class="saved-list queue-list">${state.pending.map((item) => `<article><div class="saved-main"><span class="plan-status">${esc(platformLabel(item.sourcePlatform))}</span><h3>${esc(item.clues.name)}</h3><p>${esc([item.clues.branch, item.clues.area || item.clues.address].filter(Boolean).join(" · ") || t("queue.locationUnknown"))}</p><small>${t("queue.addedAt", { time: formatClientTime(item.addedAt) })}</small></div><div class="saved-controls history-controls"><button data-open-pending="${esc(item.id)}" aria-label="${t("queue.openAria", { name: esc(item.clues.name) })}">${icons.arrow}</button><button class="delete-plan" data-delete-pending="${esc(item.id)}" aria-label="${t("queue.deleteAria", { name: esc(item.clues.name) })}">×</button></div></article>`).join("")}</div>` : `<div class="empty-state"><span>✓</span><h3>${t("queue.emptyTitle")}</h3><p>${t("queue.emptyBody")}</p><button class="primary-button" data-action="home">${t("queue.addImage")} ${icons.arrow}</button></div>`}
  </section>`;
  document.querySelector("#batch-queue-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const parsed = parseBatchRestaurantLines(new FormData(event.currentTarget).get("restaurants"));
    if (!parsed.restaurants.length) {
      showToast(t("queue.inputRequired"));
      return;
    }
    const before = state.pending.length;
    state.pending = addPendingRestaurants(state.pending, parsed.restaurants, { sourcePlatform: "unknown" });
    const added = state.pending.length - before;
    syncPending();
    postEvent("pending_queue_added", { queueCount: state.pending.length, analysisRunId: null });
    renderQueue();
    showToast(parsed.truncated ? t("queue.addedTruncated", { count: added }) : added ? t("queue.added", { count: added }) : t("queue.duplicate"));
  });
  document.querySelectorAll("[data-open-pending]").forEach((button) => button.addEventListener("click", () => openPendingAnalysis(button.dataset.openPending)));
  document.querySelectorAll("[data-delete-pending]").forEach((button) => button.addEventListener("click", () => {
    state.pending = removePendingAnalysis(state.pending, button.dataset.deletePending);
    syncPending();
    postEvent("pending_queue_removed", { queueCount: state.pending.length, analysisRunId: null });
    renderQueue();
    showToast(t("queue.removed"));
  }));
}

async function openPendingAnalysis(id) {
  const item = state.pending.find((entry) => entry.id === id);
  if (!item) return;
  const capabilities = await getCapabilities();
  if (capabilities.capabilitiesUnavailable) {
    showToast(t("error.service"));
    return;
  }
  const parsed = pendingAnalysisToTextExtraction(item, state.settings.defaultPartySize);
  if (!parsed) return;
  state.analysisRunId = createAnalysisRunId();
  state.analysisSourceMode = "live";
  state.analysisInputType = "restaurant_name";
  state.exampleInput = false;
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
  state.analysisInputType = item.sourceMode === "demo" ? item.snapshot?.exampleInputType || "example" : "restaurant_name";
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
  const publicInfo = currentPublicInfo();
  const operator = publicInfo.operatorName;
  const contact = publicInfo.contactEmail;
  const local = summarizeLocalData(state.saved, state.recent, state.pending);
  const localized = currentLegalContent()?.privacy;
  if (localized) {
    const counts = [local.savedPlanCount, local.pendingAnalysisCount, local.recentAnalysisCount, 0];
    app.innerHTML = `<section class="content-view narrow privacy-view">
      <button class="back-button" data-action="home">${t("common.backHome")}</button>
      <div class="section-heading"><span class="step-chip">${localized.step}</span><h1>${localized.title}</h1><p>${localized.intro.replace("{date}", TERMS_EFFECTIVE_DATE)}</p></div>
      <div class="privacy-summary">${localized.cards.map((card, index) => `<article><span>${counts[index]}</span><strong>${card[0]}</strong><p>${card[1]}</p></article>`).join("")}</div>
      <section class="panel privacy-section"><p class="overline">${currentLegalContent().terms.operator}</p><h2>${esc(operator)}</h2><p><a href="mailto:${esc(contact)}">${esc(contact)}</a></p></section>
      <section class="panel privacy-section"><h2>${localized.localTitle}</h2><p>${localized.localBody}</p></section>
      <section class="panel privacy-section"><h2>${localized.providersTitle}</h2><p>${localized.providersBody}</p></section>
      <section class="panel privacy-section"><h2>${localized.metricsTitle}</h2><p>${localized.metricsBody}</p></section>
      ${localized.retentionTitle ? `<section class="panel privacy-section"><h2>${localized.retentionTitle}</h2><p>${localized.retentionBody}</p></section>` : ""}
      ${localized.rightsTitle ? `<section class="panel privacy-section"><h2>${localized.rightsTitle}</h2><p>${localized.rightsBody}</p><p><a href="mailto:${esc(contact)}">${esc(contact)}</a></p></section>` : ""}
      <section class="danger-zone"><div><h2>${localized.deleteTitle}</h2><p>${localized.deleteBody}</p></div>${state.deleteConfirmOpen ? `<div class="delete-confirm"><strong>${localized.confirm}</strong><button id="cancel-delete">${localized.cancel}</button><button id="confirm-delete">${localized.deleteAll}</button></div>` : `<button id="start-delete" class="danger-button">${localized.deleteButton}</button>`}</section>
    </section>`;
    attachPrivacyDeleteHandlers();
    return;
  }
  app.innerHTML = `<section class="content-view narrow privacy-view">
    <button class="back-button" data-action="home">← ホームへ</button>
    <div class="section-heading"><span class="step-chip">プライバシーとデータ</span><h1>この端末のデータを管理できます</h1><p>更新日：${esc(TERMS_EFFECTIVE_DATE)} · ${isPublicRelease() ? "公開版 TabiTabi が扱う情報と、お問い合わせ方法を説明します。" : "招待制テストが扱うデータと、削除できる範囲を説明します。"}</p></div>
    <div class="privacy-summary"><article><span>${local.savedPlanCount}</span><strong>保存した予定</strong><p>このブラウザだけに保存。</p></article><article><span>${local.pendingAnalysisCount}</span><strong>確認待ちの店舗</strong><p>画像から得た店舗の手掛かりだけを保存。</p></article><article><span>${local.recentAnalysisCount}</span><strong>最近の確認</strong><p>必要最小限の履歴を最大10件保存。</p></article><article><span>0</span><strong>サーバーに保存する画像</strong><p>リクエスト内で処理し、本サービスのディスクには保存しません。</p></article></div>
    <section class="panel privacy-section"><p class="overline">運営者と連絡先</p><h2>${esc(operator)}</h2><p><a href="mailto:${esc(contact)}">${esc(contact)}</a></p></section>
    <section class="panel privacy-section"><p class="overline">この端末に保存</p><h2>行きたいリスト、確認待ち、履歴、設定</h2><ul>${local.fields.map((field) => `<li>${esc(field)}</li>`).join("")}${(isPublicRelease() ? [] : (local.sessionFields || [])).map((field) => `<li>${esc(field)}</li>`).join("")}</ul><p>オフラインでも画面を開けるよう、HTML、フロントエンドモジュール、スタイル、アイコンをブラウザにキャッシュする場合があります。API 応答、店舗結果、外部ページはキャッシュしません。確認待ちリストに元画像、反応数、投稿本文は保存しません。共有されたタイトル・文章・リンクは現在の画面にだけ入力し、アドレス欄からすぐ削除します。「確認をはじめる」を押すまで送信しません。実在店舗の Google Maps 住所・評価・営業時間、ホットペッパーグルメ詳細、入力された予約 URL は長期保存せず、再表示時に Place ID から更新します。</p></section>
    <section class="panel privacy-section"><p class="overline">リクエスト時に外部へ送信</p><h2>画像解析と店舗確認</h2><div class="data-flow-list"><p><strong>Qwen / OpenAI fallback</strong><span>画像を追加した場合だけ受け取ります。本サービスは画像をサーバーファイルへ保存しません。提供会社側の処理とログ期間は各社の規約に従います。</span></p><p><strong>Google Places</strong><span>店舗の検索語と、店舗確認または評価表示時の Place ID を受け取り、候補・住所・電話・評価・営業時間を返します。端末の位置情報は要求しません。</span></p><p><strong>ホットペッパーグルメ</strong><span>確認した店舗の店名・住所・電話を受け取り、店舗ページを照合します。</span></p><p><strong>店舗の公式サイト</strong><span>店舗確認後、検証済み公式サイトの公開 HTML をサーバーが取得し、予約入口、公式 Instagram、明示された予約ルールを探す場合があります。Instagram の投稿本文は自動取得しません。</span></p></div></section>
    <section class="panel privacy-section"><p class="overline">サービス運用記録</p><h2>匿名イベント、回答、技術指標</h2><p>入力の種類、候補確認、評価表示、行動ボタン、保存状況、API の成功状態、店舗確認から結果表示までの時間、token 使用量を記録します。表示した評価点そのものは記録しません。回答を送信した場合は、役立ち度、予約結果、正確性、最大500文字の改善コメントも記録します。画像、元の検索文、具体的な来店日、API Key は記録しません。運用ログは通常30日以内で削除し、件数とファイルサイズにも上限を設けます。現在はアカウントがないため、端末データの削除から集計済み運用記録を特定・削除することはできません。</p></section>
    ${isPublicRelease() ? `<section class="panel privacy-section"><p class="overline">保管期間と国外処理</p><h2>必要な期間と範囲に限定</h2><p>端末の予定と設定は削除するまでブラウザに残ります。画像解析は Alibaba Cloud Model Studio / Qwen のシンガポール国際リージョンで処理され、設定済みの予備モデルが必要な場合に限り OpenAI が処理することがあります。Google Places、Recruit / ホットペッパーグルメ、東京リージョンで本サービスをホストする Fly.io にも、依頼内容に応じた最小限の情報が送信されます。各社側の保管と国外移転の取扱いは各社の規約と設定に従います。</p></section><section class="panel privacy-section"><p class="overline">開示等のご請求・苦情</p><h2>運営者へメールでご連絡ください</h2><p>個人情報の開示、訂正、削除、利用停止その他のお問い合わせは、下記メールアドレスへご連絡ください。本人確認と対象記録の特定に必要な情報をお願いする場合があります。アカウントがなく、運用イベントを意図的に匿名化しているため、個人に結び付けられない記録があります。</p><p><a href="mailto:${esc(contact)}">${esc(contact)}</a></p></section>` : ""}
    <section class="danger-zone"><div><p class="overline">この端末のデータを削除</p><h2>予定、確認待ち、履歴、設定を消去</h2><p>行きたい予定 ${local.savedPlanCount} 件、確認待ち ${local.pendingAnalysisCount} 件、最近の確認 ${local.recentAnalysisCount} 件、人数などの端末設定を削除します。Google、ホットペッパーグルメ、Qwen、OpenAI、予約サービス側のデータには影響しません。</p></div>${state.deleteConfirmOpen ? `<div class="delete-confirm"><strong>この端末のデータをすべて完全に削除しますか？</strong><button id="cancel-delete">キャンセル</button><button id="confirm-delete">すべて削除</button></div>` : '<button id="start-delete" class="danger-button">この端末のデータを削除</button>'}</section>
  </section>`;
  attachPrivacyDeleteHandlers();
}

function attachPrivacyDeleteHandlers() {
  document.querySelector("#start-delete")?.addEventListener("click", () => { state.deleteConfirmOpen = true; renderPrivacy(); });
  document.querySelector("#cancel-delete")?.addEventListener("click", () => { state.deleteConfirmOpen = false; renderPrivacy(); });
  document.querySelector("#confirm-delete")?.addEventListener("click", () => {
    deleteLocalData(localStorage, sessionStorage);
    state.saved = [];
    state.recent = [];
    state.pending = [];
    state.activePendingId = null;
    state.settings = { ...DEFAULT_SETTINGS };
    state.deleteConfirmOpen = false;
    document.querySelector("#saved-count").textContent = "0";
    postEvent("local_data_deleted", { analysisRunId: null });
    showToast(currentLocale() === "en" ? "Data on this device was deleted" : currentLocale() === "zh-CN" ? "当前设备的数据已删除" : "この端末の予定、確認待ち、履歴、設定を削除しました");
    renderPrivacy();
  });
}

function renderPilot() {
  const publicInfo = currentPublicInfo();
  const contact = publicInfo.contactEmail;
  const localized = currentLegalContent()?.pilot;
  if (localized) {
    const subject = encodeURIComponent(currentLocale() === "en" ? "TabiTabi pilot participation" : "申请参加 TabiTabi 测试");
    const body = encodeURIComponent(currentLocale() === "en" ? "I would like to join the TabiTabi pilot.\n\nSNS I use:\nDevice: iPhone / Android\n" : "我希望参加 TabiTabi 测试。\n\n常用 SNS：\n设备：iPhone / Android\n");
    const mailto = contact ? `mailto:${encodeURIComponent(contact)}?subject=${subject}&body=${body}` : "";
    app.innerHTML = `<section class="content-view narrow pilot-view">
      <button class="back-button" data-action="home">${t("common.backHome")}</button>
      <div class="pilot-hero"><span class="step-chip">${localized.step}</span><h1>${localized.title}</h1><p>${localized.intro}</p></div>
      <section class="pilot-criteria">${localized.criteria.map((item, index) => `<article><span>0${index + 1}</span><strong>${item[0]}</strong><p>${item[1]}</p></article>`).join("")}</section>
      <section class="panel pilot-task"><h2>${localized.taskTitle}</h2><ol>${localized.tasks.map((item) => `<li>${item}</li>`).join("")}</ol></section>
      <aside class="pilot-safety"><strong>${localized.safetyTitle}</strong><p>${localized.safetyBody}</p></aside>
      <section class="panel pilot-join"><div><h2>${localized.joinTitle}</h2><p>${localized.joinBody}</p></div><div class="pilot-actions">${mailto ? `<a class="${isPublicRelease() ? "secondary-button" : "primary-button"}" href="${esc(mailto)}">${localized.email}${isPublicRelease() ? "" : ` ${icons.arrow}`}</a>` : ""}<a class="${isPublicRelease() ? "primary-button" : "secondary-button"}" href="/" data-action="home">${localized.haveCode}${isPublicRelease() ? ` ${icons.arrow}` : ""}</a></div></section>
    </section>`;
    return;
  }
  if (isPublicRelease()) {
    const mailto = contact ? `mailto:${encodeURIComponent(contact)}?subject=${encodeURIComponent("TabiTabi お問い合わせ")}` : "";
    app.innerHTML = `<section class="content-view narrow pilot-view">
      <button class="back-button" data-action="home">← ホームへ</button>
      <div class="pilot-hero"><span class="step-chip">公開ベータ</span><h1>SNSで見つけた店を、<br>行ける情報に。</h1><p>Instagram、TikTok などで見つけた飲食店を、実在する店舗と次の行動へつなげます。</p></div>
      <section class="pilot-criteria" aria-label="ご利用前の確認"><article><span>01</span><strong>公開情報を使用</strong><p>DM、通知、非公開投稿、他人の個人情報を含む画像は使用しないでください。</p></article><article><span>02</span><strong>店舗と支店を確認</strong><p>AI の抽出結果をそのまま確定せず、候補の住所と支店をご確認ください。</p></article><article><span>03</span><strong>予約成立は最終画面で確認</strong><p>TabiTabi の案内やリンクを開くだけでは予約は成立しません。</p></article></section>
      <aside class="pilot-safety"><strong>公開ベータについて</strong><p>情報源、判断の限界、外部サービスの種類を表示しますが、すべての情報が常に完全・最新であることは保証しません。</p></aside>
      <section class="panel pilot-join"><div><h2>今すぐ試す</h2><p>招待コードは不要です。店名、リンク、公開 SNS のスクリーンショットから始められます。</p></div><div class="pilot-actions"><a class="primary-button" href="/" data-action="home">店舗を確認する ${icons.arrow}</a>${mailto ? `<a class="secondary-button" href="${esc(mailto)}">運営者へ問い合わせ</a>` : ""}</div></section>
    </section>`;
    return;
  }
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
  const providerStopUntil = capabilities.providerCircuit?.openUntil ? new Date(capabilities.providerCircuit.openUntil).toLocaleString(currentLocale()) : t("settings.untilAdmin");
  const degradedProviders = Array.isArray(capabilities.providerCircuit?.degradedProviders) ? capabilities.providerCircuit.degradedProviders.map((item) => item.provider).join(", ") : "";
  const providerStopMessage = capabilities.emergencyStop ? t("settings.allStopped") : t("settings.someStopped", { providers: degradedProviders || t("settings.someProviders") });
  const providers = [
    { label: t("settings.vision"), ready: Boolean(capabilities.visionExtraction), detail: capabilities.models?.map((item) => `${item.provider}: ${item.model}`).join(" → ") || t("settings.modelNotSet") },
    { label: t("settings.fallback"), ready: Boolean(capabilities.fallbackAvailable), detail: capabilities.fallbackAvailable ? t("settings.fallbackReady") : t("settings.fallbackMissing") },
    { label: t("settings.places"), ready: Boolean(capabilities.placesSearch), detail: capabilities.placesSearch ? t("settings.availableDetails") : t("settings.demoCandidates") },
    { label: t("settings.hotpepper"), ready: Boolean(capabilities.hotPepper), detail: capabilities.hotPepper ? t("settings.availableEnrichment") : t("settings.noEnrichment") },
    { label: t("settings.webpage"), ready: Boolean(capabilities.webpageExtraction), detail: capabilities.webpageExtraction ? t("settings.webReady") : t("settings.notSet") }
  ];
  const settingsIntro = capabilities.publicReleaseMode
    ? ({ ja: "設定は現在のブラウザに保存されます。公開ベータでは招待アクセスコードは使用しません。", en: "Preferences are saved in this browser. The public beta does not use an invitation code.", "zh-CN": "设置保存在当前浏览器中。公开测试版不使用邀请码。" }[currentLocale()] || t("settings.intro"))
    : t("settings.intro");
  app.innerHTML = `<section class="content-view narrow settings-view">
    <button class="back-button" data-action="home">${t("common.backHome")}</button>
    <div class="section-heading"><span class="step-chip">${t("settings.step")}</span><h2>${t("settings.title")}</h2><p>${settingsIntro}</p></div>
    <section class="panel language-settings"><p class="overline">${t("settings.languageOverline")}</p><h2>${t("settings.languageTitle")}</h2><label>${t("settings.languageLabel")}<select id="settings-language-select">${SUPPORTED_LOCALES.map((item) => `<option value="${item.value}" ${item.value === currentLocale() ? "selected" : ""}>${item.label}</option>`).join("")}</select></label><aside><strong>${t("settings.translationTitle")}</strong><span>${t("settings.translationBody")}</span></aside></section>
    <section class="panel"><p class="overline">${t("settings.defaults")}</p><h2>${t("settings.reduceInput")}</h2><form id="settings-form" class="settings-form">
      <input type="hidden" name="locale" value="${esc(currentLocale())}">
      <label>${t("settings.party")}<input type="number" name="defaultPartySize" min="1" max="20" value="${esc(state.settings.defaultPartySize)}"></label>
      ${capabilities.publicReleaseMode ? "" : `<label>${t("settings.access")}${capabilities.pilotAccessRequired ? t("settings.required") : t("settings.optional")}<input type="password" name="pilotAccessCode" maxlength="256" autocomplete="off" value="${esc(state.settings.pilotAccessCode)}" placeholder="${t("home.accessHelp")}"><small>${capabilities.pilotAccessRequired ? t("settings.accessRequiredHelp") : t("settings.accessOptionalHelp")}</small></label>${state.settings.pilotAccessCode ? `<button type="button" class="text-button clear-access-code" id="clear-access-code">${t("settings.clearAccess")}</button>` : ""}`}
      <label class="settings-toggle"><input type="checkbox" name="saveRecentAnalyses" ${state.settings.saveRecentAnalyses ? "checked" : ""}><span><strong>${t("settings.history")}</strong><small>${t("settings.historyHelp")}</small></span></label>
      <button type="submit" class="primary-button">${t("settings.submit")}</button>
    </form></section>
    <details class="operations-settings"><summary><span>${t("settings.operationsTitle")}</span><small>${t("settings.operationsBody")}</small></summary><div class="operations-settings-body">
      ${providerStopped ? `<aside class="inline-error"><strong>${t("settings.apiStopped")}</strong><span>${esc(providerStopMessage)} ${t("settings.resume", { time: esc(providerStopUntil) })}</span></aside>` : ""}
      <section class="panel capability-panel"><div class="panel-heading"><div><p class="overline">${t("settings.capabilities")}</p><h2>${t("settings.apiStatus")}</h2></div><button type="button" class="text-button" id="refresh-capabilities">${t("settings.refresh")}</button></div>${capabilitiesUnavailable ? `<aside class="inline-error"><strong>${t("settings.unavailable")}</strong><span>${t("settings.unavailableBody")}</span></aside>` : `<div class="capability-grid">${providers.map((item) => `<article class="${item.ready ? "ready" : "pending"}"><span>${item.ready ? t("settings.ready") : t("settings.notSet")}</span><strong>${esc(item.label)}</strong><p>${esc(item.detail)}</p></article>`).join("")}</div>`}<p class="source-disclaimer">${t("settings.keysHidden")}</p></section>
      ${renderDailyBudget(budget)}
    </div></details>
  </section>`;
  document.querySelector("#settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings = settingsFromForm(Object.fromEntries(new FormData(event.currentTarget)));
    syncSettings();
    showToast(t("settings.saved"));
    renderSettings();
  });
  document.querySelector("#settings-language-select")?.addEventListener("change", (event) => {
    state.settings = normalizeSettings({ ...state.settings, locale: event.currentTarget.value });
    syncSettings();
    render();
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
    showToast(t("settings.localeSaved"));
  });
  document.querySelector("#clear-access-code")?.addEventListener("click", () => {
    state.settings = { ...state.settings, pilotAccessCode: "" };
    syncSettings();
    showToast(t("settings.accessCleared"));
    renderSettings();
  });
  document.querySelector("#refresh-capabilities")?.addEventListener("click", async (event) => {
    event.currentTarget.disabled = true;
    const latest = await getCapabilities({ force: true });
    showToast(latest.capabilitiesUnavailable ? t("settings.unavailable") : t("settings.refreshed"));
    renderSettings();
  });
}

function renderDailyBudget(budget = {}) {
  const labels = { vision_requests: t("settings.bucketVision"), vision_qwen_attempts: t("settings.bucketQwen"), vision_openai_fallback_attempts: t("settings.bucketOpenAI"), places_search: t("settings.bucketSearch"), places_details: t("settings.bucketDetails"), hotpepper_attempts: t("settings.bucketHotPepper") };
  const rows = Object.entries(budget.buckets || {}).map(([key, item]) => {
    const limit = Number(item?.limit) || 0;
    const used = Number(item?.used) || 0;
    const remaining = Math.max(Number(item?.remaining) || 0, 0);
    return `<article><div><strong>${esc(labels[key] || key)}</strong><span>${t("settings.budgetRow", { used: esc(used), limit: esc(limit), remaining: esc(remaining) })}</span></div><progress value="${esc(used)}" max="${esc(limit || 1)}"></progress></article>`;
  }).join("");
  if (!rows) return "";
  return `<section class="panel budget-panel"><p class="overline">${t("settings.budget")}</p><h2>${t("settings.budgetTitle")}</h2><p>${t("settings.budgetBody", { date: esc(budget.date || new Date().toLocaleDateString(currentLocale())) })}</p><div class="budget-grid">${rows}</div></section>`;
}

function renderTerms() {
  const publicInfo = currentPublicInfo();
  const localized = currentLegalContent()?.terms;
  if (localized) {
    app.innerHTML = `<section class="content-view narrow terms-view">
      <button class="back-button" data-action="home">${t("common.backHome")}</button>
      <div class="section-heading"><span class="step-chip">${localized.step}</span><h1>${localized.title}</h1><p>${localized.intro.replace("{date}", TERMS_EFFECTIVE_DATE)}</p></div>
      <aside class="terms-highlight"><strong>${localized.highlightTitle}</strong><p>${localized.highlightBody}</p></aside>
      <div class="terms-list">${localized.sections.map((section, index) => `<section class="panel terms-section"><span>${String(index + 1).padStart(2, "0")}</span><div><h3>${section[0]}</h3><p>${section[1]}</p></div></section>`).join("")}</div>
      <p class="terms-footer-note">${localized.operator}: ${esc(publicInfo.operatorName)} · ${localized.contact}: <a href="mailto:${esc(publicInfo.contactEmail)}">${esc(publicInfo.contactEmail)}</a></p>
      <p class="terms-footer-note">${localized.continue}</p>
    </section>`;
    return;
  }
  app.innerHTML = `<section class="content-view narrow terms-view">
    <button class="back-button" data-action="home">← ホームへ</button>
    <div class="section-heading"><span class="step-chip">利用条件</span><h1>サービスの範囲と責任</h1><p>適用日：${esc(TERMS_EFFECTIVE_DATE)} · ${isPublicRelease() ? "公開版 TabiTabi に適用されます。" : "現在の TabiTabi 招待制テストに適用されます。"}</p></div>
    <aside class="terms-highlight"><strong>最も大切なこと</strong><p>TabiTabi が示すのは次の行動であり、予約の確定ではありません。店舗や予約サービスの最終画面、電話回答、確認メールをご確認ください。</p></aside>
    <div class="terms-list">${(isPublicRelease() ? PUBLIC_TERMS_SECTIONS : TERMS_SECTIONS).map((section, index) => `<section class="panel terms-section"><span>${String(index + 1).padStart(2, "0")}</span><div><h3>${esc(section.title)}</h3>${section.paragraphs.map((paragraph) => `<p>${esc(paragraph)}</p>`).join("")}</div></section>`).join("")}</div>
    <p class="terms-footer-note">運営者：${esc(publicInfo.operatorName)} · お問い合わせ：<a href="mailto:${esc(publicInfo.contactEmail)}">${esc(publicInfo.contactEmail)}</a></p>
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

document.querySelector("#language-select")?.addEventListener("change", (event) => {
  state.settings = normalizeSettings({ ...state.settings, locale: event.currentTarget.value });
  syncSettings();
  render();
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "auto" }));
  showToast(t("settings.localeSaved"));
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
