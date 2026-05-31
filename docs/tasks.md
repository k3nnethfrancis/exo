# Exo Tasks

Last updated: 2026-05-31

This is the active task tracker for Exo. It is intentionally not a history file; completed implementation history belongs in `ledger.md`. Tasks here should be concrete, current, and ordered by practical priority.

## Now: Useability And Exo-On-Exo Readiness

- [x] Capture the current phased approach in `docs/usability-readiness.md`: readiness first, commit cleanup/push, installed-app daily use, live bug bash, then larger roadmap phases.
- [ ] Review and prepare the local commit stack for push: decide whether to keep the stack or squash into coherent feature commits.
- [x] Run one final clean-state QA pass after cleanup: `pnpm check:repo`, `pnpm typecheck`, `pnpm test`, `pnpm build`, focused Playwright, and full desktop e2e app QA.
- [x] Verify fresh-clone/setup docs against current pnpm/Corepack/Electron/MCP behavior.
- [ ] Push the reviewed branch and open the review/PR surface.
- [x] Install the packaged macOS app as the stable resident Exo runtime and use it as the default environment for the next bounded Exo implementation/review task.
- [x] Use `pnpm dev:qa` for source-build QA while the installed stable Exo app remains available for monitoring and agent coordination.
- [x] Verify `/Applications/Exo.app` shows the Exo menu bar icon, survives window close, and keeps CLI/MCP commands available while hidden.
- [ ] Add launch-at-login support for the installed app after the resident runtime passes daily-use QA.
- [ ] Design a packaged CLI/helper story so installed Exo does not depend on the repo-backed `bin/exo` long term.
- [ ] Resolve `EXO-ISSUE-025` before June 2026 GitHub Actions Node 24 enforcement affects CI.
- [ ] Spawn one Exo-managed agent for a narrow Exo task, inspect transcript/diff through Exo/CLI, and record every friction point as product work.
- [ ] Add an explicit issue/log path for Exo-on-Exo bugs found during real use.
- [ ] Keep terminal responsiveness, agent send/read, changed-file review, settings, and hidden-window runtime bugs above new platform features until the loop is reliable.
- [x] Refactor toward current-package domain modules before adding the next feature phase; do not introduce `packages/runtime` or plugin registries until runtime features create stable seams.
- [x] Extract remaining renderer state machines from `App.tsx`: pane/drop orchestration.
- [x] Extract Electron window/tray/renderer-recovery ownership into `apps/desktop/src/main/app-lifecycle.ts` as the first main-process service boundary.
- [x] Extract indexing timers, job metrics, sync/refresh scheduling, and indexed-root mutations into `apps/desktop/src/main/indexing-service.ts`.
- [x] Extract workspace note search, target resolution, target creation, suggestions, branch-family, and knowledge wrappers into `apps/desktop/src/main/workspace-notes-service.ts`.
- [x] Extract project git status and changed-line parsing into `apps/desktop/src/main/project-review-service.ts`.
- [x] Extract agent instruction provider-file alignment and runtime overlay listing into `apps/desktop/src/main/agent-instructions-service.ts`.
- [x] Extract workspace settings/application orchestration into `apps/desktop/src/main/workspace-settings-service.ts`.
- [x] Add a typed desktop IPC contract so preload, main IPC handlers, and renderer APIs cannot drift.
- [x] Extract renderer workspace-settings model helpers into `apps/desktop/src/renderer/src/workspaceSettingsModel.ts`.
- [x] Extract renderer workspace tree loading and lazy expansion into `apps/desktop/src/renderer/src/hooks/useWorkspaceTrees.ts`.
- [x] Extract renderer project review status and changed-file observation into `apps/desktop/src/renderer/src/hooks/useProjectReviewState.ts`.
- [x] Extract renderer open-document/editor state into `apps/desktop/src/renderer/src/hooks/useOpenDocuments.ts`.
- [x] Extract renderer terminal session state, hydration, event listeners, and polling into `apps/desktop/src/renderer/src/hooks/useTerminalSessions.ts`.
- [x] Extract renderer workspace bootstrap/onboarding state into `apps/desktop/src/renderer/src/hooks/useWorkspaceBootstrap.ts`.
- [x] Extract renderer workspace settings dialog, autosave, Apply, folder-picking, and index actions into `apps/desktop/src/renderer/src/hooks/useWorkspaceSettingsController.ts`.
- [x] Extract renderer workspace path mutation dialogs and create/rename/delete/move operations into `apps/desktop/src/renderer/src/hooks/useWorkspaceMutations.ts`.
- [x] Extract renderer pane drop orchestration into `apps/desktop/src/renderer/src/hooks/usePaneDropOrchestration.ts`.
- [x] Extract renderer terminal pane placement, focus, create, attach, and close orchestration into `apps/desktop/src/renderer/src/hooks/useTerminalPaneController.ts`.
- [x] Extract renderer command-server workspace listeners and global keybindings into focused hooks.
- [x] Extract renderer workspace layout persistence into `apps/desktop/src/renderer/src/hooks/useWorkspaceLayoutPersistence.ts`.
- [x] Prune MCP to the narrow agent work plane and clarify CLI as the operator/admin/debug surface.
- [x] Repair the e2e launch harness path for `EXO-ISSUE-021` by parallelizing the large shell file and capping e2e workers.
- [x] Verify the e2e launch harness repair tracked in `EXO-ISSUE-021` with a full shell e2e rerun.
- [x] Choose and add an open-source license.
- [x] Remove or resolve any accidental local edits before commit, including the stray `SECURITY.md` line if it reappears.
- [x] Confirm README, AGENTS, CLAUDE, architecture, roadmap, tasks, ledger, and MCP docs agree on the current Exo identity.
- [x] Confirm no source defaults point to private or machine-specific paths.
- [x] Confirm `.exo/`, terminal transcripts, logs, local settings, release artifacts, and generated runtime state are ignored.
- [x] Run `pnpm ci:check`.
- [x] Run focused desktop e2e for shell/search/terminal flows.
- [x] Harden fresh-clone setup for pnpm 11, blocked dependency builds, patched Vite/picomatch installs, and secured-network Electron downloads.
- [x] Fix setup and QA issues tracked through `EXO-ISSUE-020`; `EXO-ISSUE-021` remains open for the e2e launch harness.

## Next: Runtime Lifecycle And Menu Bar

- [x] Separate "Exo is running" from "Exo window is visible" in the product and architecture model.
- [x] Keep the Exo process, command server, MCP bridge, watchers, transcripts, and supervised pty agents alive when the main window is closed.
- [x] Add a macOS menu bar resident mode with actions for Show Exo, Settings, agent/session status, restart command server, and Quit Exo.
- [x] Add a first-class local macOS app install script for the resident runtime.
- [x] Add an isolated `pnpm dev:qa` source-build profile so stable installed Exo and dev Exo do not share runtime state.
- [x] Make close-window hide the workspace window instead of quitting.
- [x] Make explicit Quit warn that live terminals/agents will stop.
- [x] Ensure CLI/MCP live commands work while the Exo window is hidden and fail clearly when the Exo process is not running.
- [x] Add app lifecycle tests for close/hide/show/quit behavior.
- [x] Add app lifecycle coverage for command-server availability while hidden.
- [x] Do app QA for hidden-window agent workflows: create an agent through MCP/CLI, hide Exo, read/send messages, reopen Exo, and verify transcripts/session state.

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
- [x] Add CLI and workspace-status visibility for attached project roots.
- [x] Add CLI/UI commands to add and remove attached project roots.
- [x] Add a changed-files view for agent-authored project edits.
- [x] Link changed files to observable terminal sessions by project cwd.
- [ ] Link terminal-agent messages to files they changed only when Exo can observe the relationship reliably; keep ambiguous changes in neutral workspace/status surfaces.
- [x] Add code-review affordances for jumping from a changed file to an associated terminal session.
- [x] Add code-review affordances for jumping from an agent session to associated changed files.
- [x] Add code-review affordances for jumping from an agent session to a changed file hunk or line.
- [x] Track external file changes without resetting editor scroll or causing flicker.

## Next: Agent Context And Config Management

- [x] Add a first-class agent config manager.
- [x] Simplify the manager to global and active exocortex/notes-root instruction layers.
- [x] Keep Codex `AGENTS.md` and Claude `CLAUDE.md` aligned from one editor for each managed layer.
- [x] Detect when `AGENTS.md` and `CLAUDE.md` diverge and require the user to choose a source or manually edit before saving both.
- [x] Remove arbitrary project-scope writes, custom instruction outputs, provider-file adapter settings, history UI, generated-overlay preview, and managed provider/MCP config editing from the Agent Config Editor.
- [x] Add an optional Exo starter template for managed instruction files.
- [x] Keep Exo-generated runtime overlays under `.exo/instructions/` separate from user-authored context files.
- [x] Pass the matching `.exo/instructions/` overlay to Exo-launched terminal agents through environment variables.

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
- [x] Expose QMD-backed status/search/read/sync/update/embed through Exo CLI, plus MCP `search`/`read_document` and index summary in `workspace_status`.
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
- [x] Reframe QMD as the default search provider behind an Exo search-provider contract, not a permanent hard dependency at the product boundary.
- [x] Decide the CLI/MCP philosophy for note and graph tools: CLI is broad operator/admin/debug; MCP is the narrow agent work plane.
- [ ] Keep project files out of the notes memory index unless explicitly added later.
- [ ] Design the search-provider interface for capability discovery, status, search, read/resolve, graph hints, sync/update, cancellation, and diagnostics.
- [ ] Add note traversal and graph context primitives: files/folders, document metadata, headings/outline, outgoing links, backlinks, unresolved links, orphans, and related documents.
- [ ] Add scoped note write primitives after graph/read primitives are stable: create, append, and guarded patch within selected note roots.
- [ ] Add LM Wiki maintenance reports for stale pages, orphan pages, unresolved links, missing cross-links, contradiction candidates, and missing source questions.
- [ ] Decide which note/graph primitives belong in MCP as a compact agent-safe set versus CLI-only operator commands.

## Next: Exograph Architecture

- [ ] Write the exograph architecture spec: files/properties as approved facts, profile/config as interpretation rules, `.exo/` as derived state/proposals/runs/provenance.
- [ ] Define the exograph profile model: node types, edge types, path/property mappings, conventions, templates, maintenance rules, and review policy.
- [ ] Define proposal storage for inferred schema, graph, and file changes before any new maintainer write workflows are added.
- [ ] Define the two user-facing exograph modes: Analyze Exograph and Maintain Exograph.
- [ ] Add schema-neutral read-only graph extraction for Markdown links, backlinks, headings, tags, frontmatter/properties, paths, and file metadata.
- [ ] Keep LM Wiki and Shoshin as optional starter profiles, not built-in mandatory folder structures.

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
- [ ] Add deterministic formatting/lint to `pnpm ci:check` and CI.
- [ ] Add structural rules for renderer/main/core boundaries.
- [ ] Add command-server/CLI/MCP contract drift checks.
- [ ] Add hidden-cap/settings checks for terminal/search/runtime behavior that would hide user-controllable data.
- [x] Add docs link/path checks for README, AGENTS, and docs indexes.
- [ ] Expand docs link/path checks across roadmap, tasks, ledger, harness, architecture, MCP docs, and package README files.
- [ ] Add renderer crash regression probes for blank-window failures.
- [x] Apply user-configured live terminal scrollback to renderer/main buffers while preserving transcripts for reattached or actively streaming long-running agents.
- [ ] Add golden/snapshot coverage for stable Markdown rendering, terminal hydration, and search output.
- [ ] Add a test-quality review skill/checklist and use it before accepting Exo-hosted agent branches.
- [ ] Add an app-QA skill/checklist for real Electron validation of UI/runtime changes.
- [ ] Add entropy scans for bloated shell files, duplicated IPC/command types, direct renderer filesystem/process access, stale docs, and repeated anti-patterns.
- [ ] Add Exo-on-Exo harness coverage for agent create/read/send, transcript review, changed-file attribution, worktree cleanliness, and hidden-window recovery.
- [x] Keep CLI app-route tests isolated from live Exo command-server state.
