# Exo Harness

Last updated: 2026-05-31

Exo's harness is the set of commands, docs, and evidence habits that keep fast agent-driven development from turning into drift. The near-term goal is practical: make it easy for humans, Codex, Claude Code, and Exo-hosted agents to contribute safely.

## Canonical Gate

The one command for local and CI validation is:

```bash
pnpm ci:check
```

It runs:

```bash
pnpm check:repo
pnpm typecheck
pnpm test
pnpm build
./scripts/install-local --dry-run --skip-install --skip-build
```

`pnpm check` remains the typecheck/test/build subset. CI runs `pnpm ci:check` on macOS in `.github/workflows/ci.yml`.

When QAing the desktop app while using Exo for real work, prefer `pnpm dev:qa`. It isolates source-build runtime state under `.exo-dev/` so the installed stable Exo app can keep coordinating agents without command-server or settings collisions.

## Harness Engineering Principles

- One canonical broad gate: local handoff and CI both use `pnpm ci:check`.
- Focused gates are allowed while iterating, but broad changes finish with the canonical gate.
- Tests must be hermetic: no package test should depend on or accidentally connect to a live user Exo app.
- Runtime tests should use temporary `EXO_WORKSPACE_ROOT`, `EXO_RUNTIME_ROOT`, and `EXO_SETTINGS_PATH` values.
- Tests that create local HTTP command servers must close open connections during cleanup.
- Harness failures should fail fast with a clear cause rather than hanging until a timeout.

## Focused Gates

Use focused gates while iterating, then run the broader gate when the change crosses package boundaries.

```bash
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
pnpm --filter @exo/cli typecheck
pnpm --filter @exo/cli test
pnpm --filter @exo/core typecheck
pnpm --filter @exo/core test
pnpm --filter @exo/mcp typecheck
pnpm --filter @exo/mcp test
pnpm test:e2e
pnpm test:visual
```

Desktop e2e/visual gates build the desktop app before running Playwright.

## Current Harness Coverage

- Identity/context: `AGENTS.md`, `docs/strategy.md`, `docs/roadmap.md`, `docs/tasks.md`, and `ledger.md` describe the current exograph and Exo-on-Exo operating model.
- Coordination: `docs/harness.md`, work-chunk rules, app-QA expectations, and Exo CLI/MCP agent commands give agents a shared development loop.
- Control: `pnpm ci:check` is the canonical CI/local gate, but mechanical architecture controls are still incomplete.
- Audit: issue tracking and manual review catch drift today; automated entropy scans are not yet implemented.
- Intelligence: Playwright, CLI/MCP smoke tests, terminal health, logs, and app QA provide runtime signals, but not yet a unified dashboard.
- Type safety: `pnpm typecheck`.
- Unit/integration behavior: `pnpm test`.
- Desktop build behavior: `pnpm build`.
- Desktop interaction behavior: `pnpm test:e2e`.
- Visual shell behavior: `pnpm test:visual`.
- MCP/CLI contracts: package tests plus CLI smoke commands.
- Docs/context: reviewed manually through `README.md`, `AGENTS.md`, `ledger.md`, `docs/architecture.md`, `docs/tasks.md`, and `docs/roadmap.md`.
- CLI app-route tests: isolated temporary command server and runtime roots so a live Exo app cannot affect results.

## Missing Harness Layers

These are now part of the Exo-on-Exo readiness backlog:

- Add ESLint or Biome for deterministic formatting/lint.
- Add structural rules for high-risk patterns, likely through ast-grep or a TypeScript import-boundary test.
- Expand docs link/path checks so roadmap/tasks/ledger/MCP docs cannot drift silently.
- Add renderer crash regression probes for blank-window failures.
- Add golden/snapshot coverage for markdown rendering, terminal hydration, and search results where stable.
- Add a test-quality review workflow that checks whether tests assert behavior, isolate external state, fail for the right reason, and cover the risk being changed.
- Add an app-QA workflow that forces real Electron validation for UI/runtime changes, including screenshots or concise walkthrough evidence.
- Add entropy scans for repeated anti-patterns: bloated shell files, direct filesystem access in renderer, duplicate IPC route types, hidden caps/settings, stale docs, and MCP/CLI contract drift.
- Add Exo-on-Exo coordination checks: agent creation/read/send reliability, changed-file attribution, transcript review, worktree state, and recovery after app hide/reopen.

## Work Chunks

Each meaningful change should be a small work chunk:

- one primary behavior or refactor
- docs updated in the same chunk when public behavior changes
- focused tests or manual evidence included
- broad `pnpm ci:check` used before handoff when package boundaries or release behavior changed

Good evidence examples:

- exact validation commands and pass/fail result
- Playwright scenario name for UI behavior
- CLI smoke command output summary
- before/after screenshot for visual shell changes
- log path checked for renderer/main crashes

## Agent Workflow

Use a lightweight research -> plan -> execute -> QA loop for risky changes:

1. Research: map current files, contracts, tests, and docs before editing.
2. Plan: define the smallest safe change and the evidence it needs.
3. Execute: make scoped edits; do not fold unrelated cleanup into the chunk.
4. QA: review changed control/data flow, public interfaces, tests, and docs.

For simple fixes, compress these steps into one turn, but keep the same discipline.

## Architecture Boundaries

Current boundaries are documented but not mechanically enforced:

- Renderer uses `window.exo`; it does not import Node filesystem/process APIs directly.
- Electron main owns filesystem/process/terminal-runtime behavior.
- `packages/core` owns portable workspace/runtime/protocol logic.
- `packages/cli` and `packages/mcp` are clients of the command server contract.

Until import-boundary checks exist, reviews should explicitly look for boundary drift in changed files.

## MCP And Agent Harness

Exo's agent bridge is itself part of the harness:

```bash
./bin/exo integrations doctor
./bin/exo integrations install --dry-run all
./bin/exo agents list
./bin/exo agents read <id> --tail 20000
./bin/exo agents send <id> "message"
```

Already-running Codex/Claude sessions may not see newly installed MCP tools until restart or refresh. The CLI mirror remains the fallback control path.

Keep the split clear when adding harness coverage: CLI is the operator/admin/debug surface; MCP is the narrower agent work plane.

## Release Hygiene

Before an open-source push or release candidate:

- run `pnpm ci:check`
- run focused Playwright tests for touched UI flows
- check `docs/usability-readiness.md` for the installed-app readiness gate before switching daily work to packaged Exo
- confirm `.exo/`, logs, transcripts, and release artifacts are ignored
- verify README, AGENTS, architecture, tasks, roadmap, and MCP docs agree
- keep local/private paths out of source defaults
- confirm the license decision is represented in the repo
