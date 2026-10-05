# A05：客户周期成本报告与影子权益

2026-10-03 本地工程交付；未部署。此增量是内部离线计算器和合成状态机，不接收费、客户后台、公开 API 或真实权益。其 API 成本部分接续 [A04 请求成本归属](./request-cost-accounting.md)。

## 运行与快照边界

```sh
node scripts/summarize-customer-costs.mjs
node --test test/customer-cost-report.test.js test/shadow-entitlements.test.js
```

默认只读 `eval/costs/customer-fixture.mjs` 的合成客户、工时、金额与账单观察，不读取 `data/`、环境文件或外部服务，不创建持久记录。全部价格及金额是算术测试值，不能拿来报价、证明收款或推算市场利润。

已获授权的脱敏本地快照可显式输入：

```sh
node scripts/summarize-customer-costs.mjs --input PATH
```

输入为单个 JSON 对象，最多 10 MiB、50,000 条顶层记录、100 周期及每周期 10 币种；CLI 有界读取并拒绝读取时增长的文件。它不自动寻找文件、不写输入、不输出输入路径或原始错误。默认输出 `evidenceType=fixture_only`，显式文件为 `explicit_local_snapshot_unverified`；两者始终是 `realWorldEvidence=false`、`releaseGateEvidence=false`、`completeOperationalCoverage=false`、`billingLedger=false`。输入的完整性声明未经自动核实；“完整”仅描述所声明的快照范围，不等于供应商账户或真实经营账目完整。

## 输入契约

模块导出 `summarizeCustomerCosts(snapshot)`，`schemaVersion=1`，以下数组全部必需。金额统一为币种主单位的非负有限数字或 `null`；没有汇率或隐式换算。时间为真实存在的 UTC ISO 时间，区间采用 `[from, until)`。客户结算周期必须显式给出边界，不能从请求日期或页面访问推断周期。

| 数组 | 必需字段与意义 |
| --- | --- |
| `cycles` | `cycleId/customerId/startsAt/endsAt/currencies/coverage`。币种清单显式、去重；报告用临时 `cycle-N/customer-N` 替代原始编号。 |
| `tasks` | `taskId/cycleId/requestIds`。一个任务归属一个周期；请求引用按集合处理。空数组显式表示该任务没有所声明的上游请求。 |
| `workLogs` | `workLogId/taskId/operatorId/category/actualMinutes/currency/rateVersion/occurredAt`。一分钟制实际录入，`0` 必须是显式记录，`null` 为未知。缺少工时日志不能当成零。 |
| `laborRates` | `version/rateKey/currency/perHour/effectiveFrom/effectiveUntil`。工时引用准确版本，发生时间必须在有效期内；同 `rateKey` 版本有效期不能重叠。即使显式零分钟也要求有效价格版本，不把未知单价填零。 |
| `requestRecords` | A04 的开始、终结及缓存回执，保留当时的价格快照、失败和 fallback。每个真实请求只归属一个任务；缓存受益不新增 API 成本。 |
| `apiBills` | `billId/requestId/amount/currency/billedAt`。一个请求对应一个最终已出账分配观察；同请求多份不同账单分配会冲突。金额未知为 `null`，不从标价估算推造已出账。账单观察时间可晚于请求周期。 |
| `moneyEntries` | `entryId/cycleId/kind/amount/currency/occurredAt`。`kind` 为 `quote/receipt/refund/customer_support/channel/fixed_allocation`。固定分摊另须 `methodVersion/effectiveFrom/effectiveUntil`，记录当时适用的分摊方法版本和分配金额。报价可在周期前，实收／退款可在周期后，归属取显式 cycleId 而非付款所在月份。 |

工时分类为 `initial_verification/repeat_verification/correction/communication/rework/customer_service`。`customer_service` 工时进入客服成本，其余进入人工成本，二者不重复。`customer_support` 金额只录未包含在上述工时中的额外客服支出；固定金额是已按版本方法分配的份额，本工具不替运营者建立分摊方法或校验全公司分配总量。供应商账单也需在输入前正确分配，本工具不能自动审阅账单真实性。

`coverage` 中 `tasks/apiRequests/workLogs/apiBills/moneyEntries` 每项必须显式为 `complete` 才能形成相应完整性结论，缺失或其他值均视为未知。完整声明不能覆盖缺少的具体记录：每币种必须有报价、实收、退款、额外客服、渠道、固定分摊行；确认为无发生时录显式 `0`。报价不参与贡献公式，但单独报告其缺口。每任务须有实际工时日志；仅看到任务不能推算人工分钟。没有 API 请求的明确任务引用和完整覆盖声明，可产生“本快照无 API 请求”的零成本。

标识符必须保持稳定：重试复用原 `cycleId/taskId/requestId/workLogId/billId/entryId`，不要给同一次交易或工作另造 ID。相同 ID 与相同内容重发只计一次，JSON 属性顺序不影响去重；同任务引用同请求的顺序也不影响。相同 ID 内容冲突、请求分配到两个任务或客户、未知任务／周期、未分配的观察会保留诊断并阻止完整贡献。冲突请求不向任一客户重复分配；无效或冲突工时、收款与账单不形成可知金额。

## 输出和计算含义

每币种分别给出报价、实收总额、退款、实收净额、API 标价估算、观察到的已出账、人工、客服、渠道和固定分摊。单项含 `knownSubtotal/knownRecords/complete/missingReasons`；未知的可知小计可能为 `0`，必须同时看到 `complete=false`，这不是零成本。工时另列实际分钟小计、显式零分钟记录数及未知日志数。

| 贡献口径 | 公式（仅同币种） |
| --- | --- |
| 获客前 | 实收净额 − API 成本 − 人工 − 客服 − 固定分摊 |
| 获客后 | 获客前 − 渠道成本 |

API 成本有标价估算和已出账两套独立口径，不将两者重复相加。免费层、账单差异、汇率、获客渠道的进一步细分均未推断。缺实收、退款、标价、已出账、工时／有效单价或任何所需成本时，各币种贡献仅提供 `knownSubtotal` 和 `missingComponents/missingCycleComponents`；`completeAmount=null`、`knownSubtotalIsNotMargin=true`。其他币种的必要组件缺失也阻止周期的完整贡献，避免只看 JPY 而漏掉未知 USD 成本。

`completeCostForDeclaredCycle/completeCostForDeclaredSnapshot` 只表示声明范围无上述缺口；多个币种不产生合计利润，也不证明周期盈利。贡献不等于全公司利润，未分配的总部、研发、税费等不在快照范围内；容量售卖还需保留核心用户及失败重试预算。输出不含原始客户、运营者、任务、工作日志、API、付款等 ID，不透传正文、备注、联系人或源快照字段；只输出固定字段和临时参考号。

## 影子权益状态机

`server/shadow-entitlements.mjs` 导出创建函数、纯 reducer 和汇总函数。状态只在调用者内存中，任何转换都返回新对象；没有持久账本、数据库事务、账户鉴权或收费接入。

```js
const state = createShadowEntitlementState({ credits: 3, at, expiresAt });
const reserved = transitionShadowEntitlements(state, {
  type: "reserve", operationId, units: 1, at, reservationExpiresAt
});
```

| 状态／事件 | 契约 |
| --- | --- |
| `available → reserved` | 有限整数额度、有效期间内预留；同 operation 重试只保留一次。改变同 operation 的 units 报冲突；已 released/expired 的同 operation 重试不会重新扣减。 |
| `reserved → committed` | 必须显式 `delivery=delivered_reconciliation`、`terminal=true`，结果为 `confirmed` 或有依据的 `insufficient_information`。HTTP 成功、部分结果和未知交付不能提交。 |
| `reserved → released` | 必须显式 `delivery=not_delivered/outcome=complete_failure`。释放一次；供应商已产生的成本不会回退。 |
| `reserved → expired` | 预留期限已过，且明确证明完全失败或从未发出；未知交付继续占用。有效额度期内可重新使用已过期预留释放的额度。 |
| `advance_time` | 只推进模拟时间。总额度期满后未使用额度成为 expired；committed 不回收，交付未知的 reserved 不自动释放。 |

终态不逆转；重复同一终态事件幂等。`available/reserved/committed/expired` 为额度余额分类，其和等于初始额度；`released` 是已释放操作的历史单位数，会回到可用余额，不能再加到上述守恒式。`expiredOperations` 单独统计已证实未交付的过期预留，`heldUnknownDeliveryOperations` 统计期限已过但仍保留的未知交付。`at` 不得倒退，损坏状态停止演算。

这些交付证据字段仅为调用者给出的合成断言，不是自动核实的事实。默认 CLI 仅展示合成汇总，不向用户显示个人已购余额或拒绝“套餐不足”。这不是可出售套餐：B/C 阶段真实权益仍须事务持久层、唯一约束、并发最后一个额度、重启恢复、授权和真实交付校验；本 fixture 通过不能替代这些前提。

## 本地验收与未覆盖范围

回归覆盖币种隔离、失败 API 成本、获客前后公式、重复／冲突／跨客户分配、未知及零分钟、无效／过期／重叠工时单价、缺实收和必要成本、无效时间、金额溢出、CLI 输入边界及输出脱敏；影子回归覆盖幂等、最后模拟额度、未知交付保留、提交／完全失败释放／已证明过期、终态保护与损坏状态。

默认合成首周期已出账口径为 JPY 获客前 8,847／获客后 8,747，USD 为 −0.114；不同币种不能相加。第二周期有未知实收、分钟和 API 用量／账单，因此完整贡献全部为 null。此证据只证明计算与状态契约，没有真实客户工时、价格、账单、交付、付款、续购或 GB／发布门槛证据。

2026-10-05 审核补充：`completeActualMinutes` 同时要求任务与工时覆盖完整、归属可确定且没有相关冲突或无效记录；它与单价／账单完整性独立。未归属工时不能使已知分钟小计被称为完整工时。回归证据见 [全面审核](./a-stage-comprehensive-audit-2026-10-05.md)。
