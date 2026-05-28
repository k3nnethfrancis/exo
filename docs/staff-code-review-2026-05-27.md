# Staff Code Review - 2026-05-27

Scope: post-modularization review of `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/main/index.ts`, `workspace-ipc.ts`, `terminal-manager.ts`, terminal renderer/data path, workspace settings and agent config modules, AGENTS/docs, and tests. I did not modify source code. Working tree note: `apps/desktop/src/main/agent-instruction-overlays.ts` was already locally modified before this review.

## Executive Summary

The modularization moved real pieces out of the biggest files (`terminal-ipc`, `workspace-ipc`, `settings-store`, watcher/transcript helpers, pane/tree helpers), but the repo is not yet at a stable modular boundary. `App.tsx` and `main/index.ts` still act as service locators plus business-logic hosts. That is acceptable for a near-term product shell, but it is now the main contributor-risk surface: future agents will naturally append behavior to these files because all state and examples are there.

Highest-priority cleanup should focus on terminal data ownership and main-process service boundaries. The terminal path already streams imperatively into xterm, but it still preserves large whole-buffer strings in both main and renderer state and performs full-buffer reads/resets on common activation paths. That is the most direct performance risk and also contradicts the repo guidance most likely to be followed by future agents.

## Prioritized Findings

### P0 - Terminal Rendering Still Has Whole-Buffer Ownership In React And Main

- Files: `apps/desktop/src/renderer/src/App.tsx:154`, `apps/desktop/src/renderer/src/App.tsx:204`, `apps/desktop/src/renderer/src/App.tsx:425`, `apps/desktop/src/renderer/src/App.tsx:522`, `apps/desktop/src/renderer/src/components/TerminalView.tsx:132`, `apps/desktop/src/renderer/src/components/TerminalView.tsx:186`, `apps/desktop/src/main/terminal-manager.ts:319`, `apps/desktop/src/main/terminal-manager.ts:676`
- Risk: Exo can still accumulate and copy very large terminal strings in multiple places. Defaults are one million lines (`App.tsx:125`, `terminal-manager.ts:46`, `workspace-settings.ts:12`), and activation/sync paths call `terminals.read()` then reset xterm with the whole buffer. This can cause renderer jank, memory growth, long GC pauses, and renderer OOM after long-running agents.
- Recommended refactor: make xterm the live display owner and treat renderer state as metadata plus small restore snapshots. Replace `terminalBuffers: Record<string, string>` with a terminal hydration cache that only stores bounded inactive tails or a version token. Add main-process read APIs with explicit tail semantics for renderer hydration, while full transcript reads stay transcript-only. Remove dead append-diff code in `TerminalView` (`findAppendOffset` is present but unused because `appendOffset` is forced to `null`).
- Tests needed: a terminal stress test that streams tens of MB through a fake pty and asserts bounded renderer state, no full reset during normal streaming, and no more than one hydration read when switching tabs. Add a unit test around `TerminalView` or a thin terminal hydrator to assert append streaming does not depend on React buffer updates.
- Timing: safe-now. This is a performance and stability boundary, not a cosmetic cleanup.

### P0 - `main/index.ts` Remains The Main-Process God Object

- Files: `apps/desktop/src/main/index.ts:80`, `apps/desktop/src/main/index.ts:460`, `apps/desktop/src/main/index.ts:531`, `apps/desktop/src/main/index.ts:700`, `apps/desktop/src/main/index.ts:865`, `apps/desktop/src/main/index.ts:1121`, `apps/desktop/src/main/index.ts:1193`
- Risk: the file still owns app lifecycle, window/tray/recovery, command server wiring, workspace filesystem commands, tag search, note target resolution, git status parsing, agent instruction config, workspace settings application, and indexing job scheduling. This makes future changes hard to test without Electron globals and encourages agents to add new inline subsystems despite `AGENTS.md:79`.
- Recommended refactor: extract services in this order:
  1. `indexing-service.ts` for `scheduleIndex*`, `runIndex*`, metrics, and renderer notifications.
  2. `workspace-notes-service.ts` for tag search, note target resolution, branch/knowledge wrappers.
  3. `agent-instruction-config-service.ts` for provider file read/write and scope status.
  4. `app-lifecycle.ts` or `window-manager.ts` for tray/window/recovery.
  Keep `index.ts` as composition root only.
- Tests needed: pure unit tests for git diff parsing, note target resolution, agent instruction status resolution, and indexing queue behavior. Existing tests cover command-server discovery and terminal readiness, but not most of the logic currently embedded in `index.ts`.
- Timing: safe-now, chunked. Start with indexing or agent config because both have natural service seams.

### P1 - `App.tsx` Is Still A 3,000-Line State Machine

- Files: `apps/desktop/src/renderer/src/App.tsx:132`, `apps/desktop/src/renderer/src/App.tsx:310`, `apps/desktop/src/renderer/src/App.tsx:548`, `apps/desktop/src/renderer/src/App.tsx:953`, `apps/desktop/src/renderer/src/App.tsx:1610`, `apps/desktop/src/renderer/src/App.tsx:1713`, `apps/desktop/src/renderer/src/App.tsx:1899`, `apps/desktop/src/renderer/src/App.tsx:2047`, `apps/desktop/src/renderer/src/App.tsx:2606`
- Risk: bootstrap, layout persistence, settings autosave, document save/refresh, terminal pane/session management, workspace mutations, onboarding, and all shell rendering are interleaved. Bugs will appear as stale closures, duplicated state, and inconsistent tree/document/session updates. Agents are especially likely to patch local symptoms in `App.tsx` because every feature has a nearby example.
- Recommended refactor: extract behavior hooks, not just components:
  - `useWorkspaceBootstrap`
  - `useOpenDocuments`
  - `useWorkspaceMutations`
  - `useTerminalSessions`
  - `useWorkspaceSettingsController`
  - `usePaneDropHandlers`
  Each hook should expose command methods and owned state. Keep `App.tsx` as shell composition plus render callbacks.
- Tests needed: hook-level tests for document refresh/save race behavior, pane drag/drop behavior, terminal move/close behavior, and settings autosave/apply behavior. Current `App.test.tsx` mostly tests pure helpers and settings normalization, not the state machines.
- Timing: safe-now, but split by feature. Do not do a broad mechanical move without tests.

### P1 - IPC Types Are Duplicated And Too Loose

- Files: `apps/desktop/src/main/workspace-ipc.ts:6`, `apps/desktop/src/main/workspace-ipc.ts:44`, `apps/desktop/src/main/terminal-ipc.ts:7`, `packages/core/src/command-protocol.ts`, `AGENTS.md:66`, `AGENTS.md:108`
- Risk: workspace IPC handler signatures use many `Promise<unknown>` returns and are not derived from the preload/shared API or core command contract. Adding a route requires touching multiple places with no compile-time guarantee that renderer, preload, main handler, CLI, and MCP agree. Future agents will likely add a preload route and forget CLI/MCP parity or type narrowing.
- Recommended refactor: define a shared desktop IPC contract type in `@exo/core` or `apps/desktop/src/shared`, with route names, request payloads, and response types. Generate or type-check `registerWorkspaceIpcHandlers`, preload exposure, and renderer `window.exo` from that contract. Keep command-server HTTP routes in `packages/core/src/command-protocol.ts`, but document which routes are desktop-only IPC versus CLI/MCP public contract.
- Tests needed: a compile-time contract test using `satisfies` over the main handler table and preload bridge; a route smoke test for newly added workspace/notes handlers.
- Timing: safe-now. This is a contributor ergonomics multiplier.

### P1 - Docs Contradict Runtime Terminal Transport

- Files: `docs/architecture.md:52`, `docs/architecture.md:61`, `AGENTS.md:67`, `apps/desktop/src/main/terminal-manager.ts:181`, `apps/desktop/src/main/terminal-manager.ts:227`
- Risk: architecture docs still say Claude/Codex run in Exo-managed tmux sessions, while `TerminalManager.create()` now always sets `transport: "direct"` and never calls `persistAgent()`. `restoreAgentSessions()` only handles legacy tmux state. This mismatch will mislead future agents into restoring tmux-first behavior or writing tests against the wrong model.
- Recommended refactor: update docs to state that new terminals are direct `node-pty`, restored tmux sessions are compatibility-only, and direct agent sessions do not survive app restart unless a future persistence model is added. Also remove or clearly mark unused tmux persistence helpers if they remain only for migration.
- Tests needed: a doc/architecture link or invariant check is enough after docs are fixed; optionally add a unit test that newly created Claude/Codex sessions report `transport: "direct"`.
- Timing: safe-now.

### P1 - Workspace Settings Writes Are Race-Prone

- Files: `apps/desktop/src/renderer/src/App.tsx:548`, `apps/desktop/src/renderer/src/App.tsx:669`, `apps/desktop/src/renderer/src/App.tsx:1172`, `apps/desktop/src/renderer/src/App.tsx:1228`, `apps/desktop/src/main/index.ts:865`, `packages/core/src/workspace-settings.ts:59`
- Risk: layout autosave, immediate settings autosave, structural apply, onboarding, workspace switch, and main-process settings normalization all write the same settings document. The renderer has a local `workspaceSettingsRef`, but there is no version/compare-and-swap or single settings controller. A delayed layout save can overwrite newer settings fields if it uses a stale base.
- Recommended refactor: centralize renderer settings mutations in one `useWorkspaceSettingsController` that queues patches, always reloads/merges against the latest saved settings, and separates `layout` persistence from structural workspace settings. Consider a main-process `saveSettingsPatch` route to avoid full-object writes for layout-only changes.
- Tests needed: fake timers test where a layout save is pending, user changes terminal history settings, and both changes survive. Add structural apply plus immediate autosave race coverage.
- Timing: safe-now if scoped to settings controller; otherwise later.

### P2 - Agent Instruction Management Is Split Across Three Places

- Files: `apps/desktop/src/main/index.ts:700`, `apps/desktop/src/main/index.ts:711`, `apps/desktop/src/main/index.ts:723`, `apps/desktop/src/main/agent-instruction-overlays.ts:51`, `apps/desktop/src/main/agent-instruction-overlays.ts:69`, `apps/desktop/src/renderer/src/hooks/useAgentInstructionEditor.ts:33`
- Risk: provider file management, generated runtime overlays, renderer editing state, and terminal launch env are separate but not modeled as one domain. The current dirty working tree also contains a stray `//comment//` in `agent-instruction-overlays.ts:4`, which is exactly the kind of low-signal artifact agents leave when a domain has no focused tests or lint.
- Recommended refactor: create `agent-instructions-service.ts` that owns provider scope resolution, read status, save alignment, overlay generation, and overlay env selection. Renderer hook should depend on the service contract only. Add lint/format gate to catch stray comments/import churn.
- Tests needed: unit tests for aligned/different/missing provider files, save writes both provider files, overlay root selection prefers deepest project/note root, and launch env points at the selected overlay.
- Timing: safe-now for service extraction and tests; lint gate can be later but should be soon.

### P2 - Workspace Filesystem Operations Lack A Focused Domain Boundary

- Files: `apps/desktop/src/renderer/src/App.tsx:1919`, `apps/desktop/src/renderer/src/App.tsx:1996`, `apps/desktop/src/renderer/src/App.tsx:2011`, `apps/desktop/src/renderer/src/App.tsx:2047`, `apps/desktop/src/main/index.ts:481`, `apps/desktop/src/main/index.ts:503`
- Risk: create/rename/move/delete behavior updates trees, open document maps, branch/knowledge maps, active path, reveal requests, and disk state from one renderer file. Future agents can easily forget one mirror state when adding a workspace mutation.
- Recommended refactor: introduce a renderer `useWorkspaceMutations` hook that returns high-level operations and emits a normalized "path remap/delete" event to `useOpenDocuments` and pane-tree state. Longer term, main should return structured mutation results (`createdPath`, `previousPath`, `nextPath`, `affectedPaths`) rather than leaving the renderer to infer all effects.
- Tests needed: rename folder with open child file, delete folder with active file, move conflict, create markdown under note root versus plain file under project root.
- Timing: later unless more workspace mutation work is planned soon.

### P2 - Current Tests Miss The Modularization Boundaries

- Files: `apps/desktop/src/renderer/src/App.test.tsx:1`, `apps/desktop/src/main/terminal-manager.test.ts:1`, `packages/core/src/__tests__/workspace-settings.test.ts:1`, `docs/harness.md:67`, `docs/tasks.md:139`
- Risk: tests cover several pure helpers and terminal readiness, but not the extracted boundaries or the highest-risk state machines. `docs/tasks.md` says broader pane/reload/terminal streaming coverage is done, yet the visible renderer test file does not exercise the real `App` orchestration.
- Recommended refactor: add focused tests for the boundaries created by modularization: terminal hydration/streaming, settings autosave races, IPC contract shape, indexing queue behavior, and app bootstrap layout restoration. Keep them hermetic per `docs/harness.md:31`.
- Tests needed: listed above; also add deterministic lint/format/import-boundary checks from `docs/tasks.md:141-142`.
- Timing: safe-now for contract/unit coverage; Playwright-heavy coverage can be later.

### P3 - Some Cleanup Is Not Worth Doing Yet

- Files: `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/main/index.ts`
- Risk: chasing line count alone could create abstractions around churn and make behavior harder to change. Some UI/onboarding composition still belongs near the shell until workflows settle.
- Recommended refactor: do not split every JSX block or every helper immediately. Extract only owned state machines and services with tests. Leave presentational composition in `App.tsx` until the hook boundaries are real.
- Tests needed: none beyond the extraction tests above.
- Timing: not-worth-doing as a standalone "reduce LOC" project.

## Future Agent Mistake Hotspots

- Adding renderer polling for file freshness instead of using `WorkspaceWatcherService` events; `AGENTS.md:72` warns against this, but `App.tsx` has enough local refresh logic that agents may copy it.
- Adding terminal output to React state because `terminalBuffers` still exists and looks canonical.
- Adding main-process features directly to `main/index.ts` because existing examples for search, git, settings, indexing, and agent config are inline.
- Adding IPC routes in one layer only. The route contract is currently split across preload/shared API, `workspace-ipc.ts`, `terminal-ipc.ts`, renderer calls, and command-server/CLI/MCP contracts.
- Treating Claude and Codex as separate product concepts despite `AGENTS.md:97`; provider-specific files are compatibility outputs, but current function names and UI labels can pull contributors toward provider branches.
- Trusting docs over code for terminal transport. Docs still describe tmux as primary for agents; code now creates direct sessions.
- Updating settings with full objects from stale renderer state. This is easy to do from `saveSettingsPatch()` and layout autosave examples.

## Recommended Cleanup Roadmap

1. Fix documentation drift around direct terminal transport and legacy tmux restore. Add a focused test that new agent sessions are direct.
2. Bound terminal memory: add tail/hydration APIs, stop normal full-buffer React resets, remove unused append-offset code, and add terminal stress tests.
3. Extract `indexing-service.ts` and `agent-instructions-service.ts` from `main/index.ts`, with pure unit tests.
4. Add a typed desktop IPC contract and compile-time handler/preload conformance checks.
5. Extract `useTerminalSessions`, `useOpenDocuments`, and `useWorkspaceSettingsController` from `App.tsx`; test the state-machine races before moving more JSX.
6. Add deterministic lint/format/import-boundary checks so modularity rules are enforced before review.
7. Only after those seams are stable, revisit line-count cleanup in `App.tsx` and `main/index.ts`.
