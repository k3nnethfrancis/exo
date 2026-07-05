---
name: submit-exo-issue
description: Use when a user reports an Exo bug, QA finding, setup failure, confusing UX, regression, crash, terminal/rendering issue, plugin/harness problem, or asks to add, file, submit, track, deduplicate, or promote an Exo issue.
---

# Submit Exo Issue

Use this skill when a user reports an Exo bug, QA finding, setup failure, confusing UX, regression, crash, terminal/rendering issue, plugin/harness problem, or asks to add/file/track an Exo issue.

## Standard

Root `issues.md` is the canonical local tracker for Exo field reports. GitHub issues are useful for external intake and the scheduled Codex issue-fix loop, but every active Exo implementation issue must be promoted into root `issues.md` with an `EXO-ISSUE-*` id before assignment.

## Workflow

1. Inspect root `issues.md` for duplicates before creating a new entry.
2. If the report came from GitHub, include the GitHub issue number and URL in `Source`.
3. Add the issue under `## Open` with the next unused `EXO-ISSUE-*` id.
4. Use this shape:

```markdown
### EXO-ISSUE-000: Short user-outcome title

- Status: open
- Severity: critical|high|medium|low
- Area: short subsystem list
- Source:
  - Date/source/link/screenshot path/GitHub URL.
- Observed:
  - Concrete behavior the user saw.
- Expected:
  - User-visible behavior that should happen instead.
- Acceptance:
  - [ ] Testable condition.
  - [ ] Testable condition.
```

5. If work starts immediately, set `Status: in progress` and keep acceptance criteria current.
6. If the issue is eligible for the GitHub issue-fix loop, the GitHub issue must have both `codex-loop` and `ready-for-codex`; otherwise do not assume automation will pick it up.
7. Do not create parallel issue trackers under `docs/` or the notes vault.

## Severity Guide

- `critical`: blocks Exo daily use, corrupts user data, prevents app launch, or breaks terminal/agent core workflows.
- `high`: blocks a major workflow such as onboarding, terminal launch, editor save, MCP/CLI coordination, plugin management, or installed-app use.
- `medium`: confusing or degraded UX with a workaround.
- `low`: polish, copy, or minor inconsistency.

## Assignment Notes

- Terminal issues should reference `skills/terminal-stability/SKILL.md` before implementation.
- Plugin/harness issues should reference `skills/plugin-development/SKILL.md` before implementation.
- UI/runtime issues require real Electron app QA, not only unit tests.
