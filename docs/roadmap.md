# Exo Feature Roadmap

## Phase 1
- workspace-centric IDE shell
- markdown notebook editor
- plain terminals
- deterministic visual validation
- project-file editing path beside notebook notes

## Phase 2
- shell completion and knowledge/editor parity:
  - notebook execution
  - deeper search ranking and keyboard navigation
  - branch affordances in the explorer
  - consistent collapsed bottom bars
  - true pane graph for notes and terminals

## Phase 3
- agent runtime control layer:
  - `exo` CLI
  - workspace-aware launchers for shell, Claude, and Codex
  - Exo-managed `AGENTS.md` / `CLAUDE.md` overlays
  - runtime context snapshots
  - runtime command server in the desktop app
  - CLI terminal operations for list/create/read/write/send/kill
  - MCP bridge for agent access, wrapping the Exo runtime instead of replacing it

## Phase 4
- retrieval and layered memory:
  - QMD adapter
  - durable memory
  - trace archive
  - retrieval/index
  - working-memory assembly
  - CLI-first memory operations

## Phase 5
- multi-agent system:
  - initial manual agent observability/steering view over terminal sessions
  - tmux-backed Claude/Codex sessions managed by Exo
  - terminal reload hydration and cleanup semantics
  - multiple terminal panes
  - terminal grids
  - file+SQLite agent communication protocol
  - later direct/local transports
  - agent operator views

## Phase 6
- research harness:
  - workcells
  - supervised runs
  - metrics
  - artifacts
  - logs
  - `autoresearch-macos`
  - Exo-memory research workcell

## Phase 7
- datasets, evals, and training:
  - objective contracts
  - dataset assignment
  - eval suites
  - operator labels
  - local helper-model training
