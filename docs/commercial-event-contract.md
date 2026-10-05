# CommercialEvent v2 契约（A01）

状态：A01 纯函数、隐私白名单及 A02 后端接收／持久状态已完成，接口与生命周期见 [A02 接口说明](./commercial-measurement-api.md)。客户端尚未接入 v2，也未启用设备研究标识或 R7 统计；这些由 A03 接续，不能把后端完成当作已上线的研究能力。

## 字段与关联

实现位于 `server/commercial-event-schema.mjs`。`schemaVersion=2`；`eventId/sessionId/interactionId/batchId/deviceId` 使用随机 UUID v4，统一为小写。`analysisRunId` 保持已有 8–80 位不透明运行编号。eventId 是未来 30 天幂等依据，session 在不活动 30 分钟后更换；本模块只定义常量，不生成会话或执行去重。

| 事件 | 关联要求 |
| --- | --- |
| analysis_started / input_submitted / clues_extracted / candidates_shown / candidate_confirmed / analysis_completed / analysis_failed | 必须只有 analysisRunId |
| review_started / review_completed / review_failed | 必须只有 interactionId；不算首次分析完成 |
| primary_action_clicked / issue_reported / saved_plan_updated | analysisRunId 或 interactionId 恰好一个 |
| app_visit | 仅 sessionId，不带分析或复核引用 |

可选 batchId 用于排除首个批次的继续处理。错误阶段、输入类型、行动能力、渠道、研究来源和设备粗分类采用注册枚举。issue_reported 必须有 `issueCategory`，只允许 wrong_branch / wrong_link / outdated_info / unclear_condition / other；行动事件必须有 actionCapability，失败事件必须有 failureStage。

channel 枚举为 direct/social/search/partner/unknown；researchSource 为 natural/benchmark/assigned_task/incentivized/reminded/unknown。服务端必须结合受信任入口与流程上下文决定，默认 unknown；不能因浏览器宣称 natural 就纳入自然复用。无法确定资格须单列。未知 campaign/referrer 不保存全文，也不猜成 direct。

`validateCommercialEvent` 返回清洁的候选事件；`sanitizeCommercialEvent` 另接服务端上下文，为 sourceMode、trafficType、channel、researchSource、releaseRevision 和 occurredAt 提供可信值。缺可信模式或来源为 unknown；缺有效服务器 revision 为 null。A02 必须通过真实流程登记校核这些上下文，不能把请求 body 原样传入 trusted 参数。

不保留餐厅名、Place ID、联系方式、输入、截图、URL、完整 referrer、反馈文字或业务客户字段。校验错误只含固定原因码。原 `feedback_submitted` 的主动文字反馈仍由旧 schema 接收；未带版本或明确 version 1 保持兼容。v2 已分流到独立接收与状态存储，未知版本拒绝，不能降级进入旧接收器。

## 可选研究与生命周期

商业事件中不携带研究 deviceId。`createResearchConsentRecord` 定义 research-v1 的 accepted/declined/revoked：拒绝不保留设备编号；接受从服务器时间算 30 天；撤销需要对应随机编号。客户端 not_asked 状态不创建服务器记录。拒绝与研究关闭不影响主流程。

`createResearchAssociation` 只接最新服务端有效 accepted 记录，产生独立 eventId→deviceId 关联。事件必须发生于同意后、不能来自未来；同意到期、延长为任意期限或撤销后返回 null，包括尚未发送的旧事件。UUID 大小写不能产生两个逻辑标识。

A02 已实现受保护同意接口、持久状态、30 天关联清理和撤销时可关联记录删除；客户端的有界重试、撤销后停止发送及同意 UI 在 A03 接入时验证。不可反推的已生成匿名汇总不能承诺逐条回删。A03 才实现成熟 cohort、[24h,7d]、另一次会话、批次与研究任务排除，以及至少 5 个同意设备的客户细分门槛。契约函数测试不能替代这些客户端与统计验收。

## 自审与验收

覆盖：敏感未知字段丢弃、无效枚举和不透明编号拒绝、复核与新分析分离、单一父引用、服务端覆盖自报模式／时间／来源、拒绝研究仍可创建核心事件、同意前／未来／撤销／精确 30 天边界、旧反馈兼容。自审修复了未知版本被旧 sanitizer 静默接收及 UUID 大小写造成逻辑重复的问题。

运行 `node --test test/commercial-event-schema.test.js test/event-sanitizer.test.js test/event-client.test.js test/pilot-metrics.test.js`。本轮不变更原 release/pilot gate 的口径，不调用外部供应商。
