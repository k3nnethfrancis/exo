# Exo Tasks

## P0 — Repo and shell bootstrap
- [x] Create Electron workspace shell
- [x] Add shared core package
- [x] Add CLI package
- [x] Add fixture workspace
- [x] Add Playwright interaction and screenshot harnesses

## P1 — UI/editor/terminal shell
- [x] Sidebar with workspace, note, and project roots
- [x] Search input and fast sidebar-oriented note/project/tag search
- [x] Tabbed markdown notebook editor
- [x] Frontmatter/properties projection
- [x] Backlinks, tags, and link surfaces
- [x] Right/bottom terminal dock
- [x] Default shell tab rooted at `workspace_root`
- [x] `Claude` button launches `claude` in a new terminal tab
- [x] `Codex` button launches `codex` in a new terminal tab
- [x] Per-tab cwd override support
- [x] Project files open in a non-notebook editor path
- [x] Scrollable explorer with file/folder context actions
- [x] In-app create/rename/delete modal instead of blocking browser prompts
- [x] Collapsed bottom knowledge drawer by default
- [x] Note wrapping with vertical-scroll editor behavior
- [x] Incremental xterm rendering instead of full-buffer resets
- [x] Shared workspace knowledge footer spanning editor + terminal region
- [x] Resizable terminal dock
- [x] System-aware appearance with a warm light mode and normalized shell control sizing

## P2 — Knowledge/editor parity
- [x] Branch-aware note flows
- [ ] Notebook execution surfaces
- [x] Search parity and richer navigation
- [x] Top-bar global search (replaces sidebar search swap-in)
- [x] Floating results panel with click-outside / Esc dismiss
- [x] Search execution model — runs on Enter, not on keystroke (perf)
- [ ] Search ranking and keyboard navigation inside the floating panel
- [ ] Search history / suggestions when the input is empty
- [ ] Preview parity in search results
- [ ] Branch family affordances in the sidebar/file tree
- [x] Initial file/tab drag splitting into a second editor pane
- [x] Pane-tree no-empty-leaves invariant: auto-collapse on close, center-drop = merge
- [x] Hairline 1px pane dividers with invisible ±5px hit overlays
- [x] Consistent collapsed-bar model for terminal, inspector, and project roots
- [x] Move branch selection into the editor header and remove bottom-drawer branch clutter
- [x] Make editor tabs closeable
- [x] Flat tabs (square corners, hairline separators, no gaps) aligned across editor + terminal dock
- [x] File-tree label truncation (25 chars) with full-name tooltip
- [x] Copy Path action in file/folder context menu
- [x] Inspector / floating panel: click-outside + Esc dismiss, finger cursor
- [x] Markdown live-preview tables: styled `<table>` rendering with cursor-aware edit mode
- [x] Ordered list `1.` rendering fix (no longer wraps onto a new line)
- [ ] True arbitrary IDE pane graph and dockable note/terminal surfaces beyond the current two-pane model

## P3 — Agent runtime control layer
- [x] Exo workspace/runtime config model for launch defaults, roots, retrieval config, and communication transport
- [x] `exo launch shell|claude|codex`
- [x] Exo-generated `AGENTS.md` as the primary generic runtime contract
- [x] Exo-generated `CLAUDE.md` as the Claude-specific overlay
- [x] CLI commands for runtime context inspection and active workspace state
- [x] Runtime command server (HTTP in main process) + CLI app-client so `bin/exo` can drive a running app
- [x] Removed QMD from app/CLI search pipeline after renderer stability issues
- [x] CLI terminal operations beyond launch/context: list/create/read/write/send/kill
- [x] Agent-oriented CLI mirror for MCP tools: list/create/read/send/interrupt/terminate
- [x] Exo MCP bridge for live terminal agents: list/create/read/send/interrupt/terminate
- [x] MCP autostart path for launching Exo when the command server is missing
- [ ] Add richer terminal metadata: user-facing names, role labels, provenance, and parent/child relationship display

## P4 — Retrieval and memory
- [ ] QMD adapter for search/query/rerank from the Exo CLI
- [ ] Durable memory layer
- [ ] Trace archive layer
- [ ] Retrieval/index layer
- [ ] Working-memory assembly
- [ ] CLI-first memory commands
- [ ] Reviewed quirks and working-memory shaping

## P5 — Multi-agent and communication
- [x] Initial subagent observability view over terminal sessions
- [x] Manual run kickoff and child-agent spawning from the Inspector drawer
- [x] tmux-backed Claude/Codex persistence for Exo-managed terminal agents
- [x] Terminal close/kill cleanup for backing tmux sessions
- [x] Terminal reload hydration from the main-process buffer
- [x] Disk-backed terminal transcripts with retention policy
- [x] Terminal scroll hardening so wheel scroll is not forwarded as app arrow/history input
- [x] Terminal file drop path handling through preload
- [x] Code editor modes for common project files: Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, shell
- [x] JSON linting in code-file editor mode
- [ ] External linter/formatter adapters for code files (ruff, eslint/biome, taplo, shellcheck as applicable)
- [ ] Regression harness for renderer blank-window/crash scenarios
- [ ] Separate top-level main-agent terminals from bottom-level subagent terminals
- [ ] Multiple terminal panes
- [ ] Grid layout
- [ ] File-backed append-only message transport
- [ ] SQLite index for agent communication reads and replay
- [ ] Operator surfaces for agent communication state
- [ ] Chat wrapper experiments over terminal agents

## P6 — Research harness
- [ ] Workcell model
- [ ] Bounded run supervision
- [ ] `autoresearch-macos` integration
- [ ] CLI-first operator commands for workcells, agents, datasets, and evals
- [ ] Exo-memory/QMD system research workcell

## P7 — Training flywheel
- [ ] Objective definitions
- [ ] Dataset selectors
- [ ] Eval suites
- [ ] Operator decisions as labels
- [ ] Retrieval/ranking/quirk helper-model training
