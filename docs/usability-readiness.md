# Usability Readiness Standard

> Historical readiness standard for the pre-pivot Exo-on-Exo product path. On `refactor/note-native-exo`, use `docs/exograph-refactor-completion-plan.md`, `roadmap.md`, and `tasks.md` for active sequencing.

Last updated: 2026-05-31

This is the near-term standard before Exo becomes Kenneth's daily installed runtime for notes, terminals, agent coordination, and Exo-on-Exo development.

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
- Installed Exo owns the menu bar icon, hidden-window process, command server, MCP bridge, workspace watchers, transcripts, and supervised agent terminals.
- Source builds are QA targets. Use `pnpm dev:qa` so dev Exo writes `.exo-dev/` runtime and user-data state instead of clobbering the stable runtime.
- Repo-backed CLI/MCP installation is acceptable for local development, but a standalone packaged CLI/helper remains future work.

## Ready Means

- Notes editing, project-file editing, save feedback, settings, panes, preview, terminals, CLI/MCP, and hidden-window runtime work in the installed app.
- Terminal typing, tab switching, long output, scrollback, transcript access, and agent send/read are responsive enough for actual daily work.
- The menu bar icon is visible after launching the installed app and exposes Show Exo, Settings, status/recovery, and Quit.
- Closing the window hides Exo; quitting from the menu bar is the explicit operation that stops live agents.
- `./bin/exo status`, `./bin/exo agents list`, and MCP agent tools work while the window is hidden.
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

Anything that blocks terminal input, loses saves, breaks settings, hides the menu bar runtime, prevents CLI/MCP control, corrupts notes/project files, or makes installed and dev Exo fight over runtime state goes back to immediate readiness work.
