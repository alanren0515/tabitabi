# TabiTabi project rules

This project inherits the user-wide Codex working agreements. The following rules add project context and constraints; model handoff chains are not mandatory.

## Browser operations

- For any task that requires web pages, browser navigation, page interaction, login state, or browser-based verification, use the Codex in-app Browser by default.
- Do not operate the user's Chrome session for this project unless the user explicitly requests Chrome.
- Use Computer Use or a real-device mirror only when the user explicitly requests it or when the in-app Browser cannot verify a device-specific behavior.
- Keep browser-based verification separate from real-device Safari evidence and label the evidence accurately.

## Delivery and model roles

- The main agent owns acceptance criteria, integration, verification, reviewer triage, and authorized release execution. Use the global risk-based delegation policy; routine work can be completed directly by the current main model, including Astra.
- Preserve the project's approval boundary: user-presence actions, payments, sensitive-data transmission, new external permissions, and irreversible external changes require the appropriate user action or explicit authorization. Reuse existing authorization only for the same target, action, and limits; never expose credentials.
- Existing optional roles remain pinned: `.codex/agents/sol_design_reviewer.toml` uses `gpt-5.6-sol` with high reasoning for Japanese-first mobile UX and independent design review; `.codex/agents/terra_implementer.toml` uses `gpt-5.6-terra` with medium reasoning for bounded implementation. Use them only when their scope warrants delegation and the current tool can actually select the configured role. Do not claim a named role ran merely by supplying a similar prompt to a generic helper.
- A separate Astra reviewer may be used for consequential architecture, cross-flow product decisions, or final review without changing these pinned roles. Prefer one reviewer per unresolved risk dimension, not both Sol and Astra for the same question. Do not silently substitute unavailable pinned models.
- Run relevant automated checks for the affected behavior and real in-app Browser checks for UI changes. Documentation-only and backend-only changes do not require unrelated browser journeys. Reviewers produce findings, not completion evidence; inspect and triage each finding and rerun affected checks after fixes.
- Preserve Japanese-first mobile usability, first-time comprehension, interaction safety, accessibility, and trust. Real iOS Safari evidence remains distinct and is requested only when in-app Browser evidence cannot prove device-specific behavior.

## Product evaluation and release

- Use tools for deterministic tests, schemas, budgets, revision matching, deployment checks, and exact metrics. Delegate only unresolved qualitative or engineering judgment; model agreement is not evidence of correctness.
- In the vision pipeline, Qwen and the OpenAI fallback are systems under test, not independent judges. Verify restaurant identity and booking claims against human-confirmed ground truth and deterministic validation.
- Read `docs/manual-audit.md` and `docs/formal-public-release-checklist.md` for product evaluation or public release. Keep their paid-call approvals and evidence requirements; a local passing test does not waive release gates. Refer to `docs/pilot-runbook.md` for monitoring and `docs/security-incident-response.md` for containment and recovery.
- `.github/workflows/daily-monitor.yml` is the scheduled monitoring definition. Auditing these instructions does not authorize triggering it, changing its schedule, deploying, or configuring secrets.

## Cost and billing control

- Before any action that may create or increase a charge, report the provider, billable resource or API operation, pricing basis, estimated one-time and recurring amount, expected usage ceiling, and the condition that stops further spending. Obtain the user's explicit confirmation before proceeding.
- After a billable action, report the resource actually created or request actually made, the amount shown by the provider when available, and a clearly labeled estimate when the provider has not yet posted an exact charge.
- Never hide uncertain pricing behind a generic warning. State what is known, what remains uncertain, and the maximum exposure enforced by quotas, budgets, auto-stop, or other controls.
- Normal no-cost local work and requests covered by an already approved, explicitly stated spending ceiling may continue autonomously. Any new provider, paid plan, recurring resource, quota increase, or action that could exceed the approved ceiling requires a new confirmation.

## Fly.io deployment memory

- This project's approved Fly target is app `tabitabi-jp` in Tokyo region `nrt` with one `shared-cpu-1x` Machine, 512 MB RAM, `--ha=false`, automatic start, idle stop, and zero permanently running Machines. Remote state verified on 2026-07-18: exactly one Machine (`2874ddda755048`) is deployed, its health check passes, and all 12 required Secrets are deployed. Do not create a second Machine without a new cost report and explicit approval.
- The persistent Volume is `tabitabi_data`, 1 GB, encrypted, mounted at `/app/data`, with scheduled snapshots and 7-day retention. Do not create another Machine or Volume without a new cost report and explicit approval.
- The pilot hostname is `https://tabitabi-jp.fly.dev`; keep the free `fly.dev` domain until pilot value is proven. Do not purchase a domain without explicit approval.
- Fly routing and Docker liveness use `/healthz`. `/readyz` reports core readiness, provider degradation, and the paid-API emergency-stop state without removing the application shell from routing.
- Keep Qwen, Google Places, Hot Pepper, pilot access, and public operator values in Fly Secrets. Never record secret values in project memory, Git, logs, screenshots, commands, or chat.
- The manual global cost kill switch is the Fly Secret `PAID_API_EMERGENCY_STOP=true`. Automatic provider-specific circuit state lives at `/app/data/provider-circuit.json`. Follow `docs/security-incident-response.md` for containment and recovery.
- The checked-in `fly.toml`, `Dockerfile`, preflight, remote audit, and provider-free smoke scripts are the reusable source of truth. Re-check live Fly pricing before future deployment work; historical prices are not guarantees.
