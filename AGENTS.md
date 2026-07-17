# Project collaboration rules

## Browser operations

- For any task that requires web pages, browser navigation, page interaction, login state, or browser-based verification, use the Codex in-app Browser by default.
- Do not operate the user's Chrome session for this project unless the user explicitly requests Chrome.
- Use Computer Use or a real-device mirror only when the user explicitly requests it or when the in-app Browser cannot verify a device-specific behavior.
- Keep browser-based verification separate from real-device Safari evidence and label the evidence accurately.

## Delivery and review loop

- Work autonomously through ordinary implementation, testing, documentation, and reversible project-local changes.
- After each meaningful implementation round, run the relevant automated and browser checks, then ask at least one independent subagent to review the completed scope. Use two reviewers when product/UX and engineering/release risks are both material.
- Triage every reviewer finding against current code and evidence. Fix actionable issues in scope, add regression coverage where appropriate, rerun verification, and report findings that were intentionally not adopted with a concrete reason.
- Do not stop for ordinary technical choices. Pause only for actions that require the user in person, create or confirm payment, expose or transmit sensitive credentials/data, request a new external permission, or make an irreversible external change.
- Never treat subagent approval as completion evidence by itself; the main agent remains responsible for inspecting changes and proving the final state.

## Cost and billing control

- Before any action that may create or increase a charge, report the provider, billable resource or API operation, pricing basis, estimated one-time and recurring amount, expected usage ceiling, and the condition that stops further spending. Obtain the user's explicit confirmation before proceeding.
- After a billable action, report the resource actually created or request actually made, the amount shown by the provider when available, and a clearly labeled estimate when the provider has not yet posted an exact charge.
- Never hide uncertain pricing behind a generic warning. State what is known, what remains uncertain, and the maximum exposure enforced by quotas, budgets, auto-stop, or other controls.
- Normal no-cost local work and requests covered by an already approved, explicitly stated spending ceiling may continue autonomously. Any new provider, paid plan, recurring resource, quota increase, or action that could exceed the approved ceiling requires a new confirmation.
