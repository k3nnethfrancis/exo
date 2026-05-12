# Exo Ledger

Last updated: 2026-05-11

This is the fastest handoff file for Exo.

## Product Thesis

Exo is a workspace-centric research IDE.

It replaces Garden's native macOS shell with an Electron shell while preserving the long-term system shape:
- notes are the thinking surface
- terminals are the first agent interface
- runtime, memory, workcells, datasets, and evals are separate layers
- research loops become first-class operator objects

## Current Focus

Phase 1 done. Phase 2 has shipped most of the IDE-shell parity work. Phase 3 now has a real runtime control surface through the desktop command server, CLI, and MCP bridge.

Current working shell:
- Electron workspace shell with a top bar (search) and three primary surfaces (sidebar, editor, terminal dock)
- centered global search in the top bar; results render in a floating panel below the bar (sidebar always shows the file tree)
- search runs on Enter (not on every keystroke) and currently returns fast note filename/path matches only
- markdown live-preview editor with full table rendering (headers, alternating rows, alignment from separator), live ordered/unordered lists, headings, tasks, links/wikilinks, tags, code, quotes, rules, fold toggles
- code editor path for project files with language modes for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell
- JSON linting in project-file editor mode
- terminal panes with `Claude` and `Codex` launchers; flat tabs aligned with editor tabs
- tmux-backed Claude/Codex sessions supervised by Exo
- terminal reload hydration from main-process buffers
- terminal scroll hardening so wheel scroll remains local scrolling instead of arrow/history input
- pane tree with no-empty-leaves invariant: closing the last tab in a pane collapses the pane (sibling expands); center-drop on another pane = merge for free
- hairline 1px pane dividers between sidebar/editor and editor/terminal, with invisible ±5px hit overlays for grabbing
- workspace-aware roots and per-tab cwd launch support
- scrollable IDE-style explorer with file/folder context actions including Copy Path
- 25-character label truncation in the file tree with full-name hover tooltip
- floating Inspector panel with click-outside / Esc dismiss
- system-aware appearance model with a warm light mode and refreshed shell hierarchy

Phase 3 slice currently shipped:
- shared runtime config in `packages/core`
- generated Exo-owned `AGENTS.md` / `CLAUDE.md` overlays under `.exo/instructions/`
- `bin/exo runtime ...` inspection/sync commands
- `bin/exo launch shell|claude|codex`
- `bin/exo terminals list|create|read|write|send|kill`
- Electron terminal launch using the same runtime launch-plan path as the CLI
- runtime command server: HTTP server in the Electron main process (`apps/desktop/src/main/command-server.ts`) that exposes workspace ops to the CLI
- MCP bridge in `packages/mcp` exposing live terminal agents through `list_agents`, `create_agent`, `read_agent`, `send_agent_message`, `interrupt_agent`, and `terminate_agent`
- MCP autostart path via `EXO_MCP_AUTOSTART=1`
- QMD integration in `packages/core/src/qmd.ts` retained as optional notes index / retrieval infrastructure for future memory work; it is not the current top-bar search backend
- main-process responsibilities are being split into settings, watcher, terminal IPC, command protocol, and transcript-retention services

Outstanding for Phase 2 close-out:
- notebook execution surfaces
- search ranking + keyboard navigation in the floating panel
- branch family affordances in the file tree
- multi-pane / dockable note panes beyond the current binary split

Do not rebuild the full memory/research system until Phase 2 is closed.

## Core Model

- `workspace_root`
- `note_roots[]`
- `project_roots[]`
- `default_terminal_cwd`
- `per_tab_cwd`
- `attached_workcells[]`

Portable source defaults:
- `workspace_root = process.cwd()`
- `note_roots = [workspace_root/notes]`
- `project_roots = [exo repo root]`

Kenneth's lab roots live in the Exo settings file or environment, not core source defaults.

## Objective Stack

Exo keeps the same layered objective model from Garden:

1. workcell objective
2. runtime objective
3. training objective

Training data is always explicitly scoped. Never assume "all Exo data".

## Immediate Deliverables

Completed:
1. New repo and copied operating docs
2. Electron + React + TypeScript + Vite workspace
3. CodeMirror-based markdown notebook shell
4. xterm.js + node-pty terminal shell
5. fixture workspace for deterministic testing
6. Playwright e2e and screenshot baselines
7. project-file editing path alongside markdown notes
8. branch-aware note family flows
9. unified workspace search narrowed to fast note filename/path matches after renderer stability issues
10. explorer context menus with in-app create/rename/delete modal + Copy Path
11. terminal rendering fix for incremental xterm updates instead of full-buffer resets
12. shared knowledge footer spanning editor + terminal region
13. initial dragged-document pane splitting from explorer items and editor tabs
14. resizable terminal dock
15. shared runtime config for workspace-aware launch defaults, retrieval config, and communication transport
16. generated Exo runtime overlays under `.exo/instructions/AGENTS.md` and `.exo/instructions/CLAUDE.md`
17. CLI runtime inspection/sync commands plus `bin/exo launch shell|claude|codex`
18. app startup/runtime sync and terminal launch through the shared launch-plan path
19. simplified subagent observability view that treats terminal sessions as agents, keeps branch selection in the editor header, supports closeable editor tabs, and lets the operator kick off a run plus spawn Claude/Codex child agents without the old manual role/parent/task form
20. runtime command server (HTTP in main process) + CLI app-client for driving a running app from `bin/exo`
21. QMD adapter retained in core as optional retrieval/index infrastructure, with top-bar search narrowed away from QMD
22. top-bar global search with floating results panel (replaces the old sidebar-search-result swap)
23. pane-tree no-empty-leaves invariant: auto-collapse on close, center-drop = merge
24. hairline 1px pane dividers with invisible hit overlays
25. flat tabs (square corners, hairline separators) aligned across editor + terminal dock
26. markdown live-preview tables: styled `<table>` with headers, alternating rows, alignment from separator; cursor-in-table reverts to raw markdown
27. ordered list `1.` rendering fixed (no longer wraps onto a new line)
28. inspector / floating panel: click-outside + Esc dismiss, finger cursor, more solid hover
29. CLI terminal operations: list/create/read/write/send/kill
30. Exo MCP bridge for live terminal agents with optional autostart
31. tmux-backed agent terminal cleanup on close/kill
32. terminal buffer hydration after app reload
33. code-file editor support for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, shell, plus JSON linting
34. refactor/stability slice: portable workspace defaults, QMD runtime wording clarified, shared command protocol, extracted settings store, workspace watcher service, terminal IPC registration, terminal transcript store, stale search guard, and open-document polling error handling

Next:
1. notebook execution surfaces
2. search ranking + keyboard navigation inside the floating results panel
3. branch family affordances in the file tree
4. true arbitrary IDE pane graph beyond the current two-pane split model
5. richer terminal/session metadata and operator naming
6. external linter/formatter adapters for code-file editor mode
7. retrieval + layered memory
8. research harness
9. datasets, evals, and training

## Short-Term Roadmap

1. Finish Phase 2 knowledge/editor parity
2. Build real pane-splitting / dock management beyond right-vs-bottom terminal drag
3. Add richer terminal/session metadata and stronger crash regression coverage
4. Design explicit QMD-backed retrieval/index commands for memory work without reintroducing unstable app search behavior
5. Add the first Exo-native agent communication transport
6. Research harness
7. Datasets, evals, and training

## Runtime Direction

The next major system seam is not "memory first" in isolation.

Exo needs a runtime control layer that owns:
- agent launch
- workspace-aware context
- Exo-managed overlays for agent instructions
- retrieval backend configuration
- communication transport selection

Current structure:
- `AGENTS.md` generated/adapted by Exo as the primary generic contract
- `CLAUDE.md` generated as a secondary Claude-specific overlay
- `exo` CLI as the canonical interface for runtime operations
- desktop command server as the local runtime API
- MCP wrapping Exo runtime capabilities for other agents

For agent communication, start with the inspectable path:
- file-backed append-only messages
- SQLite index for reads, search, and replay

For retrieval, QMD should be integrated as a backend, not treated as the memory system itself.
It should feed future memory/index capabilities first. A unified human+agent search experience should come later with explicit search tiers, cancellation, result caps, and renderer crash regression coverage.
