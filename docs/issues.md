# Exo Issues

Last updated: 2026-05-25

This is the active bug/QA tracker. It captures user-observed issues that need investigation before the next push/release pass.

## Open

### EXO-ISSUE-004: Codex agent launch in a new worktree can consume queued task text at the trust prompt

- Status: open
- Severity: high
- Area: agent terminal launch, Codex provider integration, worktree orchestration
- Observed: creating a Codex agent in a newly-created worktree shows Codex's directory trust prompt. If Exo sends the task brief before the prompt is cleared, the task text is typed into the trust prompt instead of the normal Codex chat input, and the agent can exit without doing the work.
- Expected: Exo should detect provider startup prompts or otherwise avoid delivering task text until the agent is ready for normal chat input.
- Investigation notes:
  - This appeared while coordinating parallel QA agents for `qa/preview-pane-layout` and `qa/changed-file-attribution`.
  - Existing agents launched from the trusted workspace root did not hit the same startup prompt.
  - Worktree paths may resolve to the original repository root for trust purposes, so the prompt text can mention the main repo even when the agent cwd is the worktree.
- QA coverage to add:
  - Agent-launch QA for a Codex agent created in a fresh worktree.
  - Regression that queued task text is not sent until the provider is ready for chat input.

### EXO-ISSUE-005: Dev app can exit after build without exposing the Exo CLI server

- Status: open
- Severity: high
- Area: desktop dev startup, command server, agent orchestration
- Observed: after the parallel-agent stress test, `pnpm dev` built the Electron main/preload/renderer successfully, printed `starting electron app...`, then exited with code 0. Subsequent `exo agents list` reported `Exo app is not running. Start it with: exo dev`. The user also saw the leftover Codex windows/panes as blank and closed them manually.
- Expected: `pnpm dev` should either keep the Electron app and command server alive, or print a clear startup failure explaining why the app exited.
- Investigation notes:
  - This interrupted the Exo-managed agent coordination loop and forced review/takeover from git worktrees instead of live agent transcripts.
  - Focused Playwright Electron launches still passed after this occurred, so the failure may be specific to dev-mode startup, an existing singleton instance, command-server boot, or the local terminal-agent state.
- QA coverage to add:
  - Dev startup smoke test that confirms the command server becomes reachable after `pnpm dev`.
  - Regression that a clean app exit during startup emits actionable diagnostics.
  - Agent-session cleanup QA that confirms exited/disconnected Codex windows do not remain as blank panes without useful state or recovery actions.

### EXO-ISSUE-006: Agent Context Manager can show stale preload API errors after app crashes/restarts

- Status: open
- Severity: high
- Area: desktop preload bridge, workspace settings, agent context manager
- Observed: Workspace Settings and Agent Context Manager showed `managed agent config files: window.exo.workspace.listAgentManagedConfigFiles is not a function`.
- Expected: renderer/preload/main API versions should stay aligned after crashes and restarts. If they are temporarily mismatched, the UI should show a clear restart/update message instead of a raw JavaScript function error.
- Investigation notes:
  - Current source includes `listAgentManagedConfigFiles` in preload and main IPC wiring, so this likely came from a stale or mixed renderer/preload state after Exo crashed during the multi-agent stress test.
  - The renderer should still defensively tolerate missing optional agent-management APIs so settings remains usable.
- QA coverage to add:
  - Regression that Agent Context Manager opens when managed config preload APIs are missing.
  - Dev/restart QA that confirms renderer and preload bundles update together after repeated crashes.

### EXO-ISSUE-007: Agent Context Manager error and control layout can overlap in narrow or partially failed states

- Status: open
- Severity: medium
- Area: agent context manager layout, settings UI polish
- Observed: the partial-load error text overlapped the target selector and `Write provider files` action in the Agent Context Manager.
- Expected: error states should occupy their own bounded row, wrap long technical messages, and never collide with form controls.
- Investigation notes:
  - Screenshot evidence showed the raw managed-config error running through the controls near the top of the manager.
  - Long provider/config paths and API error messages need wrapping and clipping rules.
- QA coverage to add:
  - Visual or e2e layout regression for long agent-context partial-load errors.
  - Narrow-window QA for the manager header, target selector, actions, and side panel.

### EXO-ISSUE-008: Agent Context Manager needs a clearer information architecture and explanatory UX

- Status: open
- Severity: medium
- Area: agent context manager UX, settings information architecture
- Observed: the manager is hard to understand at a glance. It mixes unified instructions, provider files, instruction outputs, runtime overlays, history, and managed configs without enough hierarchy or explanation.
- Expected: users should quickly understand what Exo-managed agent context is for, which files agents will read, which scopes are affected, how provider outputs are generated, and how managed configs/MCP settings relate to agent launches.
- Candidate fixes:
  - Rework the manager into clearer sections or tabs for unified instructions, provider outputs, runtime overlays, history, and managed configs.
  - Add concise tooltips/help affordances for scope, provider files, instruction outputs, generated overlays, and managed configs.
  - Apply the same settings-design principles used elsewhere: compact hierarchy, explicit state, predictable actions, no marketing copy, and no in-app explanatory walls.
- QA coverage to add:
  - App QA walkthrough with a new-user lens: identify active scope, edit unified instructions, see output files, inspect overlay, edit MCP config.
  - Narrow-window QA to ensure labels, paths, and controls remain readable without overlap.

## Fixed

### EXO-ISSUE-001: Workspace settings button does not open settings

- Status: fixed
- Severity: high
- Area: desktop shell, settings dialog, command routing
- Observed: clicking the settings button does not open Workspace Settings.
- Expected: the settings button should reliably open the Workspace Settings dialog from the sidebar.
- Investigation notes:
  - Verify whether the button handler is failing, the dialog is opening behind another overlay, or an exception is thrown while loading settings/agent context state.
  - Check recent Agent Context Manager changes because `openWorkspaceSettingsDialog` now eagerly loads agent context files, adapters, overlays, and managed configs.
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
