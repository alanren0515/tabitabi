import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AuditWorkbenchError, auditAccessInfo, auditLanMode, auditRequestAuthorized, auditSessionCookie, auditWorkbenchEnabled, readAuditBundle, saveAuditEvidence, saveAuditUpdates } from "../server/audit-workbench.mjs";

test("audit workbench can only be enabled on an explicit loopback host", () => {
  assert.equal(auditWorkbenchEnabled({}), false);
  assert.equal(auditWorkbenchEnabled({ ENABLE_AUDIT_WORKBENCH: "true", HOST: "127.0.0.1" }), true);
  assert.throws(() => auditWorkbenchEnabled({ ENABLE_AUDIT_WORKBENCH: "true", HOST: "0.0.0.0" }), AuditWorkbenchError);
  assert.throws(() => auditWorkbenchEnabled({ ENABLE_AUDIT_WORKBENCH: "true" }), /requires loopback/);
});

test("LAN mode requires a strong token and compares query, header, or cookie credentials", () => {
  const token = "a".repeat(32);
  const env = { ENABLE_AUDIT_WORKBENCH: "true", AUDIT_ALLOW_LAN: "true", HOST: "0.0.0.0", AUDIT_TOKEN: token };
  assert.equal(auditWorkbenchEnabled(env), true);
  assert.equal(auditLanMode(env), true);
  assert.throws(() => auditWorkbenchEnabled({ ...env, AUDIT_TOKEN: "short" }), /strong token/);
  assert.equal(auditRequestAuthorized({ url: `/audit?token=${token}`, headers: {} }, env), true);
  assert.equal(auditRequestAuthorized({ url: "/api/audit/bundle", headers: { "x-audit-token": token } }, env), true);
  assert.equal(auditRequestAuthorized({ url: "/api/capabilities", headers: { cookie: `x=1; tabitabi_audit=${token}` } }, env), true);
  assert.equal(auditRequestAuthorized({ url: "/api/audit/bundle", headers: { "x-audit-token": `${token}x` } }, env), false);
  assert.equal(auditRequestAuthorized({ url: "/api/audit/bundle", headers: {} }, env), false);
  assert.equal(auditRequestAuthorized({ url: "/api/audit/bundle", headers: { cookie: "tabitabi_audit=%E0%A4%A" } }, env), false);
  assert.match(auditSessionCookie(env), /^tabitabi_audit=.*HttpOnly; SameSite=Strict; Path=\/; Max-Age=14400$/);
  assert.deepEqual(auditAccessInfo(env), { mode: "lan", sessionMaxAgeSeconds: 14_400 });
  assert.deepEqual(auditAccessInfo({ ENABLE_AUDIT_WORKBENCH: "true", HOST: "127.0.0.1" }), { mode: "loopback", sessionMaxAgeSeconds: null });
});

test("saves sanitized complete audits and confirmed scenarios atomically", async () => {
  const root = await fixtureRoot();
  const result = await saveAuditUpdates(root, {
    audits: [{
      caseId: "case-1",
      identification: "pass",
      branchCorrect: true,
      severeActionError: false,
      bookingSafety: "pass",
      mobileFlow: "pass",
      evidence: [" output/manual/case-1.png ", "output/manual/case-1.png"],
      auditedAt: "2026-07-13T12:34:00+09:00",
      notes: " mobile flow complete ",
      rawScreenshot: "must not be saved"
    }],
    scenarios: [{ id: "cv-01", status: "confirmed", linkedCaseId: "case-1", evidence: [], notes: "covered" }]
  });
  assert.equal(result.progress.auditedCases, 1);
  assert.equal(result.progress.completedScenarios, 1);
  assert.deepEqual(result.audits[0].evidence, ["output/manual/case-1.png"]);
  assert.equal(result.audits[0].auditedAt, "2026-07-13T03:34:00.000Z");
  assert.equal("rawScreenshot" in result.audits[0], false);
  const saved = JSON.parse(await readFile(join(root, "eval/manual-audits.json"), "utf8"));
  assert.equal(saved[0].status, "audited");
  assert.equal(result.matrix[0].implementationEvidence[0], "test/example.test.js");
});

test("exposes only aggregate live pilot progress in the local audit bundle", async () => {
  const root = await fixtureRoot();
  const bundle = await readAuditBundle(root);
  assert.equal(bundle.pilot.metrics.inputRuns, 1);
  assert.equal(bundle.pilot.metrics.excludedAuditEvents, 1);
  assert.equal(bundle.pilot.gatePassed, false);
  assert.equal(JSON.stringify(bundle.pilot).includes("restaurant name"), false);
});

test("keeps decision-only audits out of completed mobile audit count", async () => {
  const root = await fixtureRoot();
  const result = await saveAuditUpdates(root, { audits: [{
    caseId: "case-1",
    identification: "pass",
    branchCorrect: true,
    severeActionError: false,
    bookingSafety: "pass",
    mobileFlow: "pending",
    evidence: ["https://restaurant.example/official"],
    auditedAt: "2026-07-13T03:00:00.000Z"
  }] });
  assert.equal(result.audits[0].status, "decision_audited");
  assert.equal(result.progress.auditedCases, 0);
  assert.equal(result.progress.decisionAuditedCases, 1);
});

test("rejects incomplete, unknown, duplicate, or evidence-free updates", async () => {
  const root = await fixtureRoot();
  await assert.rejects(saveAuditUpdates(root, { audits: [{ caseId: "case-1" }] }), /identification/);
  await assert.rejects(saveAuditUpdates(root, { audits: [validAudit("unknown")] }), /unknown caseId/);
  await assert.rejects(saveAuditUpdates(root, { audits: [validAudit("case-1"), validAudit("case-1")] }), /duplicate caseId/);
  await assert.rejects(saveAuditUpdates(root, { scenarios: [{ id: "cv-01", status: "confirmed", evidence: [] }] }), /requires a linked case or evidence/);
});

test("stores only acknowledged, validated result-page evidence under an ignored local path", async () => {
  const root = await fixtureRoot();
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
  const result = await saveAuditEvidence(root, { caseId: "case-1", privacyAcknowledged: true, imageDataUrl: `data:image/png;base64,${png.toString("base64")}` });
  assert.match(result.path, /^output\/manual\/case-1-\d+-[a-f0-9]{8}\.png$/);
  assert.deepEqual(await readFile(join(root, result.path)), png);
  await assert.rejects(saveAuditEvidence(root, { caseId: "case-1", privacyAcknowledged: false, imageDataUrl: `data:image/png;base64,${png.toString("base64")}` }), /privacy-reviewed/);
  await assert.rejects(saveAuditEvidence(root, { caseId: "unknown", privacyAcknowledged: true, imageDataUrl: `data:image/png;base64,${png.toString("base64")}` }), /Unknown audit caseId/);
  await assert.rejects(saveAuditEvidence(root, { caseId: "case-1", privacyAcknowledged: true, imageDataUrl: `data:image/png;base64,${Buffer.alloc(32).toString("base64")}` }), /invalid/);
});

async function fixtureRoot() {
  const root = await mkdtemp(join(tmpdir(), "tabitabi-audit-"));
  await Promise.all([mkdir(join(root, "eval")), mkdir(join(root, "data"))]);
  await Promise.all([
    writeFile(join(root, "eval/cases.json"), JSON.stringify([{ id: "case-1", verificationStatus: "confirmed" }])),
    writeFile(join(root, "eval/manual-audits.json"), "[]"),
    writeFile(join(root, "eval/coverage-matrix.json"), JSON.stringify([{ id: "cv-01", sourceType: "text", riskTags: ["branch"], status: "planned", implementationEvidence: ["test/example.test.js"] }])),
    writeFile(join(root, "data/events.jsonl"), [
      JSON.stringify({ event: "input_submitted", trafficType: "product", sourceMode: "live", analysisRunId: "run_live_001", query: "restaurant name" }),
      JSON.stringify({ event: "input_submitted", trafficType: "audit", sourceMode: "live", analysisRunId: "run_audit_001" })
    ].join("\n"))
  ]);
  return root;
}

function validAudit(caseId) {
  return { caseId, identification: "pass", branchCorrect: true, severeActionError: false, bookingSafety: "pass", mobileFlow: "pass", evidence: ["evidence.png"], auditedAt: "2026-07-13T00:00:00Z" };
}
