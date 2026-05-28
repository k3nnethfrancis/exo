# Exo Issues

Last updated: 2026-05-26

This is the active bug/QA tracker. It captures user-observed issues that need investigation before the next push/release pass.

## Open

### EXO-ISSUE-017: Terminal tabs can become blank, show stale `[exited]`, or lag while typing

- Status: partially fixed
- Severity: high
- Area: terminal renderer, terminal session switching, xterm performance
- Observed:
  - New terminals sometimes do not fully load.
  - Switching between terminals can show a blank surface or stale `[exited]` message, then recover after switching again.
  - Typing into terminals can lag enough to become unusable.
- Next:
  - Reproduce blank/stale `[exited]` behavior with restored sessions and fresh shell sessions.
  - Inspect whether active terminal reads, session status sync, xterm remounts, or tmux attach/exit events are causing stale terminal surfaces.
  - Add focused terminal switching/performance QA before marking fixed.
- Fixed:
  - Reduced terminal typing/output lag by appending streamed chunks through an append-specific live buffer path instead of trimming and comparing whole terminal buffers on every frame.
  - Explicit terminal reads now mark buffer resets so switching/restoring terminals still refreshes the xterm surface when the source buffer is replaced.

## Resolved

### EXO-ISSUE-010: Codex agent sessions report Exo MCP startup handshake failure

- Status: resolved
- Severity: medium
- Area: MCP server integration, Codex provider integration, Exo-on-Exo workflow
- Observed: newly launched Codex terminals showed `MCP client for exo failed to start: MCP startup failed: handshaking with MCP server failed: connection closed: initialize response`.
- Resolution: the repo-backed MCP launcher now imports a bundled CommonJS runtime artifact, uses an existing build without invoking `pnpm` on every startup, and only rebuilds as a fallback with Corepack project-spec disabled. The previous bundled ESM artifact crashed on startup with `Dynamic require of "fs" is not supported` before it could answer MCP `initialize`.
- QA coverage added:
  - MCP stdio launcher regression that starts `packages/mcp/bin/exo-mcp.mjs`, performs a real SDK `initialize`, and verifies `tools/list` includes `workspace_status`.
  - Live Exo-launched Codex smoke verified the Exo MCP startup warning is absent when the desktop command server is reachable.

### EXO-ISSUE-004: Codex agent launch in a new worktree can consume queued task text at the trust prompt

- Status: resolved
- Severity: high
- Area: agent terminal launch, Codex provider integration, worktree orchestration
- Observed: creating a Codex agent in a newly-created worktree shows Codex's directory trust prompt. If Exo sends the task brief before the prompt is cleared, the task text is typed into the trust prompt instead of the normal Codex chat input, and the agent can exit without doing the work.
- Resolution: Codex terminal sessions now start in a short `starting` readiness gate. Submitted chat messages are queued during that gate, remain queued if a Codex trust/startup prompt is detected, and flush only after normal Codex chat readiness appears. Raw non-submitted input still passes through so the user can answer interstitial prompts.
- QA coverage added:
  - Regression that submitted Codex task text is queued across a startup trust prompt and flushes on chat readiness.
  - Regression that queued text flushes after the startup grace when no prompt appears.
  - Regression that raw non-submitted input can still answer provider interstitials.

## Fixed

### EXO-ISSUE-018: Agent Config Editor remains cluttered after first UX pass

- Status: fixed
- Severity: medium
- Area: agent config editor UX, settings information architecture
- Observed:
  - Right-side provider/config/overlay lists consumed too much space.
  - Provider file selection felt detached from the provider file editor.
  - Managed history and generated overlay preview added density without supporting the primary edit path.
  - The provider editor needed more vertical space.
- Fixed:
  - Moved provider file selection into a tab strip directly above the provider editor.
  - Replaced managed history with a compact history popover control near the provider editor actions.
  - Collapsed managed config editing and generated overlay details by default.
  - Increased provider editor height and reduced top-section density.
  - Fixed the unified instructions textarea being clipped after the density pass by reserving real layout height instead of allowing overlap.
  - Converted the main editor blocks and side-rail blocks into collapsible sections so users can reclaim vertical space.
  - Moved managed config selection into the managed config editor as the same tab-strip pattern used by provider files.
  - Added internal scroll containment for editor panels, tab strips, and textareas so long content scrolls inside the relevant component box.
- QA coverage:
  - Focused Electron QA covers agent-config partial-load states, narrow-error layout, provider file editing, visible and scrollable unified editor height, history popover, managed config expansion/tab selection, and generated overlay expansion.
  - Live app QA verified the editor opens with provider/config tabs attached to their editors, collapsible sections working, and the unified instructions editor visible.

### EXO-ISSUE-016: Project-file saves have no visible confirmation

- Status: fixed
- Severity: medium
- Area: editor save UX, project files
- Observed: editing project files did not visibly indicate unsaved, saving, saved, or failed state, making it unclear whether `README` and source-file edits persisted.
- Fixed:
  - Added explicit editor save control and save status text for unsaved/saving/saved/error states.
  - Save now reads the latest document state from the renderer ref before writing, avoiding stale state when invoking save immediately after edits.
  - Project markdown saves no longer try to refresh note-only knowledge/branch metadata when the file is outside an attached note root.
- QA coverage:
  - Focused Electron QA covers editing a project source file and project `README.md`, observing dirty state, saving, and confirming the files on disk changed.
  - Live app QA verified the editor save status/control is visible in the active editor toolbar.

### EXO-ISSUE-015: Browser preview launcher is on the terminal rail

- Status: fixed
- Severity: low
- Area: shell navigation, browser preview
- Observed: browser preview launch lived with terminal controls even though it opens a workspace/editor pane.
- Fixed:
  - Moved the preview launcher to the explorer rail directly under the explorer collapse/expand control.
- QA coverage:
  - Focused Electron QA verifies the launcher is absent from the terminal rail, present in the explorer rail, and opens a browser preview pane.
  - Live app QA verified the launcher placement and preview-pane creation in the running desktop app.

### EXO-ISSUE-013: Agent Config Editor sections can overlap near the bottom of the dialog

- Status: fixed
- Severity: medium
- Area: agent config editor layout, managed config editor
- Observed: the Managed config editor header and contents could visually overlap the provider file editor when the manager had constrained vertical space.
- Fixed:
  - Agent config editor blocks now size from their content and let the editor's main column scroll instead of using a flexible textarea row with an indefinite parent height.
- QA coverage:
  - Added Playwright layout regression that verifies the provider file editor and managed config editor do not overlap after selecting a managed `.mcp.json` config.

### EXO-ISSUE-012: Reattached long-running Codex sessions can crash the renderer with huge buffers

- Status: fixed
- Severity: high
- Area: terminal persistence, renderer stability, Exo-on-Exo stress
- Observed: after the multi-agent stress test, the dev app repeatedly logged renderer crashes while reattaching Codex sessions with very large terminal buffers.
- Fixed:
  - Live terminal buffers now follow the user-configured live scrollback line count instead of a hidden character cap.
  - Transcript storage still receives complete terminal data; only the live interface buffer is trimmed.
  - Renderer-side streaming buffers apply the same line-based scrollback setting as chunks arrive, so active visible terminals match the settings model.
- QA coverage:
  - Added terminal-manager regression that live buffers follow configured scrollback lines while transcript reads still include the full emitted content.
  - Added renderer utility regression for streamed terminal buffer trimming from the same configured line count.

### EXO-ISSUE-011: Exo agent send can require an extra raw Enter before Codex starts work

- Status: fixed
- Severity: high
- Area: agent terminal write path, Codex provider integration, tmux orchestration
- Observed: `exo agents send <id> <brief>` reported queued delivery and the brief appeared at the Codex prompt, but Codex did not start processing until `exo agents send <id> $'\r' --raw` was sent afterward.
- Fixed:
  - Queued Codex submitted messages now flush as message body followed by a short delayed Enter, so Codex/tmux has time to finish activating the prompt before submit.
- QA coverage:
  - Updated terminal-manager regressions to verify queued Codex task text writes body first and delayed Enter afterward.
  - Live Exo-launched Codex smoke verified a queued `exo agents send` message starts work and receives `OK` without a second raw Enter.

### EXO-ISSUE-009: Agent create subcommand treats `--help` as a cwd

- Status: fixed
- Severity: low
- Area: CLI ergonomics, agent orchestration
- Observed: running `exo agents create codex --help` created a Codex terminal with cwd `--help` instead of showing help for the create subcommand.
- Fixed:
  - `exo agents --help`, `exo agents create --help`, and `exo agents create <provider> --help` are handled before app connection/terminal creation.
  - Option-shaped create cwd values now fail with a clear invalid-cwd error instead of being passed to terminal creation.
- QA coverage:
  - Added CLI regressions for `exo agents create --help`, `exo agents create codex --help`, and non-help option-shaped cwd rejection.
  - Live app QA verified identical `exo agents list` output before and after both help commands.

### EXO-ISSUE-005: Dev app can exit after build without exposing the Exo CLI server

- Status: fixed
- Severity: high
- Area: desktop dev startup, command server, agent orchestration
- Observed: after the parallel-agent stress test, a live command server was still bound, but `${workspaceRoot}/.exo/server.json` was missing. CLI discovery therefore reported `Exo app is not running. Start it with: exo dev`, and a second `pnpm dev` exited because Electron's single-instance lock was held.
- Expected: `pnpm dev` should either keep the Electron app and command server alive, or print a clear startup failure explaining why the app exited. A running app should be able to restore command-server discovery if `.exo/server.json` disappears.
- Fixed:
  - Command server startup now exposes `ensureDiscoveryFile()` and periodically refreshes `.exo/server.json` while the server is listening.
  - Duplicate Electron launches now pass runtime metadata to the primary instance, print an actionable diagnostic before exiting, and ask the running app to refresh command-server discovery.
  - Command-server startup failures are logged to the main log instead of leaving stale in-memory server state.
- QA coverage:
  - Added a main-process unit regression that deletes `server.json` while the command server is live and verifies `ensureDiscoveryFile()` rewrites the correct port and pid.
  - Focused checks: `pnpm --filter @exo/desktop typecheck`; `pnpm --filter @exo/desktop test`.

### EXO-ISSUE-006: Agent Config Editor can show stale preload API errors after app crashes/restarts

- Status: fixed
- Severity: high
- Area: desktop preload bridge, workspace settings, agent config editor
- Observed: Workspace Settings and Agent Config Editor showed `managed agent config files: window.exo.workspace.listAgentManagedConfigFiles is not a function`.
- Fixed:
  - Renderer now treats managed-config preload APIs as optional and reports a clear restart/update message when they are unavailable.
  - Settings and Agent Config Editor still open with partial error state instead of failing the dialog.
- QA coverage:
  - Added Playwright regression that opens Agent Config Editor when the managed-config preload API is intentionally omitted.

### EXO-ISSUE-007: Agent Config Editor error and control layout can overlap in narrow or partially failed states

- Status: fixed
- Severity: medium
- Area: agent config editor layout, settings UI polish
- Observed: the partial-load error text overlapped the target selector and write action in the Agent Config Editor.
- Fixed:
  - Partial-load errors now render in their own bounded row, wrap long technical messages, and stay separate from the scope/action controls.
  - Narrow manager layouts have dedicated responsive spacing for overview, controls, and side panel content.
- QA coverage:
  - Added Playwright layout regression for long agent-context errors in a narrow manager.

### EXO-ISSUE-008: Agent Config Editor needs a clearer information architecture and explanatory UX

- Status: fixed
- Severity: medium
- Area: agent config editor UX, settings information architecture
- Observed: the manager mixed unified instructions, provider files, instruction outputs, runtime overlays, history, and managed configs without enough hierarchy or explanation.
- Fixed:
  - Reworked the manager into clearer sections for unified instructions, managed history, provider files, instruction outputs, runtime overlays, and managed config editing.
  - Replaced the single scope dropdown with explicit Global vs Selected scopes controls, including multi-select notes/project targets and a write-summary showing how many scopes will be touched.
  - Corrected provider global instruction paths: Codex writes `~/.codex/AGENTS.md`; Claude writes `~/.claude/CLAUDE.md`.
  - Removed the summary overview strip after QA showed it added visual clutter without a clear action.
  - Added concise tooltips/help affordances for scope, provider outputs, overlays, history, and managed configs.
- QA coverage:
  - Extended Playwright settings QA to verify the core sections, output controls, multi-scope writes, and absence of the removed overview strip.

### EXO-ISSUE-001: Workspace settings button does not open settings

- Status: fixed
- Severity: high
- Area: desktop shell, settings dialog, command routing
- Observed: clicking the settings button does not open Workspace Settings.
- Expected: the settings button should reliably open the Workspace Settings dialog from the sidebar.
- Investigation notes:
  - Verify whether the button handler is failing, the dialog is opening behind another overlay, or an exception is thrown while loading settings/agent context state.
  - Check recent Agent Config Editor changes because `openWorkspaceSettingsDialog` now eagerly loads agent context files, adapters, overlays, and managed configs.
  - If one load path fails or hangs, settings should still open with partial error state rather than failing the whole dialog.
- QA coverage to add:
  - E2E that clicks settings in a real configured workspace after agent manager/config files are present.
  - Regression for settings opening even if agent context/config discovery fails.
- Fixed in: `aeed5a5` / merged to `main`.

### EXO-ISSUE-002: Preview pane sizing and drag behavior is not consistent with editor/terminal panes

- Status: fixed
- Severity: high
- Area: pane graph, browser preview pane, split resizing, drag/drop tab behavior
- Observed:
  - It is difficult to resize vertical space when a preview is open, especially dragging to make bottom panes such as terminal/editor larger.
  - Preview does not appear to behave like a normal draggable/adjustable tab item alongside editor and terminal panes.
- Expected:
  - Browser preview panes should participate in the same split-pane graph as editor and terminal panes.
  - Users should be able to resize splits predictably in both vertical and horizontal directions.
  - Preview tabs should have the same drag/reorder/split affordances as editor and terminal tabs unless there is an explicit reason not to.
- Investigation notes:
  - Inspect browser pane leaf handling in pane tree state and drag/drop handlers.
  - Confirm browser pane tab chrome exposes the same drag payload/drop zones as editor and terminal leaves.
  - Confirm split resizer hit areas and persisted ratios work when a browser pane is one of the split children.
- QA coverage to add:
  - E2E for resizing a vertical split where one pane is browser preview and another is terminal/editor.
  - E2E for dragging browser preview tabs/panes using the same affordances as editor/terminal.
  - App QA screenshots for preview + terminal + editor layout before and after resize.
- Fixed in: `3733b9d` / merged to `main`.

### EXO-ISSUE-003: Changed-file badges inside terminal panes are not terminal-specific

- Status: fixed
- Severity: high
- Area: project review, terminal provenance, changed-files UI
- Observed: active file changes appear inside all terminal panes, not just the terminal that plausibly produced or owns the change.
- Expected:
  - Changed-file affordances shown inside a terminal should be specific to that terminal session when Exo can reliably link the file change to the session.
  - If Exo cannot reliably link a change to one terminal, it should avoid implying terminal-specific ownership.
- Candidate fixes:
  - Preferred if reliable: improve linking by session id, cwd, observed write event, timestamp, and controlled write path.
  - Safer fallback: move ambiguous changed-file indicators to a bottom/status bar near branch/directories/index status, with a click target that opens changed files.
  - If a changed file belongs to a project that is not imported/attached, clicking should prompt the user to import/attach that project before opening or reviewing it.
- Investigation notes:
  - Current broad cwd/root matching may be too permissive and causes every terminal in a project/root to show the same changes.
  - Provenance should not make AI-detector-style guesses. If the link is not observed or controlled, show it as workspace/project state rather than terminal state.
- QA coverage to add:
  - E2E with two terminals in the same project root where only one has an observed write candidate.
  - E2E with ambiguous changed files confirming they do not appear as terminal-specific.
  - E2E/status-bar QA for opening changed files and prompting to attach missing projects.
- Fixed in: `f7f886d` / merged to `main`.
