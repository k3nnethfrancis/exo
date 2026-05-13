# Exo Harness

Last updated: 2026-05-12

Exo's harness is the set of commands, docs, and evidence habits that keep fast agent-driven development from turning into drift. The near-term goal is practical: make it easy for humans, Codex, Claude Code, and Exo-hosted agents to contribute safely.

## Canonical Gate

The one command for local and CI validation is:

```bash
pnpm check
```

It runs:

```bash
pnpm typecheck
pnpm test
pnpm build
```

CI runs the same command on macOS in `.github/workflows/ci.yml`.

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

- Formatting/lint: not yet a dedicated gate.
- Type safety: `pnpm typecheck`.
- Unit/integration behavior: `pnpm test`.
- Desktop build behavior: `pnpm build`.
- Desktop interaction behavior: `pnpm test:e2e`.
- Visual shell behavior: `pnpm test:visual`.
- MCP/CLI contracts: package tests plus CLI smoke commands.
- Docs/context: reviewed manually through `README.md`, `AGENTS.md`, `ledger.md`, `docs/architecture.md`, `docs/tasks.md`, and `docs/roadmap.md`.

## Missing Harness Layers

These are useful but not required before the next push:

- Add ESLint or Biome for deterministic formatting/lint.
- Add structural rules for high-risk patterns, likely through ast-grep or a TypeScript import-boundary test.
- Add docs link/path checks so `AGENTS.md` and README links cannot rot silently.
- Add renderer crash regression probes for blank-window failures.
- Add golden/snapshot coverage for markdown rendering, terminal hydration, and search results where stable.

## Work Chunks

Each meaningful change should be a small work chunk:

- one primary behavior or refactor
- docs updated in the same chunk when public behavior changes
- focused tests or manual evidence included
- broad `pnpm check` used before handoff when package boundaries or release behavior changed

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
- Electron main owns filesystem/process/pty behavior.
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

## Release Hygiene

Before an open-source push or release candidate:

- run `pnpm check`
- run focused Playwright tests for touched UI flows
- confirm `.exo/`, logs, transcripts, and release artifacts are ignored
- verify README, AGENTS, architecture, tasks, roadmap, and MCP docs agree
- keep local/private paths out of source defaults
- confirm the license decision is represented in the repo
