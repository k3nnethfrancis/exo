# Exo Ledger

Last updated: 2026-03-13

This is the fastest handoff file for Exo.

## Product Thesis

Exo is a workspace-centric research IDE.

It replaces Garden's native macOS shell with an Electron shell while preserving the long-term system shape:
- notes are the thinking surface
- terminals are the first agent interface
- runtime, memory, workcells, datasets, and evals are separate layers
- research loops become first-class operator objects

## Current Focus

Phase 1 is functionally in place and Phase 2 has started.

Current working shell:
- Electron workspace shell
- markdown-notebook editor for notes
- plain text/code editor path for project files
- plain terminal panes with `Claude` and `Codex` launchers
- workspace-aware roots and per-tab cwd launch support
- scrollable IDE-style explorer with file/folder context actions
- note-wrapping notebook editor with a shared workspace knowledge footer
- first-step editor pane splitting for dragged files/tabs
- resizable terminal dock with drag docking between right and bottom placement
- Playwright interaction and screenshot harnesses
- consistent `Inspector` drawer with backlinks, links, tags, and simplified subagent observability
- system-aware appearance model with a warm light mode and refreshed shell hierarchy across buttons, tabs, and controls

Active Phase 2 work:
- branch-aware note families
- unified note/project/tag search
- richer workspace-aware navigation
- finishing the pane model so terminals, project roots, and inspector use a coherent IDE structure

Initial Phase 3 slice is also in place:
- shared runtime config in `packages/core`
- generated Exo-owned `AGENTS.md` / `CLAUDE.md` overlays under `.exo/instructions/`
- `exo-cli runtime ...` inspection/sync commands
- `exo-cli launch shell|claude|codex`
- Electron terminal launch using the same runtime launch-plan path as the CLI

Do not rebuild the full memory/research system until the shell and knowledge/editor parity surfaces are stable.

## Core Model

- `workspace_root`
- `note_roots[]`
- `project_roots[]`
- `default_terminal_cwd`
- `per_tab_cwd`
- `attached_workcells[]`

Initial defaults:
- `workspace_root = /Users/kenneth/Desktop/lab`
- `note_roots = [/Users/kenneth/Desktop/lab/notes/shoshin-codex]`
- `project_roots = [/Users/kenneth/Desktop/lab/projects]`

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
9. unified workspace search across notes, tags, and project files
10. explorer context menus with in-app create/rename/delete modal
11. terminal rendering fix for incremental xterm updates instead of full-buffer resets
12. shared knowledge footer spanning editor + terminal region
13. initial dragged-document pane splitting from explorer items and editor tabs
14. resizable terminal dock
15. shared runtime config for workspace-aware launch defaults, retrieval config, and communication transport
16. generated Exo runtime overlays under `.exo/instructions/AGENTS.md` and `.exo/instructions/CLAUDE.md`
17. CLI runtime inspection/sync commands plus `exo-cli launch shell|claude|codex`
18. app startup/runtime sync and terminal launch through the shared launch-plan path
19. simplified subagent observability view that treats terminal sessions as agents, keeps branch selection in the editor header, supports closeable editor tabs, and lets the operator kick off a run plus spawn Claude/Codex child agents without the old manual role/parent/task form

Next:
1. notebook execution surfaces
2. deeper search/navigation parity
3. true arbitrary IDE pane graph beyond the current two-pane split model
4. broaden the agent runtime control layer beyond launch/context into richer CLI-first agent operations
5. retrieval + layered memory
6. research harness
7. datasets, evals, and training

## Short-Term Roadmap

1. Finish Phase 2 knowledge/editor parity
2. Build real pane-splitting / dock management beyond right-vs-bottom terminal drag
3. Extend the runtime control layer with real agent operations after the shell stabilizes further
4. Integrate QMD as a retrieval backend through the Exo CLI
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

Current intended structure:
- `AGENTS.md` generated/adapted by Exo as the primary generic contract
- `CLAUDE.md` generated as a secondary Claude-specific overlay
- `exo` CLI as the canonical interface for runtime operations
- MCP later wrapping the CLI instead of becoming the primary surface

For agent communication, start with the inspectable path:
- file-backed append-only messages
- SQLite index for reads, search, and replay

For retrieval, QMD should be integrated as a backend, not treated as the memory system itself.
