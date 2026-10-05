# A12 review workflow fixtures

本文件记录 M15-b/M05-a 的 **synthetic fixture 准备**，对应 [下一版路线图 A12](./next-feature-roadmap.md) 和 [模块设计 M15-b、M05、M07](./feature-module-designs.md)。已实现内存模型和确定性拒绝规则，没有启用 B 业务工作区，也没有真实客户、真实来源许可审阅、外部请求、收费、存储或对外交付。

每个 record、task、draft、acceptance 和 export 均带 `fixtureOnly: true`；`realWorldEvidence`、`gqEvidence`、`g1Evidence`、`releaseGateEvidence`、`workspaceEnabled` 均为 `false`。虚构许可证据和人工操作者只检验契约，**不能成为 GQ、G1、GB 或发布证据**。真实 B 开始条件与发布门槛仍按原文档执行。

## 本地验证

```sh
node --test test/review-workflow.test.js
node scripts/validate-review-workflow.mjs
```

CLI 默认且仅运行仓库内置合成场景，支持 `--help`，拒绝 `--input` 和其他参数；不读取客户文件，不访问供应商，不写报告文件。输出为 JSON 摘要，含逐场景通过状态、`networkRequestsAttempted: 0`、`storageWrites: 0` 与非验收证据标记。测试覆盖许可矩阵与来源时间、冲突、版本／scope、生命周期、到期、新交付验收、白名单导出和无网络调用。这里只验证代码契约，不代表真实来源许可合法、用户任务成功或客户接受服务。

## 来源字段许可矩阵

`server/review-workflow.mjs` 提供 `evaluateFieldPolicy(policies, query)`。每条 `FieldPolicy` 只对应一个固定 `fieldPath × sourceType`，必须具备 `schemaVersion`、`policyId`、`purposes`、`permissions`、`retentionDays`、`reviewVersion`、带审阅人／审阅时间／有效窗口／引用的 `licenseEvidence`。所有许可引用与证据引用为有界不透明 ID；模块不保存许可证书、来源全文、截图或 API 快照。

| 维度 | 实施规则 |
| --- | --- |
| 来源 | `user_clue` 是用户自写线索；`provider_fact` 是供应商内容；`operator_checked` 是带方法与操作者的人工核验；`unknown` 不允许持有或导出来源值。客户验收不改来源类型。 |
| 用途 | 仅 `review` 与 `private_delivery`；核对许可不能自动用来交付。 |
| 范围 | `persist` 与 `export` 分别检查；`public` 一律拒绝，M05-b 没有实现。这里的 `persist` 是模型保存资格，模块本身没有持久化。 |
| 默认 | 字段／来源未知、未登记、重复政策、许可证据缺失／损坏、用途或范围不许可均拒绝。每条实际证据分别过许可检查，添加人工核验不会绕过供应商来源许可。 |
| 保留 | 字段取记录、来源时间＋政策保留天数、许可证据到期、来源证据到期中的最短窗口。供应商内容从真实 `fetchedAt` 计保留；自写／人工记录从 `observedAt` 计，缓存重读或新人工核对时间不能延长旧供应商内容的窗口。政策保留天数为 1–90；记录另取试点结束＋90 天、合同更短期限、元数据许可期限的最短值。 |
| 到期 | 到期时点即失效；`dueAt` 到期也禁止复用为当前交付。每次导出重新检查政策与来源时间，不能因旧草稿已生成而继续复制旧值。 |

固定字段路径包括客户线索、门店 ID／名称／地址、营业／时间、评分／预算、入口类型／条件、自有核对结论及来源引用；`review.metadata` 专门授权自有核对元数据。fixtures 中部分供应商字段有虚构明确许可，只是测试允许分支，**不是 Google Places、官网或其他供应商的实际许可结论**。评分／预算默认不允许保存／交付，电话不进入交付白名单。

A12 依赖调用方如实登记内容来源。它能拒绝缺失／混合来源证据和权限不匹配，不能判断人工填写的事实、许可证据、身份或来源声明是否真实，也不能识别故意删掉供应商来源后改标签的材料。真实来源审阅、来源不可变标识与受保护写入须在 B06a/B06b 关闭。

## ReviewRecord、ReviewTask 与冲突

`createReviewRecord` 仅接受显式 `fixtureOnly`，生成 UUID、workspace／cycle 引用、revision、独立 `reviewedAt`／`dueAt`、最短保留期限和操作历史。每个字段有状态、来源类型、证据、真实来源观察／获取时间、方法、核对时间、到期、所用 policy ID 和本次 `reviewTaskId`。未知／冲突值为 `null`，不保存冲突材料全文。字段缺失表示尚未记录；交付所请求字段缺失时拒绝，不能补正常值。

字段状态为 `pending/supported/unresolved/conflict/not_applicable`；输入的新核验记录必须给出终结状态。`supported` 必须有来源证据；人工证据须有当前操作者及方法；供应商证据必须给实际 `fetchedAt`，不借用当前核对时间。确认身份需要 `identity.place_id` 的人工 `branch_match` 或 `conflict_resolution` 证据；供应商 Place ID 或客户自写名称仍不足以宣布已确认分店。仅确认线上入口不会证明空席、规则或预约成立。

| 方法 | 约束 |
| --- | --- |
| `createReviewTask` / `startReview` | 单项显式创建／启动；task 与 record 均校验 scope、期望 revision，操作者／时间／字段／版本入最小历史。 |
| `recordFieldReview` | 仅处理当前任务的受影响字段；不直接覆盖 conflict；新字段不得越过许可证据或到期窗口。 |
| `resolveFieldConflict` | 必须是原 conflict 的显式人工决议，有当前操作者、决议时间、`conflict_resolution` 方法和证据引用；模型投票与客户验收没有此权限。 |
| `completeTask` | 只允许 `in_progress`；所有受影响字段 supported 或 not_applicable，且有本任务重新记录的当前证据。旧任务 supported 字段不能直接完成新任务。 |
| `transitionReviewTask` | `in_progress → blocked` 要缺线索／冲突／预算／源失败／时间未知原因；`blocked → pending` 由操作者显式恢复；未完成项可 cancelled。 |
| `createReviewTask(..., { previousTask })` | completed／cancelled 历史不重开；复核使用新的 linked task。 |
| `listDueReviews` | 仅排序最小待办引用，不请求网络，不启动任务。 |
| `invalidateExpiredFields` | 返回新 revision，删除已失效字段值与证据；旧输入快照不被改写。没有文件删除／定时清理行为。 |

调用的 `context` 必填 `fixtureOnly`、`workspaceId`、`operatorId`、`expectedRevision`、`occurredAt`；处理 task 还必须给 `expectedTaskRevision`。`workspaceState=suspended/closed` 拒绝新写／核对。所有函数返回新对象；旧 revision 保留供对比，不能静默覆盖。`workLogRefs` 只是去重引用，不记录分钟、不生成成本或计费记录。

## 私有版本化交付与 export

`createDeliveryDraft` 只接受同 workspace、同 cycle 的最多 20 条 ReviewRecord、报价版本及每条精确 `reviewRevision`，不序列化整个工作区或私人计划。Draft 持有 `deliveryId`、`cycleId`、`offerVersion`、`revision`、allowed fields、逐条 resolved/unresolved 和审阅状态；cycle 目前只是关联，不代表已交付周期或已付款。

supported／not_applicable 值及证据引用逐项过 `private_delivery/export` 许可，自有时间／状态需 `review.metadata` 许可。unknown／conflict 只投影 unresolved 状态、原因与下一动作，不带来源值或冲突证据。身份未确认／冲突时撤下全部事实与 booking 值，只保留客户线索和 unresolved；没有“已核对可预约”的总体标签。resolved/unresolved 分别计数，所有分配条目留分母。

交付请求中出现原截图、raw API、私人预约 URL、联系方式、内部备注、工时单价、付款资料或任意未知字段即拒绝。JSON/Markdown export 也不含 workspace、operator、工时、操作历史、政策全文、验收凭据。用户自写线索或许可自有结论仍可能含自写敏感内容；fixture 使用虚构文本，真实输入的敏感内容审阅／客户授权属于未实现的 B 前置条件。

`requestDeliveryReview` 将 draft 变为 `review_requested`；`recordDeliveryAcceptance` 仅接受带证据引用的 `accepted/changes_requested`，记录验收 ID、时间和 **当时 deliveryRevision**，`factCertification=false`。`reviseDeliveryDraft` 产生新 revision、新 draft 和空验收列表；旧对象在返回副本中标记 superseded、原验收仍绑定旧版。来源更新使旧 reviewRevision 不匹配，旧草稿不能继续导出；需要显式修订和再次审阅。

`exportDeliveryDraft` 用当前 records／policies 重建白名单并比较草稿投影；版本不符、许可变更／到期、缺证据、篡改投影、superseded 草稿均拒绝。格式仅 UTF-8 JSON／Markdown，20 条上限之外另有约 100 KB 内容上限；Markdown 将完整有界 JSON 放入代码块，保留来源时间。导出只返回内存字符串，不自动写文件、发送或生成公开 URL。文件明确说明核对时间不代表实时营业／空席，以及已复制文件不能远端撤回。

## 实施限制

这些文件没有接入 `server.mjs`、页面、pilot/audit token、production 权限或存储。fixtures 的 active workspace 仅是状态枚举示例，无法据此启用真实工作区。没有真实登录／管理授权、全局 ID 唯一约束、跨进程事务、重启恢复、原子文件替换、自动保留删除、撤回旧文件或真实服务容量登记；调用上下文不是生产身份验证。由于没有 UI 或后端路由变化，本项不产生 Browser 或真实 iOS Safari 证据。

B06a/B06b/B01/B05 需要 GQ/G1 与真实来源／服务范围、私有写保护、存储恢复和客户授权证据；外发、收费、公开发布和付费供应商测试继续遵循项目批准边界。CLI 的通过结果不应复制到真人评估或发布证据目录，也不改变 release gate 状态。

2026-10-05 审核补充：DeliveryDraft 保留 `generatedAt` 和最近状态变更 `updatedAt`；请求审阅、验收、修订均校验时间不倒退。请求／验收不改变内容 revision，修订才生成新内容版本，旧验收仍绑定原 revision。该约束仅用于当前内存 fixture 模型，见 [全面审核](./a-stage-comprehensive-audit-2026-10-05.md)。
