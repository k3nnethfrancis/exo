# Exo Roadmap

Last updated: 2026-05-20

Exo is a local-first agentic development environment built around a shared exocortex for humans and terminal agents. This roadmap names the major product systems we intend to build. `docs/tasks.md` is the active execution list; `ledger.md` records shipped history.

## Product North Star

Exo should be the shared workspace where humans and terminal agents read, write, search, coordinate, and develop from the same knowledge graph.

That means:

- Markdown notes and project context are shared ground truth.
- Terminal agents run inside the workspace instead of beside it.
- Agents can use Exo-controlled CLI/MCP tools to inspect context and communicate.
- Humans can review what agents are doing and what they changed without bouncing between editors.
- Memory, graph views, workcells, evals, and training grow from the shared exocortex instead of becoming separate products.

## 1. Workspace Surface

The workspace should support files and terminals as equal pane types.

- Terminal panes can be dragged into the editor canvas.
- Files and terminals can occupy arbitrary split-pane layouts.
- Mixed file/terminal tab groups should be supported later as a unified pane model, so a terminal tab and document tab can live in the same tab strip without nesting terminal chrome inside editor chrome.
- Pane layout persists across restarts.
- Tabs and borders stay visually aligned across all pane positions.
- Terminal rendering, scroll, reload hydration, and pane splits have regression coverage.

## 2. Project Roots And Code Review

Projects are explicit attachments, not every folder on disk.

- Users can add/remove project roots from the UI.
- Agents can list/add/remove project roots through Exo CLI/MCP.
- Exo exposes a changed-files view for agent-authored edits.
- Agent sessions/messages can link to files and lines they changed when Exo can observe that relationship.
- The code viewer supports review workflows without requiring a separate editor for basic inspection.

## 3. Agent Context And Config

Exo should help users manage the instruction context their agents see.

- Users can inspect/edit global and local `AGENTS.md` / `CLAUDE.md` files.
- Users can choose which attached roots receive local context files.
- Exo can compare global vs local context and surface conflicts or duplication.
- Exo can install recommended snippets explaining Exo CLI/MCP tools.
- Exo-generated runtime overlays remain separate from user-authored context files.

## 4. Authorship And Provenance

Exo should track authorship from observed workflows, not guess using AI detectors.

- Writes made through Exo-managed terminal agents are linked to source agent/session/task where possible.
- Human-authored and agent-authored changes can be distinguished in notes and project files.
- Provenance can later become block-level or line-level where the data is reliable.
- Provenance should support review, audit, and coordination, not punitive authorship scoring.

## 5. QMD, Notes Index, And Shared Search

The notes graph is the substrate for memory and retrieval.

- Exo should manage the QMD setup it needs for the full experience.
- Existing QMD setups should be detected and reused when they already index selected notes.
- QMD should index selected note roots, not project roots by default.
- Reindex triggers, frequency, and compute profiles should be configurable from Exo.
- Humans and agents should eventually search the same index through UI, CLI, and MCP.
- Low-compute machines should have fallback search modes.

## 6. Multi-Agent Coordination

Exo should make terminal-agent swarms legible and steerable.

- Agents have names, types, cwd, status, objective, and active task.
- Users can send messages to agents and route messages between agents.
- The first Exo-native transport is append-only files plus a SQLite read/search/replay index.
- MCP and CLI expose communication operations.
- The UI shows communication logs and audit trails.
- Richer local transports can come after the inspectable file/SQLite path works.

## 7. Graph And Memory Views

Exo should make the shared exocortex visible.

- Graph view combines backlinks, Markdown links, tags, file paths, and QMD-derived relationships.
- Graph views can be scoped by note root, project root, task, or agent session.
- Memory view separates durable memory, trace archive, retrieval/index, and working-memory assembly.
- Agent sessions, messages, changed files, search results, and future workcells can become graph nodes.

## 8. Workcells, Evals, And Training

These are later systems built on top of the shared workspace.

- Workcells define bounded research/development loops.
- Runs produce artifacts, metrics, logs, and replayable traces.
- Evals measure retrieval quality, memory usefulness, agent recovery, and operator acceptance.
- Training data is explicitly scoped by project, workcell, agent, artifact type, review status, and time window.
- Local/open-source agents and training workflows come after stable memory, workcells, and evals.
- Tracing, evaluation, and training should exercise the plugin boundary without becoming merely a hosted web app: core owns run/artifact/provenance primitives, while plugins can provide collectors, runners, scorers, dashboards, and provider-specific training/export flows.

## 9. Plugin Architecture

Exo should be extensible without making every personal or domain-specific workflow part of core.

- Core owns stable primitives: notes, project roots, panes, WebView/browser panes, commands, agents, messages, search, settings, runs, artifacts, provenance, and permission boundaries.
- Plugins are packages of Exo extensions. A plugin may include backend capabilities, commands, MCP/CLI tools, UI panels, editor extensions, or a web app hosted inside an Exo WebView pane.
- Web apps are one possible plugin surface, not the whole plugin model. Browser/WebView support belongs in core because local previews, docs, dashboards, and future plugin apps all need the same pane/runtime primitive.
- Agent integrations should use plugin-shaped adapter contracts where possible. Exo core should define how agents launch, expose capabilities, receive MCP/CLI tools, and report lifecycle state; specific agents such as Claude, Codex, Pi, Aider, Goose, or local/open-source agents can be first-party or community plugins.
- Plugin state should be inspectable, removable, and local-first.
- Plugin APIs should be versioned and documented before public plugin sharing is encouraged.
- Plugins should compose through stable registries instead of monkey-patching core internals: command registry, settings registry, pane/view registry, agent launcher registry, search provider registry, MCP/CLI registry, and workflow/eval registries.
- Capability permissions must be explicit for filesystem scopes, process/terminal access, network access, git write/PR rights, secrets, and MCP exposure.

## 10. Self-Modifying Exo

Exo should eventually help maintain and improve itself, but only through reviewable, policy-controlled workflows.

- The first version is supervised: an Exo-managed agent can create a branch, make changes, run the harness, summarize evidence, and prepare a PR or local diff for human review.
- Later versions can run recurring maintenance workflows for dependency/security updates, failing-test repair, docs/context drift, QMD/search health checks, and release hygiene.
- Core owns the trust boundary: git/PR workflow primitives, harness execution, audit logs, rollback metadata, provenance, settings, and policy gates.
- Plugins can provide concrete maintenance agents, workflow recipes, provider integrations, eval suites, and dashboards.
- Self-modification should build on the same plugin, workcell, provenance, and harness primitives rather than becoming a separate hidden automation system.

## 11. Developer Harness

The repo should remain easy for humans and agents to modify.

- `pnpm check` remains the canonical local and CI gate.
- Add formatting/lint.
- Add structural rules for renderer/main/core boundaries.
- Add docs link/path checks.
- Add renderer crash regression probes.
- Add stable goldens/snapshots where they catch real regressions.
