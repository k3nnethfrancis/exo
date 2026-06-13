# Staff Code Review - 2026-05-27

Scope: post-modularization review of `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/main/index.ts`, workspace IPC, terminal runtime, workspace settings, agent config modules, AGENTS/docs, and tests.

Update 2026-05-28: the terminal runtime findings from the original review were resolved by the direct-pty simplification pass. Core terminals are now direct `node-pty` only, tmux runtime paths were removed, live display ownership stays in xterm, renderer hydration uses bounded tail snapshots, and full history is transcript-only. Keep future work focused on the remaining modularity and contract risks below.

Update 2026-06-13: the direct-pty terminal guidance in this historical review is superseded by `terminal-runtime-decision.md`, `terminal-refactor-plan.md`, and `terminal-quality-standard.md`. The current decision is to move daily Exo terminals to a tmux-backed runtime with `node-pty` as the attach bridge, while preserving append-driven xterm rendering and deterministic terminal QA.

## Executive Summary

The modularization moved real pieces out of the largest files (`terminal-ipc`, `workspace-ipc`, `settings-store`, watcher/transcript helpers, pane/tree helpers), but the repo is not yet at a stable modular boundary. `App.tsx` and `main/index.ts` still act as service locators plus business-logic hosts. That is now the main contributor-risk surface: future agents will naturally append behavior to these files because all state and examples are there.

Highest-priority cleanup should focus on main-process service boundaries, renderer state-machine extraction, IPC contract typing, settings write races, and app lifecycle boundaries. Terminal work should preserve xterm-owned live rendering, bounded hydration tails, disk-backed transcripts, and the quality standard while moving process persistence behind the planned tmux-backed runtime boundary.

## Resolved Since Review

### Terminal Runtime And Rendering Ownership

- Resolved at the time by the direct-pty terminal cleanup; superseded for future runtime work by the 2026-06-13 tmux-backed decision.
- New shell, Claude, and Codex sessions still use direct `node-pty` today; tmux-backed persistence is the planned next runtime.
- Renderer terminal rendering is append-driven into xterm. React state is not the live output owner.
- Hydration reads a bounded live tail. Full history is available through transcripts.
- Remaining risk: `EXO-ISSUE-021` tracks the Electron/Playwright harness timeout after many serial app launches; affected terminal behavior passes focused tests.

## Prioritized Findings

### P0 - `main/index.ts` Remains The Main-Process God Object

- Files: `apps/desktop/src/main/index.ts`
- Risk: the file still owns app lifecycle, window/tray/recovery, command server wiring, workspace filesystem commands, tag search, note target resolution, git status parsing, agent instruction config, workspace settings application, and indexing job scheduling. This makes future changes hard to test without Electron globals and encourages agents to add new inline subsystems despite `AGENTS.md`.
- Recommended refactor: extract services in this order:
  1. `indexing-service.ts` for `scheduleIndex*`, `runIndex*`, metrics, and renderer notifications.
  2. `workspace-notes-service.ts` for tag search, note target resolution, branch/knowledge wrappers.
  3. `agent-instruction-config-service.ts` for provider file read/write and scope status.
  4. `app-lifecycle.ts` or `window-manager.ts` for tray/window/recovery.
- Tests needed: pure unit tests for git diff parsing, note target resolution, agent instruction status resolution, and indexing queue behavior.

### P0 - App Runtime Lifecycle Is Not Yet A First-Class Boundary

- Files: `apps/desktop/src/main/index.ts`
- Risk: Exo needs to behave as a resident runtime that can keep MCP, the command server, watchers, transcripts, and terminal-agent sessions available while the workspace window is hidden. If window lifecycle and runtime lifecycle stay tangled in `main/index.ts`, future multi-agent workflows will either require the app window to remain open or accidentally kill live agents on close.
- Recommended refactor: extract `app-lifecycle.ts` or `window-manager.ts` around process/window/menu-bar ownership. Make close-window hide, explicit quit stop live agents, and menu bar actions restore the window or quit. Keep runtime services owned by the process composition root, not React.
- Tests needed: main-process tests for close/hide/show/quit intent, command-server availability while hidden, and explicit quit warnings for live terminal sessions.

### P1 - `App.tsx` Is Still A Large State Machine

- Files: `apps/desktop/src/renderer/src/App.tsx`
- Risk: bootstrap, layout persistence, settings autosave, document save/refresh, terminal pane/session management, workspace mutations, onboarding, and shell rendering are interleaved. Bugs will appear as stale closures, duplicated state, and inconsistent tree/document/session updates.
- Recommended refactor: extract behavior hooks, not just components:
  - `useWorkspaceBootstrap`
  - `useOpenDocuments`
  - `useWorkspaceMutations`
  - `useTerminalSessions`
  - `useWorkspaceSettingsController`
  - `usePaneDropHandlers`
- Tests needed: hook-level tests for document refresh/save races, pane drag/drop, terminal move/close, and settings autosave/apply behavior.

### P1 - IPC Types Are Duplicated And Too Loose

- Files: `apps/desktop/src/main/workspace-ipc.ts`, `apps/desktop/src/main/terminal-ipc.ts`, `packages/core/src/command-protocol.ts`
- Risk: workspace IPC handler signatures still use loose returns and are not derived from the preload/shared API or core command contract. Adding a route requires touching multiple places with no compile-time guarantee that renderer, preload, main handler, CLI, and MCP agree.
- Recommended refactor: define a shared desktop IPC contract type in `@exo/core` or `apps/desktop/src/shared`, with route names, request payloads, and response types. Type-check `registerWorkspaceIpcHandlers`, preload exposure, and renderer `window.exo` against that contract.
- Tests needed: a compile-time contract test using `satisfies` over the main handler table and preload bridge; a route smoke test for newly added workspace/notes handlers.

### P1 - Workspace Settings Writes Are Race-Prone

- Files: `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/main/index.ts`, `packages/core/src/workspace-settings.ts`
- Risk: layout autosave, immediate settings autosave, structural apply, onboarding, workspace switch, and main-process settings normalization all write the same settings document. A delayed layout save can overwrite newer settings fields if it uses a stale base.
- Recommended refactor: centralize renderer settings mutations in one `useWorkspaceSettingsController` that queues patches, always reloads/merges against the latest saved settings, and separates `layout` persistence from structural workspace settings. Consider a main-process `saveSettingsPatch` route to avoid full-object writes for layout-only changes.
- Tests needed: fake timers test where a layout save is pending, user changes terminal history settings, and both changes survive. Add structural apply plus immediate autosave race coverage.

### P2 - Agent Instruction Management Is Split Across Three Places

- Files: `apps/desktop/src/main/index.ts`, `apps/desktop/src/main/agent-instruction-overlays.ts`, `apps/desktop/src/renderer/src/hooks/useAgentInstructionEditor.ts`
- Risk: provider file management, generated runtime overlays, renderer editing state, and terminal launch env are separate but not modeled as one domain. This remains easy to break while refining the Agent Config Editor.
- Recommended refactor: create `agent-instructions-service.ts` that owns provider scope resolution, read status, save alignment, overlay generation, and overlay env selection. Renderer hook should depend on the service contract only.
- Tests needed: unit tests for aligned/different/missing provider files, save writes both provider files, overlay root selection prefers deepest project/note root, and launch env points at the selected overlay.

### P2 - Workspace Filesystem Operations Lack A Focused Domain Boundary

- Files: `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/main/index.ts`
- Risk: create/rename/move/delete behavior updates trees, open document maps, branch/knowledge maps, active path, reveal requests, and disk state from one renderer file. Future agents can easily forget one mirror state when adding a workspace mutation.
- Recommended refactor: introduce a renderer `useWorkspaceMutations` hook that returns high-level operations and emits a normalized path remap/delete event to `useOpenDocuments` and pane-tree state. Longer term, main should return structured mutation results (`createdPath`, `previousPath`, `nextPath`, `affectedPaths`).
- Tests needed: rename folder with open child file, delete folder with active file, move conflict, create markdown under note root versus plain file under project root.

### P2 - Current Tests Miss Some Modularization Boundaries

- Files: `apps/desktop/src/renderer/src/App.test.tsx`, `apps/desktop/src/main/terminal-manager.test.ts`, `packages/core/src/__tests__/workspace-settings.test.ts`, `docs/harness.md`
- Risk: tests cover several pure helpers and terminal readiness, but not all extracted boundaries or the highest-risk state machines.
- Recommended refactor: add focused tests for terminal hydration/streaming, settings autosave races, IPC contract shape, indexing queue behavior, and app bootstrap layout restoration. Keep them hermetic per `docs/harness.md`.
- Timing: safe-now for contract/unit coverage; Playwright-heavy coverage can stay focused because the Electron launch harness has known serial-run limits.

### P3 - Some Cleanup Is Not Worth Doing Yet

- Files: `apps/desktop/src/renderer/src/App.tsx`, `apps/desktop/src/main/index.ts`
- Risk: chasing line count alone could create abstractions around churn and make behavior harder to change. Some UI/onboarding composition still belongs near the shell until workflows settle.
- Recommendation: extract owned state machines and services with tests. Leave presentational composition in `App.tsx` until the hook boundaries are real.

## Future Agent Mistake Hotspots

- Adding renderer polling for file freshness instead of using `WorkspaceWatcherService` events.
- Reintroducing React-owned terminal output state. The canonical terminal model is xterm live streaming plus bounded hydration tail plus transcripts.
- Adding main-process features directly to `main/index.ts` because existing examples for search, git, settings, indexing, and agent config are inline.
- Adding IPC routes in one layer only. The route contract is currently split across preload/shared API, workspace IPC, terminal IPC, renderer calls, and command-server/CLI/MCP contracts.
- Treating Claude and Codex as separate product concepts. Provider-specific files are compatibility outputs; Exo should keep the UX agent-agnostic.
- Updating settings with full objects from stale renderer state.

## Recommended Cleanup Roadmap

Phase rule: first extract current-package domain modules, then build resident runtime and multi-agent features, then promote stable runtime services into a dedicated runtime package, and only then expose plugin registries.

1. Extract runtime lifecycle/window/menu-bar ownership from `main/index.ts`, with tests for hidden-window command-server availability.
2. Extract `indexing-service.ts` and `agent-instructions-service.ts` from `main/index.ts`, with pure unit tests.
3. Add a typed desktop IPC contract and compile-time handler/preload conformance checks.
4. Extract `useTerminalSessions`, `useOpenDocuments`, and `useWorkspaceSettingsController` from `App.tsx`; test the state-machine races before moving more JSX.
5. Add deterministic lint/format/import-boundary checks so modularity rules are enforced before review.
6. Revisit line-count cleanup in `App.tsx` and `main/index.ts` only after those boundaries are stable.
