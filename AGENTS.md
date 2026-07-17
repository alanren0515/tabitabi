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
