# Project collaboration rules

## Browser operations

- For any task that requires web pages, browser navigation, page interaction, login state, or browser-based verification, use the Codex in-app Browser by default.
- Do not operate the user's Chrome session for this project unless the user explicitly requests Chrome.
- Use Computer Use or a real-device mirror only when the user explicitly requests it or when the in-app Browser cannot verify a device-specific behavior.
- Keep browser-based verification separate from real-device Safari evidence and label the evidence accurately.

## Delivery and review loop

- Work autonomously through ordinary implementation, testing, documentation, and reversible project-local changes.
- At the start of each work loop, explicitly decide whether a subagent is worth its resource cost. Use one only when the task can progress independently in parallel, benefits materially from a distinct review perspective, or carries enough product/security/release risk that independent review is likely to catch consequential issues.
- Do not use a subagent for small or tightly coupled edits, critical-path work the main agent must complete immediately, routine verification already covered by focused tests, or work that would duplicate the main agent's analysis. Prefer the minimum number of agents that covers the actual risk; two reviewers are reserved for genuinely separate product/UX and engineering/release concerns.
- After a meaningful implementation round, always run the relevant automated and browser checks. Add independent subagent review only when the loop-level decision above justifies it, and briefly state the reason when one is used.
- Triage every reviewer finding against current code and evidence. Fix actionable issues in scope, add regression coverage where appropriate, rerun verification, and report findings that were intentionally not adopted with a concrete reason.
- Do not stop for ordinary technical choices. Pause only for actions that require the user in person, create or confirm payment, expose or transmit sensitive credentials/data, request a new external permission, or make an irreversible external change.
- Never treat subagent approval as completion evidence by itself; the main agent remains responsible for inspecting changes and proving the final state.

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
