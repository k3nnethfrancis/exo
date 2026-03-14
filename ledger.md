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

Active Phase 2 work:
- branch-aware note families
- unified note/project/tag search
- richer workspace-aware navigation

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

Next:
1. notebook execution surfaces
2. deeper search/navigation parity
3. true arbitrary IDE pane graph beyond the current two-pane split model
4. runtime + memory reintroduction

## Short-Term Roadmap

1. Finish Phase 2 knowledge/editor parity
2. Build real pane-splitting / dock management beyond right-vs-bottom terminal drag
3. Runtime + memory
4. Research harness
5. Multi-agent system
6. Datasets, evals, and training
