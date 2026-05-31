# Changelog

## 0.1.0-alpha.3 - 2026-05-31

Installed-app readiness, direct-pty terminal reliability, Exo-on-Exo harness cleanup, and resident runtime support.

- Makes the packaged macOS app the intended stable daily runtime and adds `./scripts/install-mac-app` / `pnpm install:mac-app` for local unsigned app installation.
- Adds `pnpm dev:qa` so source QA uses isolated `.exo-dev/` runtime and user-data state while installed Exo keeps coordinating notes, agents, CLI, and MCP.
- Adds a resident runtime menu-bar controller: closing the window hides Exo, the process keeps the command server/MCP/watchers/transcripts/live pty agents alive, and explicit Quit warns before stopping live terminals.
- Replaces core tmux terminal runtime paths with direct `node-pty` sessions, disk-backed transcripts, bounded live-tail hydration, terminal health diagnostics, semantic agent-message delivery, and coalesced resize handling.
- Refactors major desktop ownership boundaries out of the shell: app lifecycle, indexing, workspace notes, project review, agent instructions, workspace settings, renderer workspace/bootstrap/settings/mutation/open-document/terminal/pane-layout hooks, and typed desktop IPC.
- Prunes MCP to the narrow agent work plane while keeping CLI as the broader operator/admin/debug surface.
- Simplifies the Agent Config Editor to global and active exocortex instruction layers that align `AGENTS.md` and `CLAUDE.md`.
- Adds and verifies hidden-window CLI/MCP QA, refreshed desktop visual baselines, full desktop e2e coverage, and the usability-readiness standard for installed daily use.
- Installs and verifies `/Applications/Exo.app` as the local stable runtime with a visible macOS menu bar icon; normal `exo status` resolves to the installed runtime while `pnpm dev:qa` can run side-by-side.
- Tracks the remaining CI Node 20 GitHub Actions deprecation warning as `EXO-ISSUE-025`.

## 0.1.0-alpha.2 - 2026-05-17

Tester-readiness hardening for terminal history, Markdown tasks, and agent search.

- Simplifies terminal history behavior around explicit `full` and `custom` modes: `full` keeps Exo buffers untrimmed and transcripts default to forever.
- Removes hidden terminal transcript byte caps and renderer-side terminal buffer trimming.
- Filters xterm device-response sequences so terminal control replies cannot leak into Claude/Codex input.
- Makes rendered Markdown task checkboxes clickable, toggling the underlying `- [ ]` / `- [x]` source text directly.
- Gives CLI and MCP search a dedicated 30s default timeout while keeping normal command-server requests fast, and includes structured timeout errors for search failures.
- Adds regression coverage for terminal scrollback/device responses, clickable task checkboxes, CLI/MCP search timeout behavior, and MCP integration config.

## 0.1.0-alpha.1 - 2026-05-17

Fresh setup and QMD integration hardening.

- Adds repo-backed local install flow with `./scripts/install-local`, CI dry-run coverage, and pnpm dependency build-script allowlisting.
- Hardens first launch by creating missing note roots, using portable workspace defaults, preserving empty folders in the explorer, and fixing the blank renderer hook-order crash.
- Adds Exo-managed QMD indexing as an active optional substrate with lexical, semantic, and hybrid modes, Settings controls, status UI, sync/update/embed actions, and Explore indexed search on Enter.
- Exposes QMD-backed index status, search, read, sync, update, and embed flows through the Exo CLI/MCP command server while keeping terminal-agent CLI/MCP tools intact.
- Keeps QMD state under workspace-local `.exo/qmd`, credits upstream QMD by Tobi Lutke, and documents the adapter boundary and upgrade checklist.
- Fixes merge-blocking review issues: stale QMD docid read safety, multi-root hybrid search, long-running index command timeouts, workspace-root command-server refresh, and the ignored root `postinstall` script.

## 0.1.0-alpha.0 - 2026-05-12

Initial public alpha.

- Defines Exo as a local-first agentic development environment built around a shared exocortex.
- Ships the Electron desktop shell with Markdown notes, explicit note/project roots, project file viewing/editing, and terminal panes.
- Adds Claude, Codex, and shell terminal launchers with tmux-backed agent recovery.
- Adds Exo CLI and MCP control surfaces for live terminal agents.
- Adds MCP integration setup helpers for Codex and Claude Code.
- Narrows app search to fast note filename/path search while QMD remains future notes index infrastructure.
- Adds the current docs, roadmap, task tracker, harness notes, and plugin architecture direction.
