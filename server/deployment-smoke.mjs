export class DeploymentSmokeError extends Error {
  constructor(stage, status, hint) {
    super(`${stage} failed${status ? ` (HTTP ${status})` : ""}. ${hint}`);
    this.name = "DeploymentSmokeError";
    this.stage = stage;
    this.status = status || null;
    this.hint = hint;
  }
}

export function validateSmokeImageMetadata({ extension = "", size = 0 } = {}) {
  const mime = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" }[String(extension).toLowerCase()];
  if (!mime) throw new Error("SMOKE_SCREENSHOT_PATH must be PNG, JPEG, or WebP");
  if (!Number.isFinite(size) || size <= 0 || size > 8 * 1024 * 1024) throw new Error("SMOKE_SCREENSHOT_PATH must be a non-empty file no larger than 8 MB");
  return mime;
}

export async function runDeploymentSmoke({ baseUrl, allowedOrigin = "https://tabitabi-jp.fly.dev", accessCode = "", screenshotDataUrl = "", live = false, fetchImpl = fetch } = {}) {
  const parsedBaseUrl = new URL(baseUrl);
  const local = ["127.0.0.1", "localhost"].includes(parsedBaseUrl.hostname);
  if (parsedBaseUrl.username || parsedBaseUrl.password || (parsedBaseUrl.protocol !== "https:" && !local)) {
    throw new Error("Deployment smoke requires HTTPS, except for localhost verification");
  }
  const origin = parsedBaseUrl.origin;
  if (!local && origin !== new URL(allowedOrigin).origin) throw new Error("TABITABI_BASE_URL is not the explicitly allowed production origin");
  const headers = accessCode ? { "X-Pilot-Access": accessCode } : {};
  const checks = {};
  checks.health = await expectJson("health", fetchImpl, `${origin}/healthz`, {}, (value) => value.status === "ok");
  checks.readiness = await expectJson("readiness", fetchImpl, `${origin}/readyz`, {}, (value) => value.ready === true);
  checks.capabilities = await expectJson("capabilities", fetchImpl, `${origin}/api/capabilities`, {}, (value) => value.visionExtraction === true && value.placesSearch === true && value.pilotAccessRequired === true);
  checks.privacy = await expectDocument("privacy", fetchImpl, `${origin}/privacy`);
  checks.terms = await expectDocument("terms", fetchImpl, `${origin}/terms`);
  if (live) {
    if (!screenshotDataUrl) throw new Error("SMOKE_SCREENSHOT_PATH is required for live provider smoke testing");
    checks.qwen = await expectJson("qwen", fetchImpl, `${origin}/api/extract-screenshot`, post({ imageDataUrl: screenshotDataUrl }, headers), (value) => Boolean(value.extraction?.restaurant?.name || value.extraction?.restaurants?.length));
    const search = await fetchJson("placesSearch", fetchImpl, `${origin}/api/restaurants/search`, post({ query: "ホームズパスタ 上野店", clues: { name: "ホームズパスタ", branch: "上野店", area: "上野" } }, headers));
    checks.placesSearch = Array.isArray(search.candidates) && search.candidates.some((item) => /ホームズパスタ/.test(item.name || ""));
    if (!checks.placesSearch) throw new Error("Live Places smoke did not return the expected restaurant");
    const candidate = search.candidates.find((item) => /ホームズパスタ/.test(item.name || ""));
    const details = await fetchJson("placesDetails", fetchImpl, `${origin}/api/restaurants/details`, post({ placeId: candidate.placeId, clues: { name: "ホームズパスタ", branch: "上野店", area: "上野" } }, headers));
    checks.placesDetails = Boolean(candidate.placeId && details.restaurant?.placeId === candidate.placeId);
    if (!checks.placesDetails) throw new Error("Live Place Details smoke returned a mismatched restaurant");
  }
  return { passed: Object.values(checks).every(Boolean), live, checks };
}

function post(body, headers) { return { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) }; }
async function fetchJson(stage, fetchImpl, url, options = {}) {
  let response;
  try { response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(15_000), ...options }); }
  catch { throw new DeploymentSmokeError(stage, null, "接続、TLS、許可されたホスト、または Fly のコールドスタートを確認してください。"); }
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new DeploymentSmokeError(stage, response.status, hintFor(response.status, value?.code));
  return value;
}
async function expectJson(stage, fetchImpl, url, options, validate) { const value = await fetchJson(stage, fetchImpl, url, options); if (!validate(value)) throw new DeploymentSmokeError(stage, null, "応答形式と本番設定を確認してください。"); return true; }
async function expectDocument(stage, fetchImpl, url) {
  let response;
  try { response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(15_000) }); }
  catch { throw new DeploymentSmokeError(stage, null, "公開ページへの接続と Fly の起動状態を確認してください。"); }
  const text = await response.text();
  if (!response.ok || !/id="app"/.test(text) || response.headers.get("x-tabitabi-document") !== stage) throw new DeploymentSmokeError(stage, response.status, "独立した公開ページのサーバールートを確認してください。");
  return true;
}
function hintFor(status, code) {
  if (status === 401) return "PILOT_ACCESS_CODE が本番 Secret と一致するか確認してください。";
  if (status === 429 && code === "DAILY_BUDGET_EXCEEDED") return "東京時間の翌日まで待ち、日次予算を手動で書き換えないでください。";
  if (status === 429) return "レート制限が解除されてから一度だけ再試行してください。";
  if (status === 503) return "/readyz の missing 項目と本番 Secret、Volume の書き込み権限を確認してください。";
  return "本番ログと対象 API の設定を確認してください。";
}
