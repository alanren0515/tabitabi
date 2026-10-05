import test from "node:test";
import assert from "node:assert/strict";
import { AUDIT_SESSION_KEY, resolveAuditSession, auditNavigationPath } from "../src/audit-session.js";

test("test entry survives reload within its tab, without promoting a normal tab", () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  assert.deepEqual(resolveAuditSession({ search: "?audit=1", storage }), { active: true, persisted: true, trafficType: "audit" });
  assert.equal(values.get(AUDIT_SESSION_KEY), "1");
  assert.equal(resolveAuditSession({ storage }).trafficType, "audit");
  assert.deepEqual(resolveAuditSession(), { active: false, persisted: false, trafficType: "product" });
  assert.equal(resolveAuditSession({ search: "?audit=0" }).trafficType, "product");
});

test("blocked tab storage keeps the exclusion marker across document navigation and reload", () => {
  const storage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const session = resolveAuditSession({ search: "?audit=1&share=1", storage });
  assert.deepEqual(session, { active: true, persisted: false, trafficType: "audit" });
  const path = auditNavigationPath("/privacy?share=1#data", session);
  assert.equal(path, "/privacy?share=1&audit=1#data");
  assert.equal(resolveAuditSession({ search: new URL(path, "https://example.com").search, storage }).trafficType, "audit");
  assert.equal(auditNavigationPath("/", session), "/?audit=1");
});

test("silent or missing storage also retains the marker while ordinary routes are unchanged", () => {
  const storage = { getItem: () => null, setItem() {} };
  for (const unavailable of [storage, null]) {
    const session = resolveAuditSession({ search: "?audit=1", storage: unavailable });
    assert.equal(auditNavigationPath("/terms", session), "/terms?audit=1");
  }
  assert.equal(auditNavigationPath("/privacy", { active: true, persisted: true }), "/privacy");
  assert.equal(auditNavigationPath("/privacy", { active: false, persisted: false }), "/privacy");
});
