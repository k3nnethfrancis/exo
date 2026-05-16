# Exo

**Shared Exocortex for Humans and Agents.**

Exo is a local-first agentic development environment built around a shared exocortex for you and your terminal agents.

It gives agents a common knowledge graph they can read from, write to, and coordinate through, while giving you one surface for keeping their work aligned. That graph is grounded in your Markdown notes and project context, turning the material you already think with into shared ground truth for multi-agent development. You can take notes, run agents, and inspect the code they write without bouncing between editors.

## Why Exo Exists

AI agents are most useful when they can work from the same context you use: your notes, tasks, drafts, logs, code, and project history. Today that context is usually split across a notes app, terminals, editor windows, chat transcripts, and ad hoc files. Exo brings those pieces into one local-first workspace so humans and agents can share context instead of constantly reassembling it.

Exo is for people who want terminal agents to participate in their actual working environment: reading and writing notes, searching project context, changing code, communicating with other agents, and leaving an inspectable trail of what happened.

## What Exo Is

- A Markdown knowledge environment for notes, tasks, drafts, logs, and project context.
- A terminal-agent workspace for running Claude, Codex, shell sessions, and future local agents.
- A project/code viewer for inspecting what agents are changing.
- A shared command surface through the Exo CLI and MCP server.
- A foundation for note indexing, memory, multi-agent communication, attribution, graph views, workcells, evals, and training loops.

## What Works Today

- Markdown notes with live-preview editing, properties/frontmatter, backlinks/tags/links, branch families, foldable lists, and table widgets.
- Explicit note roots and project roots.
- Project files with CodeMirror modes for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell.
- Fast note filename/path search from the explorer search pane.
- Optional QMD-backed notes indexing with lexical, semantic, and hybrid modes.
- Index status, sync, and settings controls for selected note roots.
- Editor and terminal panes with flat tabs, split behavior, and no-empty-leaves pruning.
- xterm/node-pty terminals rooted in the workspace by default.
- Claude and Codex terminal launchers backed by Exo runtime launch plans.
- Tmux-backed Claude/Codex recovery across Exo restarts.
- CLI and MCP control of live Exo terminal agents.
- Integration helpers for installing Exo MCP into Codex and Claude Code.

## Roadmap

Exo is early, and the long-term system is larger than the current shell. Near-term priorities:

- Drag terminal panes into the editor canvas so files and terminal agents can share one arbitrary split-pane graph.
- Improve QMD indexing performance with true file-level incremental updates when upstream APIs support it.
- Detect existing QMD setups, refine Exo-owned QMD setup, and configure richer reindex triggers.
- Let humans and agents search the same knowledge graph with explicit tiers, cancellation, progress, and result caps.
- Manage global and project-local `AGENTS.md` / `CLAUDE.md` files from Exo.
- Compare global and local agent context files, surface conflicts, and install Exo-recommended snippets.
- Track authorship and provenance so human-written and agent-written changes are distinguishable by source, session, and task.
- Link agent sessions and messages to the files they changed so code review stays inside the workspace.
- Add graph and memory views that combine backlinks, notes, project context, and indexed relationships.
- Let agents add, remove, and inspect attached project roots through Exo-controlled CLI/MCP commands.
- Add multi-agent communication protocols over files, SQLite, MCP, and later richer local transports.
- Add an agent roster with names, roles, objectives, message routing, and communication logs.
- Add a plugin architecture for optional workflows and shareable extensions without bloating core.
- Add workcells, evals, datasets, and training loops for improving agent behavior.

See `docs/roadmap.md` and `docs/tasks.md` for the active plan.

## Current Status

Exo is under active development and not yet a polished public binary release.

- Supported today: source development and unsigned macOS packaging.
- Coming later: first-class Windows and Linux support.
- License: Apache-2.0.
- Current alpha: `0.1.0-alpha.0`.
- Not ready yet: signed/notarized macOS releases, Windows/Linux installers, and cross-platform terminal persistence.

Before broad public binary release, Exo still needs signed/notarized macOS packaging and a clean release checklist from a fresh clone.

## Quick Start

```bash
pnpm install
pnpm dev
```

Run with remote debugging when inspecting the real Electron renderer:

```bash
pnpm --filter @exo/desktop dev -- --remote-debugging-port=9222
```

The browser at `localhost:5173` is not equivalent to the Electron app; it does not have the preload `window.exo` bridge.

## Agent Integrations

Exo can expose its live terminal agents through MCP and through a CLI mirror. The MCP server currently supports:

- `list_agents`
- `create_agent`
- `read_agent`
- `send_agent_message`
- `interrupt_agent`
- `terminate_agent`

Install Exo MCP into supported local agent clients:

```bash
./bin/exo integrations doctor
./bin/exo integrations install all
```

Preview without modifying local agent config:

```bash
./bin/exo integrations install --dry-run all
./bin/exo integrations config codex
./bin/exo integrations config claude
```

Already-running agent sessions may need restart or MCP refresh before they see newly installed tools. The CLI mirror remains available when MCP is unavailable.

## CLI

Standalone workspace/runtime commands:

```bash
./bin/exo workspace status
./bin/exo search "query"
./bin/exo index status
./bin/exo index sync
./bin/exo runtime status
./bin/exo runtime sync
./bin/exo launch claude
```

Commands that drive a running Exo app:

```bash
./bin/exo open /path/to/file
./bin/exo status
./bin/exo config get
./bin/exo terminals list
./bin/exo terminals create shell
./bin/exo terminals read term-4
./bin/exo terminals transcript term-4 --tail 200000
./bin/exo terminals send term-4 "message plus Enter"
./bin/exo terminals kill term-4
```

Agent-oriented aliases mirror the MCP tools:

```bash
./bin/exo agents list
./bin/exo agents create claude /path/to/workspace
./bin/exo agents read term-4 --tail 20000
./bin/exo agents send term-4 "message plus Enter"
./bin/exo agents send term-4 "raw input without Enter" --raw
./bin/exo agents interrupt term-4 ctrl-c
./bin/exo agents terminate term-4
```

## Workspace Model

Exo settings are stored in one JSON file:

- macOS default: `$HOME/Library/Application Support/@exo/desktop/workspace-settings.json`
- override: `EXO_SETTINGS_PATH`

Portable source defaults:

- `workspace_root = process.cwd()`
- `note_roots = [workspace_root/notes]`
- `project_roots = [exo repo root]`
- `default_terminal_cwd = workspace_root`
- `terminalScrollbackLines = 5000`
- `terminalBufferChars = 80000`

Runtime files live under `.exo/` inside the workspace root:

- `.exo/server.json` - command server discovery
- `.exo/instructions/AGENTS.md` - Exo-generated generic runtime contract
- `.exo/instructions/CLAUDE.md` - Exo-generated Claude overlay
- `.exo/terminal-state.json` - persisted tmux-backed agent terminal state
- `.exo/terminal-transcripts/` - disk-backed terminal transcripts with retention
- `.exo/qmd/index.sqlite` - Exo-managed QMD notes index when indexing is enabled

QMD is the active indexing substrate for optional Exo-managed notes search. Live Explore typing remains fast filename/path search; indexed search is explicit through Enter in Explore when enabled and through CLI/MCP index/search tools. See `docs/qmd-integration-notes.md` for the adapter contract and upgrade notes.

## Development Harness

The canonical local gate is:

```bash
pnpm check
```

It runs:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Focused checks:

```bash
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
pnpm --filter @exo/cli typecheck
pnpm --filter @exo/cli test
pnpm --filter @exo/core test
pnpm --filter @exo/mcp typecheck
pnpm --filter @exo/mcp test
pnpm test:e2e
pnpm test:visual
```

See `docs/harness.md` for work-chunk rules, validation evidence, and agent-friendly development workflow.

## Stack

- Electron, React, TypeScript, Vite
- CodeMirror 6
- xterm.js, node-pty, tmux
- pnpm workspaces
- Vitest and Playwright
- Model Context Protocol SDK

## Repository Map

- `apps/desktop` - Electron main/preload/renderer, settings, terminal supervision, and the local command server.
- `packages/core` - workspace model, note/project discovery, runtime config, launch plans, QMD adapter, shared command protocol, integration helpers.
- `packages/cli` - `bin/exo` command surface.
- `packages/mcp` - stdio MCP server that wraps the running Exo app for local agents.
- `docs/architecture.md` - package and runtime architecture.
- `docs/strategy.md` - product direction and system model.
- `docs/harness.md` - developer harness, gates, and agent workflow.
- `docs/plugins.md` - future extension model.
- `docs/tasks.md` - active execution tracker.
- `docs/roadmap.md` - future work and sequencing.
- `docs/qmd-integration-notes.md` - current QMD adapter contract and upgrade checklist.
- `ledger.md` - fastest current-state handoff.

## Packaging

Unsigned macOS app bundle:

```bash
pnpm pack:mac
```

Unsigned macOS DMG and ZIP:

```bash
pnpm dist:mac
```

Artifacts are written to `release/`. Public binary releases should be signed and notarized before being presented as stable.

## Logs

Main-process log:

```bash
tail -f "$HOME/Library/Application Support/@exo/desktop/exo-main.log"
```

macOS Electron crash reports:

```bash
ls "$HOME/Library/Logs/DiagnosticReports"/Electron-*.ips
```

## Docs Order

1. `AGENTS.md` - concise agent map
2. `README.md` - product overview and onboarding
3. `docs/README.md` - committed docs map
4. `docs/strategy.md` - product direction and system model
5. `ledger.md` - current state and recent completed slices
6. `docs/architecture.md` - runtime and package architecture
7. `docs/harness.md` - contribution harness and validation gates
8. `docs/tasks.md` - active execution tracker
9. `docs/roadmap.md` - future plans
10. `docs/plugins.md` - future extension model
11. `packages/mcp/README.md` - MCP setup and tools
