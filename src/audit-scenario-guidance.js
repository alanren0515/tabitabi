const SOURCE_REQUIREMENTS = {
  tiktok_screenshot: "准备一张保留 TikTok 界面结构的完整截图，不要只裁剪餐厅文字。",
  instagram_screenshot: "准备一张保留 Instagram Reels/帖子界面结构的完整截图，不要只裁剪餐厅文字。",
  xiaohongshu_screenshot: "准备一张保留小红书标题、正文卡片和互动区结构的完整截图。",
  x_screenshot: "准备一张保留 X 帖子账号区、正文与时间线结构的完整截图。",
  text: "使用真实餐厅文字输入完成流程，不需要准备 SNS 原始截图。"
};

const RISK_REQUIREMENTS = {
  low_resolution: "另存一份低清副本用于测试：短边小于 360px 或长边小于 640px；原图留在手机中供人工对照。",
  opinion_vs_fact: "画面应同时包含餐厅身份线索和作者主观评价，确认评价不会进入店名查询或预约结论。",
  temporary_closure: "帖子应提到临时休业或闭店；确认系统只把它当帖子说法，并在选定门店后使用当前官网或 Maps 复核。",
  same_name: "选择存在同名店或多分店品牌的素材，确保候选页能展示多个可能性。",
  branch: "素材应包含分店、地区、车站或地址中的至少一种分店线索，并逐项核对候选地址。",
  address_missing: "素材中不要出现完整地址，避免人工补写截图里没有的信息。",
  station_only: "素材中应出现具体车站名，并确认车站线索进入候选搜索且仍需用户选择门店。",
  old_post: "使用发布日期较早、可能与当前状态不同的公开帖子，并记录大致发布日期。",
  relocation: "素材应包含旧址或迁址前线索；必须用当前官方门店页核对现址后才能进入预约入口。",
  phone_only: "选择没有已核验在线预约流程、只能电话确认的真实餐厅结果。",
  japanese_script: "打开电话助手并核对标准版、简短版和日语不熟练版，不实际拨号也可以完成界面审计。",
  multiple_restaurants: "一张截图中至少清楚出现两家餐厅，验证先选择餐厅，再选择具体 Places 候选。",
  user_confirmation: "不要接受系统默认猜测；必须由你主动点击确认具体餐厅与分店。",
  candidate_rejection: "至少排除一个错误候选，再确认正确候选；排除阶段不应提前加载详情。",
  no_restaurant_name: "选择看得到食物或描述、但没有清晰店名的 Instagram 素材，确认系统阻止搜索。",
  low_confidence: "确认低置信度提示出现，且未人工勾选核对前不能继续。"
};

export function scenarioAuditGuidance(scenario = {}) {
  const items = [SOURCE_REQUIREMENTS[scenario.sourceType] || "使用与场景来源一致的真实公开素材。"];
  for (const tag of scenario.riskTags || []) {
    if (RISK_REQUIREMENTS[tag]) items.push(RISK_REQUIREMENTS[tag]);
  }
  items.push("完成后只保存本产品的候选页或结果页证据；不要把原始 SNS 截图、用户名、评论或私信写入评估文件。");
  return [...new Set(items)];
}

