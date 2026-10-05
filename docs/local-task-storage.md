# A06 本机任务存储契约

本机计划、最近确认和待确认队列采用同一白名单存储服务。此服务不联网、不保存图片或完整餐厅快照，不把用户进度解释为营业、空席或预约事实。集合／标签仍为 M03-b 后置范围。

## 数据与容量

- `saved`：键 `tabitabi-saved`，沿用已有计划容量，不新增 200 条限制。
- `recent`：键 `tabitabi-recent`，最多 10 项。
- `pending`：键 `tabitabi-pending`，使用 `normalizePendingAnalyses`，最多 30 项；服务不自动把 `reviewing` 改为 `pending`。重载恢复由应用显式调用队列恢复方法。
- 每域安全迁移备份为 `<原键>:migration-backup:v2`。备份同样只含白名单资料，不含原始 JSON、未知旧字段或第三方快照。

`SavedPlanV2` 字段：`schemaVersion: 2`、UUID `id`、`restaurantId`、`legacyId`、`revision`、`sourceMode`、`placeId`、`name`、`userClues`、`requiresRefresh`、`planDate`、`planTime`、`partySize`、`planStatus`、`userProgress`、`note`、`lastAnalyzedAt`、`lastReviewedAt`、`lastReviewOutcome`、`savedAt`、`updatedAt`。

新计划使用独立 UUID，同店不同日期可保存为不同计划；应用必须以计划 `id` 编辑或删除，以 `restaurantId` 找固定演示数据。旧 `id` 与旧 `restaurant.id` 迁移为餐厅引用；旧 `id` 保存在 `legacyId`，迁移 UUID 映射可重复且不会按餐厅去重。同店、同日期的已有重复计划也保留为独立条目。

名称、备注和每个用户线索最多 500 个 JavaScript 字符单位，仅接受字符串，不把对象转成文本。线索白名单为 `name / branch / area / address / originalName / nearest_station / category`。新 live 计划的名称只取用户标签或线索，不取第三方 `restaurant.name`。任何 sourceMode 都不保存 `snapshot`、完整 `restaurant`、评分、地址事实、证据、风险或预约入口；演示恢复用固定数据。

`userProgress` 为 `want_to_go / reserved_by_user / visited / skipped`。旧 `planStatus: reserved` 只映射为本人记录的 `reserved_by_user`，`not_recommended` 映射 `skipped`，其他映射 `want_to_go`。`planStatus` 保留原枚举兼容和排序用途；编辑 `userProgress` 不改变系统建议。`updateSavedPlan` 仅接受名称、线索、备注、计划日期／时间／人数、旧状态和用户进度，其余更新字段丢弃。

日期验证实际月长及闰年，时间为 `HH:mm`。时间戳只接受含时区的有效 ISO 日期时间，统一为 UTC ISO；未知／损坏时刻为 `null`，不会改成当前时刻或 1970。旧 `lastAnalyzedAt` 仅兼容历史显示，不生成可信 `lastReviewedAt`。迁移没有完备复核时间与 outcome 时两者均为 `null`。

## 同步 API

```js
const service = createLocalTaskStorage({ storage: localStorage });
service.load("saved");                 // { items, status, omittedCount }
service.write("saved", editedPlans);   // 同一返回结构
service.retry("saved");                // 重读并重试；保留尚未持久化的内存编辑
service.clear("saved");                // 只清本域及其安全备份
service.exportDomain("saved");         // { schemaVersion: 2, domain, items, status, omittedCount }
```

`domain` 只能为 `saved / recent / pending`，未知域抛 `RangeError`。导出的 `LOCAL_TASK_STORAGE_KEYS / LOCAL_TASK_BACKUP_KEYS` 可用于识别存储范围。所有返回项都重新经白名单处理；应用应接收返回的 `items`，以保留存储失败时的安全内存版本。`omittedCount` 表示归一化后未纳入的条目数，包括容量或重复线索；批次输入可继续用队列已有报告区分原因。

| status | 含义与应用行为 |
| --- | --- |
| `ready` | 可正常持久化；不存在的键是空且 ready |
| `corrupt` | JSON 或记录结构损坏；原始值保留，安全可读项仍可展示和导出，不能把损坏域当空 ready |
| `migration_failed` | 安全备份／替换失败，已有记录超过容量／包含重复队列线索，或首次读取恢复时合并存在同 ID 内容冲突／容量遗漏；原始值保留，只展示和导出安全内存项，可重试 |
| `unavailable` | 存储访问、写入或清除失败；内存编辑保留，可重试 |

`load` 在服务实例内缓存状态。旧数据迁移先写安全备份，再替换原值；任一步失败不得覆写唯一原始数据。非 `ready` 时 `write` 只更新安全内存，不能因 render 自动写入而破坏旧值。服务区分已读取到的基线与首次读取失败后的未知集合：已读取基线的显式 `retry` 最终持久化最新内存编辑，包含删除；不会重载旧数据覆盖编辑。此前完全未读到基线时，空内存不能代表删除意图；恢复读取后先保留原有安全记录，再合并内存中不同 ID 的新条目，同 ID 且安全内容完全相同的条目只保留一次。

未知基线的恢复若出现同 ID 但安全内容不同的版本，则返回 `migration_failed`，保留原始存储和安全内存版本，不静默选择覆盖方；若合并超容量或因重复队列线索遗漏条目，同样阻断替换并报告 `omittedCount`。render／write 及重复 retry 不解除此保护。调用方仍可展示和导出内存草稿，但不得声称该导出包含尚未合并的原有记录。须先在本机修复原始域或调整冲突的内存条目，再 retry；用户明确清空该域也可解除阻断。安全合并结果返回后，即使持久化仍失败，也成为已读取基线，后续对这些已展示记录的编辑和删除可继续重试。

损坏原始数据只有被外部修复或用户明确清空后才能退出 `corrupt`。`clear` 仅调用本域和备份的删除，不读或迁移待清原值；删除失败返回 `unavailable`，不改变基线认知。成功清空建立已知空基线，重置待写状态、遗漏计数及恢复阻断，之后的编辑和删除恢复按该空基线处理。

分域清空不触碰设置、访问状态或 pilot 凭证。既有 `deleteLocalData` 仍是设备全清动作，额外删除三域安全备份，并按原语义清设置、访问状态和当前 tab pilot 访问码。

读取已有 recent／pending 原始记录时，若归一化会遗漏任何项，服务只写容量内的安全备份，保留原始域且返回 `migration_failed` 与 `omittedCount`；即使后续 render／write 只传容量内安全项也不放行替换。导出仅含可展示的安全部分，不能声称完整导出未纳入项。原始容量问题仍在时 retry 继续保持阻断。用户可明确清空该域后重新整理；需要保留超额记录时先在本机修复原始域到容量内再 retry，或分批重建队列，服务没有静默裁剪或自动扩大容量的恢复路径。重试恢复仍保留此前安全内存编辑。

## 删除与撤销

应用的撤销记录仅包含本次实际删除的条目。`restoreDeletedTasks(domain, current, deleted)` 将这些条目追加恢复到当前安全列表，不重放整个旧快照；同 ID 的现有版本优先，后续新增与编辑不回退。若合并超过 recent 10 项／pending 30 项容量，或重复线索导致归一化遗漏，返回 `restored: false` 并保持当前列表；页面明确说明未恢复，不静默裁剪或部分恢复。撤销记录只在本页内存保留，刷新后不承诺继续撤销。

示例体验开始前保存并脱离当前队列任务；示例不能完成真实待办或覆盖其线索。

## 纯方法与复核元数据

`searchSavedPlans(items, query)` 只搜索用户名称及备注，采用 NFKC 和大小写归一化，不搜索第三方详情或用户地址线索，也不触发分析。

```js
recordPlanReview(item, {
  sourceMode: "live",
  requestStatus: "completed",
  resultGeneratedAt: "2026-10-03T01:00:00.000Z",
  outcome: "supported" // supported / unknown / conflicted
});
```

调用方必须在用户显式主动复核获得终结结果后调用。方法同时校验计划及结果为 live、请求 completed、真实有效结果计算时间及终结 outcome，才更新复核时间、outcome 和 revision。失败、demo、处理中、未知时间、非终结 outcome、早于旧复核的结果都不更新；完全相同结果幂等。`unknown` 是明确终结 outcome，不伪装为成功证据。此方法不改变用户进度，不更新各来源获取时间；缓存命中后的本次真实复核可以更新结果计算时间，来源时间仍由 M15 契约负责。

## 完成证据与限制

相关 Node 回归覆盖三域未知字段／快照泄漏、备份及替换失败、坏 JSON／坏记录保护、存储拒绝及 quota 失败、首次读取失败后的空 render 保护／新草稿合并／同 ID 冲突持续阻断、合并容量及重复线索保护、已知基线重试保留编辑及删除、清空成功／失败后的基线状态、严格日期与未知时间、独立计划 UUID、旧引用稳定迁移、240 条计划保留、10／30 条容量、用户进度分离及合格真实复核。应用集成与 in-app Browser 证据由主代理另外验收；此存储实现不构成部署、公开发布或真人复核证据。
