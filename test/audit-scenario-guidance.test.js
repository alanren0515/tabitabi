import test from "node:test";
import assert from "node:assert/strict";
import { scenarioAuditGuidance } from "../src/audit-scenario-guidance.js";

test("builds concrete low-resolution Instagram material requirements", () => {
  const guidance = scenarioAuditGuidance({ sourceType: "instagram_screenshot", riskTags: ["multilingual", "low_resolution"] });
  assert.match(guidance.join(" "), /Instagram/);
  assert.match(guidance.join(" "), /360px|640px/);
  assert.match(guidance.at(-1), /不要把原始 SNS 截图/);
});

test("builds branch rejection steps for a multi-restaurant TikTok scenario", () => {
  const guidance = scenarioAuditGuidance({ sourceType: "tiktok_screenshot", riskTags: ["multiple_restaurants", "user_confirmation", "candidate_rejection"] });
  assert.match(guidance.join(" "), /至少清楚出现两家餐厅/);
  assert.match(guidance.join(" "), /主动点击确认/);
  assert.match(guidance.join(" "), /至少排除一个错误候选/);
});

