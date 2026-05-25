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
