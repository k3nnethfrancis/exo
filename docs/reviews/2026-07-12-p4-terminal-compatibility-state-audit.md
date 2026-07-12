# Terminal compatibility-state audit

Date: 2026-07-12
Scope: Loop 01 P4 evidence only. This audit makes no runtime, settings, CLI, command-server, or documentation change outside this file.

## Decision

The direct-PTY product has no durable terminal-transcript feature. Therefore
`terminalTranscriptRetention` and `terminalTranscriptRetentionDays` are dead
persisted compatibility state and should be **deleted through an explicit,
idempotent settings migration**. They must not be renamed, exposed again, or
kept as a compatibility default.

The surrounding legacy terminal tuning fields should be removed from persisted
`WorkspaceSettings` in the same focused terminal change, with one exception:
`terminalFontSize` is a live, compact user preference and should remain. The
only other live behavior currently encoded by a setting is
`terminalHistoryLines`; it is both a visible xterm scrollback limit *and* an
unrelated main-process tail-cache character limit. That coupling is incorrect
for the current architecture. Migrate it to two internal bounded defaults now;
only reintroduce an explicit scrollback setting if Exo later offers a real
user-facing scrollback choice with a clear unit and UI.

This is a source/type/settings/docs cleanup. It does **not** require a new CLI
flag, command-server route, or shared command protocol change.

## Current product boundary

The canonical decision is direct `node-pty` rendered by xterm. xterm owns the
live screen and ordinary scrollback; `TerminalManager` owns an in-memory,
bounded tail for renderer reload and operator tail reads. App exit ends PTYs.
There is no transcript store, transcript route, transcript read, or durable
terminal recovery in the current runtime.

Evidence:

- `docs/terminal-runtime-decision.md:7-31`
- `skills/terminal-stability/SKILL.md` (Current Decision, Ownership, and Hard
  Invariants)
- `apps/desktop/src/main/terminal-tail-cache.ts:1-5`
- `apps/desktop/src/main/terminal-manager.ts:285-306` (only in-memory tail
  append) and `:179-186` (tail read)
- `apps/desktop/src/main/command-server.test.ts:47-53` (legacy transcript
  route returns 404)

## Persisted-key disposition

| Key | Exact live source callers | Current user-visible behavior | Disposition | Migration and verification implication |
| --- | --- | --- | --- | --- |
| `terminalTranscriptRetention` | Normalized at `packages/core/src/workspace-settings.ts:358`; seeded at `apps/desktop/src/main/workspace-config-store.ts:118`. No production runtime, renderer, UI, IPC, CLI, or command-server reader. | None. The Settings Terminal section renders only font size. | **Delete.** | Strip this known legacy key during settings/registry/transaction normalization while retaining unrelated unknown keys. Remove type/default/test-fixture expectations. Regression: a legacy settings snapshot loses only this pair and keeps commands, layout, indexed roots, and unknown fields. |
| `terminalTranscriptRetentionDays` | Normalized at `workspace-settings.ts:359`; seeded at `workspace-config-store.ts:119`. No production reader. | None. | **Delete.** | Same migration as above. Also remove the unused `_legacyTranscriptRetentionDays` constructor parameter at `terminal-manager.ts:67` and update the positional test construction at `terminal-manager.test.ts:12`. |
| `terminalFontSize` | Renderer applies it in `apps/desktop/src/renderer/src/App.tsx:273-279`; `TerminalView` passes it to xterm at `components/TerminalView.tsx:85-100`; editable UI at `WorkspaceSettingsDialog.tsx:501-514`; persisted dialog mapping at `useWorkspaceSettingsController.ts:124,384`. | The Terminal Settings section lets the user set terminal font size. | **Retain.** | Keep its current bounds and the Settings round-trip coverage. Electron QA: font size changes an existing/new terminal without disturbing the mounted xterm state. |
| `terminalHistoryLines` | Main passes it to `TerminalManager` at `apps/desktop/src/main/index.ts:483-486` and reapplies it at `:417-419`; renderer maps it to xterm `scrollback` at `workspaceSettingsModel.ts:44-48`, `App.tsx:273-279`, and `TerminalView.tsx:92,307-308`. Main uses that same numeric value as `TerminalTailCache` **characters** (`terminal-manager.ts:64-75`, `terminal-tail-cache.ts:8-16`). | Controls ordinary xterm scrollback and the in-memory replay/tail bound, but has no current UI. The two consumers use different units. | **Migrate, then delete as persisted state.** | Replace with separate internal, named defaults: a line limit for xterm and a character/byte limit for `TerminalTailCache`. Do not retain an invisible implementation-tuning setting. If product research later earns a scrollback choice, add a new explicitly named, line-unit setting and visible UI—not this overloaded key. Regression: bounded reload/operator tail and xterm scrollback remain independently bounded; a legacy value does not alter either after migration. |
| `terminalReadTailChars` | Normalized at `workspace-settings.ts:367`; renderer reads it only in `workspaceSettingsModel.ts:46` to cap pending hydration data passed by `App.tsx:93`. Main tail reads do not consume it. | None. It is not a user-facing tail-size control. | **Delete.** | Make the hydration-race buffer an internal bounded constant. Preserve tests for output arriving before xterm registration and reload replay; do not turn a transport bound into Settings UI. |
| `terminalMaxReadTailChars` | Normalized at `workspace-settings.ts:368-371`; no production reader after normalization. | None. | **Delete.** | Remove type/default/fixtures. Retain `TerminalManager.readTail(id, { maxLines })` behavior and its bounded-memory backing. |
| `terminalInputCoalesceMs` | Normalized at `workspace-settings.ts:360`; no production reader. | None. | **Delete.** | Keep output backpressure/coalescing internal if still needed; preserve byte-faithful rapid-input tests. |
| `terminalAgentStartupGraceMs` | Normalized at `workspace-settings.ts:361`; no production reader. | None. | **Delete.** | Invocation timing must remain an `InvocationRunner`/test concern, not persisted terminal configuration. |
| `terminalAgentSubmitDelayMs` | Normalized at `workspace-settings.ts:362`; no settings-to-manager reader. `TerminalManager` has a separately defaulted internal option at `terminal-manager.ts:31-44,179-186`. | None. Configured Command prompt submission uses the internal delay, not the stored value. | **Delete as persisted state; retain internal default/test injection.** | Preserve configured-Command launch/prompt delivery tests with a deterministic injected option where needed. Prove a legacy setting cannot silently claim control of launch behavior. |
| `terminalInitialColumns`, `terminalInitialRows` | Normalized at `workspace-settings.ts:363-364`; no settings-to-manager reader. `TerminalManager` uses its own internal defaults through `TerminalGeometryService` at `terminal-manager.ts:31-44,112-113,352`. | None. Initial geometry comes from internal defaults and then renderer fit. | **Delete as persisted state; retain internal geometry defaults.** | Keep resize and first-fit regressions. Do not surface startup geometry as a user preference. |
| `terminalMinimumColumns`, `terminalMinimumRows` | Normalized at `workspace-settings.ts:365-366`; no production reader. | None. | **Delete.** | Preserve the geometry service's internal safety minimums and resize tests. |
| `terminalUnresponsiveThresholdMs` | Normalized at `workspace-settings.ts:372`; no production reader. | None. | **Delete.** | Do not reintroduce a user-tunable health-policy setting. |
| `terminalIdleThresholdMs` | Normalized at `workspace-settings.ts:373`; no settings-to-manager reader. `TerminalManager` uses the internal default through `TerminalManagerOptions` at `terminal-manager.ts:31-44,313-337`. | A session can acquire the internal `idle` health state; the persisted value does not control it. | **Delete as persisted state; retain internal default/test injection.** | Keep health-status tests and real-app visibility QA. |

## UI, reader, and test evidence

- The current Terminal Settings UI contains exactly `terminalFontSize`:
  `apps/desktop/src/renderer/src/components/WorkspaceSettingsDialog.tsx:497-516`.
  There is no transcript, retention, history, tail, geometry, health, or
  timing control to preserve.
- `apps/desktop/src/renderer/src/workspaceSettingsModel.ts:44-49` is the only
  renderer settings reader beyond the font size: it maps `terminalHistoryLines`
  and `terminalReadTailChars`.
- `apps/desktop/src/main/index.ts:417-419,483-486` is the only production
  settings-to-terminal-manager bridge, and it reads only
  `terminalHistoryLines`.
- The remaining mentions of the transcript pair outside normalizers/defaults
  are test fixtures in core settings tests, desktop main tests, renderer App
  tests, Settings tests, and desktop E2E fixtures. They test shape preservation
  today, not a transcript behavior. Update those fixtures to assert named
  removal rather than carrying stale fields forever.

## Documentation disposition

| Artifact | Finding | Action in the implementation change |
| --- | --- | --- |
| `SECURITY.md:13-22` | Claims `.exo/terminal-transcripts/` exists and says transcripts default to forever. This is false for the current runtime and security guidance. | **Refresh immediately**: remove the directory and retention warning; retain security guidance for actual `.exo/` derived data (index/invocation records) only. |
| `README.md:57-58,268` and `CONTEXT.md:66` | Correctly describe bounded in-memory replay and reject durable transcripts. `README.md:144` has one stale resident-runtime reference to "transcripts." | **Refresh the one stale README line**; retain the rest. |
| `docs/terminal-runtime-decision.md` and `skills/terminal-stability/SKILL.md` | Current and aligned. | **Retain unchanged** except links if documents are deleted. |
| `docs/terminal-quality-standard.md` | Its current content is largely aligned but duplicates the terminal skill; P4 inventory already lists it as a stale-plan deletion candidate. | **Distill/delete**, not a second canonical terminal policy. Keep the skill and runtime decision as the durable pair. |
| `docs/terminal-architecture-v4.md`, `terminal-refactor-plan.md`, `terminal-code-review-2026-06-23.md`, `terminal-fallback-audit.md`, `terminal-render-cleanup-protocol.md`, `wp-078-pi-answer-visibility-diagnostic.md` | Tmux/transcript-era architecture/audits; `docs/README.md` already labels them archaeology. | **Delete in the P4 stale-document deletion commit** after preserving only still-true direct-PTY invariants in the skill/runtime decision. Do not bulk-rewrite historical content as present tense. |
| `CHANGELOG.md`, `ledger.md`, old resolved `issues.md` entries, dated reviews | Historical records mention transcripts/tmux. | **Retain as historical evidence**, but do not use them as current product documentation. The current EXO-ISSUE-101 acceptance text should be corrected once this deletion lands because it presently claims transcript retention settings are already gone. |

## Safe implementation slice

1. Add a named legacy-terminal-settings migration to
   `normalizeWorkspaceSettings`, analogous to the existing named
   `projectRoots` removal: drop only the listed obsolete terminal keys while
   preserving unrelated unknown fields. Rewriting through the existing
   settings/registry transaction should make the removal durable on load.
2. Remove the obsolete fields/types/defaults and their fixture values. Replace
   `terminalHistoryLines` with independent internal scrollback and tail bounds;
   retain `terminalFontSize` only.
3. Remove the unused legacy constructor slot and stale settings-to-runtime
   mapping. Do not change `TerminalManager`'s public desktop/CLI surface,
   command-server routes, or `@exo/core` command protocol.
4. Refresh the current docs above, then delete explicitly superseded
   terminal/transcript plans in the separate P4 documentation deletion commit.

## Required proof after implementation

- Core settings tests prove a legacy settings file, registry entry, and
  interrupted transaction remove exactly the named terminal keys while
  preserving Agent Commands, layout, indexing, revision behavior, and unknown
  future fields.
- Terminal manager/unit tests prove tail memory remains bounded for long output
  without newlines; renderer tests prove bounded hydration replay and no full
  replay on ordinary tab/focus changes.
- Electron QA: rapid input, paste/control keys, resize, normal scrollback,
  pane/tab hide/reveal, configured Command launch, renderer reload, and app
  exit. Confirm the compact Terminal Settings section still exposes only font
  size.
- Run the terminal-stability checks for touched code, then the repository gate:
  `pnpm --filter @exo/desktop typecheck`, desktop terminal tests,
  `pnpm --filter @exo/desktop build`, `pnpm check:repo`, and the applicable
  Electron terminal journey. Use packaged-app QA for lifecycle claims.
