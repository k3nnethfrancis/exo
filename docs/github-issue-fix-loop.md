# GitHub Issue Fix Loop

The scheduled Codex issue-fix loop keeps everyday Exo bugs moving while larger architecture work continues. It is intentionally conservative: it should produce small, reviewed draft PRs, not autonomous merges.

## Eligibility

The loop may work only on open GitHub issues in `k3nnethfrancis/exo` with both labels:

- `codex-loop`
- `ready-for-codex`

Prefer issues also labeled `bug` when multiple issues are ready. Skip issues that are broad, architectural, duplicated, blocked, unclear, or missing reproduction detail. If an issue is too large, comment with a proposed breakdown instead of implementing it.

## One Run, One Issue

Each scheduled run should pick at most one issue. It should:

1. Confirm the issue is still open and labeled correctly.
2. Reproduce, inspect, or explain why reproduction is not possible.
3. Create an isolated branch/worktree.
4. Implement the smallest coherent fix.
5. Add or update focused tests.
6. Run relevant checks.
7. Perform app QA for UI, terminal, preview, editor, onboarding, plugin, settings, CLI/MCP, or resident-runtime changes.
8. Commit and push the branch.
9. Open a draft PR linked to the issue.

The loop must not push directly to `main`, auto-merge, or edit unrelated dirty work.

## Required PR Notes

Every draft PR should include:

- linked issue
- root cause
- change summary
- tests run
- app QA notes, when applicable
- remaining risks or follow-up issues

## Human Contract

Use `codex-loop` for issues that are acceptable for the automation to consider. Add `ready-for-codex` only when the issue is clear enough to act on. Remove either label to pause automation for that issue.
