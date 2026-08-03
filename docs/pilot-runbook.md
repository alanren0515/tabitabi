# 小范围真实试运行

招募渠道、样本配额、SNS 内容、预算与合规方案见 [TabiTabi 日本用户 Pilot 招募与 SNS 扩散方案](./pilot-acquisition-plan.md)。

向认识的日本用户一对一邀请时，可直接使用 [日文 DM、回复与 4 回测试模板](./closed-pilot-japanese-invitation-templates.md)。模板不包含访问码；访问码仍须在对方确认参加条件后单独发送。

公开的日文参加说明页为 `https://tabitabi-jp.fly.dev/pilot`。可以在 SNS 招募文案或一对一邀请中分享该页面，但不要把 `PILOT_ACCESS_CODE` 放进公开帖子、URL、二维码或截图。参与者先通过页面中的公开联系邮箱申请，再由运营者单独发送访问码。

这一步只在 30/30 风险场景发布门槛通过后开始。目标不是重复内部审计，而是确认真实用户能从自己的餐厅线索走到安全、可执行的下一步。

## 建议样本安排

- 邀请 5 位真实目标用户，每人完成 4 次不同餐厅输入，共 20 次 live 输入。
- 输入尽量覆盖：截图 8 次、文字或店名 6 次、社交链接加正文 3 次、普通网页或预约平台链接 3 次。
- 至少 10 次结果由实际使用者提交结果页底部反馈；同一次分析重复提交不会增加样本数。
- 不要求用户为了指标点击行动按钮，也不要诱导选择“有帮助”。门槛用于发现问题，不是需要人工凑出的数字。

## 开始前

1. 运行 `npm run eval:release-gate`，确认 `gatePassed` 为 `true`。
2. 使用正式产品地址，不要从 `/audit` 或带 `?audit=1` 的地址进入；审计流量会被正确排除。
3. 确认服务使用持久化的 `data/` 目录，否则重启或重新部署后事件会丢失。
4. 打开 `/readyz`，确认视觉识别和 Google Places 都为可用状态。
5. 告知测试者不要提交私信、通知、私人账号、评论区个人信息或包含 API Key 的截图。

## 每位测试者要做什么

1. 打开正式产品首页，粘贴自己的店名、公开链接或上传一张公开 SNS 帖子截图。
2. 检查模型整理出的店名、地区、分店和帖子说法；有误就先修改。
3. 在候选页确认正确门店；不确定时使用“不是这家”或返回修改线索，不要勉强选择。
4. 阅读结果中的结论、判断边界和主要行动。
5. 如果这个行动符合真实意图，可以打开预约入口或查看电话；打开入口不等于预约成功，不必付费、拨号或最终提交。
6. 在结果页底部提交真实反馈：是否有帮助、是否预约成功、信息是否准确；付费意愿为可选项，可以选择“会考虑 / 看价格 / 不会 / 不确定”或留空。提交成功后页面会显示服务端已接收的感谢状态。

## 每天复核

本地开发时可在保存事件日志的同一环境运行：

```bash
npm run metrics:summary
npm run pilot:gate
npm run status
```

### 每日自动监测

每日监测将“今天所有版本的运营使用量”和“当前部署版本的 pilot 指标”分开显示。这样新部署后当前版本暂时为 0，不会把旧版本的真实使用误判为丢失，也不会把旧版本事件错误计入当前发布门槛。

在已部署新版本、且当前 Fly 登录状态可用的环境中运行：

```bash
npm run monitor:daily
npm run status
```

监测会读取并汇总：

- 东京自然日的真实输入、完成分析、行动点击和有效反馈；审计流量、演示数据和旧版 pilot 事件会按规则排除。
- Qwen、OpenAI fallback、Google Places、Hot Pepper 的每日预算使用量。
- 各数据源请求数、缓存命中、延迟、错误率和 p95 延迟。
- `/healthz`、`/readyz`、`/api/capabilities` 与 Fly Machine/Volume 审计。

报告写入本机 `data/monitoring/YYYY-MM-DD.json` 和 `data/monitoring/latest.json`；远端历史写入 Fly Volume 的 `/app/data/daily-monitoring/`，保留 90 个自然日。原始事件、截图、店名、访问码和 API Key 不会写入监测报告。

告警分级如下：

- `info`：当天还没有真实使用。它不代表故障，也不应触发止损。
- `warning`：任一预算桶达到 70%，或数据源在至少 5 次请求后的错误率达到 15%。
- `critical`：任一预算桶达到 90%，数据源错误率达到 30%，服务未就绪、provider circuit 打开、emergency stop 开启，或 Fly 审计失败。

出现 `critical` 时，监测命令返回退出码 2；先停止评测和宣传，检查 `/readyz`、Fly 状态与 [安全事故处理手册](./security-incident-response.md)，必要时设置 `PAID_API_EMERGENCY_STOP=true`。不要因为“今天是 0”而手动重置预算或电路状态。

项目包含 `.github/workflows/daily-monitor.yml`，默认每天 09:00 JST 运行一次，也支持手动触发。它不会创建新的 Fly Machine 或 Volume；要启用它，需要把代码仓库连接到 GitHub，并在仓库 Actions secrets 中设置 `FLY_API_TOKEN`。当前项目没有 Git remote，因此这个工作流目前只是已准备好的配置，不会自动运行。访问令牌不要粘贴到聊天、代码、日志或截图中。

GitHub Actions 的分钟数和 Fly 短暂唤醒产生的计算费用取决于账户套餐与实际运行时间；本轮没有启动工作流、没有调用付费供应商 API、没有新增 Fly 资源，因此没有新增账单。启用前仍需按项目规则重新核对价格与 spending ceiling。

正式 Fly 试运行以线上 Volume 为准。不要把本机日志复制或合并到线上，也不要用本机 `pilot:gate` 代替生产证据。先用 provider-free smoke 唤醒现有 Machine，然后运行：

```bash
TABITABI_BASE_URL=https://tabitabi-jp.fly.dev npm run release:smoke
npm run release:pilot-remote
npm run release:preflight
npm run release:fly-audit
npm run release:formal-gate
```

`release:pilot-remote` 在 Fly 容器内聚合 `/app/data/events.jsonl`，只把计数、比例和 gate 结果写回本机，不输出原始事件。该命令可能短暂唤醒现有 Machine，但不会调用 Qwen、Google Places 或 Hot Pepper。

审计工作台会优先显示 `data/release-evidence/latest-remote-pilot.json` 中的远端聚合报告。若该报告生成失败，工作台必须显示“报告不可用”，不能把缺失的指标显示为 0；先重新运行 `release:pilot-remote`，再点击工作台的“重新读取”。因此“0”只代表报告中明确统计出的 0，不代表监测失败。

Fly 审计必须由拥有当前 Fly 登录配置的同一 macOS 用户运行。脚本会把 `config.yml` 临时复制到权限受限的可写目录，使受限 Codex/自动化环境可以创建 flyctl 锁文件和日志；结束后会删除该目录。不要为排错打印、手工复制或提交 Fly token。远端审计失败时会覆盖写入当前 revision 的脱敏失败证据，避免正式门禁继续使用旧报告。

`pilot:gate` 要求：20 次不同 live 输入、10 次有效反馈、分析完成率至少 80%、行动率至少 35%、有帮助比例至少 60%。命令在尚未达标时返回非零是正常现象，并仍会更新 `eval/latest-pilot-results.json`。

付费意愿分布只用于产品方向判断，不进入 `pilot:gate`。不要为了达标或证明商业假设而诱导参与者选择特定答案。正式远端报告按当前部署的 Git revision 隔离统计；旧版本和没有版本标记的历史事件会保留在日志中，但不会计入新版本发布门槛。

若数据明显少于实际使用次数，先检查测试者是否误用了审计地址、流程是否进入演示回退、部署的 `data/` 是否持久化，以及结果页是否明确显示反馈已提交。不要手工编辑事件日志来补样本。
