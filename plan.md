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
  - reserved for later Exo-native MCP exposure

### Non-negotiable rules
- markdown-on-disk is canonical
- notebook mode is a projection
- terminals are plain by default in v1
- `Claude` and `Codex` are just launchers that run those commands in new terminal tabs
- CLI-first interfaces come before MCP and before deep operator UI
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
- CLI-first agent operations later exposable through MCP

Current shipped slice:
- shared runtime config and launch-plan generation in `packages/core`
- generated Exo-owned overlays under `.exo/instructions/AGENTS.md` and `.exo/instructions/CLAUDE.md`
- `exo-cli runtime status|context|launch-plan|sync`
- `exo-cli launch shell|claude|codex`
- Electron terminal launch wired through the same launch-plan path

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
