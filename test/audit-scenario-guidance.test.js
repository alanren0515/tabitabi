import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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

test("keeps both pending Xiaohongshu scenarios explicit without manufacturing evidence", () => {
  const opinion = scenarioAuditGuidance({ sourceType: "xiaohongshu_screenshot", riskTags: ["multilingual", "opinion_vs_fact"] }).join(" ");
  assert.match(opinion, /小红书标题、正文卡片和互动区/);
  assert.match(opinion, /主观评价.*不会进入店名查询或预约结论/);
  assert.match(opinion, /不要把原始 SNS 截图/);

  const relocation = scenarioAuditGuidance({ sourceType: "xiaohongshu_screenshot", riskTags: ["old_post", "relocation"] }).join(" ");
  assert.match(relocation, /发布日期较早/);
  assert.match(relocation, /当前官方门店页核对现址/);
  assert.match(relocation, /不要把原始 SNS 截图/);
});

test("keeps Xiaohongshu evidence gates planned until real mobile evidence exists", async () => {
  const matrix = JSON.parse(await readFile(new URL("../eval/coverage-matrix.json", import.meta.url), "utf8"));
  for (const id of ["cv-04", "cv-08"]) {
    const scenario = matrix.find((item) => item.id === id);
    assert.equal(scenario.sourceType, "xiaohongshu_screenshot");
    assert.equal(scenario.status, "planned");
    assert.match(scenario.remainingVerification, /真实.*小红书.*截图.*移动端/u);
    assert.equal(Array.isArray(scenario.evidence), false);
  }
});
