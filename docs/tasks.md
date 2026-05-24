# Exo Tasks

Last updated: 2026-05-23

This is the active task tracker for Exo. It is intentionally not a history file; completed implementation history belongs in `ledger.md`. Tasks here should be concrete, current, and ordered by practical priority.

## Now: Pre-Push Cleanup

- [x] Choose and add an open-source license.
- [x] Remove or resolve any accidental local edits before commit, including the stray `SECURITY.md` line if it reappears.
- [x] Confirm README, AGENTS, CLAUDE, architecture, roadmap, tasks, ledger, and MCP docs agree on the current Exo identity.
- [x] Confirm no source defaults point to private or machine-specific paths.
- [x] Confirm `.exo/`, terminal transcripts, logs, local settings, release artifacts, and generated runtime state are ignored.
- [x] Run `pnpm ci:check`.
- [x] Run focused desktop e2e for shell/search/terminal flows.
- [x] Harden fresh-clone setup for pnpm 11, blocked dependency builds, patched Vite/picomatch installs, and secured-network Electron downloads.

## Next: Workspace Surface

- [x] Add first-run onboarding that requires a user-selected notes folder before showing the app shell.
- [x] Replace free-text notes/project path setup with native folder selection and removable folder lists.
- [x] Add a setup/switch-workspace surface that shows notes folder, project folders, default terminal, and index settings before entering the app.
- [x] Add a persisted workspace registry so users can switch among saved workspaces without reselecting folders.
- [x] Make CLI/MCP workspace resolution use the active workspace registry when explicit env vars are not set.
- [x] Make terminal panes draggable into the editor canvas.
- [x] Let files and terminals share one arbitrary split-pane graph.
- [x] Roadmap mixed file/terminal tab groups after the split-pane model stabilizes.
- [x] Support multiple terminal panes in the main workspace, not just the terminal dock.
- [x] Add a core WebView/browser pane for local web-app previews, docs, dashboards, and future plugin-hosted apps.
- [x] Persist pane layout across restart.
- [x] Keep file and terminal tab chrome aligned across all pane positions.
- [x] Add broader regression coverage for pane closure, reload, and terminal streaming.

## Next: Project Roots And Code Review

- [ ] Keep project imports explicit; do not auto-load every workspace project folder.
- [x] Add CLI/MCP commands to list attached project roots.
- [x] Add CLI/MCP commands to add and remove attached project roots.
- [x] Add a changed-files view for agent-authored project edits.
- [x] Link changed files to observable terminal sessions by project cwd.
- [ ] Link terminal-agent messages to files they changed when Exo can observe the relationship.
- [x] Add code-review affordances for jumping from a changed file to an associated terminal session.
- [x] Add code-review affordances for jumping from an agent session to associated changed files.
- [x] Add code-review affordances for jumping from an agent session to a changed file hunk or line.
- [x] Track external file changes without resetting editor scroll or causing flicker.

## Next: Agent Context And Config Management

- [x] Add a first-class agent config manager.
- [x] Let users inspect and edit global and selected local `AGENTS.md` / `CLAUDE.md` files from Exo.
- [x] Let users choose which attached roots receive local agent context files.
- [x] Compare global vs local agent context files.
- [x] Surface conflicting or duplicated instructions.
- [x] Offer Exo-recommended snippets that explain Exo CLI/MCP tools to terminal agents.
- [x] Add a unified agent-agnostic instruction composer that renders provider-compatible context files.
- [x] Preserve and round-trip Exo-managed unified sections without overwriting unrelated manual content.
- [x] Add version history and diff/restore for Exo-managed unified instruction bodies.
- [ ] Extend agent config management to MCP/provider config files and additional provider instruction files such as `soul.md`.
- [ ] Keep Exo-generated runtime overlays under `.exo/instructions/` separate from user-authored context files.

## Next: Authorship And Provenance

- [x] Track observed file changes near Exo-managed terminal sessions as provenance candidates.
- [x] Record session id, timestamp, association method, and target file for observable write candidates.
- [ ] Distinguish human-authored and agent-authored note/code changes in the UI.
- [ ] Explore block-level or line-level provenance only where Exo can track it reliably.
- [ ] Avoid AI-detector-style inference; provenance should come from observed writes and controlled workflows.

## Next: QMD, Notes Index, And Search

- [x] Keep live Explore typing as fast filename/path search while making indexed search explicit.
- [x] Add Exo-managed QMD setup for selected note roots only.
- [x] Configure indexed note roots and the first reindex trigger from Exo settings.
- [x] Expose QMD-backed status/search/read/sync/update/embed through Exo CLI and MCP.
- [x] Replace the 2s CLI/MCP search timeout with search-appropriate behavior and regression coverage.
- [ ] Keep embedding/search off the Electron desktop critical path and add regression coverage for cold, broad, and in-progress index queries.
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
- [ ] Define run, artifact, trace, and evaluation result primitives that plugins can build on.
- [ ] Add supervised run surfaces with artifacts, metrics, logs, and replay.
- [ ] Add eval hooks for retrieval quality, memory usefulness, agent recovery, and operator acceptance.
- [ ] Keep training data explicitly scoped by project, workcell, agent, artifact type, review status, and time window.
- [ ] Explore local-agent training workflows once Exo has stable workcells, memory, and evals.

## Later: Plugin Architecture

- [ ] Define plugin manifest shape and version policy.
- [ ] Define plugin install/load locations.
- [ ] Define plugin extension depths: app plugins, surface plugins, capability plugins, and workflow plugins.
- [ ] Define safe renderer panel and WebView app extension points.
- [ ] Define command registration API.
- [ ] Define settings API for plugin-owned state.
- [ ] Define agent launcher adapter API for Claude, Codex, Pi, Aider, Goose, OpenCode, and local/open-source agents.
- [ ] Decide how plugins can add MCP tools or CLI commands under explicit permissions.
- [ ] Define capability permissions for filesystem scopes, process/terminal access, network access, git write/PR rights, secrets, and MCP exposure.
- [ ] Define search provider, trace collector, eval runner, and workflow extension points.
- [ ] Decide whether the current branch-family file convention remains core or moves behind a plugin boundary.
- [ ] Keep optional personal/domain workflows out of core until the plugin boundary exists.

## Later: Self-Modifying Exo

- [ ] Define a supervised self-modification workflow: branch, change, run harness, summarize evidence, and prepare PR or local diff.
- [ ] Add policy gates for git writes, PR creation, dependency/security updates, and auto-merge eligibility.
- [ ] Connect self-modification to provenance, audit logs, workcells, and harness results.
- [ ] Let maintenance workflows be implemented as plugins on top of core git, harness, provenance, and policy primitives.

## Developer Harness

- [ ] Add deterministic formatting/lint.
- [ ] Add structural rules for renderer/main/core boundaries.
- [x] Add docs link/path checks for README, AGENTS, and docs indexes.
- [ ] Add renderer crash regression probes for blank-window failures.
- [ ] Add golden/snapshot coverage for stable Markdown rendering, terminal hydration, and search output.
- [x] Keep CLI app-route tests isolated from live Exo command-server state.
