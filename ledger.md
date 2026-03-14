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

Phase 1 is UI-first.

Build and validate:
- Electron workspace shell
- markdown-notebook editor
- plain terminal panes with `Claude` and `Codex` launchers
- workspace-aware roots and navigation
- Playwright interaction and screenshot harnesses

Do not rebuild the full memory/research system until the shell is stable.

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

1. New repo and copied operating docs
2. Electron + React + TypeScript + Vite workspace
3. CodeMirror-based markdown notebook shell
4. xterm.js + node-pty terminal shell
5. fixture workspace for deterministic testing
6. Playwright e2e and screenshot baselines

## Short-Term Roadmap

1. UI/editor/terminal shell
2. knowledge/editor parity
3. runtime + memory
4. research harness
5. multi-agent system
6. datasets, evals, and training

