# API 凭证与费用异常止损手册

## 自动检测与动作

应用在调用供应商之前记录五分钟滚动窗口，并把状态持久化到 `/app/data/provider-circuit.json`：

| 触发条件 | 阈值 | 自动动作 |
|---|---:|---|
| Qwen 调用突发 | 10 次 / 5 分钟 | 隔离 Qwen 6 小时 |
| OpenAI fallback 突发 | 3 次 / 5 分钟 | 隔离 OpenAI 6 小时 |
| Google Places 突发 | 20 次 / 5 分钟 | 隔离 Google Places 6 小时 |
| Hot Pepper 真实 HTTP 请求突发 | 20 次 / 5 分钟 | 隔离 Hot Pepper 6 小时 |
| 同一供应商鉴权或限流错误 | 2 次 / 5 分钟 | 隔离对应供应商 6 小时 |
| 同一供应商网络、超时或 5xx 故障 | 5 次 / 5 分钟 | 隔离对应供应商 6 小时 |
| 熔断状态文件损坏 | 1 次 | fail-closed，停止付费 API |

自动熔断后设置页显示对应供应商安全停止，相关付费接口在上游调用前返回 503；应用外壳和其他供应商保持可用。手动总开关会停止全部付费接口。每日预算、每 IP 限流、并发限制和供应商侧配额仍同时生效。

## 发现异常后的第一分钟

若只是普通用户滥用，先从可信终端执行以下命令。它会更新 Fly Secret 并重启 Machine；不会删除数据：

```bash
fly secrets set PAID_API_EMERGENCY_STOP=true -a tabitabi-jp
```

确认止损：

```bash
curl -i https://tabitabi-jp.fly.dev/readyz
fly logs -a tabitabi-jp
```

预期 `/readyz` 仍可返回核心就绪状态，同时 JSON 中 `emergencyStop` 为 `true`；受保护的付费 POST 接口返回 503。日志可出现 `SECURITY_CIRCUIT_OPEN`，但不应包含密钥、查询或截图。

若怀疑 Fly 账号、Machine、部署供应链或 API Key 已失陷，不要把应用开关当作主要止损：立即在 Qwen、Google Cloud 和 Recruit 控制台禁用或轮换对应 Key，并撤销可疑 Fly 令牌。拥有 Fly 部署权限的人可以部署读取 Secrets 的代码，也能取消应用开关。

## 接下来 15 分钟

1. 在 Fly 控制台检查最近部署、Machine、组织成员、访问令牌和异常登录；撤销不认识的令牌或成员。
2. 在 Qwen、Google Cloud、Recruit 控制台检查调用量和错误。先禁用或轮换可疑凭证，再把新凭证写入 Fly Secrets。
3. Google Key 必须继续仅允许 Places API (New)，Text Search 与 Place Details 各保持每天 100 次控制台硬配额；应用内部各为 90 次。
4. Qwen Key 应继续限制为新加坡业务空间的 `qwen3.6-flash`。若供应商支持更低的调用额度或费用告警，按试点真实用量设置。
5. 检查 Fly Volume 中 `source-metrics.jsonl`、`daily-budget.json` 和 `provider-circuit.json` 的时间线。不要在调查完成前删除原始记录。

## 凭证轮换

先在供应商控制台创建新 Key，再安全更新 Fly Secret；确认新 Key 生效后撤销旧 Key。不要把 Key 放在命令行参数、聊天、截图或 Git 中。使用标准输入导入，避免 shell history 保存值。

## 恢复服务

只有在 Fly 账号安全、供应商凭证已轮换、调用量停止异常并完成原因记录后才能恢复。

普通自动熔断可等待六小时自动恢复。`state_corrupt` 不会自动恢复：保持手动总开关为 `true`，先从 Volume 保存损坏文件作为事件证据，确认副本存在后再重建该文件。随后先运行 provider-free smoke，最后取消手动开关，让 `fly.toml` 中的 `false` 恢复生效：

```bash
fly secrets unset PAID_API_EMERGENCY_STOP -a tabitabi-jp
```

恢复后先运行不调用供应商的 smoke test；确有必要时才执行一次经授权并事先报告费用的 live smoke，并立即复核供应商用量。

## 边界

这套熔断只能停止经过 TabiTabi 应用的流量。若攻击者直接取得 Fly Secret 或供应商 API Key，可能绕过应用调用供应商。因此供应商侧 API 限制、每日配额、账单告警、账号 MFA 和立即撤销/轮换 Key 是最终止损层。Fly 账号、供应链或 Machine 被完全控制时，不应把应用内日志或熔断状态视为可信证据。
