# Exo Tasks

Last updated: 2026-05-16

This is the active task tracker for Exo. It is intentionally not a history file; completed implementation history belongs in `ledger.md`. Tasks here should be concrete, current, and ordered by practical priority.

## Now: Pre-Push Cleanup

- [x] Choose and add an open-source license.
- [ ] Remove or resolve any accidental local edits before commit, including the stray `SECURITY.md` line if it reappears.
- [ ] Confirm README, AGENTS, CLAUDE, architecture, roadmap, tasks, ledger, and MCP docs agree on the current Exo identity.
- [ ] Confirm no source defaults point to private or machine-specific paths.
- [ ] Confirm `.exo/`, terminal transcripts, logs, local settings, release artifacts, and generated runtime state are ignored.
- [ ] Run `pnpm check`.
- [ ] Run focused desktop e2e for shell/search/terminal flows.

## Next: Workspace Surface

- [ ] Make terminal panes draggable into the editor canvas.
- [ ] Let files and terminals share one arbitrary split-pane graph.
- [ ] Support multiple terminal panes in the main workspace, not just the terminal dock.
- [ ] Persist pane layout across restart.
- [ ] Keep file and terminal tab chrome aligned across all pane positions.
- [ ] Add regression coverage for pane splitting, pane closure, reload, and terminal streaming.

## Next: Project Roots And Code Review

- [ ] Keep project imports explicit; do not auto-load every workspace project folder.
- [ ] Add CLI/MCP commands to list attached project roots.
- [ ] Add CLI/MCP commands to add and remove attached project roots.
- [ ] Add a changed-files view for agent-authored project edits.
- [ ] Link terminal-agent sessions/messages to files they changed when Exo can observe the relationship.
- [ ] Add code-review affordances for jumping from an agent session to a changed file and line.
- [ ] Track external file changes without resetting editor scroll or causing flicker.

## Next: Agent Context And Config Management

- [ ] Add a first-class agent config manager.
- [ ] Let users inspect and edit global and selected local `AGENTS.md` / `CLAUDE.md` files from Exo.
- [ ] Let users choose which attached roots receive local agent context files.
- [ ] Compare global vs local agent context files.
- [ ] Surface conflicting or duplicated instructions.
- [ ] Offer Exo-recommended snippets that explain Exo CLI/MCP tools to terminal agents.
- [ ] Keep Exo-generated runtime overlays under `.exo/instructions/` separate from user-authored context files.

## Next: Authorship And Provenance

- [ ] Track writes made through Exo-managed terminal agents.
- [ ] Record source agent, session id, task/objective, timestamp, and target file for observable writes.
- [ ] Distinguish human-authored and agent-authored note/code changes in the UI.
- [ ] Explore block-level or line-level provenance only where Exo can track it reliably.
- [ ] Avoid AI-detector-style inference; provenance should come from observed writes and controlled workflows.

## Next: QMD, Notes Index, And Search

- [x] Keep live Explore typing as fast filename/path search while making indexed search explicit.
- [x] Add Exo-managed QMD setup for selected note roots only.
- [x] Configure indexed note roots and the first reindex trigger from Exo settings.
- [x] Expose QMD-backed status/search/read/sync/update/embed through Exo CLI and MCP.
- [ ] Package the QMD setup Exo needs so first-time users do not have to understand QMD separately.
- [ ] Detect an existing QMD setup and connect it when it already indexes the selected notes.
- [ ] Add true file-level incremental indexing when QMD exposes a public API for changed/deleted files.
- [ ] Add configurable reindex triggers beyond manual/on-save, such as app start, interval, and git events.
- [ ] Add progress and cancellation for long semantic embedding builds.
- [ ] Add machine-size/performance profiles:
  - small: low-compute fallback using filename/path and lightweight lexical search
  - medium: local semantic index with conservative caps
  - large: richer semantic retrieval and reranking
- [ ] Refine shared human/agent search semantics across Explore, CLI, and MCP.
- [ ] Keep project files out of the notes memory index unless explicitly added later.

## Next: Multi-Agent Coordination

- [ ] Add an agent roster with names, types, current cwd, status, objective, and active task.
- [ ] Let users assign or edit agent names, roles, and objectives.
- [ ] Add direct message sending between Exo-managed terminal agents.
- [ ] Build first Exo-native communication transport:
  - append-only file messages
  - SQLite index for reads, search, and replay
  - CLI and MCP access
- [ ] Add communication logs and audit trail UI.
- [ ] Support routing messages through MCP and filesystem-backed channels.
- [ ] Keep terminal agents as the first integration point; add richer direct transports later.

## Later: Graph, Memory, Workcells, Training

- [ ] Add graph/memory view combining backlinks, Markdown links, note structure, and QMD-derived relationships.
- [ ] Add scoped graph views by note root, project root, task, or agent session.
- [ ] Add durable memory, trace archive, retrieval/index, and working-memory assembly as separate layers.
- [ ] Support adding non-Claude/non-Codex terminal agents, including local/open-source agents.
- [ ] Add workcell model for bounded research/development loops.
- [ ] Add supervised run surfaces with artifacts, metrics, logs, and replay.
- [ ] Add eval hooks for retrieval quality, memory usefulness, agent recovery, and operator acceptance.
- [ ] Keep training data explicitly scoped by project, workcell, agent, artifact type, review status, and time window.
- [ ] Explore local-agent training workflows once Exo has stable workcells, memory, and evals.

## Later: Plugin Architecture

- [ ] Define plugin manifest shape and version policy.
- [ ] Define plugin install/load locations.
- [ ] Define safe renderer panel extension points.
- [ ] Define command registration API.
- [ ] Define settings API for plugin-owned state.
- [ ] Decide whether plugins can add MCP tools or CLI commands.
- [ ] Decide whether the current branch-family file convention remains core or moves behind a plugin boundary.
- [ ] Keep optional personal/domain workflows out of core until the plugin boundary exists.

## Developer Harness

- [ ] Add deterministic formatting/lint.
- [ ] Add structural rules for renderer/main/core boundaries.
- [ ] Add docs link/path checks for README, AGENTS, and docs indexes.
- [ ] Add renderer crash regression probes for blank-window failures.
- [ ] Add golden/snapshot coverage for stable Markdown rendering, terminal hydration, and search output.
- [x] Keep CLI app-route tests isolated from live Exo command-server state.
