# Usability Readiness Standard

> Installed-app readiness evidence complements the active sequencing in `tasks.md` and the reviewed boundary in `docs/reviews/2026-07-12-fable-loop-01-packet.md`.

Last updated: 2026-07-12

This is the near-term standard before Exo becomes Kenneth's daily installed runtime for notes, terminals, configured Commands, and Exo-on-Exo development.

The goal is not public-release polish. The goal is a stable local app that can stay running while Kenneth works on other projects, while source builds are tested separately.

## Phase Order

1. Finish usability and harness readiness.
2. Clean up the local commit stack into reviewable history.
3. Push the branch and expose the review surface.
4. Install and run the packaged macOS app as the stable resident runtime.
5. Use installed Exo for real work and bug bash every friction point.
6. After the app is truly stable in daily use, resume larger roadmap phases: exograph architecture, graph/read primitives, note maintenance, multi-agent communication, plugins, workcells, evals, and training.

## Stable Runtime Model

- Installed `Exo.app` is the stable daily runtime.
- Installed Exo owns the menu bar icon, hidden-window process, command server, workspace watchers, direct PTYs, and configured-Command invocation.
- Source builds are QA targets. Use `pnpm dev:qa` so dev Exo writes `.exo-dev/` runtime and user-data state instead of clobbering the stable runtime.
- The repo-backed CLI is the local operator surface; a standalone packaged CLI/helper remains future work.

## Ready Means

- Note editing, save feedback, settings, panes, preview, terminals, CLI search/status, configured-Command invocation, and hidden-window runtime work in the installed app.
- Terminal typing, tab switching, long output, and ordinary scrollback are responsive enough for actual daily work.
- The menu bar icon is visible after launching the installed app and exposes Show Exo, Settings, status/recovery, and Quit.
- Closing the window hides Exo; quitting from the menu bar is the explicit operation that stops live agents.
- `exo status` and `exo search` remain useful while the window is hidden or the app is off; `exo open` and `exo invoke` connect to the resident app when it is available.
- Dev QA can run with `pnpm dev:qa` while installed Exo remains available for monitoring.
- Open critical usability issues are either resolved or explicitly moved into the live bug-bash backlog with a workaround.

## Required Evidence Before Push

- `pnpm ci:check`
- Focused e2e for touched desktop flows.
- Installed-app dry run or real install evidence for packaging changes.
- In-app QA notes for affected workflows.
- `git status --short` clean except intentionally untracked local artifacts.
- Docs agree across `README.md`, `AGENTS.md`, `../tasks.md`, `../roadmap.md`, `docs/harness.md`, and `ledger.md`.

## Live Bug-Bash Backlog

These are allowed after initial install only if they do not block daily use:

- visual polish that does not hide controls or data
- additional app-QA screenshots
- richer terminal health UI
- launch-at-login
- standalone packaged CLI/helper
- signing/notarization
- CI/harness expansions that are valuable but not required to safely use the current local app

Anything that blocks terminal input, loses saves, breaks settings, hides the menu bar runtime, prevents CLI control, corrupts Notes, or makes installed and dev Exo fight over runtime state goes back to immediate readiness work.
