# Exo Strategy

Last updated: 2026-05-20

This is the strategy document for Exo. `README.md` explains the product publicly, `docs/roadmap.md` describes future systems, `docs/tasks.md` tracks concrete work, and `ledger.md` records shipped history.

## Product Direction

Exo is a local-first agentic development environment built around a shared exocortex for humans and terminal agents.

The core idea is simple: your Markdown notes and project context become shared ground truth. You can write and organize your own knowledge, while terminal agents can read, write, search, and coordinate through the same knowledge graph using Exo-controlled tools.

Exo should be flexible enough to support many workflows. A person might use it as a research IDE, a note-taking system, an agent control room, a code-review surface, or an evaluation/training workspace. The product identity is broader than any one of those use cases: Exo is a shared exocortex.

## System Model

Exo is organized around:

- `workspace_root` - the local workspace containing runtime state.
- `note_roots[]` - Markdown knowledge roots selected by the user.
- `project_roots[]` - explicitly attached project/code roots.
- `terminal_sessions[]` - shell, Claude, Codex, and future local/open-source terminal agents.
- `agent_context_files[]` - global and local `AGENTS.md` / `CLAUDE.md` files.
- `notes_index` - Exo-managed QMD-backed index for optional notes search and future memory.
- `agent_communication` - future inspectable message transport for multi-agent coordination.
- `workcells[]` - future bounded development/research loops with artifacts, metrics, and replay.
- `plugins[]` - future local-first extension packages that can add agent launchers, commands, panels, WebView apps, search providers, eval runners, trace collectors, and workflows through permissioned APIs.

Portable source defaults:

- `workspace_root = process.cwd()`
- `note_roots = [workspace_root/notes]`
- `project_roots = [exo repo root]`

Local/private paths belong in settings or environment examples, not source defaults.

## Product Principles

- Local-first by default.
- Markdown-on-disk is canonical.
- Notebook mode is a projection over Markdown, not a separate data model.
- Project roots are explicit attachments.
- Terminal agents run inside Exo; Exo does not treat them as detached side channels.
- CLI and MCP are first-class control surfaces.
- Humans and agents should share the same notes index through explicit, observable search modes.
- Provenance should come from observed workflows, not AI-detector inference.
- Training data is never ambient; it must be explicitly scoped.
- Core primitives should stay stable and small; plugins should extend Exo through registries instead of patching internals.

## Current Foundation

Already shipped:

- Electron desktop shell with notes, project files, explorer, and terminal dock.
- Markdown live-preview editing, branch families, backlinks/tags/links, code blocks, rules, and table widgets.
- Code-file editor modes for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell.
- Explicit note roots and project roots.
- Fast note filename/path search in explorer search mode.
- Optional QMD-backed lexical, semantic, and hybrid notes index.
- Claude, Codex, and shell terminals.
- Tmux-backed Claude/Codex persistence and cleanup.
- Runtime command server and `bin/exo` CLI.
- Exo MCP tools for live terminal agents.
- MCP autostart and integration installer/doctor for Codex and Claude Code.
- `pnpm check` harness and baseline CI.

Current intentional limits:

- Live Explore typing is fast note filename/path search.
- QMD-backed indexed search is explicit and should not block the renderer.
- Project roots are not auto-loaded from every workspace project folder.
- File/terminal panes do not yet share one arbitrary pane graph.
- Authorship/provenance is not yet tracked.
- Agent-to-agent communication is not yet a durable Exo-native protocol.
- Plugin APIs are not yet public; optional agent launchers, dashboards, eval runners, and workflow integrations should wait for a clear core/plugin boundary.

## Next Product Systems

### Workspace Surface

Files and terminals should become equal pane types. The next major UI shift is letting terminal panes move into the editor canvas, persist across restarts, and support multi-pane agent work without forcing everything into one terminal dock.

### Project Roots And Code Review

Exo should let users and agents explicitly attach project roots. It should also make agent-authored code changes reviewable from inside Exo: changed-file views, transcript-to-file links, and jump-to-line review flows.

### Agent Context And Config

Exo should manage the context files terminal agents rely on. Users should be able to inspect/edit global and local `AGENTS.md` / `CLAUDE.md`, compare conflicts, choose which roots receive context files, and install Exo-recommended snippets for CLI/MCP use.

### Authorship And Provenance

Exo should distinguish human-written and agent-written work where it can observe the source. The first implementation should track writes made through Exo-managed agents by session/task/file. More granular block/line provenance can come later.

### QMD, Notes Index, And Search

QMD is now the Exo-managed notes-index substrate. Exo should improve performance, detect existing QMD setups, expose compute profiles, add richer trigger controls, and serve the same index to humans and agents through UI, CLI, and MCP.

### Multi-Agent Coordination

Exo should make terminal-agent swarms legible. Agents need names, objectives, status, message routing, and communication logs. The first durable transport should be append-only files plus a SQLite index, exposed through CLI/MCP and visible in the UI.

### Graph And Memory Views

The shared exocortex should be visible. Graph and memory views should combine backlinks, Markdown links, note structure, QMD-derived relationships, agent sessions, messages, changed files, and future workcells.

### Workcells, Evals, And Training

Once the workspace, memory, and coordination layers are stable, Exo can support bounded research/development loops, evals, datasets, and local/open-source agent training workflows.

Core should own durable run, artifact, trace, evaluation-result, provenance, and permission primitives. Specific collectors, scorers, dashboards, provider integrations, and training/export flows can be plugins. An eval dashboard may run inside an Exo WebView pane, but the eval system should not be only a hosted web app because it needs permissioned access to Exo's agents, terminal logs, files, search, git state, and artifacts.

### Plugin Architecture

Exo's plugin model should distinguish app plugins, surface plugins, capability plugins, and workflow plugins. The WebView/browser pane belongs in core because many unrelated workflows need local web-app previews, dashboards, docs, and artifact viewers. Plugins can target that primitive with their own apps.

Specific coding agents should use adapter-shaped integrations where possible. Core defines launch, terminal transport, lifecycle, MCP/CLI exposure, and provenance hooks; individual agents such as Claude, Codex, Pi, Aider, Goose, OpenCode, and local/open-source agents can be first-party or community plugins.

### Self-Modifying Exo

Exo can eventually help maintain and improve itself through supervised, reviewable workflows: create a branch, make changes, run the harness, summarize evidence, and prepare a PR or local diff. Core should own policy gates, git/PR primitives, harness execution, audit logs, rollback metadata, and provenance. Concrete maintenance agents and recurring workflows should be plugin-shaped.

## Validation

Canonical gate:

```bash
pnpm check
```

Focused UI/runtime validation:

```bash
pnpm test:e2e
pnpm test:visual
```

Every significant change should update docs and tasks when it changes product behavior, public commands, runtime contracts, settings, or agent workflows.

## Decision Log

### 2026-05-12 — README And Product Identity

Exo is now documented as a local-first agentic development environment built around a shared exocortex. Individual users can shape it into a research IDE, note system, agent control room, code-review surface, or training workspace, but the category is the shared exocortex.

### 2026-05-12 — Tasks Are Active Backlog, Not History

`docs/tasks.md` now tracks current work by priority and product system. Completed historical phase lists moved out of task tracking; `ledger.md` is the handoff/history file.

### 2026-05-11 — Search Lives In The Explorer Pane

Search moved out of the top bar. Current search is fast note filename/path matching with snippets and hover previews. Broad/QMD retrieval remains deferred until the notes-index design has explicit tiers, cancellation, caps, and renderer crash coverage.

### 2026-05-11 — QMD Was Future Notes Index Infrastructure

QMD remained in core as notes index/retrieval infrastructure. It was not the current app search backend at that point. This was superseded by the 2026-05-16 active optional index work.

### 2026-05-16 — QMD Is Active Optional Index Infrastructure

QMD now backs optional lexical, semantic, and hybrid notes indexing through Exo settings, CLI, and MCP. Live Explore typing remains filename/path based for responsiveness; indexed Explore search is explicit on Enter. Save-triggered indexing refreshes the matching indexed root only and defers embeddings.
