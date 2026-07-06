---
name: submit-exo-issue
description: Use when a user reports an Exo bug, QA finding, setup failure, confusing UX, regression, crash, terminal/rendering issue, plugin/harness problem, or asks to add, file, submit, track, deduplicate, or promote an Exo issue.
---

# Submit Exo Issue

Use this skill when a user reports an Exo bug, QA finding, setup failure, confusing UX, regression, crash, terminal/rendering issue, plugin/harness problem, or asks to add/file/track an Exo issue.

## Standard

GitHub issues are the default submission surface for Exo field reports and Codex-loop work. Root `issues.md` is useful for duplicate checks and implementation context, but do not edit it unless the user asks for a local tracker update, you are starting implementation immediately, or the report already needs to be reconciled with an existing `EXO-ISSUE-*`.

## Workflow

1. Inspect root `issues.md` and recent GitHub issues for duplicates or related context.
2. Create or update the GitHub issue as the primary action.
3. Use a concise issue body:

- Summary
- Observed
- Expected
- Acceptance criteria
- Relevant screenshot/log/source paths

4. If the issue is actionable by automation, apply both `codex-loop` and `ready-for-codex`; otherwise do not assume automation will pick it up.
5. Only edit root `issues.md` when explicitly useful. If you do, add the next unused `EXO-ISSUE-*` under `## Open` and include the GitHub URL in `Source`.
6. Do not create parallel issue trackers under `docs/` or the notes vault.

## Severity Guide

- `critical`: blocks Exo daily use, corrupts user data, prevents app launch, or breaks terminal/agent core workflows.
- `high`: blocks a major workflow such as onboarding, terminal launch, editor save, MCP/CLI coordination, plugin management, or installed-app use.
- `medium`: confusing or degraded UX with a workaround.
- `low`: polish, copy, or minor inconsistency.

## Assignment Notes

- Terminal issues should reference `skills/terminal-stability/SKILL.md` before implementation.
- Plugin/harness issues should reference `skills/plugin-development/SKILL.md` before implementation.
- UI/runtime issues require real Electron app QA, not only unit tests.
