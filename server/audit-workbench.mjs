import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { loadPilotReport } from "./pilot-report.mjs";

export class AuditWorkbenchError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.name = "AuditWorkbenchError";
    this.status = status;
  }
}

export function auditWorkbenchEnabled(env = process.env) {
  if (env.ENABLE_AUDIT_WORKBENCH !== "true") return false;
  const host = String(env.HOST || "");
  if (["127.0.0.1", "localhost", "::1"].includes(host)) return true;
  if (env.AUDIT_ALLOW_LAN === "true" && host === "0.0.0.0" && String(env.AUDIT_TOKEN || "").length >= 32) return true;
  throw new AuditWorkbenchError("Audit workbench requires loopback, or explicit LAN mode with a strong token", 500);
}

export function auditLanMode(env = process.env) {
  return env.ENABLE_AUDIT_WORKBENCH === "true" && env.AUDIT_ALLOW_LAN === "true";
}

export function auditAccessInfo(env = process.env) {
  return auditLanMode(env)
    ? { mode: "lan", sessionMaxAgeSeconds: 14_400 }
    : { mode: "loopback", sessionMaxAgeSeconds: null };
}

export function auditRequestAuthorized(request = {}, env = process.env) {
  if (!auditLanMode(env)) return true;
  const expected = String(env.AUDIT_TOKEN || "");
  const requestUrl = new URL(request.url || "/", "http://audit.invalid");
  const supplied = String(
    request.headers?.["x-audit-token"]
    || requestUrl.searchParams.get("token")
    || cookieValue(request.headers?.cookie, "tabitabi_audit")
    || ""
  );
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length > 0
    && expectedBuffer.length === suppliedBuffer.length
    && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export function auditSessionCookie(env = process.env) {
  if (!auditLanMode(env)) return "";
  return `tabitabi_audit=${encodeURIComponent(env.AUDIT_TOKEN)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=14400`;
}

export async function readAuditBundle(root) {
  const [cases, audits, matrix, pilot] = await Promise.all([
    readJson(join(root, "eval/cases.json")),
    readJson(join(root, "eval/manual-audits.json")),
    readJson(join(root, "eval/coverage-matrix.json")),
    loadPilotReport(join(root, "data/events.jsonl"))
  ]);
  return { cases, audits, matrix, pilot, progress: summarizeAuditProgress({ cases, audits, matrix }) };
}

export async function saveAuditUpdates(root, payload = {}) {
  const bundle = await readAuditBundle(root);
  const caseIds = new Set(bundle.cases.map((item) => item.id));
  const auditUpdates = sanitizeAuditUpdates(payload.audits, caseIds);
  const scenarioUpdates = sanitizeScenarioUpdates(payload.scenarios, bundle.matrix, caseIds);

  if (!auditUpdates.length && !scenarioUpdates.length) {
    throw new AuditWorkbenchError("No complete audit or scenario update was supplied");
  }

  const auditByCase = new Map(bundle.audits.map((item) => [item.caseId, item]));
  for (const audit of auditUpdates) auditByCase.set(audit.caseId, audit);
  const audits = bundle.cases.flatMap((testCase) => auditByCase.has(testCase.id) ? [auditByCase.get(testCase.id)] : []);

  const scenarioById = new Map(scenarioUpdates.map((item) => [item.id, item]));
  const matrix = bundle.matrix.map((scenario) => scenarioById.has(scenario.id)
    ? mergeScenario(scenario, scenarioById.get(scenario.id))
    : scenario);

  await writeJsonAtomically(join(root, "eval/manual-audits.json"), audits);
  await writeJsonAtomically(join(root, "eval/coverage-matrix.json"), matrix);
  return { cases: bundle.cases, audits, matrix, pilot: bundle.pilot, progress: summarizeAuditProgress({ cases: bundle.cases, audits, matrix }) };
}

export async function saveAuditEvidence(root, payload = {}) {
  if (payload.privacyAcknowledged !== true) {
    throw new AuditWorkbenchError("Confirm that this is a privacy-reviewed product result screenshot");
  }
  const cases = await readJson(join(root, "eval/cases.json"));
  const caseId = limitedString(payload.caseId, 160);
  if (!cases.some((item) => item.id === caseId)) throw new AuditWorkbenchError("Unknown audit caseId");
  const match = String(payload.imageDataUrl || "").match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw new AuditWorkbenchError("Evidence must be a PNG or JPEG data URL");
  if (match[2].length > 6 * 1024 * 1024) throw new AuditWorkbenchError("Evidence image is too large", 413);
  const content = Buffer.from(match[2], "base64");
  if (content.length < 16 || content.length > 4 * 1024 * 1024 || !validImageSignature(match[1], content)) {
    throw new AuditWorkbenchError("Evidence image content is invalid or exceeds 4 MB", content.length > 4 * 1024 * 1024 ? 413 : 400);
  }
  const directory = join(root, "output/manual");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const safeCaseId = caseId.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 120);
  const extension = match[1] === "jpeg" ? "jpg" : "png";
  const filename = `${safeCaseId}-${Date.now()}-${randomBytes(4).toString("hex")}.${extension}`;
  const path = join(directory, filename);
  await writeFile(path, content, { mode: 0o600, flag: "wx" });
  return { path: `output/manual/${filename}`, bytes: content.length };
}

export function summarizeAuditProgress({ cases = [], audits = [], matrix = [] }) {
  const audited = audits.filter((item) => item.status === "audited");
  return {
    confirmedCases: cases.filter((item) => item.verificationStatus === "confirmed").length,
    auditedCases: audited.length,
    decisionAuditedCases: audits.filter((item) => ["audited", "decision_audited"].includes(item.status)).length,
    completedScenarios: matrix.filter((item) => item.status === "confirmed").length,
    totalScenarios: matrix.length
  };
}

function sanitizeAuditUpdates(value, caseIds) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 50) throw new AuditWorkbenchError("audits must be an array of at most 50 entries");
  const seen = new Set();
  return value.map((audit, index) => {
    const label = `audit ${index + 1}`;
    const caseId = limitedString(audit?.caseId, 160);
    if (!caseIds.has(caseId)) throw new AuditWorkbenchError(`${label}: unknown caseId`);
    if (seen.has(caseId)) throw new AuditWorkbenchError(`${label}: duplicate caseId`);
    seen.add(caseId);
    if (!["pass", "fail"].includes(audit?.identification)) throw new AuditWorkbenchError(`${label}: identification must be pass or fail`);
    if (typeof audit?.branchCorrect !== "boolean") throw new AuditWorkbenchError(`${label}: branchCorrect must be boolean`);
    if (typeof audit?.severeActionError !== "boolean") throw new AuditWorkbenchError(`${label}: severeActionError must be boolean`);
    if (!["pass", "fail"].includes(audit?.bookingSafety)) throw new AuditWorkbenchError(`${label}: bookingSafety must be pass or fail`);
    if (!["pass", "fail", "pending"].includes(audit?.mobileFlow)) throw new AuditWorkbenchError(`${label}: mobileFlow must be pass, fail, or pending`);
    const evidence = evidenceList(audit?.evidence, label);
    const auditedAt = validIsoDate(audit?.auditedAt, label);
    const result = {
      caseId,
      status: audit.mobileFlow === "pending" ? "decision_audited" : "audited",
      identification: audit.identification,
      branchCorrect: audit.branchCorrect,
      severeActionError: audit.severeActionError,
      bookingSafety: audit.bookingSafety,
      mobileFlow: audit.mobileFlow,
      evidence,
      auditedAt
    };
    const notes = limitedString(audit?.notes, 2_000);
    if (notes) result.notes = notes;
    return result;
  });
}

function sanitizeScenarioUpdates(value, matrix, caseIds) {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > matrix.length) throw new AuditWorkbenchError("scenarios must be a bounded array");
  const matrixIds = new Set(matrix.map((item) => item.id));
  const seen = new Set();
  return value.map((scenario, index) => {
    const label = `scenario ${index + 1}`;
    const id = limitedString(scenario?.id, 80);
    if (!matrixIds.has(id)) throw new AuditWorkbenchError(`${label}: unknown id`);
    if (seen.has(id)) throw new AuditWorkbenchError(`${label}: duplicate id`);
    seen.add(id);
    if (!["planned", "confirmed"].includes(scenario?.status)) throw new AuditWorkbenchError(`${label}: invalid status`);
    const linkedCaseId = limitedString(scenario?.linkedCaseId, 160);
    if (linkedCaseId && !caseIds.has(linkedCaseId)) throw new AuditWorkbenchError(`${label}: unknown linkedCaseId`);
    const evidence = scenario?.evidence == null || scenario.evidence.length === 0 ? [] : evidenceList(scenario.evidence, label);
    if (scenario.status === "confirmed" && !linkedCaseId && !evidence.length) {
      throw new AuditWorkbenchError(`${label}: confirmed scenario requires a linked case or evidence`);
    }
    return {
      id,
      status: scenario.status,
      linkedCaseId: linkedCaseId || "",
      evidence,
      notes: limitedString(scenario?.notes, 2_000)
    };
  });
}

function mergeScenario(current, update) {
  const merged = { ...current, status: update.status };
  if (update.linkedCaseId) merged.linkedCaseId = update.linkedCaseId;
  else delete merged.linkedCaseId;
  if (update.evidence.length) merged.evidence = update.evidence;
  else delete merged.evidence;
  if (update.notes) merged.notes = update.notes;
  else if (current.notes && update.status === "planned") merged.notes = current.notes;
  else delete merged.notes;
  return merged;
}

function evidenceList(value, label) {
  if (!Array.isArray(value) || !value.length || value.length > 20) {
    throw new AuditWorkbenchError(`${label}: 1–20 evidence references are required`);
  }
  const evidence = [...new Set(value.map((item) => limitedString(item, 500)).filter(Boolean))];
  if (!evidence.length) throw new AuditWorkbenchError(`${label}: evidence is required`);
  return evidence;
}

function validIsoDate(value, label) {
  const date = new Date(String(value || ""));
  if (!value || Number.isNaN(date.valueOf())) throw new AuditWorkbenchError(`${label}: auditedAt must be an ISO date`);
  return date.toISOString();
}

function limitedString(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function cookieValue(header, name) {
  for (const part of String(header || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) {
      try { return decodeURIComponent(rest.join("=")); }
      catch { return ""; }
    }
  }
  return "";
}

function validImageSignature(type, content) {
  if (type === "png") return content.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJsonAtomically(path, value) {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, path);
}
