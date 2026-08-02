import { auditLaunchPath, isScreenshotAuditSource } from "./audit-routing.js";
import { scenarioAuditGuidance } from "./audit-scenario-guidance.js";
import { markAuditPassed, mobileAuditFinished, nextUnfinishedCaseId } from "./audit-progress.js";

const LOCAL_KEY = "tabitabi_local_audit_drafts_v1";
const app = document.querySelector("#audit-app");
const toast = document.querySelector("#audit-toast");
const initialUrl = new URL(window.location.href);
if (initialUrl.searchParams.has("token")) {
  initialUrl.searchParams.delete("token");
  history.replaceState(null, "", `${initialUrl.pathname}${initialUrl.search}${initialUrl.hash}`);
}

const state = {
  bundle: null,
  tab: "cases",
  filter: "remaining",
  scenarioFilter: "remaining",
  selectedCaseId: "",
  selectedScenarioId: "",
  auditDrafts: {},
  scenarioDrafts: {},
  saving: false
};

load();

async function load() {
  try {
    const response = await fetch("/api/audit/bundle", { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "无法读取本地评估数据");
      error.code = payload.code || "";
      throw error;
    }
    state.bundle = payload;
    hydrateDrafts();
    selectDefaults();
    render();
  } catch (error) {
    const command = error.code === "AUDIT_AUTH_REQUIRED" ? "npm run audit:mobile" : "npm run audit";
    app.innerHTML = `<section class="fatal"><h2>${error.code === "AUDIT_AUTH_REQUIRED" ? "手机审计会话需要重新建立" : "审计工作台没有启动"}</h2><p>${esc(error.message)}</p><code>${command}</code></section>`;
  }
}

function hydrateDrafts() {
  const local = readLocalDrafts();
  const auditByCase = new Map(state.bundle.audits.map((item) => [item.caseId, item]));
  state.auditDrafts = Object.fromEntries(state.bundle.cases.map((testCase) => {
    const existing = auditByCase.get(testCase.id) || {};
    return [testCase.id, { ...blankAudit(testCase.id), ...existing, ...(local.audits?.[testCase.id] || {}) }];
  }));
  state.scenarioDrafts = Object.fromEntries(state.bundle.matrix.map((scenario) => [scenario.id, {
    id: scenario.id,
    status: scenario.status,
    linkedCaseId: scenario.linkedCaseId || "",
    evidence: scenario.evidence || [],
    notes: scenario.notes || "",
    ...(local.scenarios?.[scenario.id] || {})
  }]));
}

function selectDefaults() {
  state.selectedCaseId = nextUnfinishedCaseId(state.bundle.cases, state.auditDrafts, state.bundle.cases[0]?.id || "");
  state.selectedScenarioId = state.bundle.matrix.find((item) => item.status !== "confirmed")?.id || state.bundle.matrix[0]?.id || "";
}

function render() {
  const progress = state.bundle.progress;
  app.innerHTML = `
    ${renderAccessMode(state.bundle.access)}
    <section class="progress-grid">
      ${progressCard(progress.auditedCases, state.bundle.cases.length, "完整实机审计")}
      ${progressCard(progress.decisionAuditedCases, state.bundle.cases.length, "预约决策已核对")}
      ${progressCard(progress.completedScenarios, progress.totalScenarios, "风险场景已覆盖")}
    </section>
    ${renderPilotOverview(state.bundle.pilot)}
    <aside class="privacy-boundary"><strong>证据边界</strong><span>只记录结果、匿名案例 ID、公开 URL 或本地证据路径；不要粘贴原始截图、账号、评论、私信或 API Key。</span></aside>
    <nav class="audit-tabs" aria-label="审计类型">
      <button data-tab="cases" class="${state.tab === "cases" ? "active" : ""}">${state.bundle.cases.length} 例实机审计</button>
      <button data-tab="scenarios" class="${state.tab === "scenarios" ? "active" : ""}">${state.bundle.matrix.length} 个风险场景</button>
      <button data-export="audits">导出 manual-audits.json</button>
      <button data-export="matrix">导出 coverage-matrix.json</button>
    </nav>
    ${state.tab === "cases" ? renderCases() : renderScenarios()}`;
  bindEvents();
}

function renderAccessMode(access = {}) {
  if (access.mode === "lan") {
    const hours = Math.round((Number(access.sessionMaxAgeSeconds) || 0) / 3600) || 4;
    return `<aside class="access-mode lan"><strong>手机 · 可信 Wi-Fi 会话</strong><span>会话最长 ${hours} 小时；Mac 休眠、终端停止或服务重启后，请重新运行 <code>npm run audit:mobile</code> 并打开新地址。</span></aside>`;
  }
  return `<aside class="access-mode"><strong>Mac 本机审计</strong><span>当前只允许这台 Mac 访问；如需手机审计，请停止服务后运行 <code>npm run audit:mobile</code>。</span></aside>`;
}

function renderPilotOverview(pilot = {}) {
  const metrics = pilot.metrics || {};
  const gates = pilot.gates || {};
  const unavailable = pilot.reportStatus === "unavailable";
  const sourceLabel = pilot.reportSource === "remote" ? "远端 Fly 试点报告" : "未指定来源";
  const generatedAt = pilot.generatedAt ? ` · ${formatAuditTime(pilot.generatedAt)}` : "";
  return `<section class="pilot-overview">
    <div class="pilot-heading"><div><span>REAL PRODUCT TRAFFIC</span><h2>真实试运行</h2><p>${unavailable ? "远端报告暂时无法读取；不能把空值当成 0" : `当前版本累计 · 只读统计；${sourceLabel} · 审计、演示和旧版事件已排除${generatedAt}`}</p></div><button type="button" data-refresh-pilot>重新读取</button></div>
    ${unavailable ? `<aside class="pilot-report-unavailable" role="status"><strong>监测报告不可用</strong><span>${esc(pilot.note || "请重新生成远端试点报告后再判断今天的使用量。")}</span><code>npm run release:pilot-remote</code></aside>` : `<div class="pilot-grid">
      ${pilotCount(metrics.inputRuns, 20, "live 输入", gates.inputSample)}
      ${pilotCount(metrics.feedbackRuns, 10, "有效反馈", gates.feedbackSample)}
      ${pilotRate(metrics.analysisCompletionRate, 0.8, "分析完成率", gates.analysisCompletion)}
      ${pilotRate(metrics.actionRate, 0.35, "行动率", gates.actionRate)}
      ${pilotRate(metrics.helpfulRate, 0.6, "有帮助比例", gates.helpfulRate)}
    </div>`}
  </section>`;
}

function renderCases() {
  const visible = state.bundle.cases.filter((item) => caseVisible(item.id));
  if (!visible.some((item) => item.id === state.selectedCaseId)) state.selectedCaseId = visible[0]?.id || "";
  const testCase = state.bundle.cases.find((item) => item.id === state.selectedCaseId);
  return `<section class="workspace">
    <aside class="case-rail">
      <div class="filter-row">
        ${filterButton("remaining", "待完成")}${filterButton("all", "全部")}${filterButton("failed", "有问题")}
      </div>
      <div class="case-list">${visible.map(renderCaseListItem).join("") || '<p class="empty">当前筛选没有案例。</p>'}</div>
    </aside>
    <article class="audit-panel">${testCase ? renderCaseForm(testCase) : '<p class="empty">请选择一个案例。</p>'}</article>
  </section>`;
}

function renderCaseListItem(testCase, index) {
  const draft = state.auditDrafts[testCase.id];
  const status = draft.mobileFlow === "pending" ? "decision" : auditComplete(draft) ? "complete" : "pending";
  return `<button class="case-item ${testCase.id === state.selectedCaseId ? "active" : ""}" data-case-id="${esc(testCase.id)}">
    <span>${String(state.bundle.cases.indexOf(testCase) + 1).padStart(2, "0")}</span>
    <div><strong>${esc(testCase.clues?.name || testCase.query)}</strong><small>${esc(sourceLabel(testCase.sourceType))} · ${esc(testCase.clues?.branch || testCase.clues?.area || "分店待核对")}</small></div>
    <i class="status-${status}">${status === "complete" ? "完成" : status === "decision" ? "待手机" : "待审计"}</i>
  </button>`;
}

function renderCaseForm(testCase) {
  const draft = state.auditDrafts[testCase.id];
  const expected = [testCase.expected?.nameIncludes, ...(testCase.expected?.nameAnyOf || []), testCase.expected?.addressIncludes].filter(Boolean).join(" · ");
  const screenshotCase = isScreenshotAuditSource(testCase.sourceType);
  const appUrl = auditLaunchPath(testCase);
  return `<div class="panel-heading">
      <div><span>${esc(testCase.id)}</span><h2>${esc(testCase.clues?.name || testCase.query)}</h2><p>${esc(sourceLabel(testCase.sourceType))}</p></div>
      <a href="${appUrl}" target="_blank" rel="noreferrer">${screenshotCase ? "打开主产品并上传原图" : "在主产品打开此输入"} ↗</a>
    </div>
    ${screenshotCase ? '<aside class="screenshot-route"><strong>必须验证视觉路径</strong><p>请从手机相册手动上传这例对应的原始 SNS 截图。下方 query 仅用于核对预期结果，不能替代截图提交。</p></aside>' : ""}
    <section class="case-evidence">
      <div><small>实际提交输入</small><code>${esc(testCase.query)}</code></div>
      <div><small>预期识别</small><strong>${esc(expected || testCase.expected?.placeId || "查看官方证据")}</strong></div>
      <div class="official-links"><small>确认来源</small>${(testCase.officialSources || []).map((url) => `<a href="${esc(safeUrl(url))}" target="_blank" rel="noreferrer">${esc(hostLabel(url))} ↗</a>`).join("")}</div>
    </section>
    <form id="audit-form" data-case-form="${esc(testCase.id)}">
      <div class="field-grid">
        ${selectField("identification", "餐厅身份", draft.identification, [["", "请选择"], ["pass", "正确"], ["fail", "错误"]])}
        ${selectField("branchCorrect", "分店/地址", booleanValue(draft.branchCorrect), [["", "请选择"], ["true", "正确"], ["false", "错误"]])}
        ${selectField("bookingSafety", "预约建议安全性", draft.bookingSafety, [["", "请选择"], ["pass", "通过"], ["fail", "不通过"]])}
        ${selectField("severeActionError", "严重行动错误", booleanValue(draft.severeActionError), [["", "请选择"], ["false", "没有"], ["true", "存在"]])}
        ${selectField("mobileFlow", "手机完整流程", draft.mobileFlow, [["", "请选择"], ["pass", "通过"], ["fail", "完成但失败"], ["pending", "仅决策已核对"]])}
      </div>
      <label class="wide-field"><span>证据（每行一个公开 URL 或本地相对路径）</span><textarea name="evidence" rows="4" placeholder="output/manual/case-003-result.png">${esc((draft.evidence || []).join("\n"))}</textarea></label>
      <section class="evidence-upload">
        <div><strong>从手机上传结果页证据</strong><span>只接受本产品的结果页截图，不接受原始 SNS 截图；最大 4 MB。</span></div>
        <input type="file" id="evidence-file" accept="image/png,image/jpeg" />
        <label><input type="checkbox" id="evidence-privacy" /> 我已确认图片不含原始帖子、用户名、评论、私信、通知或 API Key。</label>
        <button type="button" id="upload-evidence">上传并加入证据</button>
      </section>
      <label class="wide-field"><span>备注（不要写入帖子原文或用户名）</span><textarea name="notes" rows="3" maxlength="2000">${esc(draft.notes || "")}</textarea></label>
      <div class="form-actions"><button type="button" data-save-draft>保存本机草稿</button><button type="button" data-fill-pass>检查无问题，填入通过项</button><button type="submit" class="primary" ${state.saving ? "disabled" : ""}>写入评估文件</button><button type="submit" class="primary" data-advance="next" ${state.saving ? "disabled" : ""}>写入并下一例</button><span>${auditComplete(draft) ? "字段完整" : "仍有必填项"}</span></div>
    </form>`;
}

function renderScenarios() {
  const visible = state.bundle.matrix.filter((item) => state.scenarioFilter === "all" || state.scenarioDrafts[item.id].status !== "confirmed");
  if (!visible.some((item) => item.id === state.selectedScenarioId)) state.selectedScenarioId = visible[0]?.id || "";
  const scenario = state.bundle.matrix.find((item) => item.id === state.selectedScenarioId);
  return `<section class="workspace">
    <aside class="case-rail"><div class="filter-row">
      <button data-scenario-filter="remaining" class="${state.scenarioFilter === "remaining" ? "active" : ""}>待完成</button>
      <button data-scenario-filter="all" class="${state.scenarioFilter === "all" ? "active" : ""}>全部</button>
    </div><div class="case-list">${visible.map((item) => {
      const draft = state.scenarioDrafts[item.id];
      const originalIndex = state.bundle.matrix.indexOf(item);
      return `<button class="case-item ${item.id === state.selectedScenarioId ? "active" : ""}" data-scenario-id="${esc(item.id)}"><span>${String(originalIndex + 1).padStart(2, "0")}</span><div><strong>${esc(item.riskTags.join(" · "))}</strong><small>${esc(sourceLabel(item.sourceType))}</small></div><i class="status-${draft.status === "confirmed" ? "complete" : "pending"}">${draft.status === "confirmed" ? "完成" : "计划"}</i></button>`;
    }).join("") || '<p class="empty">当前筛选没有场景。</p>'}</div></aside>
    <article class="audit-panel">${scenario ? renderScenarioForm(scenario) : '<p class="empty">请选择一个场景。</p>'}</article>
  </section>`;
}

function renderScenarioForm(scenario) {
  const draft = state.scenarioDrafts[scenario.id];
  const guidance = scenarioAuditGuidance(scenario);
  return `<div class="panel-heading"><div><span>${esc(scenario.id)}</span><h2>${esc(scenario.riskTags.join(" · "))}</h2><p>${esc(sourceLabel(scenario.sourceType))}</p></div></div>
    ${scenario.remainingVerification ? `<aside class="remaining"><strong>还缺什么</strong><p>${esc(scenario.remainingVerification)}</p></aside>` : ""}
    <section class="material-guide"><strong>你需要准备和执行</strong><ol>${guidance.map((item) => `<li>${esc(item)}</li>`).join("")}</ol></section>
    <form id="scenario-form" data-scenario-form="${esc(scenario.id)}">
      <div class="field-grid">
        ${selectField("status", "场景状态", draft.status, [["planned", "仍在计划"], ["confirmed", "已有真实证据"]])}
        <label><span>关联案例</span><select name="linkedCaseId"><option value="">不关联具体案例</option>${state.bundle.cases.map((item) => `<option value="${esc(item.id)}" ${item.id === draft.linkedCaseId ? "selected" : ""}>${esc(item.id)}</option>`).join("")}</select></label>
      </div>
      <label class="wide-field"><span>证据（每行一个）</span><textarea name="evidence" rows="5">${esc((draft.evidence || []).join("\n"))}</textarea></label>
      <label class="wide-field"><span>完成说明</span><textarea name="notes" rows="4" maxlength="2000">${esc(draft.notes || "")}</textarea></label>
      <div class="form-actions"><button type="button" data-save-draft>保存本机草稿</button><button type="submit" class="primary" ${state.saving ? "disabled" : ""}>写入场景文件</button></div>
    </form>`;
}

function bindEvents() {
  document.querySelector("[data-refresh-pilot]")?.addEventListener("click", load);
  document.querySelectorAll("[data-tab]").forEach((button) => button.addEventListener("click", () => { captureVisibleForm(); persistLocal(); state.tab = button.dataset.tab; render(); }));
  document.querySelectorAll("[data-filter]").forEach((button) => button.addEventListener("click", () => { captureVisibleForm(); persistLocal(); state.filter = button.dataset.filter; render(); }));
  document.querySelectorAll("[data-scenario-filter]").forEach((button) => button.addEventListener("click", () => { captureVisibleForm(); persistLocal(); state.scenarioFilter = button.dataset.scenarioFilter; render(); }));
  document.querySelectorAll("[data-case-id]").forEach((button) => button.addEventListener("click", () => { captureVisibleForm(); state.selectedCaseId = button.dataset.caseId; render(); }));
  document.querySelectorAll("[data-scenario-id]").forEach((button) => button.addEventListener("click", () => { captureVisibleForm(); state.selectedScenarioId = button.dataset.scenarioId; render(); }));
  document.querySelector("#audit-form")?.addEventListener("submit", saveAudit);
  document.querySelector("#scenario-form")?.addEventListener("submit", saveScenario);
  document.querySelector("#upload-evidence")?.addEventListener("click", uploadEvidence);
  document.querySelector("[data-fill-pass]")?.addEventListener("click", fillVisibleAuditPass);
  document.querySelectorAll("form select, form textarea").forEach((input) => input.addEventListener("change", () => { captureVisibleForm(); persistLocal(); }));
  document.querySelector("[data-save-draft]")?.addEventListener("click", () => { captureVisibleForm(); persistLocal(); showToast("本机草稿已保存"); render(); });
  document.querySelectorAll("[data-export]").forEach((button) => button.addEventListener("click", () => exportJson(button.dataset.export)));
}

function captureVisibleForm() {
  const auditForm = document.querySelector("#audit-form");
  if (auditForm) {
    const values = new FormData(auditForm);
    const caseId = auditForm.dataset.caseForm;
    state.auditDrafts[caseId] = {
      ...state.auditDrafts[caseId],
      caseId,
      identification: values.get("identification"),
      branchCorrect: parseBoolean(values.get("branchCorrect")),
      bookingSafety: values.get("bookingSafety"),
      severeActionError: parseBoolean(values.get("severeActionError")),
      mobileFlow: values.get("mobileFlow"),
      evidence: lines(values.get("evidence")),
      notes: String(values.get("notes") || "").trim()
    };
  }
  const scenarioForm = document.querySelector("#scenario-form");
  if (scenarioForm) {
    const values = new FormData(scenarioForm);
    const id = scenarioForm.dataset.scenarioForm;
    state.scenarioDrafts[id] = {
      ...state.scenarioDrafts[id],
      id,
      status: values.get("status"),
      linkedCaseId: values.get("linkedCaseId"),
      evidence: lines(values.get("evidence")),
      notes: String(values.get("notes") || "").trim()
    };
  }
}

async function saveAudit(event) {
  event.preventDefault();
  captureVisibleForm();
  const draft = state.auditDrafts[event.currentTarget.dataset.caseForm];
  if (!auditComplete(draft)) return showToast("请先完成全部判断并填写证据");
  draft.auditedAt = new Date().toISOString();
  await saveToServer({ audits: [draft] }, { advanceCase: event.submitter?.dataset.advance === "next" });
}

function fillVisibleAuditPass() {
  captureVisibleForm();
  const draft = state.auditDrafts[state.selectedCaseId];
  if (!draft) return;
  state.auditDrafts[state.selectedCaseId] = markAuditPassed(draft);
  persistLocal();
  showToast("已填入通过项；请补充结果页证据后再写入");
  render();
}

async function saveScenario(event) {
  event.preventDefault();
  captureVisibleForm();
  const draft = state.scenarioDrafts[event.currentTarget.dataset.scenarioForm];
  if (draft.status === "confirmed" && !draft.linkedCaseId && !draft.evidence.length) return showToast("完成场景需要关联案例或证据");
  await saveToServer({ scenarios: [draft] });
}

async function uploadEvidence() {
  captureVisibleForm();
  const file = document.querySelector("#evidence-file")?.files?.[0];
  const privacyAcknowledged = document.querySelector("#evidence-privacy")?.checked === true;
  if (!file) return showToast("请先选择结果页截图");
  if (!privacyAcknowledged) return showToast("请先完成隐私确认");
  if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 4 * 1024 * 1024) return showToast("请使用 4 MB 以内的 PNG 或 JPEG");
  const button = document.querySelector("#upload-evidence");
  button.disabled = true;
  try {
    const response = await fetch("/api/audit/evidence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caseId: state.selectedCaseId, privacyAcknowledged, imageDataUrl: await fileAsDataUrl(file) })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "证据上传失败");
    const draft = state.auditDrafts[state.selectedCaseId];
    draft.evidence = [...new Set([...(draft.evidence || []), result.path])];
    persistLocal();
    showToast("结果页证据已保存到 Mac");
    render();
  } catch (error) {
    showToast(error.message || "证据上传失败");
    button.disabled = false;
  }
}

async function saveToServer(payload, { advanceCase = false } = {}) {
  state.saving = true;
  render();
  try {
    const response = await fetch("/api/audit/save", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "写入失败");
    state.bundle = result;
    const selectedCaseId = state.selectedCaseId;
    const selectedScenarioId = state.selectedScenarioId;
    localStorage.removeItem(LOCAL_KEY);
    hydrateDrafts();
    state.selectedCaseId = advanceCase ? nextUnfinishedCaseId(state.bundle.cases, state.auditDrafts, selectedCaseId) : selectedCaseId;
    state.selectedScenarioId = selectedScenarioId;
    showToast("已原子写入评估文件");
  } catch (error) {
    showToast(error.message || "写入失败");
  } finally {
    state.saving = false;
    render();
  }
}

function exportJson(type) {
  captureVisibleForm();
  if (type === "audits") {
    const existing = new Map(state.bundle.audits.map((item) => [item.caseId, item]));
    for (const draft of Object.values(state.auditDrafts)) if (auditComplete(draft)) existing.set(draft.caseId, normalizedAudit(draft));
    downloadJson("manual-audits.json", state.bundle.cases.flatMap((item) => existing.has(item.id) ? [existing.get(item.id)] : []));
  } else {
    const result = state.bundle.matrix.map((item) => mergeScenarioForExport(item, state.scenarioDrafts[item.id]));
    downloadJson("coverage-matrix.json", result);
  }
}

function caseVisible(id) {
  const draft = state.auditDrafts[id];
  if (state.filter === "remaining") return !mobileAuditFinished(draft);
  if (state.filter === "failed") return draft.identification === "fail" || draft.branchCorrect === false || draft.bookingSafety === "fail" || draft.severeActionError === true || draft.mobileFlow === "fail";
  return true;
}

function auditComplete(draft) {
  return ["pass", "fail"].includes(draft.identification)
    && typeof draft.branchCorrect === "boolean"
    && typeof draft.severeActionError === "boolean"
    && ["pass", "fail"].includes(draft.bookingSafety)
    && ["pass", "fail", "pending"].includes(draft.mobileFlow)
    && Array.isArray(draft.evidence) && draft.evidence.length > 0;
}

function normalizedAudit(draft) {
  const result = {
    caseId: draft.caseId,
    status: draft.mobileFlow === "pending" ? "decision_audited" : "audited",
    identification: draft.identification,
    branchCorrect: draft.branchCorrect,
    severeActionError: draft.severeActionError,
    bookingSafety: draft.bookingSafety,
    mobileFlow: draft.mobileFlow,
    evidence: draft.evidence,
    auditedAt: draft.auditedAt || new Date().toISOString()
  };
  if (draft.notes) result.notes = draft.notes;
  return result;
}

function mergeScenarioForExport(current, draft) {
  if (!draft) return current;
  const result = { ...current, status: draft.status };
  if (draft.linkedCaseId) result.linkedCaseId = draft.linkedCaseId; else delete result.linkedCaseId;
  if (draft.evidence?.length) result.evidence = draft.evidence; else delete result.evidence;
  if (draft.notes) result.notes = draft.notes;
  return result;
}

function persistLocal() {
  localStorage.setItem(LOCAL_KEY, JSON.stringify({ audits: state.auditDrafts, scenarios: state.scenarioDrafts }));
}

function readLocalDrafts() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || "{}"); } catch { return {}; }
}

function blankAudit(caseId) {
  return { caseId, identification: "", branchCorrect: null, severeActionError: null, bookingSafety: "", mobileFlow: "", evidence: [], notes: "", auditedAt: "" };
}

function selectField(name, label, value, options) {
  return `<label><span>${esc(label)}</span><select name="${esc(name)}">${options.map(([optionValue, optionLabel]) => `<option value="${esc(optionValue)}" ${String(value ?? "") === optionValue ? "selected" : ""}>${esc(optionLabel)}</option>`).join("")}</select></label>`;
}

function progressCard(value, total, label) {
  return `<article><strong>${value}<small>/${total}</small></strong><span>${esc(label)}</span><progress value="${Number(value) || 0}" max="${Number(total) || 1}"></progress></article>`;
}

function pilotCount(value, target, label, passed) {
  const available = value !== null && value !== undefined && Number.isFinite(Number(value));
  const numeric = available ? Number(value) : 0;
  return `<article class="${passed ? "passed" : ""}"><strong>${available ? numeric : "—"}<small>/${target}</small></strong><span>${esc(label)}</span><progress ${available ? `value="${numeric}"` : ""} max="${target}"></progress></article>`;
}

function pilotRate(value, target, label, passed) {
  const numeric = Number(value);
  const available = typeof value === "number" && Number.isFinite(numeric);
  const percent = available ? Math.round(numeric * 100) : 0;
  return `<article class="${passed ? "passed" : ""}"><strong>${available ? `${percent}%` : "—"}<small>/${Math.round(target * 100)}%</small></strong><span>${esc(label)}</span><progress value="${percent}" max="100"></progress></article>`;
}

function formatAuditTime(value) {
  try { return new Intl.DateTimeFormat("ja-JP", { dateStyle: "short", timeStyle: "short" }).format(new Date(value)); }
  catch { return String(value || ""); }
}

function filterButton(value, label) { return `<button data-filter="${value}" class="${state.filter === value ? "active" : ""}">${label}</button>`; }
function booleanValue(value) { return typeof value === "boolean" ? String(value) : ""; }
function parseBoolean(value) { return value === "true" ? true : value === "false" ? false : null; }
function lines(value) { return [...new Set(String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean))].slice(0, 20); }
function sourceLabel(value) { return ({ tiktok_screenshot: "TikTok 截图", instagram_screenshot: "Instagram 截图", xiaohongshu_screenshot: "小红书截图", x_screenshot: "X 截图", social_link: "社交链接", text: "文字输入" })[value] || value || "未知来源"; }
function hostLabel(value) { try { return new URL(value).hostname; } catch { return "官方来源"; } }
function safeUrl(value) { try { const url = new URL(value); return ["http:", "https:"].includes(url.protocol) ? url.href : "#"; } catch { return "#"; } }
function esc(value = "") { return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

function downloadJson(filename, value) {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
  showToast(`${filename} 已导出`);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 2_400);
}

function fileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("无法读取证据图片"));
    reader.readAsDataURL(file);
  });
}
