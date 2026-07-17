import { isApprovedQwenBaseUrl } from "./qwen-endpoint.mjs";

export function evaluateDeploymentPreflight({ env = {}, flyConfig = "", dockerfile = "", releaseGate = null } = {}) {
  const fly = parseSimpleToml(flyConfig);
  const checks = {
    qwenKey: present(env.DASHSCOPE_API_KEY),
    qwenEndpoint: isApprovedQwenBaseUrl(env.DASHSCOPE_BASE_URL),
    qwenModel: String(env.QWEN_VISION_MODEL || "").trim() === "qwen3.6-flash",
    googlePlacesKey: present(env.GOOGLE_MAPS_API_KEY),
    pilotAccessCode: String(env.PILOT_ACCESS_CODE || "").trim().length >= 24,
    operatorName: present(env.PUBLIC_OPERATOR_NAME),
    contactEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(env.PUBLIC_CONTACT_EMAIL || "").trim()),
    emergencyStopReady: fly["env.PAID_API_EMERGENCY_STOP"] === "false",
    providerBudgetCaps: safeLimit(env.DAILY_VISION_REQUEST_LIMIT, 60, 60)
      && safeLimit(env.DAILY_QWEN_ATTEMPT_LIMIT, 60, 60)
      && safeLimit(env.DAILY_OPENAI_FALLBACK_LIMIT, 10, 10)
      && safeLimit(env.DAILY_PLACES_SEARCH_LIMIT, 90, 90)
      && safeLimit(env.DAILY_PLACES_DETAILS_LIMIT, 90, 90)
      && safeLimit(env.DAILY_HOTPEPPER_ATTEMPT_LIMIT, 60, 60)
      && safeLimit(env.VISION_MAX_OUTPUT_TOKENS, 1_200, 1_800, 256),
    flyTokyo: fly[".primary_region"] === "nrt",
    flyIdleLifecycle: fly["http_service.auto_start_machines"] === true && fly["http_service.auto_stop_machines"] === "stop" && fly["http_service.min_machines_running"] === 0,
    flyHttpsAndHealth: fly["http_service.force_https"] === true && fly["http_service.checks.path"] === "/healthz",
    flyMachineShape: fly["vm.size"] === "shared-cpu-1x" && fly["vm.memory"] === "512mb" && fly["vm.cpus"] === 1,
    flyPersistentData: fly["mounts.source"] === "tabitabi_data" && fly["mounts.destination"] === "/app/data",
    flySnapshots: fly["mounts.scheduled_snapshots"] === true && fly["mounts.snapshot_retention"] === 7,
    pinnedContainerBase: /^FROM\s+node:[^\s]+@sha256:[a-f0-9]{64}$/m.test(dockerfile),
    releaseEvidence: releaseGate?.gatePassed === true
  };
  return { passed: Object.values(checks).every(Boolean), checks, missing: Object.entries(checks).filter(([, value]) => !value).map(([name]) => name) };
}

export function parseEnvironmentFile(content = "") {
  const result = {};
  for (const line of String(content).split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    result[match[1]] = stripQuotes(match[2]);
  }
  return result;
}

export function flyApplicationName(content = "") {
  const value = parseSimpleToml(content)[".app"];
  return /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(String(value || "")) ? value : "";
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) return text.slice(1, -1);
  return text;
}

function present(value) { return Boolean(String(value || "").trim()); }

function safeLimit(value, fallback, maximum, minimum = 1) {
  const numeric = value === undefined || value === "" ? fallback : Number(value);
  return Number.isInteger(numeric) && numeric >= minimum && numeric <= maximum;
}

function parseSimpleToml(content = "") {
  const result = {};
  let section = "";
  for (const rawLine of String(content).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+#.*$/, "").trim();
    const sectionMatch = line.match(/^\[\[?([^\]]+)\]\]?$/);
    if (sectionMatch) { section = sectionMatch[1].trim(); continue; }
    const assignment = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
    if (!assignment) continue;
    result[`${section}.${assignment[1]}`] = parseTomlValue(assignment[2].trim());
  }
  return result;
}

function parseTomlValue(value) {
  if (/^"[^"\r\n]*"$/.test(value)) return value.slice(1, -1);
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}
