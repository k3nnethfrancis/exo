# Exo Roadmap

Last updated: 2026-07-02

Exo is a local-first AI workstation for applied AI engineers and researchers building personal AI systems over a Markdown-first exograph. This roadmap names the practical path from the current app to Kenneth using Exo to build Exo by default, then to a more general local AI workbench. `docs/tasks.md` is the active execution list; `ledger.md` records shipped history.

## Current Ship Path

The current objective is not to finish every long-term Exo idea. It is to reach a stable local build where Kenneth can use Exo daily, develop mostly through plugins, and coordinate agents through robust CLI/MCP surfaces.

Canonical work tracking:

- `../issues.md` is the only canonical active bug, QA, and field-report tracker.
- `docs/tasks.md` tracks implementation tasks and workstream sequencing.
- `ledger.md` records shipped state and handoff notes.
- GitHub issues can feed the scheduled Codex issue-fix loop, but accepted implementation bugs should still land in `../issues.md` with an `EXO-ISSUE-*` id.

### Phase A: Plugin Architecture Completion

Goal: make plugins practical to set up, inspect, configure, trust, enable, disable, and develop without turning Exo core into a grab bag.

Core stays responsible for Markdown graph/editor, basic file/path search, pane/webview hosts, terminal runtime, minimal activity/artifact/provenance/review references, permission/trust substrate, plugin registry, and official plugin discovery.

Plugins own harness adapters, advanced search providers such as QMD, profiles, routines/templates, graph visualizations, analyzers, eval/export tools, dashboards, and domain workflows.

Remaining work:

- Finish the staged profile apply flow with permission prompts before profile/plugin recommendations can write `AGENTS.md`, `CLAUDE.md`, MCP config, skills, routines, plugin settings, or permission grants.
- Tighten plugin-owned settings and Plugin Manager UX so it reads as "manage my plugin stack", not only "inspect current metadata".
- Make plugin setup tangible: local plugin add/remove/swap, official-vs-local distinction, trust state, readiness state, dependency hints, disabled/missing handling, and clear "what changed" review.
- Split terminal/session substrate types from harness adapter ids so `exo agents` derives launchable harnesses from the registry while `exo terminals` remains the low-level core terminal surface.
- Define the external plugin contracts for workload-specific traces, review labels, dataset exports, eval packets, and instrumented runtimes.
- Keep GA/Shoshin-specific behavior out of OSS core; represent it as local/private plugin configuration or downstream reference plugins.

QA after Phase A:

- Plugin Manager app QA: official rows locked, local/dev rows trust/enable/disable correctly, settings validation works, missing dependency states are legible, no overlap in dense layouts.
- Onboarding plugin review QA: clean workspace selection shows core rows, official plugins, local profile/plugin inventory, and no destructive apply path without review.
- Search QA: QMD enabled/degraded/disabled states still preserve core filename/path/basic text search and do not block Explore.
- Harness QA: unavailable harnesses do not show dead launch buttons; Claude/Codex/shell still launch through the registered harness path.

### Phase B: Daily-Use Bug Bash And UI Fit

Goal: fix the active user-facing friction in `../issues.md` that blocks Exo from feeling like a normal daily workspace.

Current priority clusters:

- Terminal and preview interaction: render corruption, preview focus stealing input, blank terminal hydration, long scrollback, sleep/wake field dogfooding.
- Editor and graph UX: wikilink suggestions/hover, backlinks/references replacing inspect mode, project Markdown rendering, task-list/list behavior, thinner editor chrome.
- Explorer polish: file/folder differentiation, no duplicate disclosure controls, smaller warm changed-state badges, less harsh folder typography.
- Settings/profile/plugin UI: roomy settings layout, no modal blur weirdness, no duplicate agent settings, clear Apply/save semantics.
- Install/onboarding: first-run open-notes flow, packaged first launch, clear logs, user-vs-developer persona split.

QA after Phase B:

- Manual installed-app pass on a real workspace: notes, project files, plugin manager, agent config, settings, preview, terminal, CLI status, MCP status.
- Playwright/e2e smoke for the affected flows before any push.
- Screenshot review for dense UI surfaces: Settings, Plugin Manager, Agent Config/Skills, explorer, editor, terminal/preview split.

### Phase C: CLI/MCP Multi-Agent Coordination

Goal: make Exo useful as the control plane for humans and supervising agents coordinating work across local terminal agents.

CLI philosophy: broad operator/admin/debug surface.

MCP philosophy: narrow agent work plane.

Remaining work:

- Keep MCP compact but robust: workspace status, search/read, list/create/read/send/interrupt/terminate agents, plus preview/artifact open if approved through the core web viewer endpoint.
- Make `workspace_status` the reliable orientation tool: workspace roots, plugin/search readiness, live agents, index status summary, command-server health, and actionable degraded-state diagnostics.
- Harden command-server discovery so stale runtime, unreachable app, sandbox-blocked process checks, and deleted MCP launcher paths are distinguishable.
- Add NDE-style MCP testing: functionality, latency, result quality, ease-of-use, stale config diagnostics, and security/permission review.
- Keep the scheduled GitHub issue-fix loop conservative: only labeled issues, one issue max per run, isolated branch/worktree, tests/app QA, draft PR, no direct main push, no auto-merge.

QA after Phase C:

- CLI QA: workspace, index, project roots, plugin inventory, agents, terminals diagnostics, transcript reads, preview open.
- MCP QA: tool listing, workspace status, search/read, agent lifecycle, send/interrupt/terminate, stale-launcher diagnostics.
- Exo-on-Exo QA: supervising Codex can use Exo MCP to create/read/message agents and report results without raw filesystem orientation as the first path.

### Phase D: Routine Substrate POC

Goal: prove scheduled/local routines without prematurely turning every workflow into core.

Near-term proof:

- Use the GitHub issue-fix loop as the first practical routine-like workflow.
- Model a routine as prompt, harness, trigger/schedule, scope, permissions, and output policy.
- Keep rich workload schemas plugin-owned. Core stores minimal activity, artifact-reference, provenance-reference, and review-reference records.
- Do not run destructive or write-capable routines without explicit trust/permission/review gates.

QA after Phase D:

- Dry-run routine execution shows planned prompt, harness, scope, permissions, outputs, and blocked actions.
- Manual run records activity/artifacts/traces and review state without mutating user notes unless approved.
- Scheduled run cannot exceed issue/worktree/permission limits.

### Phase E: Installable Stable Runtime

Goal: use the installed macOS app as the stable daily Exo while source builds remain QA/dev surfaces.

Remaining work:

- Clean first-run install path: no source-run prerequisite, no workspace-root `/` fallback, no silent packaged-app exit.
- Keep `exo start` focused on last known workspace; keep developer commands explicit.
- Menu bar resident behavior: show/hide/status/settings/quit, clear agent shutdown warning, readable icon treatment.
- README/changelog/release notes describe user install versus developer setup.
- Packaging and CI gates are deterministic enough that a fresh clone can build, install, and launch.

QA after Phase E:

- Clean reinstall from no app data.
- `pnpm install`, build, package, install to user Applications, first launch, notes folder selection, restart, CLI/MCP integration.
- Long passive dogfooding period while using Exo for non-Exo work.

### Phase F: Graph And Exograph Workbench

Goal: build from stable core and plugin surfaces toward the exograph vision without imposing one vault schema.

Work after ship-readiness:

- Read-only graph extraction for links, backlinks, headings, tags, frontmatter/properties, paths, and file metadata.
- Optional OKF-compatible import/export/profile diagnostics without enforcing OKF on arbitrary Markdown.
- Profile-driven graph semantics: node types, edge types, path/property mappings, folder roles, authorship/mutability, templates, maintenance workflows, and review policy.
- Graph visualization plugin(s), metadata profile plugins, graph-health analyzer plugins, and reviewable maintenance proposals.
- Scoped note write primitives only after graph/read primitives are stable: create, append, guarded patch within selected note roots.

QA after Phase F:

- Graph extraction snapshots are deterministic and schema-neutral.
- Plugin graph views cannot mutate notes.
- Any proposed note/file mutation is reviewable, scoped, reversible, and tied to provenance.

## Product North Star

Exo should be the local workstation where humans and terminal agents build, maintain, evaluate, and improve personal AI systems around an exograph: a user-defined knowledge/work graph with growable relational ontologies.

That means:

- Markdown notes, project context, terminal sessions, agent messages, changed files, activity records, artifact references, and provenance references can become graph nodes.
- Links, frontmatter/properties, tags, paths, observed edits, citations, provenance, and user-defined mappings can become graph edges.
- Durable approved graph facts live in user-owned files. Exo keeps derived indexes, proposals, activity records, artifact references, and provenance references under `.exo/`.
- Terminal agents run inside the workspace instead of beside it.
- Agents can use Exo-controlled CLI/MCP tools to inspect context and communicate.
- Humans can review what agents are doing and what they changed without bouncing between editors.
- Search, memory, graph views, workflows, evals, and training grow from the exograph inside one workstation instead of becoming separate products.

## Useability First

The near-term product question is not whether Exo can describe a complete platform. It is whether Kenneth can use Exo as the default workspace for building Exo itself.

That means the immediate phases are ordered by unlock:

1. Stabilize the current app so notes, terminals, settings, CLI/MCP, background runtime, and review surfaces are reliable enough for daily work.
2. Use Exo-managed agents for bounded Exo tasks and treat every failure in that loop as product signal.
3. Make Exo-on-Exo coordination legible: agent roster, objectives, messages, transcripts, changed files, review links, and clear recovery paths.
4. Define exograph architecture only where it makes the working loop more coherent: profile/schema, read-only graph inspection, provider-neutral search, proposals, and reviewable maintenance.
5. Add plugins after core primitives are proven by actual Exo-on-Exo use, especially for evals/training/search-optimization harnesses that should not bloat core.

## Architecture Sequence

Exo should evolve through useability-driven phases instead of jumping straight to a large platform shape.

1. Current-package domain modules: keep `apps/desktop`, `packages/core`, `packages/cli`, and `packages/mcp`, but extract stable services and renderer state machines so new work stops accumulating in `main/index.ts` and `App.tsx`.
2. Resident runtime and Exo-on-Exo use: keep the process alive in the background, use Exo-managed agents for Exo work, and harden the actual coordination loop.
3. Capability boundaries: make terminal agents, project review, note search, graph inspection, and communication stable capabilities.
4. Exograph architecture: define profile/schema, graph extraction, proposal/review, provenance, and provider-neutral search contracts.
5. Runtime package extraction: once resident runtime and agent coordination have real pressure, move stable process-owned services into a dedicated runtime package.
6. Plugin registries: after runtime/domain primitives are stable, expose extension points for agents, panes, commands, search providers, exograph analyzers, evals, training, and workflows.

## 1. Stabilize The Daily Workspace

Exo should be reliable enough that Kenneth can leave it running and work inside it.

- Notes, project files, terminals, web previews, settings, CLI/MCP, and the menu bar runtime remain stable during normal work.
- Terminal responsiveness, tab switching, scrollback, pane resize, process exit states, and transcript access are top-tier and continuously QA'd.
- Bug bashes discovered while using Exo become the highest-priority work, not side quests.
- Every significant change gets automated tests plus in-app QA.
- The branch is kept clean enough to push/review instead of becoming an unreviewable local stack.

## 2. Workspace Surface

The workspace should support files and terminals as equal pane types.

- Terminal panes can be dragged into the editor canvas.
- Files and terminals can occupy arbitrary split-pane layouts.
- Mixed file/terminal tab groups should be supported later as a unified pane model, so a terminal tab and document tab can live in the same tab strip without nesting terminal chrome inside editor chrome.
- Pane layout persists across restarts.
- Tabs and borders stay visually aligned across all pane positions.
- Terminal rendering, scroll, reload hydration, and pane splits have regression coverage.

## 3. Runtime Lifecycle And Menu Bar

Exo should be a resident local runtime, not only a visible desktop window.

- The Exo process can keep running while the workspace window is hidden.
- The command server, MCP bridge, watchers, transcripts, and terminal-agent sessions remain available while the process is running.
- Closing the window hides it by default; quitting from the menu bar explicitly stops live agents.
- A macOS menu bar icon exposes Show Exo, Settings, session/status indicators, command-server recovery, and Quit.
- The installed macOS app is the stable daily runtime; source builds use an isolated QA runtime when testing changes side-by-side.
- CLI and MCP commands should work whenever Exo is running, even if no window is visible.
- If Exo is not running, CLI/MCP errors should clearly say that live agent control requires starting Exo.
- Relaunch should reattach to durable terminal sessions once the tmux-backed runtime lands; until then, it should show prior transcripts/session history without pretending dead pty processes survived.

The first version is in place: closing the window hides Exo, explicit Quit warns before stopping live terminals, the menu bar exposes runtime status plus recovery actions, and hidden-window CLI/MCP agent workflows have focused QA coverage.

## 4. Exo-On-Exo Agent Coordination

Exo should become the default way to coordinate agents working on Exo.

- Users can create Exo-managed Claude/Codex/shell sessions with names, cwd, objectives, active tasks, status, and health.
- Users and supervising agents can send messages, interrupt, terminate, inspect transcripts, and see changed files from one surface.
- Exo exposes the same safe work-plane through MCP so an external agent can create/read/message Exo-managed agents while the app runs in the background.
- The UI shows agent objectives, communication logs, changed files, and review links without requiring terminal transcript spelunking.
- The first coordination transport should be inspectable append-only files plus SQLite indexing; richer transports can come later.

## 5. Project Roots And Code Review

Projects are explicit attachments, not every folder on disk.

- Users can add/remove project roots from the UI.
- Agents can inspect attached project roots through MCP workspace status. Humans, scripts, and supervised operators can add/remove roots through Exo CLI/UI.
- Exo exposes a changed-files view for agent-authored edits.
- Agent sessions/messages can link to files and lines they changed when Exo can observe that relationship.
- The code viewer supports review workflows without requiring a separate editor for basic inspection.

## 6. Agent Context And Config

Exo should help users manage the instruction context their agents see.

- Users can inspect/edit global and local `AGENTS.md` / `CLAUDE.md` files.
- Users can choose which attached roots receive local context files.
- Exo can compare global vs local context and surface conflicts or duplication.
- Exo can install recommended snippets explaining Exo CLI/MCP tools.
- Exo-generated runtime overlays remain separate from user-authored context files.

## 7. Authorship And Provenance

Exo should track authorship from observed workflows, not guess using AI detectors.

- Writes made through Exo-managed terminal agents are linked to source agent/session/task where possible.
- Human-authored and agent-authored changes can be distinguished in notes and project files.
- Provenance can later become block-level or line-level where the data is reliable.
- Provenance should support review, audit, and coordination, not punitive authorship scoring.
- Exo should model authorship, mutability, and role separately from any specific folder name: source/evidence, editable synthesis, append-only log, generated artifact, trace, task, entity, project, eval, and dataset are roles/properties that profiles can map onto folders/frontmatter/conventions.

## 7.5 Feed And Activity Substrate

Exo should provide a small core feed/event stream and activity substrate. It should not become a large automation product before plugins prove which primitives are universal.

- Feed items are incoming or generated context, not necessarily notes: quick captures, RSS/bookmarks, voice transcripts, file changes, terminal-agent outputs, MCP messages, workflow results, git events, plugin responses, eval results, and training artifacts.
- The feed replaces a hardcoded inbox. Inbox-style workflows can be built on top, but Exo should not require an `/inbox/` folder or processing ritual.
- Feed items can be linked, archived, promoted into notes/entities/tasks, used as source evidence, converted into trace records, or dismissed.
- Core may own scheduler hooks or job registration so plugins do not each invent process supervision.
- A core activity record should capture id, status, timestamps, actor, harness, scope, permissions, output policy, and references to artifacts/transcripts/logs.
- Routines, workflows, graph-health jobs, eval runs, and training exports are plugin concepts by default.
- Scheduled runs should use plugin-owned schemas for detailed logs, traces, labels, dashboards, and exports, while linking back to core activity/artifact references.
- Skills are harness-visible capabilities referenced by prompts. Exo should eventually show which skills are available to which harnesses, but skills are not independent worker runtimes by default.

## 8. Exograph Architecture

Exo's core object is the exograph, not a fixed folder schema or one retrieval backend.

- Exo should opportunistically support the Open Knowledge Format (OKF) v0.1 draft as its portable knowledge-bundle compatibility target: Markdown concept documents, YAML frontmatter with `type` when present, normal Markdown links, optional `index.md`, optional `log.md`, and permissive consumers that preserve unknown fields.
- Users can define or accept an exograph profile: node types, edge types, path/property mappings, conventions, templates, maintenance rules, and review policy.
- Exo can recommend starter profiles, including a minimal flat-notes profile, a Shoshin-style organization profile, and an LM Wiki-style profile.
- Exo should never require `entities/`, `sources/`, `index.md`, `log.md`, or any other structure by default. It may detect and map them when they exist, or propose them with review.
- Exo should never require OKF frontmatter to use a file as Markdown. OKF checks are explicit diagnostics or export/import compatibility checks, not default editing gates.
- Exo-created workflows such as create note, create project, create concept, and future profile setup may offer OKF-compatible templates as options.
- Approved durable graph facts live in Markdown/frontmatter/properties, links, tags, and user files.
- Inferred facts, schema suggestions, activity records, artifact references, and provenance references live in `.exo/` until accepted.
- OKF compatibility should be read/write/export compatible when structure exists or is requested, but Exo runtime state, traces, proposals, plugin data, and training artifacts can remain richer `.exo/` state that links back to Markdown/OKF concepts.
- Profiles are mappings, not mandates. They define how folders, frontmatter, links, feed items, author/mutability rules, templates, and maintenance routines become graph semantics for a workspace.
- User-facing exograph modes collapse to two surfaces:
  - Analyze Exograph: read-only discovery, schema suggestions, and health diagnostics.
  - Maintain Exograph: reviewable file/profile changes after user approval.

## 9. QMD, Notes Index, And Shared Search

The exograph is the substrate for memory and retrieval.

- Exo should manage the QMD setup it needs for the default local search experience.
- Existing QMD setups should be detected and reused when they already index selected notes.
- QMD should index selected note roots, not project roots by default.
- Reindex triggers, frequency, and compute profiles should be configurable from Exo.
- Humans and agents should search the same exograph through UI, CLI, and MCP.
- Low-compute machines should have fallback search modes.
- Search should sit behind a provider contract. QMD is the default provider, but users should later be able to swap or extend retrieval without changing Exo's note, graph, CLI, or MCP contracts.
- MCP should expose search as an agent work primitive, not expose provider maintenance/admin controls.
- CLI should expose provider status, sync, diagnostics, and maintenance controls.

## 10. Note Traversal And Graph Maintenance

Exo should help agents maintain a useful exograph, not only retrieve from one.

- Selected note roots are the editable knowledge boundary; project roots are code/review context unless explicitly added to memory later.
- Exo should understand source/raw material, synthesized wiki pages, index/catalog files, logs, entities, projects, tasks, and durable agent instructions through user-defined profiles instead of hard-coding one person's directory layout.
- CLI should offer broad note operations inspired by mature local knowledge tools: list files/folders, inspect file metadata, read, create, append, guarded patch, move/rename, backlinks, outgoing links, unresolved links, orphans, headings/outline, tags/properties, and maintenance/lint reports.
- MCP should keep the smaller agent work plane: orient to the workspace, search, read, inspect document context/graph, propose or apply approved note changes in allowed note roots, and coordinate agents.
- Write operations must be scoped, reviewable, and observable. Prefer create/append/patch-with-expected-content over generic overwrite.
- Wiki health checks should report stale pages, orphan pages, missing cross-links, unresolved links, contradiction candidates, and missing source questions.

## 11. Graph And Memory Views

Exo should make the exograph visible.

- Graph view combines backlinks, Markdown links, tags, file paths, and QMD-derived relationships.
- Graph views can be scoped by note root, project root, task, or agent session.
- Memory view separates durable memory, trace archive, retrieval/index, and working-memory assembly.
- Agent sessions, messages, changed files, search results, and future workcells can become graph nodes.

## 12. Workcells, Evals, And Training

These are later systems built on top of the shared workspace. Core should own only minimal activity, artifact-reference, provenance-reference, permission, and review hooks. Specific eval, training, and search-optimization harnesses should be plugin sets unless they become necessary for the default Exo-on-Exo loop.

- Workcells define bounded research/development loops.
- Plugin runs produce artifacts, metrics, logs, and replayable traces while linking to core activity records.
- Evals measure retrieval quality, memory usefulness, agent recovery, and operator acceptance.
- Training data is explicitly scoped by project, workcell, agent, artifact type, review status, and time window.
- Local/open-source agents and training workflows come after stable memory, workcells, and evals.
- Tracing, evaluation, and training should exercise the plugin boundary without becoming merely a hosted web app: core owns references and permissions, while plugins provide collectors, runners, scorers, dashboards, schemas, and provider-specific training/export flows.

## 13. Plugin Architecture

Exo should be extensible without making every personal or domain-specific workflow part of core.

- The first plugin architecture phase is internal contracts, not public plugin loading. Exo should define registries for built-in capabilities, then migrate QMD search and shell/Claude/Codex launchers onto those contracts before loading external code.
- Core owns stable primitives: notes, project roots, basic search, panes, trusted web viewer host/endpoints, terminal runtime/rendering/session services, commands, agents, messages, settings, activity records, artifact/provenance references, proposals, and permission boundaries.
- Plugins are packages of Exo extensions. A plugin may include backend capabilities, commands, MCP/CLI tools, UI panels, editor extensions, or a local web app/artifact opened through Exo's core web viewer.
- Harness plugins integrate agent runtimes through Exo-owned terminal/session services. Routines are prompt-centered run definitions executed by a harness, often on a schedule; they may be shipped by a plugin or profile but are not themselves the worker runtime.
- Downstream workloads should prove the plugin boundary: elicitation harnesses, trace collectors, correction/review surfaces, domain-model hypotheses, dataset exporters, eval runners, and instrumented agent runtimes should use generic Exo primitives without all becoming core.
- Workload-specific plugins can use OKF concept documents for curated project/domain knowledge where possible, while storing raw traces, review labels, eval packets, and training exports as local artifacts linked back to OKF concepts.
- Web apps are one possible plugin output, not the whole plugin model. The web viewer host and open/focus/close endpoints belong in core because local previews, docs, dashboards, and artifacts all need the same trusted viewer.
- Agent integrations should use plugin-shaped adapter contracts where possible. Exo core should define how agents launch, expose capabilities, receive MCP/CLI tools, and report lifecycle state; specific agents such as Claude, Codex, Pi, Aider, Goose, or local/open-source agents can be first-party or community plugins.
- The current terminal rail should become a general tool/plugin dock, but terminal correctness remains a core product responsibility rather than a plugin concern.
- Plugin state should be inspectable, removable, and local-first.
- Plugin APIs should be versioned and documented before public plugin sharing is encouraged.
- Plugins should compose through stable registries instead of monkey-patching core internals: command registry, settings registry, pane/view registry, agent harness registry, search provider registry, exograph analyzer registry, MCP/CLI registry, and eval/training/export registries.
- Capability permissions must be explicit for filesystem scopes, process/terminal access, network access, git write/PR rights, secrets, and MCP exposure.
- Public manifests, install locations, package loading, and a Plugin Manager UI come after the internal registry contracts have been proven by current first-party capabilities.

## 14. Self-Modifying Exo

Exo should eventually help maintain and improve itself, but only through reviewable, policy-controlled workflows.

- The first version is supervised: an Exo-managed agent can create a branch, make changes, run the harness, summarize evidence, and prepare a PR or local diff for human review.
- Later versions can run recurring maintenance workflows for dependency/security updates, failing-test repair, docs/context drift, QMD/search health checks, and release hygiene as plugins over core git/harness/activity primitives.
- Core owns the trust boundary: git/PR workflow primitives, harness execution, audit logs, rollback metadata, provenance references, settings, and policy gates.
- Plugins can provide concrete maintenance agents, workflow recipes, provider integrations, eval suites, and dashboards.
- Self-modification should build on the same plugin, workcell, provenance, and harness primitives rather than becoming a separate hidden automation system.

## 15. Developer Harness

The repo should remain easy for humans and agents to modify.

- `pnpm check` remains the canonical local and CI gate.
- `pnpm ci:check` remains the canonical broad local/CI gate.
- Add deterministic formatting/lint and make it part of CI.
- Add mechanical architecture rules for renderer/main/core boundaries, command-server/CLI/MCP contract drift, hidden runtime caps, and direct filesystem/process access in renderer code.
- Expand docs link/path checks across README, AGENTS, architecture, tasks, roadmap, ledger, harness, and MCP docs.
- Add renderer crash regression probes for blank-window failures.
- Add stable goldens/snapshots where they catch real regressions.
- Add test-quality and app-QA skills/checklists so Exo-hosted agents know how to design tests, review tests, and manually validate Electron UI/runtime changes.
- Add entropy scans for bloated shell files, duplicated contracts, stale docs, and patterns that make Exo harder for agents to safely extend.
