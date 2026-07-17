# 候选匹配评测集

这里只保存经过匿名化的餐厅识别线索，不保存原始社交媒体截图、用户名或无关个人信息。

每个案例至少包含：

- 输入来源类型
- 实际提交给 Places 的 query
- 店名、分店、地址等线索
- 人工确认的预期店名与地址片段
- 如已确认，补充 `expected.placeId`
- `verificationStatus: confirmed` 必须附至少一个官方或商家自有来源 URL

目标覆盖 30–50 个真实案例，包括同名店、分店、迁址、闭店、多语言名称、地址不完整和低清截图。

验收门槛：

- Top-3 召回率不低于 90%
- 自动选择错误店铺数为 0（当前产品始终要求用户确认）
- 每个失败案例记录失败原因并进入回归集

## 两层评测

- `coverage-matrix.json`：30 个必须覆盖的风险场景。`planned` 只代表已规划，不计入任何准确率。
- `cases.json`：经过人工确认且附官方来源的真实餐厅案例。
- `manual-audits.json`：对已确认案例的识别、分店、预约安全和移动流程人工结果，必须附本地测试或截图证据。
- `platform-url-checks.json`：公开平台 URL 的 host/path 形态回归。它只验证 provider 与 capability 分类，不计入人工审计、餐厅身份、库存或预约成功指标。运行 `npm run eval:platform-urls` 查看结果。

人工审计状态：`decision_audited` 表示已核对识别与预约决策、但移动端专项流程仍待完成；只有 `audited` 才计入最终 30 例发布样本。

运行 `npm run eval:release-gate`。只有至少 30 个 confirmed + audited 案例、识别准确率不低于 70%、严重行动建议错误率低于 5%、预约安全通过率不低于 95%，且 30 个风险场景全部完成时才允许通过。当前技术评测已达到该门槛；正式公开发布仍必须通过线上真实 pilot 和 `npm run release:formal-gate`，不能把技术评测通过等同于产品验证完成。

启动本地服务后运行 `npm run eval:candidates` 会调用真实 Places 搜索，并将不含原始输入和第三方详情的名次结果写入 `latest-candidate-results.json`。总发布门槛要求至少 30 个已确认案例的 Top-3 召回率达到 90%。

人工记录不要直接手改 JSON。本机审计运行 `npm run audit`；真实手机审计运行 `npm run audit:mobile`，再使用终端打印的随机令牌 URL。完整素材要求和逐例步骤见 `docs/manual-audit.md`。普通开发服务与生产镜像不会开放审计写入 API。
