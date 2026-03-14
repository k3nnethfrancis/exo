# Exo

Exo is a workspace-centric research IDE for autonomous intellectual work.

It is the Electron rebuild of Garden. The product direction stays intact, but the shell changes:
- `workspace_root` is primary
- `note_roots` and `project_roots` are attached separately
- terminals default to the workspace root
- notes, terminals, workcells, memory, datasets, and evals share one operator surface

## Current Phase

Phase 1 is UI-first:
- Electron shell
- markdown-notebook editor
- plain terminal panes with `Claude` and `Codex` launchers
- workspace-aware roots and file navigation
- visual regression and interaction harnesses from the start

Current shell status:
- markdown notes and project files both open cleanly
- branch-aware note flows are back
- search spans notes, tags, and project files

Higher-level systems follow after the shell is stable:
- memory and quirk runtime
- autoresearch workcells
- multi-agent coordination
- datasets, evals, and training loops

## Stack

- Electron
- React
- TypeScript
- Vite
- CodeMirror 6
- xterm.js
- node-pty
- Playwright

## Workspace Model

The default Exo model is:
- `workspace_root = /Users/kenneth/Desktop/lab`
- attached note root:
  - `/Users/kenneth/Desktop/lab/notes/shoshin-codex`
- attached project root:
  - `/Users/kenneth/Desktop/lab/projects`

In tests, Exo can boot against a deterministic fixture workspace via environment variables.

## Quick Start

```bash
pnpm install
pnpm dev
```

Validation loop:

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:visual
```

## Docs Order

- `ledger.md`: fastest current-state handoff
- `plan.md`: canonical strategy and phased implementation plan
- `docs/tasks.md`: active execution tracker
- `docs/roadmap.md`: feature roadmap by phase
- `docs/resources.md`: retained references and external substrates
