# 三路线评估工具（A09/A10）

已提供离线协议校验、同案例汇总和旧版保留／重放命令。默认数据是 30 个合成案例、90 个任务；未开展真人研究，不能据此宣称 GQ 通过或产品更好。

## 本机使用

```bash
npm run benchmark:validate
npm run benchmark:summary
npm run benchmark:baseline -- --verify
npm run benchmark:baseline -- --replay
```

前两个命令默认读取 `eval/benchmark/fixtures/synthetic-study.json`，不联网、不调用供应商，也不写产品事件。可以通过 `--input /受控目录/study.json` 指定研究文件。文件上限 5 MB；JSON 错误不回显输入片段或私人路径。validate 的成功只表示结构有效；summary 才提供 GQ 的保守计算。合成数据永远不能得到 `passed=true`。

退出状态：validate 校验失败为 1；summary 缺证据、无效记录或真人 GQ 未通过为 1，完整 fixture_only 或真人 pass 为 0。退出 0 不等于可以公开发布。

## 基线保留

首次体验改动前的已提交代码版本为 `6c1e1567ebb796af2f8dd19e001f3550303fc2c0`。`eval/benchmark/baseline-snapshot.json` 保存版本、SHA-256、归档位置、Node 版本、配置位置和重放命令。代码档案实际保存在 `data/benchmark-baselines/`，已忽略，不包含 `.env`、业务日志或用户上传内容。

`--create` 只创建首次 HEAD 源代码基线；存在 manifest 时只验证，不替换旧版。它保留的是已提交源码，不包含未提交修改。已保留的档案通过摘要校验；重放会解包到临时目录，以独立的无供应商凭据环境运行旧版 49 项回归，再启动本机服务检查 health/capabilities。`PAID_API_EMERGENCY_STOP=true`，不会继承当前项目的 `.env` 或环境凭据。结束后清理临时目录与进程。

归档目前是本机保留，没有声称已异地备份。在新 checkout 或档案丢失时，可从该保留的 Git revision 恢复：按 manifest 的 sourcePaths 执行 `git archive --format=tar --output=<archivePath> <revision> -- <sourcePaths...>`，然后运行 verify/replay；SHA 必须与原 manifest 一致，不能生成新摘要冒充旧档案。Git revision 和档案均丢失时评估停止，不能仅凭版本文字判可复现。

本轮验证：Node v26.0.0，49 项旧版回归及本机 API 启动检查通过，外部付费调用 0。这是旧版可运行性证据，不是 baseline 真人任务成绩或真实设备 Safari 证据。

## 研究输入契约

文件包含 `studyMode`（synthetic/real）、`protocol`、`groundTruth[]`、`attempts[]`。详细字段可从默认 fixture 查看，但真实研究必须重新确认真值、来源与版本，不能只修改 studyMode。

| 对象 | 必须冻结或记录的内容 |
| --- | --- |
| protocol | protocolVersion、groundTruthVersion、baseline/candidate revision、唯一 primaryReference 的固定操作路径、caseRoster、normal/hard 配比、任务目标、完整任务计时口径、统一上限、rubric、研究起止时间 |
| baselineSnapshot | 与 baselineRevision 相同的旧版档案及配置；真实模式 CLI 另检查本机档案存在、摘要一致、配置禁用供应商 |
| assignmentDesign | 首版支持每案例三路线由不同参与者完成；各参与者路线任务数差不超过 1，首个路线人数差不超过 1，任务顺序不重叠或倒置 |
| targetParticipants/deviceAvailability | 匿名参与编号、目标人群确认、设备／地区、冻结前核验的三路线可用性；人数由实际任务与名单交叉校验 |
| groundTruth | 案例与真值版本、normal/hard、门店／分店引用、预期行动或 unknown_required、输入类型、人工审核及来源证据引用、核验日和有效窗口 |
| attempt | 唯一任务号、caseId、route、对应 revision、protocol/truth/rubric 版本、匿名参与／审核编号、设备／地区、分配顺序、开始结束、terminal、审核原因与实际选择 |

真实来源的 `evidenceRef` 指向受控真值材料（官方来源或人工核验记录），门店／分店编号须能在同一受控版本中追溯到具体身份。工具检查记录完整与一致性；人工负责真实性、来源内容和终结评分，不由模型自动判定。研究协议必须在任务采集前冻结。A09 先保留旧版并确定规则；正式 candidate revision、真实案例与参与者尚未齐备时，真实协议仍是待准备状态，不能把合成协议当作已冻结的真人协议。

未分配或失效真值统一标记 `invalid_truth` 并说明原因，三路线对称排除。原案例名单、分配总量和排除数保留；缺失任务仍留在有效分母，不能按单路线删失败记录。首版要求每个有效案例每条必需路线恰好一条任务，额外重试不能替代失败任务。重试研究需新协议／另行记录，不能混入本报告。次级竞品不参与本版 GQ 文件，应独立整理诊断记录。

## 计算与判定

- 全任务正确完成率 =（correct_action + justified_unknown）/ 全部有效分配任务；可行动解决率单列。失败、未完成、incorrect_unknown、弃权与超时保留分母。
- justified_unknown 只对预定 unknown_required 且正确理解未知的案例成立，不能带错分店或实际行动选择。correct_action 必须确认真值分店与适当行动，外部点击本身不算成功。
- 成功任务中位数与 min/p25/p75/max 同时显示样本数；缺失或零分母返回 null，不把 API 响应时间当完整任务时间。
- 至少 30 个有效去重案例、10–15 位实际目标参与者、三路线同案例完整记录和冻结分层才具备 GQ 判断条件。
- candidate 相对旧版与主要替代路线的两种完成率都不能下降；wrong_branch/unsafe_action 按案例检查新增，不能仅比较错误总数。
- 增量需相对 primaryReference 成功中位耗时降低至少 25%，或难例关键错误减少且常规成功中位耗时增加不超过 10%。候选必须至少解决一个可行动案例，全拒答不能通过。
- 真人模式还需实际基线档案校核；缺时、缺路、混版本、未冻结或无成功耗时等给出 insufficient_evidence。证据完整而保护／改善不满足为 not_passed。仅 synthetic 完整且有可计算证据时为 fixture_only；永远不是商业验证。

小样本结果仅支持探索，不证明统计显著、总体无风险、真实预约成立、付费意愿或商业可行。GQ 与原 release/pilot/public gate 分离。

## 隐私与保留

研究数据只存受控本地研究域，不进入产品日志，不使用邮箱或账号作为参与编号，不保存普通用户截图。匿名汇总不输出案例／参与者编号、源内容或审核文字。原始研究记录默认最多 30 天、不可反推匿名汇总最多 90 天；当前由负责人到期检查和清理，自动删除尚未实现，报告会显示 `expiryDeletionImplemented=false`。

真实参与者联络、客户资料、付费识别及竞品购买仍按项目授权边界执行；这些离线命令不触发它们。
