# Exo Harness

> General validation guidance remains useful, but the product framing in this document predates the Exograph pivot. On `refactor/note-native-exo`, use `tasks.md` for active work sequencing and `docs/reviews/2026-07-12-fable-loop-01-packet.md` for the reviewed deletion boundary.

Last updated: 2026-07-03

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

`pnpm check` remains the typecheck/test/build subset. CI runs `pnpm ci:check` on macOS in `.github/workflows/ci.yml`./

When QAing the desktop app while using Exo for real work, prefer `pnpm dev:qa`. It isolates source-build runtime state under `.exo-dev/` so the installed stable Exo app can keep coordinating agents without command-server or settings collisions.

## Launch-Mode Evidence

Use the launch mode that matches the behavior under review:

- `pnpm dev`: active Electron/Vite development and fast main/renderer iteration.
- `pnpm dev:qa`: source-build QA with isolated `.exo-dev/` runtime and user-data paths.
- `pnpm app`: source-built smoke test only. It builds production bundles and launches Electron from the source tree, but it is not equivalent to installed or packaged Exo.
- `pnpm pack:mac` then `open release/mac-arm64/Exo.app`: packaged-app QA for onboarding, first-run setup, app-support/user-data paths, packaged resources, native-module packaging, and terminal cwd defaults.
- `pnpm dist:mac`: unsigned DMG/ZIP release artifact validation.

Startup, onboarding, first-run workspace setup, Application Support/user-data paths, packaged resources, native module packaging, install paths, and terminal cwd defaults require packaged-app evidence. Do not mark those flows complete with only `pnpm dev`, `pnpm dev:qa`, or `pnpm app`.

First-run workspace behavior has one product invariant: missing or invalid workspace settings show onboarding. Exo must not silently choose a notes root, project root, or default terminal cwd for the user.

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
pnpm test:e2e
pnpm test:visual
```

Desktop e2e/visual gates build the desktop app before running Playwright.

## App Visual QA Preflight

UI, terminal, preview, editor, onboarding, plugin/extension metadata, settings, CLI, and resident-runtime changes need real Electron app QA when they affect visible behavior. Computer Use visual QA is preferred because it checks the same installed or dev app surface a user sees, but inability to inspect the app is itself a blocker signal. Do not replace a failed visual inspection with a vague "not checked" note.

Before detailed review, run a short visibility smoke:

1. Launch or foreground the intended app target: installed `Exo.app` for installed-app QA, or `pnpm dev:qa` for source-build QA.
2. Confirm the desktop is unlocked and Computer Use can inspect the screen.
3. Confirm an Exo window or menu-bar-controlled resident app is visible, foregroundable, and showing nonblank renderer content.
4. Confirm the target surface for the change is reachable before starting workflow-specific assertions.

Classify preflight failures explicitly:

- App unavailable: Exo is not running, launch failed, or the intended dev/installed target cannot be foregrounded.
- Desktop locked: Computer Use sees the macOS lock screen, login prompt, or any state that prevents app interaction.
- Window hidden or wrong Space: Exo appears to be running, but no inspectable Exo window can be brought forward.
- Renderer blank: an Exo window is visible, but the renderer is empty, crashed, or stuck before meaningful content.
- Tool timeout: Computer Use cannot return app or screen state after retry, even though process-level checks suggest Exo may be running.

If any preflight failure remains after one clean relaunch or foreground retry, stop the visual QA pass and report it as a blocker. The change may still have automated tests, Playwright evidence, CLI smoke, or logs, but it has not passed app visual QA.

Fallback evidence is acceptable only as a labeled substitute while the visual blocker is tracked. Capture all of the following:

- the preflight failure class, attempted target, retry count, and whether the desktop was locked, hidden, blank, or timed out
- process or command-server evidence such as `./bin/exo status`, `./bin/exo search`, or relevant app launch logs
- an alternate visual artifact when possible, such as a Playwright screenshot/video, a macOS screenshot, or a CDP screenshot from the real Electron renderer
- focused automated coverage for the affected surface, such as a named Playwright/e2e/visual spec or package test
- a remaining-risk note that says Computer Use did not inspect the app and names the missing human-visible workflow

A PR or handoff may say "fallback app evidence collected" only when that bundle is present. It must not say "app QA passed" unless Computer Use or a human actually inspected the running Exo app.

## Current Harness Coverage

- Identity/context: `AGENTS.md`, `CONTEXT.md`, `../README.md`, `docs/architecture.md`, `../roadmap.md`, and `../tasks.md` describe the current note-native operating model. `ledger.md` is shipped history.
- Coordination: `docs/harness.md`, work-chunk rules, app-QA expectations, and Exo CLI/AgentCommand surfaces give agents a shared development loop.
- Control: `pnpm ci:check` is the canonical CI/local gate, but mechanical architecture controls are still incomplete.
- Audit: issue tracking and manual review catch drift today; automated entropy scans are not yet implemented.
- Intelligence: Playwright, CLI smoke tests, terminal health, logs, and app QA provide runtime signals, but not yet a unified dashboard.
- Type safety: `pnpm typecheck`.
- Unit/integration behavior: `pnpm test`.
- Desktop build behavior: `pnpm build`.
- Desktop interaction behavior: `pnpm test:e2e`.
- Visual shell behavior: `pnpm test:visual`.
- CLI contracts: package tests plus CLI smoke commands.
- Docs/context: reviewed manually through `README.md`, `AGENTS.md`, `ledger.md`, `docs/architecture.md`, `../tasks.md`, and `../roadmap.md`.
- CLI app-route tests: isolated temporary command server and runtime roots so a live Exo app cannot affect results.

## Missing Harness Layers

These are now part of the Exo-on-Exo readiness backlog:

- Add ESLint or Biome for deterministic formatting/lint.
- Add structural rules for high-risk patterns, likely through ast-grep or a TypeScript import-boundary test.
- Expand docs link/path checks so roadmap/tasks/ledger/current architecture docs cannot drift silently.
- Add renderer crash regression probes for blank-window failures.
- Add golden/snapshot coverage for markdown rendering, terminal hydration, and search results where stable.
- Add a test-quality review workflow that checks whether tests assert behavior, isolate external state, fail for the right reason, and cover the risk being changed.
- Add an app-QA workflow that forces real Electron validation for UI/runtime changes, including screenshots or concise walkthrough evidence.
- Add entropy scans for repeated anti-patterns: bloated shell files, direct filesystem access in renderer, duplicate IPC route types, hidden caps/settings, stale docs, and CLI/command-server contract drift.
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
- `packages/cli` is the active client of the command server contract. The previous `packages/mcp` client was removed on the Exograph refactor branch.

Until import-boundary checks exist, reviews should explicitly look for boundary drift in changed files.

## CLI And Agent Harness

Exo's compact operator CLI is part of the harness:

```bash
./bin/exo status
./bin/exo search "query"
./bin/exo invoke @handle "task"
```

`exo invoke` creates a visible terminal task through a configured Command. Note-native
invocation remains a separate editor flow with document context and review. Removed
`exo agents` and `exo spawn` command families are not compatibility aliases.

## Release Hygiene

Before an open-source push or release candidate:

- run `pnpm ci:check`
- run focused Playwright tests for touched UI flows
- check `docs/usability-readiness.md` for the installed-app readiness gate before switching daily work to packaged Exo
- confirm `.exo/`, logs, transcripts, and release artifacts are ignored
- verify README, AGENTS, architecture, tasks, roadmap, and current docs agree
- keep local/private paths out of source defaults
- confirm the license decision is represented in the repo
