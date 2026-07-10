---
name: submit-exo-issue
description: Use when a user reports an Exo bug, QA finding, setup failure, confusing UX, regression, crash, terminal/rendering issue, graph/search/invocation/review problem, or asks to add, file, submit, track, deduplicate, or promote an Exo issue.
---

# Submit Exo Issue

Use this skill when a user reports an Exo bug, QA finding, setup failure, confusing UX, regression, crash, terminal/rendering issue, graph/search/invocation/review problem, or asks to add/file/track an Exo issue.

## Standard

Root `issues.md` is the canonical submission surface for Exo field reports and implementation issues. GitHub issues are optional mirrors for public tracking or Codex-loop automation, not the source of truth.

## Workflow

1. Inspect root `issues.md` for duplicates or related context.
2. Add or update the root `issues.md` entry as the primary action, using the next unused `EXO-ISSUE-*` under `## Open` when creating a new issue.
3. Use a concise issue body:

- Summary
- Observed
- Expected
- Acceptance criteria
- Relevant screenshot/log/source paths

4. If the issue should also exist on GitHub, create or update the GitHub issue after `issues.md` and include the GitHub URL in `Source`.
5. If the GitHub issue is actionable by automation, apply both `codex-loop` and `ready-for-codex`; otherwise do not assume automation will pick it up.
6. Do not create parallel issue trackers under `docs/` or the notes vault.

## Severity Guide

- `critical`: blocks Exo daily use, corrupts user data, prevents app launch, or breaks terminal/invocation core workflows.
- `high`: blocks a major workflow such as onboarding, graph read path, search/read/status, terminal launch, editor save, note-native invocation, direct-write review, CLI coordination, or installed-app use.
- `medium`: confusing or degraded UX with a workaround.
- `low`: polish, copy, or minor inconsistency.

## Assignment Notes

- Terminal issues should reference `skills/terminal-stability/SKILL.md` before implementation.
- UI/runtime issues require real Electron app QA, not only unit tests.
