# TabiTabi 正式公开发布检查表

更新：2026-07-23

本文件区分“同版本封闭试点通过”和“公开访问已经安全启用”。`npm run release:formal-gate` 只证明前者；只有 `npm run release:public-gate` 通过，才可以对外宣称正式公开。

## 1. 同版本封闭试点

- 冻结一个干净的 40 位 Git revision，并将 `RELEASE_REVISION` 写入镜像。
- 运行当前 revision 的完整测试、35 个候选评测和35个决策评测。
- 正式评测默认将付费数据源调用间隔设为16秒，以服从生产熔断器的5分钟窗口。候选报告保存允许长期保留的 Google Place ID；同一 revision 的决策评测复用这些 ID，只请求详情，不重复执行文本搜索。不要为正式发布证据调低 `EVAL_PROVIDER_INTERVAL_MS`。
- 部署到现有 `tabitabi-jp` 单 Machine，不创建第二台 Machine 或第二个 Volume。
- 在该镜像上完成至少20次真实 live 输入和10条有效反馈；满足完成率、行动率和有帮助比例门槛。
- 生成 `latest-formal.json`，且 `release:formal-gate` 全部通过。

## 2. 法律与公开信息审阅

代码已准备日文、英文和简体中文的公开版条款与隐私文本，但在公开开关启用前仍需完成一次面向日本业务的专业审阅。审阅证据写入本机忽略目录 `data/release-evidence/legal-review.json`，不得提交个人证件、合同原件或律师通信。

至少核对：

- 运营者名称 `Ren` 和公开联系邮箱 `rgq.alan515@gmail.com`。
- 利用目的、取得方式、本机数据、30日运行日志、删除和投诉窗口。
- Qwen 新加坡国际区域、Google Places、Recruit / Hot Pepper、Fly.io 东京托管，以及可选 OpenAI fallback 的数据流和境外处理说明。
- 用户上传内容、禁止行为、服务停止、第三方费用、预约不成立边界、适用法律和消费者保护。
- 发生个人数据事件时的联系、调查与通知流程。

参考官方规则：

- 日本个人信息保护委员会《个人信息保护法ガイドライン（通則編）》：https://www.ppc.go.jp/personalinfo/legal/guidelines_tsusoku/
- 日本个人信息保护委员会《外国にある第三者への提供編》：https://www.ppc.go.jp/personalinfo/legal/guidelines_offshore/

代码内文本不是法律意见；审阅未完成时不得把 `PUBLIC_RELEASE_MODE` 改为 `true`。

## 3. 恢复与告警演练

公开前需要留下两份不含密钥的结构化证据：

- `restore-drill.json`：确认现有 Fly Volume 有可用快照、可以在隔离资源中恢复、事件/预算/熔断状态可读，并且没有创建第二台生产 Machine。
- `alerting-drill.json`：确认 Fly 异常重启、供应商预算、紧急停止都能把通知送达运营者。

恢复演练可能需要临时 Fly Volume 或 Machine，会产生费用；告警服务也可能引入新供应商。执行前必须重新核对官方价格并取得用户明确确认。不得为了通过门禁伪造演练记录。

## 4. 公开模式激活

公开访问是一次明确、可回滚的环境变更：

1. 保留 `PAID_API_EMERGENCY_STOP=false`、现有每日预算和供应商控制台硬配额，不提高上限。
2. 在同一 Git revision 和镜像上设置 `PUBLIC_RELEASE_MODE=true`。公开模式会让付费接口不再要求共享邀请码；因此只有前述门禁与滥用防护全部通过后才能执行。
3. 保留 `PILOT_ACCESS_CODE` Secret 也不会重新锁住公开模式；回滚时把 `PUBLIC_RELEASE_MODE=false` 即可恢复邀请制。
4. 部署后先运行 provider-free smoke：

   ```bash
   TABITABI_BASE_URL=https://tabitabi-jp.fly.dev \
   SMOKE_RELEASE_MODE=public \
   npm run release:smoke
   ```

5. 重新生成 Fly 远端状态，确认仍只有一台东京 512MB Machine、一个1GB Volume、健康检查通过。
6. 运行 `npm run release:public-gate`。任何一项失败，立即恢复 `PUBLIC_RELEASE_MODE=false`，不进行宣传投放。

## 5. 公开后的24小时观察

- 观察每日 Qwen、Places、Hot Pepper 用量、失败率、熔断状态和 Fly 重启。
- 达到应用每日预算、供应商控制台硬配额、异常错误率或凭证风险时，使用 `PAID_API_EMERGENCY_STOP=true` 立即停止付费调用，网站壳和隐私/条款页继续可访问。
- 未经新的费用报告和确认，不增加 Machine、Volume、供应商额度、付费域名或推广预算。

## 当前状态

- 公开模式代码：已准备，默认关闭。
- 同版本候选/决策付费评测：等待费用确认。
- 同版本真实试点：尚未开始累计。
- 法律专业审阅：未完成。
- 恢复与告警演练：未完成。
- 正式公开门禁：预期保持失败，直至上述真实证据齐全。
