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

### Phase 2 — Knowledge/editor parity
Build:
- backlinks, tags, search, branches
- workspace-aware file navigation
- notebook execution surfaces

Current phase-2 slice already in:
- note branch families using Garden's file-family pattern
- unified search sections for notes, tags, and project files
- markdown-note vs project-file editor behavior split

### Phase 3 — Runtime and memory
Build:
- durable memory
- trace archive
- retrieval/index layer
- working-memory assembly
- CLI-first memory operator commands

### Phase 4 — Research harness
Build:
- workcell model
- bounded run supervision
- `autoresearch-macos` baseline integration
- CLI-first workcell, agent, dataset, and eval commands

### Phase 5 — Multi-agent system
Build:
- multiple terminal panes
- terminal grids
- subagent surfaces
- later: chat-style wrappers over terminal agents

### Phase 6 — Datasets, evals, and training
Build:
- explicit objective contracts
- dataset selectors
- eval suites
- operator decisions as labels
- helper-model training
- memory-system research as a first-class internal workcell

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
