# TabiTabi 下一轮实施计划（交给 Codex 执行）

本计划来自 2026-07-16 的整体评审。当前状态：257 个自动测试全部通过；`npm run status` 显示卡点为 `external_evidence_required`（缺 2 个风险场景 + 20 次 live 输入 + 10 条反馈）。本轮目标：把代码侧剩余的安全与工程缺口补完，让项目进入"只等真实用户"的状态。

## 全局约束（每个任务都必须遵守）

1. **保持零 npm 依赖**。只用 Node 内置模块；测试继续用 `node --test`。
2. **不得伪造证据、不得放宽任何 gate**。`eval/release-gate`、`pilot:gate`、人工移动端审计记录只能由真实证据推进；单元测试不冒充移动端完成记录。
3. 每个任务完成后运行 `npm test`，全部通过才算完成；行为变化必须同步更新 `README.md` 的"当前边界"和相关 `docs/`。
4. 不修改 `eval/cases.json` 已确认案例，不删改 `data/` 下已有运行数据。
5. 每个任务独立 commit，commit message 用中文说明动机。

---

## P0-1 初始化版本控制（最高优先级，先做这个）

**背景**：仓库 `main` 分支零提交，全部代码只存在于工作目录，是当前最大的单点风险。

**步骤**：
1. 在 `.gitignore` 中补充：`data/daily-budget.json`（运行时状态，目前只有 `data/*.jsonl` 被忽略）。检查 `output/` 下是否还有其他运行时产物需要忽略。
2. `git add -A` 后用 `git status` 逐项核对暂存区：**`.env.local`、`data/` 运行数据、`.playwright-cli/` 必须不在其中**。若发现任何密钥或运行数据被暂存，先修 `.gitignore` 再继续。
3. 完成首次 commit。

**验收**：`git log` 有首个提交；`git status` 干净；`git ls-files` 中不含 `.env.local`、任何 `.jsonl`、`daily-budget.json`。

---

## P1-2 SSRF 加固：消除 DNS rebinding 窗口

**背景**：`server/webpage-extraction.mjs` 先 `lookup()` 校验私网地址、再 `fetch()`——fetch 会重新解析 DNS，恶意域名可以在两次解析之间切换到内网 IP（TOCTOU）。更严重的是 `server/reservation-link-discovery.mjs` **完全没有 DNS 私网检查**，它抓取的官网 URI 虽来自 Google Places，但目标网站可以重定向到任意地址。

**要求**：
1. 抽出一个共享的"安全 HTML 抓取"工具（建议 `server/safe-html-fetch.mjs`），保证**实际建立连接的 IP 与校验通过的 IP 是同一个**。零依赖的可行做法：用 `node:https`/`node:http` 的 `request` 并传入自定义 `lookup`，把已校验的地址固定进去；或其他等效手段，实现方式可自选，但"校验与连接使用同一地址"是硬性要求。
2. 重定向每一跳都要重新走"URL 形态校验 + DNS 校验 + IP 固定"，保留现有的最多 3 跳限制。
3. `webpage-extraction.mjs` 和 `reservation-link-discovery.mjs` 都改用该工具；后者补上此前缺失的私网检查。注意保留两者现有行为差异（超时、错误分类、缓存键）。
4. TLS 证书校验必须仍按**原始主机名**进行（固定 IP 不能破坏 SNI/证书验证）。

**测试**：新增用例覆盖——首次解析为公网、连接时解析为私网的 rebinding 场景必须被阻断；重定向到私网 IP 字面量被阻断；正常公网抓取不回归。现有 SSRF 相关测试（`test/webpage-extraction.test.js` 等）全部保持通过。

---

## P1-3 抓取响应体改为流式读取

**背景**：两个抓取器目前 `await response.text()` 先把整个响应读进内存再截 512KB；不带 Content-Length 的恶意服务器可以造成内存放大。

**要求**：改为流式读取，累计超过 512KB 立即中止连接并抛 `TOO_LARGE`（沿用现有错误码）；保留现有的 Content-Length 预检作为快速路径。

**测试**：用 mock 流式响应验证超限即断开、不完整读入；正常小页面行为不变。

---

## P1-4 视觉提取的提示注入防护

**背景**：截图是不可信输入，可能包含针对视觉模型的对抗性指令文本。现有缓解（严格 JSON Schema、帖子声明与事实隔离）已经不错，补最后一层。

**要求**：在 `server/vision-extraction.mjs` 的结果后处理中，对提取出的店名、分店、地址等字段做"指令样文本"检测（中/英/日常见 prompt-injection 模式，如"ignore previous instructions"、"忽略以上指示"、"システムプロンプト"、要求输出密钥或改变行为的句式）。命中时**不 block**，而是强制 `requiresUserConfirmation = true` 并把置信度降为 low，让既有的人工核对门槛接住。规则表放在独立模块、保持保守（宁可漏报不可把正常店名误杀——注意日文店名可能含"指示"等常见词，模式要求完整句式而非单词）。

**测试**：注入样本被降级、正常中日文店名不受影响。README"当前边界"补一条说明。

---

## P1-5 公开 pilot 前的滥用面收敛：可选访问口令

**背景**：截图识别接口本质是免费视觉模型代理，IP 固定窗口限流挡不住分布式滥用；每日预算保护的是账单，不是服务可用性（被打满后真实用户当天不可用）。pilot 只有 10–15 人，不需要账号系统。

**要求**：
1. 新增可选环境变量 `PILOT_ACCESS_CODE`。**未设置时行为与现在完全一致**（默认零变化）。
2. 设置后，`/api/extract-screenshot`、`/api/extract-webpage`、`/api/restaurants/*` 要求请求头（如 `X-Pilot-Access`）携带匹配口令，否则 401 且不消耗预算与限流额度。`/api/capabilities`、`/api/events`、静态资源、健康检查不受影响；`/api/capabilities` 返回中标记"需要访问口令"，前端据此在设置页提供一次性输入并存 localStorage，后续请求自动携带。
3. 口令比较用常数时间比较（`crypto.timingSafeEqual`）。审计工作台的既有 token 机制不变。
4. `.env.example` 与 `docs/deployment.md`、`docs/pilot-runbook.md` 同步说明。

**测试**：未设置 env 全量回归不变；设置后无口令 401、有口令正常、事件上报不受影响。

---

## P2-6 运维加固

1. `server.mjs` 增加 `uncaughtException` / `unhandledRejection` 处理：记录错误（不含密钥与请求体）后以非零码退出，交由进程管理器重启。
2. `docs/deployment.md` 补齐硬性前提：必须部署在 HTTPS 反向代理之后；`TRUST_PROXY` 只有在可信代理正确设置 `X-Forwarded-For` 时才能开启（否则限流可被伪造头绕过）；`data/` 目录需要纳入备份；说明限流器与缓存是单进程内存态，**当前架构只支持单实例部署**，多实例前需要重新设计。

---

## P2-7 pilot 反馈中的愿付费信号（产品项，小改动）

**背景**：商业评估结论是变现是最薄弱环节，应在 pilot 期间就采集付费意愿信号。

**要求**：
1. 结果反馈表单（`src/app.js` 中 `#feedback-form`）增加一个**可选**单选："如果以后提供付费的代订/礼宾服务，你会？"选项枚举：`会考虑` / `看价格` / `不会` / `不确定`（未选则不上报该字段）。
2. `server/event-sanitizer.mjs` 白名单加入该枚举字段，非法值丢弃整个字段而不是拒绝事件。
3. `scripts/summarize-metrics.mjs` 与 pilot 报告输出该分布，**不进入 `pilot:gate` 通过条件**。

**测试**：sanitizer 枚举校验、汇总统计、旧事件（无该字段）兼容。

---

## P3-8 只做准备、不代替人工的事项

1. **剩余 2 个小红书风险场景**（观点与事实混合、旧帖迁址）需要用户提供真实公开帖子截图，Codex 不得用任何自动化产物冒充。可做的：确认审计工作台中这两个场景条目与指引完整、待办说明清晰。
2. **iOS 分享入口限制**：在 `docs/mvp-decisions.md` 增补一段——Web Share Target 不支持 iOS Safari，中文用户 iPhone 占比高，pilot 的分享入口转化数据会被系统性压低，解读指标时必须考虑；原生壳 Share Extension 仍按"闭环验证通过后"排期，本轮不实施。

---

## 完成后的整体验收

依次运行并全部通过/符合预期：

```bash
npm test
npm run eval:validate
npm run status
```

`npm run status` 的 `remaining` 中，代码可解决项应清零，只剩需要真实用户/真实截图的项（riskScenarios、liveInputRuns、feedbackRuns）。git 历史应为一串按任务划分的干净提交。
