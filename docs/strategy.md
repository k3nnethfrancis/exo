# Exo Strategy

Last updated: 2026-06-21

This is the strategy document for Exo. `README.md` explains the product publicly, `docs/roadmap.md` describes future systems, `docs/tasks.md` tracks concrete work, and `ledger.md` records shipped history.

## Product Direction

Exo is a local-first AI workstation for applied AI engineers and researchers building personal AI systems over their own Markdown-first exograph.

The core idea is simple: your Markdown notes, project context, terminal sessions, agent messages, changed files, activity records, and artifact references become a user-defined knowledge/work graph. You can write and organize your own knowledge, while terminal agents, search providers, routines, plugins, evals, and future training loops operate over the same exograph using Exo-controlled tools.

Exo should be flexible enough to support many workflows. A person might use it as a research IDE, a note-taking system, an agent control room, a code-review surface, or an evaluation/training workspace. The product identity is broader than any one of those use cases: Exo is the local workstation for configuring, running, observing, evaluating, and improving personal AI systems.

## System Model

Exo is organized around:

- `workspace_root` - the local workspace containing runtime state.
- `note_roots[]` - Markdown knowledge roots selected by the user.
- `project_roots[]` - explicitly attached project/code roots.
- `terminal_sessions[]` - shell and harness-backed sessions such as Claude Code, Codex, Pi, Hermes, and future local/open-source agents.
- `runtime_process` - the resident Exo process that owns the command server, MCP bridge, watchers, transcripts, and terminal-agent runtime independent of whether the workspace window is visible.
- `agent_context_files[]` - global and local `AGENTS.md` / `CLAUDE.md` files.
- `exograph_profile` - user-defined schema/profile for interpreting files, properties, links, paths, sessions, and artifacts as graph nodes and relations.
- `exograph_proposals[]` - inferred schema/graph/file changes that remain reviewable until accepted.
- `notes_index` - Exo-managed QMD-backed index for optional notes search and future memory.
- `search_providers[]` - the provider-backed retrieval layer behind Exo search. QMD is the default local provider, but the Exo contract should allow alternate local, custom, or remote retrieval implementations later.
- `agent_communication` - future inspectable message transport for multi-agent coordination.
- `activities[]` - minimal records for plugin/manual work: what ran, by whom, against what scope, and where outputs live.
- `workcells[]` - future plugin-defined bounded development/research loops with artifacts, metrics, and replay.
- `plugins[]` - future local-first extension packages that can add agent harnesses, commands, panels, local web apps/artifacts opened through Exo's web viewer, search providers, eval runners, trace collectors, and workflows through permissioned APIs.

Architecture should evolve in phases: first stabilize the current app enough to use Exo for Exo work, then harden Exo-on-Exo agent coordination, then define exograph/profile/provider contracts where the actual workflow demands them, then extract runtime/plugin boundaries after the core primitives are proven.

Portable source defaults:

- `workspace_root = process.cwd()`
- `note_roots = [workspace_root/notes]`
- `project_roots = [exo repo root]`

Local/private paths belong in settings or environment examples, not source defaults.

## Product Principles

- Local-first by default.
- Markdown-on-disk is canonical.
- The exograph is user-defined; Exo may detect, recommend, and maintain structure, but should not impose one vault schema.
- Durable approved graph facts live in user-owned files and properties. Inferred facts, activity records, artifact references, and proposals stay in `.exo/` until accepted.
- First-run setup and workspace switching use the same workspace create/select surface.
- First-run setup requires an explicit notes folder choice before the app shell appears.
- Notebook mode is a projection over Markdown, not a separate data model.
- Project roots are explicit attachments.
- Terminal agents are supervised by Exo even when their full-fidelity interaction is delegated to tmux or an external terminal client.
- Exo running and Exo visible are separate states; hiding the window should not kill the local runtime or live agents.
- CLI and MCP are first-class control surfaces.
- CLI is the operator/admin/debug control plane; MCP is the narrower agent work plane.
- Humans and agents should share the same notes index through explicit, observable search modes.
- Search is a capability boundary, not a permanent commitment to one indexing implementation.
- Exo-on-Exo is the default product proving loop: use Exo-managed agents for bounded Exo tasks, then turn friction into product work.
- Provenance should come from observed workflows, not AI-detector inference.
- Training data is never ambient; it must be explicitly scoped.
- Core primitives should stay stable, boring, and small; plugins should provide interesting workflow behavior through registries instead of patching internals.
- Product language should distinguish the layers: Exo is the workstation, the exograph is the user-owned knowledge/work graph, the resident runtime is the local substrate, and exocortex is a useful metaphor or profile, not the top-level product category.

## Current Foundation

Already shipped:

- Electron desktop shell with notes, project files, explorer, and terminal dock.
- Markdown live-preview editing, branch families, backlinks/tags/links, code blocks, rules, and table widgets.
- Code-file editor modes for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell.
- Explicit note roots and project roots.
- Fast note filename/path search in explorer search mode.
- Optional QMD-backed lexical, semantic, and hybrid notes index.
- Shell, Claude Code, Codex, and first-pass harness metadata for Pi and Hermes.
- Tmux-backed terminal supervision through Exo's current tmux control-mode bridge, with disk-backed transcripts for durable history. The durable tmux session model is settled; the embedded interactive rendering path remains under simplification review because Exo should not own terminal-emulator complexity unless it can meet the terminal quality standard.
- Runtime command server and `bin/exo` CLI.
- Exo MCP tools for live terminal agents.
- MCP autostart and integration installer/doctor for Codex and Claude Code.
- `pnpm check` harness and baseline CI.

Current intentional limits:

- Live Explore typing is fast note filename/path search.
- QMD-backed indexed search is explicit and should not block the renderer.
- Project roots are not auto-loaded from every workspace project folder.
- File/terminal panes share one arbitrary split-pane graph, but mixed file/terminal tab groups remain a future refinement.
- Authorship/provenance is not yet tracked.
- Agent-to-agent communication is not yet a durable Exo-native protocol.
- Plugin APIs are not yet public; optional agent launchers, dashboards, eval runners, and workflow integrations should wait for a clear core/plugin boundary.

## Next Product Systems

### Use Exo To Build Exo

The immediate system goal is useability: Kenneth should be able to keep Exo running, use it for notes and terminals, spawn Exo-managed agents for bounded Exo tasks, inspect their transcripts and changed files, and review the result inside Exo. Work that improves this loop comes before broad platform expansion.

### Workspace Surface

Files and terminals should become equal pane types. The next major UI shift is letting terminal panes move into the editor canvas, persist across restarts, and support multi-pane agent work without forcing everything into one terminal dock.

### Runtime Lifecycle And Menu Bar

Exo should become a resident local runtime. The process should keep MCP, the command server, watchers, transcripts, and terminal-agent sessions available when the workspace window is hidden. A macOS menu bar controller should expose Show Exo, Settings, status, recovery actions, and explicit Quit. The terminal runtime should move to explicit tmux-backed persistence rather than hidden fallback behavior.

For day-to-day Exo-on-Exo development, the installed macOS app should be the stable resident runtime. Source builds should be isolated QA targets, not the same runtime the user relies on for monitoring, notes, and agent coordination. The practical split is:

- Stable installed Exo owns the real workspace, menu bar, command server, MCP bridge, transcripts, and long-running supervised agents.
- Dev/QA Exo runs with separate `.exo-dev/` runtime and user-data paths so it can be tested without clobbering stable command-server discovery or settings.

### Project Roots And Code Review

Exo should let users and agents explicitly attach project roots. It should also make agent-authored code changes reviewable from inside Exo: changed-file views, transcript-to-file links, and jump-to-line review flows.

### Agent Context And Config

Exo should manage the context files terminal agents rely on. Users should be able to inspect/edit global and local `AGENTS.md` / `CLAUDE.md`, compare conflicts, choose which roots receive context files, and install Exo-recommended snippets for CLI/MCP use.

### Authorship And Provenance

Exo should distinguish human-written and agent-written work where it can observe the source. The first implementation should track writes made through Exo-managed agents by session/task/file. More granular block/line provenance can come later.

### Exograph Architecture

Exo should formalize the exograph without forcing a schema. Users can start with a flat notes folder, accept a starter profile such as LM Wiki, map an existing Shoshin-style vault, or define their own schema. Profiles define node types, edge types, path/property mappings, conventions, templates, maintenance rules, and review policy.

The two user-facing exograph modes should be:

- Analyze Exograph: read-only discovery, schema suggestions, and graph health diagnostics.
- Maintain Exograph: reviewable file/profile changes after user approval.

### QMD, Notes Index, And Search

QMD is now the default Exo-managed notes-index substrate. Exo should improve performance, detect existing QMD setups, expose compute profiles, add richer trigger controls, and serve the same search contract to humans and agents through UI, CLI, and MCP. The long-term interface should be a search-provider boundary so users can keep QMD as the default path, modify it, or swap in another local or remote retrieval implementation without changing Exo's exograph, CLI, or MCP contracts.

### LM Wiki And Knowledge Maintenance

Exo should support the LM Wiki pattern as one exograph profile: Markdown on disk as a maintained knowledge graph, raw/source material separated from synthesized wiki pages, durable `AGENTS.md` / `CLAUDE.md` conventions, an index/catalog for navigation, an append-only log of maintenance work, and periodic lint/health checks for stale claims, orphan pages, missing cross-links, contradictions, and useful new source questions.

This should shape Exo's surfaces:

- CLI may expose broad note and graph operations for humans, scripts, and debugging.
- MCP should expose the small set of operations agents need to orient, search, read, maintain, and coordinate.
- Write tools should be deliberate, scoped to selected note roots, and biased toward create/append/patch-with-guard flows over broad arbitrary filesystem writes.
- Graph tools should make paths, backlinks, outgoing links, headings, orphans, unresolved links, and maintenance gaps easy to inspect without forcing the agent to read the whole vault.

### Multi-Agent Coordination

Exo should make terminal-agent swarms legible. Agents need names, objectives, status, message routing, and communication logs. The first durable transport should be append-only files plus a SQLite index, exposed through CLI/MCP and visible in the UI.

### Graph And Memory Views

The exograph should be visible. Graph and memory views should combine backlinks, Markdown links, note structure, QMD-derived relationships, agent sessions, messages, changed files, and future workcells.

### Workcells, Evals, And Training

Once the workspace, memory, and coordination layers are stable, Exo can support bounded research/development loops, evals, datasets, and local/open-source agent training workflows.

Core should own minimal activity, artifact-reference, provenance-reference, review, and permission primitives. Specific collectors, scorers, dashboards, schemas, provider integrations, and training/export flows should be plugins. An eval dashboard may open through Exo's native web viewer, but the eval system should not be only a hosted web app because it needs permissioned access to Exo's agents, terminal logs, files, search, git state, and artifacts.

### Plugin Architecture

Exo's plugin model should distinguish app plugins, surface plugins, capability plugins, and workflow plugins. The web viewer host belongs in core because many unrelated workflows need local web-app previews, dashboards, docs, and artifact viewers. Plugins can generate local content or run local services and ask Exo to open them through core viewer endpoints.

Specific coding agents should use adapter-shaped integrations where possible. Core defines launch, session lifecycle, MCP/CLI exposure, semantic message delivery, trace/provenance hooks, and optional terminal attachment. Individual agents such as Claude Code, Codex, Pi, Hermes, Aider, Goose, OpenCode, and local/open-source agents should be bundled, first-party, user, workspace, or community plugins rather than permanent core branches. Local forks such as GA Pi are configured instances of the Pi harness plugin, not source defaults in OSS Exo.

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

Exo was documented as a local-first agentic development environment built around a shared exocortex. Individual users could shape it into a research IDE, note system, agent control room, code-review surface, or training workspace, but the category was the shared exocortex.

This was superseded by the 2026-05-31 exograph framing.

### 2026-05-12 — Tasks Are Active Backlog, Not History

`docs/tasks.md` now tracks current work by priority and product system. Completed historical phase lists moved out of task tracking; `ledger.md` is the handoff/history file.

### 2026-05-11 — Search Lives In The Explorer Pane

Search moved out of the top bar. Current search is fast note filename/path matching with snippets and hover previews. Broad/QMD retrieval remains deferred until the notes-index design has explicit tiers, cancellation, caps, and renderer crash coverage.

### 2026-05-11 — QMD Was Future Notes Index Infrastructure

QMD remained in core as notes index/retrieval infrastructure. It was not the current app search backend at that point. This was superseded by the 2026-05-16 active optional index work.

### 2026-05-16 — QMD Is Active Optional Index Infrastructure

QMD now backs optional lexical, semantic, and hybrid notes indexing through Exo settings, CLI, and MCP. Live Explore typing remains filename/path based for responsiveness; indexed Explore search is explicit on Enter. Save-triggered indexing refreshes the matching indexed root only and defers embeddings.

### 2026-05-31 — CLI/MCP Split And Search Provider Direction

The CLI is the broad operator/admin/debug surface, similar in spirit to Obsidian CLI's broad app-control model. MCP remains the narrow agent work plane. Exo should add note traversal, graph, and maintenance operations carefully, and should avoid turning MCP into a full admin surface. QMD remains the default local search provider, but Exo search should be designed around a provider contract so alternate retrieval backends can plug in later.

### 2026-05-31 — Exograph And Exo-On-Exo Direction

Exo's core concept is the exograph: a user-defined knowledge/work graph with growable relational ontologies. The immediate product proving loop is Exo-on-Exo: use Exo-managed agents to build Exo, then prioritize the reliability, coordination, review, and graph primitives that make that loop work in practice.

### 2026-06-21 — AI Workstation Product Category

Exo's public category is now the local-first AI workstation: a workbench for applied AI engineers and researchers building personal AI systems locally. The exograph remains the core product object, the resident runtime is the local substrate, plugins provide variation, and exocortex is a user-facing metaphor/profile rather than the headline category.
