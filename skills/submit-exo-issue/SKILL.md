---
name: submit-exo-issue
description: Use when a user reports an Exo bug, QA finding, setup failure, confusing UX, regression, crash, terminal/rendering issue, graph/search/invocation/review problem, or asks to add, file, submit, track, deduplicate, or promote an Exo issue.
---

# Submit Exo Issue

Use this skill when a user reports an Exo bug, QA finding, setup failure, confusing UX, regression, crash, terminal/rendering issue, graph/search/invocation/review problem, or asks to add/file/track an Exo issue.

## Standard

GitHub Issues are the canonical public submission surface for Exo field reports
and implementation work. Do not create a local issue ledger.

## Workflow

1. Search GitHub Issues for duplicates or related context.
2. Create or update one GitHub Issue with a concise body:

- Summary
- Observed
- Expected
- Acceptance criteria
- Relevant screenshot/log/source paths

3. Add labels only when they exist and accurately describe the report. Do not
   assume an automation label or a scheduled agent loop.
4. Do not create parallel issue trackers under `docs/`, a notes vault, or a
   local repository file.

## Severity Guide

- `critical`: blocks Exo daily use, corrupts user data, prevents app launch, or breaks terminal/invocation core workflows.
- `high`: blocks a major workflow such as onboarding, graph read path, search/read/status, terminal launch, editor save, note-native invocation, direct-write review, CLI coordination, or installed-app use.
- `medium`: confusing or degraded UX with a workaround.
- `low`: polish, copy, or minor inconsistency.

## Assignment Notes

- Terminal issues should reference `skills/terminal-stability/SKILL.md` before implementation.
- UI/runtime issues require real Electron app QA, not only unit tests.
