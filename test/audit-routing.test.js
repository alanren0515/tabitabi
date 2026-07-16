import test from "node:test";
import assert from "node:assert/strict";
import { auditLaunchPath, isScreenshotAuditSource } from "../src/audit-routing.js";

test("screenshot audits always start at the upload flow and mark traffic as audit", () => {
  assert.equal(isScreenshotAuditSource("tiktok_screenshot"), true);
  assert.equal(isScreenshotAuditSource("text"), false);
  assert.equal(auditLaunchPath({ sourceType: "instagram_screenshot", query: "must not be prefilled" }), "/?audit=1");
});

test("text audits preserve the exact confirmed query through the review-only share prefill", () => {
  assert.equal(auditLaunchPath({ sourceType: "text", query: "六歌仙 新宿本店" }), "/?audit=1&share=1&text=%E5%85%AD%E6%AD%8C%E4%BB%99%20%E6%96%B0%E5%AE%BF%E6%9C%AC%E5%BA%97");
});
