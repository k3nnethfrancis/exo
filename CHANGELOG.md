# Changelog

## 0.1.0-alpha.2 - 2026-05-17

Tester-readiness hardening for terminal history, Markdown tasks, and agent search.

- Simplifies terminal history behavior around explicit `full` and `custom` modes: `full` keeps Exo buffers untrimmed, transcripts default to forever, and restored tmux-backed agents seed visible scrollback once before returning to live PTY streaming.
- Removes hidden terminal transcript byte caps, renderer-side terminal buffer trimming, and recurring tmux snapshot replay into visible terminals.
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
