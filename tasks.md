# Exo Tasks

Last updated: 2026-07-02

This is the active task tracker for Exo. It is intentionally not a history file; completed implementation history belongs in `ledger.md`. Tasks here should be concrete, current, and ordered by practical priority.

Canonical issue intake is root `issues.md`. Do not add new Exo issue trackers under `docs/` or the notes vault.

## Current Ship Roadmap Tasks

- [ ] Execute Terminal V4.1 geometry convergence work from Fable's proposal before treating terminal render bugs as isolated symptoms:
  - [ ] Wave 1 fan-out in progress from `fable-exo-preflight-spec.md`: red geometry tests, geometry service base, terminal input escape pass, plain-attach spike, and plugin P1 namespaced capabilities.
  - [ ] Write the reconnect-at-wrong-size red test before implementation.
  - [ ] Write the wake/reconnect simulation red test before implementation.
  - [ ] Implement recorded renderer geometry and attach/reconnect size assertion (`EXO-ISSUE-075`).
  - [ ] Remove asymmetric tmux-only resize clamping or replace it with symmetric renderer-source enforcement.
  - [ ] Add attach generations so renderer resize dedupe cannot suppress lifecycle geometry reassertion.
  - [ ] Add geometry divergence diagnostics and a resync action.
  - [ ] Implement byte-faithful live reconnect snapshots after size assertion.
  - [ ] Run the plain tmux-attach spike in parallel as evidence, not as a product-path switch.
- [ ] Finish Plugin Architecture Completion:
  - [ ] Wave 1 plugin package in progress: migrate capability kinds to namespaced ids with legacy manifest alias shim and status-visible deprecation.
  - [x] Accept Fable's sequencing amendment: namespaced capabilities and scoped permissions land before the proposal/review write contract.
  - [ ] Add staged profile apply review with trust prompts and permission grants before any profile/plugin recommendation can write instructions, MCP config, skills, routines, settings, or grants.
  - [ ] Design proposal/review write contract as the shared substrate for profile apply, project knowledge sync, graph maintenance, skill/config writes, and agent-suggested note edits.
  - [ ] Design semantic trace contract early enough that harness adapters do not need another terminal-service re-plumb.
  - [ ] Tighten Plugin Manager into a management surface: active/disabled/untrusted/missing states, local plugin add/remove/swap, plugin-owned settings, readiness/dependency guidance, and no dense-layout overlap.
  - [ ] Split terminal/session substrate types from harness-adapter ids so `exo agents` derives launchable harnesses from registered harness plugins while `exo terminals` remains the low-level core terminal surface.
  - [ ] Define external plugin contracts for workload-specific trace collection, review labels, dataset export, eval packets, and instrumented agent runtimes.
  - [ ] Define a Project Knowledge Sync plugin/profile contract for project-local canonical Markdown files: default names such as `issues.md`, `tasks.md`, `roadmap.md`, plans, specs, `AGENTS.md`, and `CLAUDE.md`; custom user patterns; sync mode; conflict policy; remote GitHub state; and reviewable proposals.
  - [ ] Keep GA/Shoshin-specific behavior out of OSS core; represent local variants as local/private plugin configuration or downstream plugins.
- [ ] Run Plugin Architecture QA after the next plugin slice:
  - [ ] Plugin Manager app QA: official rows locked, local/dev rows trust/enable/disable correctly, settings validation works, missing dependency states are legible, and dense layouts do not overlap.
  - [ ] Onboarding plugin review QA: clean workspace selection shows core rows, official plugins, local profile/plugin inventory, and no destructive apply path without review.
  - [ ] Search QA: QMD enabled/degraded/disabled states preserve core filename/path/basic text search and do not block Explore.
  - [ ] Harness QA: unavailable harnesses do not show dead launch buttons; shell/Claude/Codex still launch through the registered harness path.
- [ ] Clear the daily-use bug-bash cluster from root `issues.md` before treating the build as ship-ready:
  - [ ] Terminal/preview interaction: `EXO-ISSUE-056`, `EXO-ISSUE-062`, `EXO-ISSUE-069`, `EXO-ISSUE-072`, plus any new render/focus regressions.
  - [ ] Editor/graph UX: `EXO-ISSUE-051`, `EXO-ISSUE-052`, `EXO-ISSUE-053`, `EXO-ISSUE-057`.
  - [ ] Explorer/UI polish: `EXO-ISSUE-043`, `EXO-ISSUE-044`, `EXO-ISSUE-055`, `EXO-ISSUE-058`.
  - [ ] Settings/profile/plugin UI: `EXO-ISSUE-047`, `EXO-ISSUE-048`, `EXO-ISSUE-049`.
  - [ ] Install/onboarding/dev launch: `EXO-ISSUE-027`, `EXO-ISSUE-028`, `EXO-ISSUE-029`, `EXO-ISSUE-031`.
  - [ ] QA workflow: `EXO-ISSUE-074` so visual app QA has a clear preflight/fallback path when Computer Use cannot inspect Exo.
- [ ] Harden CLI/MCP for multi-agent coordination:
  - [ ] Make `workspace_status` a reliable orientation tool with workspace roots, plugin/search readiness, live agents, index summary, command-server health, and degraded-state diagnostics.
  - [ ] Add or finalize the core preview/artifact-open command path for CLI/MCP through the core web viewer endpoint.
  - [ ] Add NDE-style MCP tests covering functionality, latency, result quality, stale config diagnostics, and permission/security behavior.
  - [ ] Harden stale command-server and MCP launcher diagnostics, including deleted launcher paths and sandbox-blocked process probes.
  - [ ] Keep the scheduled GitHub issue-fix loop conservative and documented: labeled issues only, one issue max, isolated branch/worktree, tests/app QA, draft PR, no main push, no auto-merge.
- [ ] Prove the first Routine substrate path without expanding core:
  - [ ] Use the GitHub issue-fix loop as the first routine-like POC.
  - [ ] Model routine definitions as prompt, harness, trigger/schedule, scope, permissions, and output policy.
  - [ ] Keep rich workload schemas plugin-owned; core stores minimal activity, artifact-reference, provenance-reference, and review-reference records.
- [ ] Complete installable stable-runtime readiness:
  - [ ] Clean reinstall from no app data, package, install to user Applications, first launch, notes folder selection, restart, CLI/MCP integration.
  - [ ] Update README, changelog, and release notes for user install versus developer setup.
  - [ ] Run a passive dogfooding period while using Exo for non-Exo work.
- [ ] Defer larger exograph work until the plugin/CLI/MCP/daily-use ship path is stable:
  - [ ] Read-only graph extraction and graph visualization plugins.
  - [ ] Project knowledge sync views for drift/conflict state between project-local Markdown and central exograph Markdown.
  - [ ] Optional OKF-compatible profile diagnostics/import/export.
  - [ ] Scoped note write primitives with reviewable, reversible proposals.

## Now: Useability And Exo-On-Exo Readiness

- [x] Complete the terminal launch-readiness checklist tracked in `EXO-ISSUE-068` before treating Exo as launch-ready for daily agent work:
  1. [x] Complete the current `TerminalManager` boundary split: runtime, session registry, harness readiness/queued-send policy, live-tail policy, diagnostics, transcripts, health, and recovery each have a named owner.
     - 2026-06-24: Moved live-tail source selection into `terminal-live-tail-policy`; lifecycle/write/reconnect orchestration remains in `TerminalManager` as the compatibility facade until a concrete reliability bug justifies another split.
  2. [x] Move Codex-specific startup prompt scanning, queued semantic sends, and MCP launch overrides out of `TerminalManager` into `terminal-harness-readiness`.
  3. [x] Remove legacy `terminalHistoryMode`; terminal behavior is expressed as explicit numeric/settings fields for live scrollback, read tails, transcript retention, timing, and geometry.
  4. [x] Replace preview-pane/global terminal refresh mitigations with scoped `TerminalView` visibility, focus, fit, and resize handling.
  5. [x] Keep native tmux recovery/debug available through diagnostics/API attach fields; remove the visible terminal-header copy button to reduce chrome clutter.
  6. [x] Establish a living render-stability fixture corpus for Claude/Codex corruption shapes, especially `???`, `�`, tofu boxes, stale overlays, prompt wrapping drift, and blank history gaps.
     - 2026-06-24: Added visible-history assertions to the fake-Claude preview/reload e2e so the test scrolls back to Claude-like history anchors and then returns to the live prompt before continuing input.
  7. [x] Promote the focused terminal gate into the standard readiness path: terminal vitest subset, render-stability fixture, fake-agent e2e, stable smoke, installed-app restart, and manual Claude/Codex QA.
  8. [x] Pass real app QA after each terminal slice: fresh shell, fresh Claude, fresh Codex, preview open, tab switch, hard refresh/app restart, and install-app command-server recovery.
     - 2026-06-24 installed-app QA: temporary shell `term-34` preserved Unicode-heavy output through CLI read and rendered without visible smear in the installed app; temporary Claude `term-35` rendered a clean fresh header and accepted `/status` on first focused click without inference. Remaining field coverage: resumed long Claude session, sleep/wake, and longer daily-use sessions.
     - 2026-06-24 gate: `pnpm terminal:check` passed with process privileges after the sandboxed Electron launch failed with `kill EPERM`.
     - 2026-06-24 gate: `pnpm stable:check` passed end to end.
     - 2026-06-24 installed-app QA: temporary Codex `term-36` rendered cleanly, exposed a malformed global `terminal-stability` skill warning, and after fixing `/Users/kenneth/.codex/skills/terminal-stability/SKILL.md`, temporary Codex `term-37` launched without that warning. Preview-open terminal visibility was also spot-checked in the installed app. Long resumed Claude sessions and macOS sleep/wake remain field-dogfooding coverage rather than implementation blockers.
- [ ] Continue `EXO-ISSUE-069` terminal field dogfooding: macOS sleep/wake and long resumed Claude/Codex sessions with real user workflows.
- [x] Resolve `EXO-ISSUE-070` terminal code-review residuals from `docs/terminal-code-review-2026-06-23.md`.
- [ ] Continue `EXO-ISSUE-062` terminal render cleanup using `docs/terminal-render-cleanup-protocol.md`: every new `�`/`???`/tofu/smear field case needs classification, fixture coverage, and `pnpm terminal:check`.
- [ ] Complete fresh-clone setup QA for `EXO-ISSUE-027`: frozen install, package build, user Applications install, and first launch logging.
- [x] Complete first-run onboarding QA for `EXO-ISSUE-028`: existing notes folder selection, post-selection shell state, terminal cwd default, and settings Apply copy.
- [x] Fix markdown editor cursor/list QoL: preserve cursor across refresh, continue bullets on Enter, exit empty bullets cleanly, and keep arrow navigation out of hidden list markers.
- [x] Fix markdown task-list continuation so Enter preserves `- [ ]` structure and empty task items exit cleanly.
- [x] Add wikilink exit behavior: Tab/Enter from inside `[[target]]` moves the cursor after a following space so typing can continue inline.
- [x] Add wikilink existing-note suggestions while typing `[[query]]`, capped to three matches, with Enter selecting the first existing note match.
- [ ] Reproduce and fix `EXO-ISSUE-029`: stray default Electron app window during `pnpm dev`.
- [x] Implement `EXO-ISSUE-030`: tmux-backed core terminal runtime with deterministic terminal-quality tests and no live-inference automated QA.
  - Follow-up: remaining terminal launch-readiness work is now tracked under `EXO-ISSUE-068`.
- [x] Complete `EXO-ISSUE-037` terminal parity follow-up after multi-agent review: stale tmux state persistence, terminal-quality CI gate, and diagnostics gaps.
  - Follow-up: remaining diagnostics hardening and launch-readiness work is now tracked under `EXO-ISSUE-068`.
- [x] Complete the terminal architecture simplification decision pass.
  - Decision: Exo remains embedded-first, tmux-durable, and xterm-owned. See `docs/terminal-architecture-v4.md`.
- [x] Remove artificial terminal capability limits found by multi-agent review: preserve alternate-screen/TUI escapes, replace broad wheel-input suppression with explicit viewport scrolling, send first measured resize immediately, route `exo terminals send` through semantic message delivery, and report missing/exited write targets as not delivered.
- [ ] Reproduce and fix `EXO-ISSUE-031`: packaged app silently exits on first launch after local install.
- [x] Mitigate `EXO-ISSUE-026`: installed app renderer runaway CPU/RSS during idle workspace use and missing renderer recovery after forced renderer death.
- [x] Capture the current phased approach in `docs/usability-readiness.md`: readiness first, commit cleanup/push, installed-app daily use, live bug bash, then larger roadmap phases.
- [ ] Review and prepare the local commit stack for push: decide whether to keep the stack or squash into coherent feature commits.
- [x] Run one final clean-state QA pass after cleanup: `pnpm check:repo`, `pnpm typecheck`, `pnpm test`, `pnpm build`, focused Playwright, and full desktop e2e app QA.
- [x] Verify fresh-clone/setup docs against current pnpm/Corepack/Electron/MCP behavior.
- [ ] Push the reviewed branch and open the review/PR surface.
- [x] Install the packaged macOS app as the stable resident Exo runtime and use it as the default environment for the next bounded Exo implementation/review task.
- [x] Make `exo` / `exo start` launch or focus the resident packaged app, while source QA stays under `pnpm dev:qa`.
- [x] Use `pnpm dev:qa` for source-build QA while the installed stable Exo app remains available for monitoring and agent coordination.
- [x] Verify `/Applications/Exo.app` shows the Exo menu bar icon, survives window close, and keeps CLI/MCP commands available while hidden.
- [ ] Add launch-at-login support for the installed app after the resident runtime passes daily-use QA.
- [ ] Design a packaged CLI/helper story so installed Exo does not depend on the repo-backed `bin/exo` long term.
- [x] Scope and implement `EXO-ISSUE-033`: optional Streamable HTTP MCP transport for remote-only MCP hosts such as Glean, keeping stdio as the default local transport.
- [x] Fix `EXO-ISSUE-035`: stop active terminal rehydration from resetting xterm and replaying stale scrollback over live agent output.
- [ ] Continue `EXO-ISSUE-017` terminal field validation after the split-pane resize-handoff mitigation: watch for Claude/Codex prompt wrapping drift, large blank history gaps, and missing-looking output chunks.
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
- [x] Keep the Exo process, command server, MCP bridge, watchers, transcripts, and terminal-agent sessions available when the main window is closed.
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
- [x] Add a core web viewer pane for local web-app previews, docs, dashboards, and plugin-produced artifacts.
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
- [x] Move the Agent Config Editor entry point from Workspace Settings to the agent harness rail.
- [x] Add first-pass skill inventory and editing for Claude/Codex global, workspace, and active notes skill folders.
- [x] Add reversible harness skill disable/enable by moving folders into an Exo-managed disabled-skills store instead of deleting them.
- [x] Add first-pass git/GitHub skill sources: sync a repo `skills/` folder into Exo's library store and install copies into selected harness scopes without overwriting existing local skills.
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
- [ ] Define the core authorship/mutability/role model: human-authored, agent-authored, mixed, unknown; immutable source, append-only log, editable synthesis, generated artifact; source, concept, entity, project, task, trace, profile, eval, dataset.
- [ ] Explore block-level or line-level provenance only where Exo can track it reliably.
- [ ] Avoid AI-detector-style inference; provenance should come from observed writes and controlled workflows.

## Next: Feed, Activity Substrate, And Plugin Routines

- [ ] Define the feed/event item model for incoming and generated context: quick capture, RSS/bookmark/web clip, voice transcript, file change, terminal-agent output, MCP message, workflow result, git event, plugin response, eval result, and training artifact.
- [ ] Define feed item review/promote/archive semantics without requiring an `/inbox/` folder.
- [x] Define the first-pass Routine/activity model: prompt, selected harness, optional required harness skills, manual trigger or schedule, scope, permissions, output policy, logs, traces, artifacts, review state, and recovery.
- [x] Reassess the current Routine/Run core model and shrink future expansion toward a minimal activity substrate: ids, status, timestamps, actor, scope, permission checks, artifact references, transcript/log references, optional provenance links, and optional review state.
  - 2026-06-27: Added `docs/activity-plugin-contract.md` and narrowed `RunRecord` away from embedded rich trace/eval/file-change schemas. Trace JSONL remains an artifact-backed helper; rich workload schemas stay plugin-owned.
- [x] Define how harness skill inventory is represented so Exo can warn when a Routine prompt references a skill the selected harness does not expose.
- [x] Define plugin routine templates as metadata that can be instantiated into concrete user/workspace Routines.
- [x] Add the first Routine CLI MVP: list plugin templates, create concrete routines, list routines, record dry-run executions, and inspect run records/artifacts.
- [x] Add an official `graph-health.template` routine plugin manifest for dogfooding plugin-template discovery.
- [x] Add first app-backed Routine execution handoff: `exo routines run --agent` launches shell/Claude/Codex through the running app, sends the prompt, and records the agent-session artifact for review.
- [ ] Add first plugin routine candidate use cases: update entities, graph health, organize wiki, plugin-hosted elicitation, training export, eval run, and Exo-on-Exo maintenance.
- [x] Decide the first user-facing Routine creation surface: CLI MVP on top of one core routine service.
- [ ] Decide whether core needs scheduler hooks now or whether plugin routine execution can stay manual/CLI until repeated use proves the scheduler substrate.
- [ ] Add activity lifecycle tracking beyond handoff only at the substrate level: terminal transcript links, completion detection, cancellation, and accepted/rejected review references.

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
- [x] Design the search-provider interface for capability discovery, status, search, read/resolve, sync/update, and future diagnostics.
- [x] Move QMD behind the internal `SearchProvider` contract while preserving current UI/CLI/MCP behavior.
- [x] Reframe QMD in settings, Plugin Manager, CLI, and MCP copy as an official advanced search provider plugin while preserving core filename/path/text search when QMD is disabled or degraded.
- [x] Add provider-neutral search status and capability metadata so Plugin Manager can show QMD readiness without treating QMD as core search.
- [ ] Add note traversal and graph context primitives: files/folders, document metadata, headings/outline, outgoing links, backlinks, unresolved links, orphans, and related documents.
- [ ] Add scoped note write primitives after graph/read primitives are stable: create, append, and guarded patch within selected note roots.
- [ ] Add LM Wiki maintenance reports for stale pages, orphan pages, unresolved links, missing cross-links, contradiction candidates, and missing source questions.
- [ ] Decide which note/graph primitives belong in MCP as a compact agent-safe set versus CLI-only operator commands.

## Next: Exograph Architecture

- [ ] Write the exograph architecture spec: files/properties as approved facts, profile/config as interpretation rules, `.exo/` as derived state/proposals/runs/provenance.
- [ ] Add OKF v0.1 compatibility requirements to the exograph spec as optional structure, not a Markdown gate: concept docs with `type` when present/requested, optional `title`/`description`/`resource`/`tags`/`timestamp`, Markdown links, optional `index.md`/`log.md`, permissive consumers, and unknown-field preservation.
- [ ] Define the exograph profile model as mappings, not mandates: node types, edge types, path/property mappings, folder roles, authorship/mutability rules, feed promotion rules, conventions, templates, maintenance workflows, and review policy.
- [ ] Add OKF-compatible structure detection and explicit conformance diagnostics for attached note roots without forcing users to restructure existing notes.
- [ ] Add OKF export/import planning for Exo profiles and curated graph facts, including create-note/create-project templates that can emit OKF-compatible frontmatter when selected.
- [ ] Define proposal storage for inferred schema, graph, and file changes before any new maintainer write workflows are added.
- [ ] Define the two user-facing exograph modes: Analyze Exograph and Maintain Exograph.
- [ ] Add schema-neutral read-only graph extraction for Markdown links, backlinks, headings, tags, frontmatter/properties, paths, and file metadata.
- [x] Add a core read-only graph snapshot API that produces deterministic note/tag/link facts for graph visualization plugins and MCP/CLI graph traversal.
- [ ] Keep LM Wiki and Shoshin as optional starter profiles, not built-in mandatory folder structures.

## Next: Plugin Architecture Completion

- [x] Add a profile dry-run/preview planner that shows recommended plugin, schema, context-template, skill, routine, graph-view, and review-policy effects without applying them.
- [x] Split plugin trust from enabled state and keep user/workspace plugin manifests inspectable but inactive until explicitly trusted later.
- [x] Add neutral plugin location resolution for built-in, dev, user, and workspace plugin directories so routine discovery does not own plugin discovery.
- [x] Keep plugin manifests metadata-only and reject unsafe entrypoint paths before any future executable plugin loading exists.
- [x] Make harness readiness the canonical launchability model for Claude, Codex, Pi-compatible, Hermes, and future adapters.
- [x] Add a final launch gate so non-shell agent terminals cannot be created from raw launch plans when the harness is not launchable.
- [x] Define the agent-harness plugin contract for Claude, Codex, Pi, Aider, Goose, OpenCode, and local/open-source agents: adapter metadata, availability detection, launch planning, semantic messages, skill/config inventory, dependency/setup guidance, and core terminal ownership.
- [x] Keep Plugin Manager read-only for the foundation pass while improving category navigation, detail inspection, and setup/readiness explanations.
- [x] Add Plugin Enablement v0: desktop Plugin Manager can trust, enable, and disable local/developer metadata plugins while keeping official/core rows read-only and without executing plugin code.
- [x] Add Plugin Config v0 core state: metadata-only plugin settings schemas, JSON-backed overrides, validation, reset, and inventory summaries without executing plugin code.
- [x] Add Plugin Config desktop UI in Plugin Manager so trusted/enabled local plugins can edit reviewed settings without bloating Workspace Settings.
- [x] Add typed tool surface descriptors for the right rail/tool dock so terminal launchers, harness launchers, Agent Config, Plugin Manager, side-pane controls, and future routine/graph plugin surfaces are described before renderer callback wiring.
- [x] Sharpen the graph visualization plugin boundary with deterministic `GraphSnapshot` metadata, derived backlinks, nested `graphVisualization` compatibility payloads, graph-aware surface descriptor metadata, and focused contract docs.
- [x] Define safe renderer panel extension points and core web viewer endpoint usage for plugin-produced local apps/artifacts without implementing renderer plugin loading.
- [x] Write the near-term Profile and Plugin Management plan that distinguishes Onboarding, Settings/Profile, Plugin Manager, Agent Config, and status-bar review affordances.
- [x] Add active workspace profile state under the runtime root: active profile id/source/hash, scope, auto-update flag, and review-required status.
- [x] Add shared/main/preload APIs for listing profiles, reading active profile state, setting/clearing active profile state, and toggling profile auto-update without applying profile writes.
- [x] Refactor Workspace Settings from horizontal tabs to vertical settings navigation and add a Profile page.
- [x] Add a read-only Profile Settings page showing active profile, profile candidates, recommended plugins, schemas, context/instruction templates, skills, routines, graph views, review/output policies, and disabled write actions with reasons.
- [x] Add a read-only Profile Customize/Edit screen shell that centralizes profile metadata, recommended plugins, instruction templates, skills, schemas, routines, graph views, analyzers, and policies while keeping templatize/save disabled.
- [x] Route Profile Customize component sections to existing specialized managers: recommended plugins open Plugin Manager, and instructions/templates/skills open Agent Config Editor while inline writes remain disabled.
- [x] Add a Profile copy/customize path that creates trusted workspace-local profile metadata, selects it, and marks review required without mutating official profile packages or writing user instruction files.
- [x] Improve Plugin Manager into a quick management surface with active/disabled/untrusted/missing setup/permissions-needed buckets, inline mutable actions, same-category alternatives, and clear locks for official/core rows.
- [x] Add Plugin Manager baseline/layer orientation so users can distinguish always-on Exograph core, official plugins, local plugins, developer plugins, and which local plugins can be swapped or removed.
- [x] Expose backend `ProfilePlanPreview` data to Profile Settings so Review/Customize screens show canonical profile actions, blockers, warnings, and future write/install/schedule effects without renderer-side duplicate planning.
- [x] Add profile review and notes-repo changes indicators to the bottom bar, with a changed-notes modal that opens changed Markdown files from note roots.
- [ ] Add permission prompts and a staged profile apply review flow before any profile can write `AGENTS.md`, `CLAUDE.md`, MCP config, skills, routines, plugin settings, or permission grants.
- [x] Add local plugin add/remove/swap primitives for metadata plugin directories without loading executable plugin entrypoints.
- [x] Add provider-neutral search readiness metadata so Plugin Manager can show QMD and future search-provider state without treating QMD as core search.

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

## Next: Plugin Architecture Foundations

- [x] Scope the plugin architecture as internal capability registries first, not arbitrary user-code loading.
- [x] Define the target core-versus-plugin architecture: core owns Markdown graph/editor, basic search, pane/web viewer hosts, terminal runtime, minimal activity/artifact-reference substrate, permissions, and plugin registry; plugins provide harnesses, advanced search, profiles, routines, analyzers, evals, exporters, dashboards, and maintenance workflows.
- [x] Write the concrete implementation sequence in `docs/plugin-implementation-plan.md`.
- [x] Write the near-term Plugin Manager foundation milestone: inventory sources, visible categories, non-goals, acceptance criteria, tests, and app QA requirements.
- [x] Expose current core capabilities, official plugin-shaped capabilities, and metadata-only local manifests to the desktop through a read-only inventory API.
- [x] Add a read-only Plugin Manager foundation surface grouped by category, showing Core vs Official Plugin vs Local Plugin vs Developer Manifest, lifecycle, trust, enabled/disabled state, dependency/install status, and surfaces/permissions.
- [x] Add a read-only Plugin Manager detail panel for profile and graph visualization metadata without adding mutation or plugin execution.
- [x] Keep Settings focused on baseline Exo behavior; use Plugin Manager for plugin lifecycle/config and keep Agent Config Editor specialized for harness instructions/skills/provider files.
- [x] Define the profile manifest extension for recommended plugins, metadata/frontmatter schemas, context templates, AGENTS/CLAUDE templates, MCP config, skills, routine templates, graph views, analyzer settings, and output/review policies.
- [x] Define the graph-data API and graph visualization surface contract before implementing the default graph explorer.
- [x] Add core capability contract types and a built-in registry with tests.
- [x] Register built-in QMD search-provider metadata without changing behavior.
- [x] Extract QMD behind a `SearchProvider` interface.
- [x] Add a typed search-provider registry and route the QMD facade through it.
- [x] Register built-in shell, Claude, and Codex agent-harness metadata without changing behavior.
- [x] Extract shell/Claude/Codex launch planning behind an `AgentHarness` interface.
- [x] Add a typed agent-harness registry and route runtime launcher resolution through it.
- [x] Define Routine and harness skill inventory contracts before implementing scheduler UI.
- [x] Define first-pass Run, artifact, trace, file-change proposal, and evaluation result primitives that plugins can build on.
- [ ] Narrow the long-term core contract from rich Run/trace/eval schemas to minimal activity, artifact-reference, provenance-reference, and review-reference primitives; leave rich schemas plugin-owned.
- [x] Define canonical `.exo/` storage paths for first-pass Routine definitions, Run/activity records, transcripts, logs, and artifacts.
- [x] Add a first JSON-backed core store for Routine definitions and Run/activity records.
- [x] Add artifact writing and trace JSONL append helpers to the Routine/Run store.
- [x] Add metadata-only plugin routine-template extraction and concrete Routine instantiation helpers.
- [x] Add a core Routine service that discovers plugin templates, persists routines, and records dry-run executions.
- [x] Add a generic trace collector contract without registering workload-specific collectors in core.
- [x] Add a manual Routine executor substrate with injected host execution, artifact recording, trace recording, failure capture, and review status updates.
- [x] Document that workload-specific systems such as Guardian Angel should be downstream plugins/reference workloads, not Exo core features.
- [ ] Define external plugin contracts for workload-specific trace collection, review labels, dataset export, eval packets, and instrumented agent runtimes.
- [x] Review the first-pass official harness plugin/config work for shell, Claude Code, Codex, Pi, and Hermes; ensure missing harnesses are configuration items, not dead launch buttons, and local GA Pi is represented only as a local custom Pi instance.
- [ ] Split terminal/session substrate types from harness-adapter ids so CLI/MCP agent creation derives allowed choices from the registered harnesses while `exo terminals` stays the low-level core terminal surface.
- [ ] Define how downstream plugins can use OKF-compatible concept documents for curated knowledge while storing raw traces, labels, eval packets, and training exports as linked local artifacts.
- [x] Define permissioned surface-contribution policy for desktop, CLI, MCP, and command-server exposure.
- [x] Define plugin manifest shape and first Exo API version policy.
- [x] Add metadata-only local plugin manifest discovery and validation for `exo.plugin.json`.
- [x] Add a duplicate-safe plugin registry for discovered plugin manifests and declared capabilities.
- [x] Define initial plugin discovery sources and trust states: built-in, dev, user, workspace; trusted, untrusted, disabled.
- [x] Keep first-pass plugin manifests non-executable: no entrypoint loading, permission grants, UI contributions, CLI commands, or MCP tools.
- [x] Add metadata-only plugin permission grant/revocation state and policy helpers that distinguish requested permissions from active grants.
- [x] Add architecture/harness checks that discourage direct implementation imports outside the provider/harness facade path.
- [x] Define concrete discovery locations for built-in, dev, user, and workspace plugin manifests in the desktop runtime.
- [x] Define concrete install/load directories and lifecycle rules for future executable plugins.
- [x] Convert the current terminal rail into a general tool/plugin dock without moving terminal rendering, scrollback, reconnect, or diagnostics out of core.
- [x] Add renderer surface descriptors for official/local tool actions: terminal launcher, harness launcher, agent config, routines, graph tools, and future plugin panels.
- [x] Add core web viewer open/focus/close endpoints for URL/path/artifact preview; plugin outputs should call those endpoints rather than require a special WebView plugin API.
- [x] Add first-pass onboarding capability review for official/local plugins after workspace selection: core locked rows, QMD/search provider rows, agent harness readiness rows, and local/profile/routine inventory from the existing Plugin Inventory API; web viewer remains core.
- [ ] Add a future onboarding apply flow for profile/plugin recommendations after trust prompts and permission grants exist.
- [ ] Add trust prompts and permission prompt UX before any plugin entrypoint execution.
- [x] Add the first read-only Plugin Manager UI after manifests, trust, and permissions survived the metadata-only pass.
- [x] Add Plugin Manager mutation flows for metadata-only local/developer plugins: trust, enable, and disable.
- [x] Add plugin-owned settings/config core contracts after the metadata-only enablement path.
- [x] Add plugin-owned settings/config UI after the core settings contract has enough real plugin configuration to validate.

## Later: Graph, Memory, Workcells, Training

- [ ] Add graph/memory view combining backlinks, Markdown links, note structure, and QMD-derived relationships.
- [ ] Add scoped graph views by note root, project root, task, or agent session.
- [ ] Add durable memory, trace archive, retrieval/index, and working-memory assembly as separate layers.
- [ ] Support adding non-Claude/non-Codex terminal agents, including local/open-source agents.
- [ ] Add workcell model for bounded research/development loops.
- [x] Define first-pass run, artifact, trace, and evaluation result primitives that plugins can build on.
- [ ] Add supervised activity/plugin-run surfaces with artifacts, metrics, logs, and replay.
- [ ] Add eval hooks for retrieval quality, memory usefulness, agent recovery, and operator acceptance.
- [ ] Keep training data explicitly scoped by project, workcell, agent, artifact type, review status, and time window.
- [ ] Explore local-agent training workflows once Exo has stable workcells, memory, and evals.

## Later: Plugin Architecture

- [x] Define plugin manifest shape and version policy.
- [x] Define plugin install/load locations.
- [x] Define plugin extension depths: app plugins, surface plugins, capability plugins, and routine/template plugins.
- [ ] Define safe renderer panel extension points and core web viewer endpoint usage for plugin-produced local apps/artifacts.
- [ ] Define command registration API.
- [x] Define settings API for plugin-owned state.
- [x] Define agent harness adapter API for Claude, Codex, Pi, Aider, Goose, OpenCode, and local/open-source agents.
- [ ] Decide how plugins can add MCP tools or CLI commands under explicit permissions.
- [x] Define initial capability permissions for workspace/notes/project reads and writes, terminal/agent launch, network access, artifact writes, scoped grants, and propose-vs-write metadata.
- [x] Define search provider, trace collector, eval runner, exporter, and routine-template extension points.
- [ ] Decide whether the current branch-family file convention remains core or moves behind a plugin boundary.
- [ ] Keep optional personal/domain workflows out of core until the plugin boundary exists.

## Later: Self-Modifying Exo

- [ ] Define a supervised self-modification workflow: branch, change, run harness, summarize evidence, and prepare PR or local diff.
- [ ] Add policy gates for git writes, PR creation, dependency/security updates, and auto-merge eligibility.
- [ ] Connect self-modification to provenance, audit logs, workcells, and harness results.
- [ ] Let maintenance workflows be implemented as plugins on top of core git, harness, provenance, and policy primitives.

## Developer Harness

- [x] Configure the scheduled Codex GitHub issue-fix loop: poll only issues labeled `codex-loop` and `ready-for-codex`, fix at most one issue per run in an isolated worktree/branch, run focused tests and app QA, and open a draft PR instead of pushing to `main`.
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
