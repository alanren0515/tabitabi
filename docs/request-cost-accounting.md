# A04：请求成本归属与离线汇总

2026-10-03 本地工程交付；未部署。此功能观察实际发出的供应商请求及缓存受益，不能充当账单或套餐权益账本。

## 记录与归属

服务端仅在实际调用 fetch 时生成一次 requestId，记录 attempt_started 和 attempt_finished；认证、校验、全局预算或熔断提前拒绝不会虚构供应商尝试。每次 HTTP 操作生成 httpOperationId；关联只取已认证、当前有效的服务器流程能力，绑定 analysisRunId 或 interactionId，不信任正文自报 ID。缺少或失效能力时仍计运营请求，标记 unattributed，不能遗漏费用。

覆盖 Google Places 搜索、详情／候选预览、Hot Pepper 每次电话／关键词／名称检索，以及 Qwen／OpenAI 每次截图尝试。失败、双模型回退和 audit 请求都保留；供应商 HTTP 成功不代表解析成功或产品交付。即使模型输出 schema 错误，响应中有效 usage 仍用于费用估算。核心流程的 v1／v2 完成口径不因成本日志变化。

缓存为每次加载生成 loadId，首次请求归属触发者；其他命中／并发等待者记录自己的 cache_access、同一 loadId 和 delivered／failed。多个受益者不重复产生上游 attempt。预算提前拒绝仍可能产生失败的缓存访问回执，但不产生请求成本。没有原始加载记录时显示 missingOriginAccesses；不推定货币节省或共享摊销。

当前候选页面未展示评分预览按钮；保留处理函数已携带测量能力，对应 API 的归属／缓存覆盖由实际本机 HTTP 测试证明，没有将其列为浏览器操作证据。

## 价格与 unknown

登记表位于 server/cost-prices.mjs，当前为空。没有经过核实的真实单价，实时记录中的金额保持 unknown/null，不能显示为免费或零成本。eval/costs/fixture.mjs 的单价全为人工合成，不能用于报价。

每个价格版本必须有供应商、准确模型／SKU、计价单位、币种、生效起止、核实日期、HTTPS 来源及免费层处理。相同 provider/SKU 生效区间不得重叠，采用 [effectiveFrom, effectiveUntil)。请求保存当时的限定字段价格快照，后续登记表变更不重算历史。

request 单价按尝试次数估算标价，包括失败；真实供应商计费可能不同。模型按 input/output tokens 计价，有单独缓存输入单价时必须有对应 cachedInputTokens。缺 usage、价格失效、无效价格、冲突、未终结、金额溢出均明确 unknown。免费层、实际账单和汇率未知时保持 null；USD／JPY 等币种分别显示可知标价小计。

此登记结构不会自动核实来源或账户适用性。登记真实价格前需确认准确 SKU、模型、服务地区、生效区间、免费层及官方价格依据；新增付费请求仍遵循项目费用授权门槛。

## 存储与隐私

数据位于被 Git 忽略且不可静态读取的 data/request-costs.jsonl，默认保留30天、最多50,000行和10 MiB。无公共导出 API。只记录关联编号、枚举状态、供应商／SKU、用量及价格快照；不保存查询、餐厅名、上传图像、请求 URL、正文、Key、流程 token 或原始错误信息。固定的价格出处 URL 可进入价格快照。

日志失败仅发出固定 COST_LOG_WRITE_FAILED，核心 API 继续，不重跑上游请求。日志裁剪、进程中断和持久失败可能损失开始或终结记录，汇总总是 completeOperationalCoverage=false、billingLedger=false。完整观察金额也不能宣称账户全量成本。公开 HTML、网络／基础设施、人工和客户周期成本属于后续 A05 范围。

## 使用

运行：

```sh
npm run costs:summary
```

默认只读取合成 fixture，输出 fixture_only、realWorldEvidence=false、releaseGateEvidence=false。明确获准分析的本地 JSONL 快照需要显式指定：

```sh
node scripts/summarize-request-costs.mjs --input PATH
```

显式快照最多10 MiB，仍标记 explicit_local_snapshot_unverified；不自动升级为业务或发布证据。输出不含原始关联编号，按东京自然日、供应商／操作／流量类型汇总，全版本成本均计入。真实业务完成分母应使用同版商业统计，不能用 HTTP 成功次数代替。

重发按内容去重，JSON 字段顺序不同仍是相同记录；冲突及畸形记录不能形成完整估算。估算只在观察到的记录中无 unknown、冲突或无效记录，且至少有一次尝试时才为完整；不存在请求时不会宣称成本为零。

## 验收与接续

模块测试覆盖价格区间、token 算法、双模型实际尝试、Hot Pepper 三次检索、并发缓存／失败、写入失败、重发／冲突、畸形记录及溢出。实际本机 HTTP 覆盖搜索／详情／预览归属、双模型失败及 audit、unknown、私有文件404、无图片／正文／凭据入日志；供应商全部使用本地替身。

最终证据见 [实施记录](./implementation-progress.md) 和 [本轮进度审核](./progress-audit-2026-10-03.md)。A05 将补 API＋工时＋客户周期报告及不改变真实权益的影子 fixture；目前没有客户周期毛利、真实账单对账或套餐扣减。
