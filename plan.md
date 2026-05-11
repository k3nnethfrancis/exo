# Exo Plan

This is the canonical strategy and phased implementation plan for Exo.

## Product Direction

Exo is a workspace-centric research IDE for autonomous intellectual work.

It is the Electron rebuild of Garden, with the product identity widened from a native Mac note app to a shareable operator environment for:
- notes
- terminals
- workcells
- memory
- datasets
- evals

## Explicit System Model

Exo is organized around:

- `workspace_root`
  - where terminals and agents start by default
- `note_roots[]`
  - one or more attached note systems
- `project_roots[]`
  - attached repos and workspaces
- `default_terminal_cwd`
  - default = `workspace_root`
- `per_tab_cwd`
  - any terminal tab can override cwd
- `attached_workcells[]`
  - explicit research-loop bindings

Initial defaults:
- `workspace_root = /Users/kenneth/Desktop/lab`
- `note_roots = [/Users/kenneth/Desktop/lab/notes/shoshin-codex]`
- `project_roots = [/Users/kenneth/Desktop/lab/projects]`

## Objective Stack

Exo should preserve and make explicit the layered objective stack:

### 1. Workcell objective
- local, project-specific, bounded
- examples:
  - lower `val_bpb`
  - reduce correction rate
  - increase acceptance rate

### 2. Runtime objective
- improve cross-project usefulness:
  - completion rate
  - recovery quality
  - retrieval usefulness
  - supervisor acceptance

### 3. Training objective
- scoped improvement targets:
  - retrieval ranking
  - quirk extraction
  - working-memory assembly
  - recovery policy
  - run-promotion policy
  - later: project-specific research agents

Training data must always be assigned explicitly by project, workcell, agent, artifact type, review status, and time window.

## Technical Architecture

### Stack
- Electron
- React
- TypeScript
- Vite
- CodeMirror 6
- xterm.js
- node-pty
- Playwright

### Workspace layout
- `apps/desktop`
  - Electron main, preload, renderer
- `packages/core`
  - shared domain contracts and filesystem-aware workspace/note logic
- `packages/cli`
  - CLI-first operator and harness commands
- `packages/mcp`
  - Exo-native MCP exposure for live app and terminal-agent operations

### Non-negotiable rules
- markdown-on-disk is canonical
- notebook mode is a projection
- terminals are plain by default in v1
- `Claude` and `Codex` are just launchers that run those commands in new terminal tabs
- CLI-first interfaces remain the canonical runtime surface; MCP wraps them for agent access
- higher-order runtime systems should be reintroduced only after the shell is stable

## Delivery Phases

### Phase 1 — UI/editor/terminal shell
Goal: Exo should already feel like a serious IDE before memory/research features return.

Build:
- workspace-aware sidebar
- tabbed markdown notebook editor
- properties/frontmatter projection
- tag, wikilink, markdown-link, and backlink surfaces
- docked terminal pane on the right or bottom
- terminal tabs with `Terminal`, `Claude`, and `Codex`
- split-pane resizing and stable chrome/layout
- open project files without forcing notebook semantics

### Phase 2 — Shell completion and knowledge/editor parity
Goal: finish the IDE shell so later runtime systems sit on stable operator surfaces.

Build:
- notebook execution surfaces
- richer search ranking, keyboard navigation, and preview flows
- branch affordances in the explorer
- consistent collapsed-bar patterns for project roots, inspector/knowledge, and terminal dock
- true pane graph beyond the current two-editor split:
  - dockable note panes
  - dockable terminal panes
  - multiple terminal regions and grid layouts

Current completed slice:
- note branch families using Garden's file-family pattern
- unified search sections for notes, tags, and project files
- markdown-note vs project-file editor behavior split
- first-step dragged document splitting
- **pane-tree invariant**: empty leaves auto-prune (close last terminal in a split → sibling expands; center-drop = merge)
- **top-bar global search**: search lifted out of the sidebar into a centered top-bar input; results render in a floating panel below the bar; sidebar always shows the file tree
- **search execution model**: results commit on Enter (not on every keystroke) — local QMD + filesystem search is too slow for live debounce on broad queries
- **shell chrome polish**: hairline 1px pane dividers with invisible ±5px hit overlays; flat tabs (square corners, hairline separators, no gaps); editor and terminal tab strips aligned at 40px
- **markdown live-preview parity**: tables render as styled `<table>` elements with header bg, alternating row stripes, and alignment from separator row; cursor-in-table reverts to raw markdown for editing
- **inspector polish**: click-outside / Esc dismiss; finger cursor on toggle; more solid hover

### Phase 3 — Agent runtime control layer
Goal: Exo must control how terminal agents are launched and what context they receive.

Build:
- Exo workspace configuration model for:
  - `workspace_root`
  - `note_roots`
  - `project_roots`
  - per-agent launch defaults
  - QMD/retrieval backend config
  - agent-to-agent transport config
- `exo` CLI as the canonical runtime surface
- workspace-aware launchers:
  - `exo launch shell`
  - `exo launch claude`
  - `exo launch codex`
- Exo-generated agent context overlays:
  - `AGENTS.md` as the primary generic runtime contract
  - `CLAUDE.md` as a secondary Claude-specific overlay
- task-scoped working context snapshots provided by Exo instead of ad hoc terminal bootstrap pastes
- CLI-first agent operations with MCP exposure for external agents
  - terminal list/create/read/write/send/kill operations
  - MCP tools to inspect, create, steer, interrupt, and terminate Exo sessions

Current shipped slice:
- shared runtime config and launch-plan generation in `packages/core`
- generated Exo-owned overlays under `.exo/instructions/AGENTS.md` and `.exo/instructions/CLAUDE.md`
- `bin/exo runtime status|context|launch-plan|sync`
- `bin/exo launch shell|claude|codex`
- Electron terminal launch wired through the same launch-plan path
- **runtime command server**: HTTP server in the Electron main process (`apps/desktop/src/main/command-server.ts`) exposes workspace ops (open file, search, list/create terminals, get settings) so the `bin/exo` CLI can drive a running app; `packages/cli/src/app-client.ts` is the matching client
- **CLI terminal control**: `bin/exo terminals list|create|read|write|send|kill`
- **MCP bridge**: `packages/mcp` exposes live Exo terminal agents through `list_agents`, `create_agent`, `read_agent`, `send_agent_message`, `interrupt_agent`, and `terminate_agent`; optional autostart uses `EXO_MCP_AUTOSTART=1`
- **terminal agent lifecycle**: Claude/Codex sessions are tmux-backed; Exo close/kill terminates the backing session; renderer reload hydrates from the main-process buffer
- **code-file editor modes**: project files now use CodeMirror language support for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell, with JSON linting
- **QMD integration**: `packages/core/src/qmd.ts` exposes the QMD vault index as a retrieval backend; powers semantic search results in the top-bar search panel

### Phase 4 — Retrieval and layered memory
Goal: Exo should own memory architecture while allowing retrieval backends like QMD.

Build:
- QMD adapter as a retrieval/index backend, not the memory system itself
- explicit memory layers:
  - durable memory
  - trace archive
  - retrieval/index
  - working-memory assembly
- CLI-first memory operator commands:
  - `exo context`
  - `exo qmd search`
  - `exo qmd query`
  - `exo memory snapshot`
  - `exo memory review`
- approved quirks and working-memory shaping driven by Exo runtime state

### Phase 5 — Agent communication and multi-agent system
Goal: terminals should be able to collaborate through Exo-native protocols.

Build:
- richer terminal/session metadata and naming
- multiple terminal panes and grid layouts
- agent-to-agent communication protocol with inspectable transports
- initial transport strategy:
  - file-backed append-only messages
  - SQLite index for reads, search, and replay
- later transport options:
  - direct local sockets
  - brokered relay
- operator surfaces for agent state, conversations, and message audit trails
- later: chat-style wrappers over terminal agents

### Phase 6 — Research harness
Goal: make bounded research loops first-class operator objects.

Build:
- workcell model
- bounded run supervision
- `autoresearch-macos` baseline integration
- CLI-first workcell, agent, dataset, and eval commands
- one of the first workcells should target Exo's own memory/runtime system quality

### Phase 7 — Datasets, evals, and training
Goal: turn real operator behavior and research traces into improvement loops.

Build:
- explicit objective contracts
- dataset selectors
- eval suites
- operator decisions as labels
- helper-model training
- memory-system and retrieval-system improvement as first-class research targets

## Validation Loop

Every phase starts with a harness contract.

Mandatory commands:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:e2e`
- `pnpm test:visual`

Visual coverage should include:
- default workspace with notes attached
- note editor with properties/frontmatter projection
- right-docked terminal
- bottom-docked terminal
- Claude and Codex terminal tabs
- backlinks, tags, and search results surfaces

## Decisions Log

### 2026-04-27 — Markdown table widget uses single-line replace, not block decorations
**Why**: CodeMirror raises `Block decorations may not be specified via plugins` when a `ViewPlugin` emits a `Decoration.replace` with `block: true`. Block decorations must come from a `StateField`. The `markdownLivePreview` extension is structured as a `ViewPlugin` for live cursor-aware decoration, so block-level can't work.
**How**: The widget is emitted as a single-line `Decoration.replace` on the table's first line; subsequent table lines get `Decoration.line({class: "exo-md-line--folded-hidden"})` (`display: none`). The widget visually grows below the first line and hidden lines collapse out of layout.
**Tradeoff**: The cursor can technically still move into hidden lines, but our cursor-in-table check is by line number, so edit-mode swap still works correctly.

### 2026-04-27 — Search results live in a floating panel above the editor, not in the sidebar
**Why**: Embedding search results in the sidebar swapped out the file tree on every keystroke — disorienting, and clicks on results crashed the renderer due to a `dragManager.startDrag` race. Cursor's pattern (centered floating panel anchored to the search input) is cleaner.
**How**: `SearchResultsPanel` component renders as `position: fixed` below the top-bar search input; sidebar always shows the file tree. Click-outside / Esc dismiss. Click-result opens file and dismisses + clears query.
**Tradeoff**: Search no longer drags-and-drops into a pane (we removed `onMouseDown` + `dragManager.startDrag` from result rows). Acceptable — drag-from-search-results was low-value.

### 2026-04-27 — Search runs on Enter, not on every keystroke
**Why**: Live search across the workspace + QMD semantic search returned hundreds of results for short queries and could crash the renderer when rendering them. Debouncing at 120ms / 500ms helped but didn't fully cap the cost.
**How**: Two state vars — `searchQuery` (live, drives the input) and `searchSubmittedQuery` (only updates on Enter, drives the actual search and the panel render). Esc clears both.
**Tradeoff**: Loses live-search affordance. Matches Cursor / VS Code command palette behavior, which is what users have muscle memory for.

### 2026-04-27 — Pane tree invariant: no empty leaves
**Why**: Closing the last terminal in a split pane left an empty pane that didn't reclaim space. Center-drop merge was also missing — once you split a pane you couldn't merge it back without manually closing.
**How**: New `pruneEmptyLeaves(tree, isEmpty)` helper in `usePaneTree.ts`. Called atomically inside `setTree` updaters after every close/drop. Refuses to empty the entire tree (last-leaf protection). Made the invariant load-bearing: closing the last tab in a pane = pane disappears + sibling expands; center-drop = move tab + prune empty source = visual merge for free.
**Tradeoff**: Edge-drop within source pane (only one tab) is now a no-op — would orphan an empty half. Acceptable, matches user intent.

### 2026-04-26 — Pane resizers are 1px hairlines with invisible ±5px hit overlays
**Why**: Visible 6-10px grab strips between panes broke visual flow ("everything floats on a bar"). Cursor and Obsidian both use hairline dividers.
**How**: Grid track for the resizer is 1px painted with `var(--divider)`; `::after` extends ±5px on each side as a transparent hit zone. The bounding host stays 1px so layout math is clean.
**Constraint discovered**: Grid cells with `overflow: hidden` clip pseudo-element overflow. `.workspace__body` has `overflow: hidden` inline, but the `::after` extension only goes 5px and the surrounding columns absorb it without scrollbars.

## Open Questions

- **Search ranking**: current results are unsorted by score within each section (notes/projects/tags/semantic). Should we add a unified ranking, or keep the section-grouped UX?
- **Keyboard nav in search panel**: arrow keys + Enter to open the highlighted result — not yet built. Would complete the command-palette feel.
- **Search history**: should recent searches surface as suggestions when the input is empty and focused?
- **Table widget edit affordance**: today, clicking into a table cell shows raw markdown. A future improvement would be in-cell editing without the markdown-source flash.
- **Terminal state persistence**: pty processes die on Exo quit, scrollback evaporates, pane layout resets. Real fix is large (detach pty backend, serialize scrollback, persist pane tree). Tagged for later.
