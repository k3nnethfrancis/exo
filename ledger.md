# Exo Ledger

Last updated: 2026-07-03

This is the fastest current-state handoff for Exo. It records what exists now, what changed recently, and what is next. Active bugs and QA findings live in root `issues.md`; active tasks live in `tasks.md`; future systems live in `roadmap.md`; product/system strategy lives in `docs/strategy.md`.

## Current Handoff

- Root `issues.md` is now the canonical Exo bug, QA, and field-report tracker. The old `docs/issues.md` path was moved; the vault dogfooding note should be treated as intake/history only.
- The current ship path is documented at the top of `roadmap.md` and mirrored as concrete checklist items in `tasks.md`.
- The near-term focus remains Plugin Architecture Completion: staged profile apply, permission/trust prompts, deeper Plugin Manager/profile management, local plugin setup, harness adapter cleanup, project knowledge sync, and keeping GA/Shoshin-specific behavior out of OSS core.
- After the next plugin slice, run an explicit QA block across Plugin Manager, onboarding plugin review, QMD/search readiness, and harness launch/readiness states.
- In parallel, keep clearing root `issues.md` daily-use blockers: terminal/preview interaction, editor/graph UX, explorer polish, settings/profile/plugin UI, install/onboarding, and dev launch.
- CLI/MCP readiness is the next major non-plugin track: reliable `workspace_status`, preview/artifact open through the core web viewer endpoint, NDE-style MCP testing, stale command-server diagnostics, and the conservative scheduled Codex issue-fix loop.
- Routine work should remain a POC until the plugin/CLI/MCP ship path is stable. The GitHub issue-fix loop is the first routine-like proof, not a reason to move rich workflow schemas into core.

## Recent Progress

- Terminal V4.1 geometry convergence landed: renderer-recorded geometry drives create/attach/reconnect/restore; diagnostics expose renderer/tmux/client divergence and divergence age; `exo terminals resync <id>` uses the same reconnect path as bridge recovery; the plain attach spike was rejected as a product runtime.
- Plugin architecture slices landed: namespaced core capability kinds, scoped `propose` versus `write` permissions, proposal/review substrate, native proposal review UI, semantic trace metadata, Plugin Manager hardening, and first structural guardrails in `pnpm check:repo`.
- Harness architecture moved forward: terminal sessions now carry substrate identity plus public `harnessId`; Codex readiness/semantic-send/MCP launch augmentation moved behind the built-in harness contract; CLI/MCP/app agent creation now validates registered, enabled, surface-approved, launchable harness ids through the command server.
- Pi-compatible harness configuration is persisted through workspace settings and projected to the existing Pi adapter vocabulary, with environment overrides still winning for operator/developer use.
- Index settings now explain pending embeddings and only mention Apply when structural workspace/index changes actually require Apply.

## Current Open Architecture Questions

- Whether to keep the current closed/namespaced `CapabilityKind` allowlist through first public plugin work, or adopt Fable's open/inert unknown kind model before external plugin authors exist.
- Whether the proposal apply host must switch from `gray-matter` frontmatter rewrite to a comment/key-order-preserving YAML AST before P3 can be called complete.
- Whether semantic trace work needs a fake-harness plus Claude-adapter consumer and `exo traces read` before it is more than a contract.
- How profile apply should stage plugin enables, grants, skills, routines, settings, and AI-generated profile changes without turning profile selection into silent writes.

## Product Thesis

Exo is a local-first exograph workspace for humans and terminal agents.

The exograph is a user-defined knowledge/work graph grounded in Markdown notes, project context, terminal sessions, agent messages, changed files, artifacts, workflow runs, and provenance. Humans and agents should be able to read, write, search, coordinate, and develop from that graph.

Research IDE, note-taking system, agent control room, code-review surface, and training workspace are all valid Exo use cases. They are not the category. The category is the exograph workspace.

## Current Shipped Surface

- Electron desktop shell with sidebar/explorer, editor, and terminal dock.
- Markdown live-preview editor with properties/frontmatter, links, tags, backlinks, branch families, code blocks, horizontal rules, foldable lists, and table widgets.
- Project-file editor path with CodeMirror support for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell.
- JSON linting in code-file editor mode.
- Explicit note roots and project roots.
- Explorer search mode with fast note filename/path results, snippets, and hover previews.
- Optional QMD-backed notes index with lexical, semantic, and hybrid modes.
- Index status pill in the footer and Index settings panel with `Sync index`.
- CLI notes-index routes for status, search, read, sync, update, and embed flows through the running Exo command server. MCP exposes the narrower agent-facing search/read primitives plus index summary in `workspace_status`.
- Claude, Codex, and shell terminal launchers.
- Tmux-backed Claude/Codex/shell sessions supervised by Exo, with the current embedded terminal path attached through Exo's tmux control-mode bridge.
- Terminal reload hydration from bounded main-process tails plus startup reattach for persisted tmux sessions.
- Disk-backed terminal transcripts with retention policy.
- Terminal scroll hardening and file-drop path handling.
- Runtime command server discovered through `${workspace_root}/.exo/server.json`.
- `bin/exo` CLI for runtime, workspace, terminal, and agent operations.
- Exo MCP bridge exposing live terminal agents.
- MCP autostart and `exo integrations doctor|config|install|test`.
- `pnpm check` canonical harness used by CI.

## Current Intentional Limits

- The current phase is usability/harness readiness, not new platform expansion: finish the installed-app standard, clean up commits, push, run packaged Exo as the stable runtime, then bug bash from daily use before resuming larger roadmap phases.
- Live Explore typing remains fast note filename/path search.
- Optional indexed Explore search runs explicitly on Enter when QMD lexical search is enabled.
- QMD-backed semantic/hybrid indexing can be compute-heavy; note-save refreshes are collection-scoped and defer embeddings.
- Project roots are explicit attachments; Exo does not auto-load every workspace project folder.
- Exo does not yet track authorship/provenance for agent-authored writes.
- Exo does not yet have durable agent-to-agent communication beyond terminal/CLI/MCP control.
- Agent context comparison is heuristic: Exo surfaces obvious duplicates, package-manager mismatches, and broad global/local coverage reminders.
- The unified agent context composer writes provider-compatible files for a selected scope, preserving manual content outside Exo-managed blocks and keeping restoreable history for Exo-managed instruction bodies.
- Provider instruction files are now adapter-backed internally, but users cannot yet configure adapters from Settings.
- Exo runtime overlays are generated under `.exo/instructions/` and previewed in Settings; they are not inserted into user-authored provider context files.
- Exo-launched terminal agents receive the matching overlay path through `EXO_INSTRUCTIONS` plus scope/label env vars.
- Codex startup sends are readiness-gated: submitted task text queues during startup/trust interstitials and flushes only after normal chat input is ready, while raw input remains available for answering prompts.
- The immediate proving loop is Exo-on-Exo: use Exo-managed agents for bounded Exo work, then prioritize the reliability, coordination, review, and graph primitives that make that loop usable.

## Recent Completed Work

- Added first-pass onboarding capability review after notes/workspace configuration: setup now saves workspace defaults, shows core locked capabilities plus optional official/local plugin inventory from the existing Plugin Inventory API, highlights QMD/search and agent harness readiness, and lets users enter the workspace without applying profiles, executing plugins, or granting permissions.
- Added the first typed tool surface descriptor layer for the desktop right rail/tool dock: core now describes terminal dock toggles, core terminal launch, official harness launchers, Agent Config, Plugin Manager, side-pane controls, and future routine-template/graph-visualization tool targets, while the renderer maps descriptors to existing icons and callbacks without moving terminal runtime/rendering into plugins.
- Added Plugin Config v0 desktop editing in the Plugin Manager: trusted/enabled local manifest plugins can read, edit, apply, and reset metadata-declared settings through Exo-rendered controls, while core/official rows and untrusted/disabled plugins remain non-editable and plugin code is still never executed for settings UI.
- Added Plugin Enablement v0 in the desktop Plugin Manager: local/developer metadata plugin manifests can now be trusted, enabled, and disabled with state persisted under the Exo runtime root, while core/official plugin rows remain read-only and manifest discovery remains non-executable.
- Added Plugin Config v0 core contracts: plugin manifests can declare typed metadata-only settings schemas, Exo persists JSON-backed local overrides in `plugin-settings.json`, validates effective settings, preserves config across manifest edits while requiring review, and exposes settings summaries in plugin inventory. Desktop editing UI is still a follow-up.
- Fixed harness inference configuration readiness: Pi is now a generic Pi-compatible harness instance with local executable/repo/backend config, launch is blocked with a missing inference-backend status until `EXO_PI_BACKEND_URL` or `EXO_PI_BACKEND_COMMAND` is configured, Agent Config Editor separates enabled/launch/dependency status, and Hermes is hidden from normal harness lists unless explicitly configured.
- Ran a context-evolution pass after the terminal/cmux/harness discussions: updated repo guidance away from stale node-pty attach-bridge language, captured the current terminal simplification question, reframed vanilla Exo as core plus bundled/recommended plugins, and clarified that local forks such as GA Pi are configured instances of generic harness plugins rather than OSS source defaults.
- Added metadata-only local plugin manifests in `@exo/core`: `exo.plugin.json` discovery, strict manifest validation, source/trust metadata, duplicate-safe plugin/capability registration, and tests. This does not execute plugin code or grant plugin permissions.
- Fixed markdown editor QoL regressions: clean-file refreshes now restore cursor selection instead of jumping to the top, live-preview bullets/numbered lists and task lists continue on Enter, empty list/task items exit cleanly, cursor filtering avoids hidden list-marker positions, and Tab/Enter exits `[[wikilinks]]` to a following space for continued inline typing.
- Added an Exo-owned wikilink suggestion popup in the editor: typing inside `[[...]]` searches existing note targets, shows at most three matches, hides when no existing note matches, and Enter accepts the first result.
- Tightened terminal resize handoff after split-pane Claude Code prompt rendering artifacts: xterm fitting and tmux/node-pty resize IPC now converge within one animation frame, with the broader terminal rendering issue kept open for daily-use validation.
- Made `exo` and `exo start` the end-user launcher for the resident packaged app, changed MCP autostart defaults to `exo start`, and left `exo dev` as a deprecated source-QA shortcut that runs the isolated `pnpm dev:qa` profile.
- Added the first routine-template bridge for plugins: `routineTemplate` capabilities can now carry typed template metadata, and Exo core can instantiate those templates into concrete user/workspace Routine definitions with explicit scope, permissions, trigger, and output policy.
- Added the first Routine CLI MVP: `exo routines templates`, `exo routines list`, `exo routines create`, explicit `exo routines run --dry-run`, and run/artifact inspection operate through a core `RoutineService` and the `.exo/routines` / `.exo/runs` store without launching agents yet. Added a bundled dev `graph-health.template` routine plugin manifest for dogfooding metadata discovery.
- Added first app-backed Routine execution handoff: `exo routines run --agent` creates an Exo-managed shell/Claude/Codex terminal through the running app, sends the routine prompt semantically, records an agent-session artifact/trace, and marks the run pending review while completion tracking remains future work.
- Added the first permissioned surface policy contract in `@exo/core`: capabilities now distinguish desktop, CLI, MCP, command-server, and internal exposure, with helpers that keep disabled capabilities hidden and make MCP reviewed/agent-facing while command-server exposure stays internal by default.
- Added generic Routine/Run/artifact/trace contracts in `@exo/core`: Routine definitions now model prompt, harness, required skills, trigger, scope, permissions, and output policy; Run records model status, review state, transcripts/logs, artifacts, proposed changes, trace packets, eval results, and errors; harnesses expose skill inventories with a helper for missing required skills.
- Kept Guardian Angel out of Exo core: GA remains a downstream/reference plugin workload that should use generic Exo primitives rather than shipping as built-in OSS product code without explicit approval.
- Moved shell, Claude, and Codex launch planning behind the first `AgentHarness` contract in `@exo/core`: built-in harnesses now expose capability metadata and resolve launcher configs while `runtime.ts` remains the compatibility facade used by terminal manager, CLI, and MCP.
- Moved QMD behind the first `SearchProvider` contract in `@exo/core`: the QMD implementation now lives as a provider with capability metadata while `qmd.ts` remains a compatibility facade for existing desktop, CLI, MCP, and command-server callers.
- Added the first internal plugin-architecture primitive in `@exo/core`: typed capability metadata, a duplicate-safe registry, bundled QMD search-provider metadata, bundled shell/Claude/Codex agent-harness metadata, and focused registry tests without changing runtime behavior.
- Began the terminal runtime refactor for `EXO-ISSUE-030`: terminal creation now launches durable shell/agent commands inside Exo-owned tmux sessions, the current embedded path attaches through Exo's tmux control-mode bridge, terminal kill explicitly terminates tmux, and diagnostics expose tmux runtime/session/bridge state without adding a user-facing transport switch.
- Added `.exo/terminal-sessions.json` as the initial Exo-to-tmux registry and startup reattach path for live tmux panes, with focused unit coverage and Electron relaunch QA proving a shell accepts input after Exo closes and relaunches.
- Added deterministic terminal-quality QA: fake agent fixture, p50/p90 shell input latency measurement, no-live-inference fake-agent e2e, and fixture cleanup for tmux-backed Electron tests.
- Verified the pure local install workflow on 2026-05-31: `/Applications/Exo.app` launches as the stable resident runtime, the menu bar icon is visible, normal `exo status` resolves to the installed runtime, and `pnpm dev:qa` can run concurrently against `.exo-dev/` without clobbering stable command-server discovery.
- Added `docs/usability-readiness.md` as the near-term gate for installed daily use, commit cleanup/push, live bug bash, and the later roadmap handoff.
- Added the first local macOS installed-app path for Exo-on-Exo use: `scripts/install-mac-app` / `pnpm install:mac-app` builds and installs unsigned `Exo.app`, while `pnpm dev:qa` runs source QA against isolated `.exo-dev/` runtime and user-data paths.
- Completed the first cleanup/refactor pass toward a more modular desktop architecture: main-process domain services now own app lifecycle, indexing, workspace notes, project review, agent instructions, and workspace settings orchestration; renderer tree/project-review/settings helpers have first-class modules and hooks.
- Extracted open-document/editor state from `App.tsx` into `useOpenDocuments`, covering document cache, dirty/save status, external refresh, scroll restore, knowledge/branch-family caches, branch creation, and path remapping.
- Extracted terminal renderer session state from `App.tsx` into `useTerminalSessions`, covering active terminal selection, hydration snapshots, created/data/exit listeners, polling sync, agent annotations, and kill/create session bookkeeping.
- Extracted workspace bootstrap and onboarding state from `App.tsx` into `useWorkspaceBootstrap`, keeping app-layout restore callbacks in the shell while moving setup, workspace switching, and initial model/tree/terminal loading into a focused hook.
- Extracted workspace settings controller state from `App.tsx` into `useWorkspaceSettingsController`, covering settings dialog drafts, autosave, structural Apply, folder picking, index jobs, and index-sync UI state.
- Extracted workspace path mutation state from `App.tsx` into `useWorkspaceMutations`, covering create/rename/delete/move dialogs and filesystem mutations while keeping editor pane remap/delete callbacks in the shell.
- Extracted pane drop orchestration from `App.tsx` into `usePaneDropOrchestration`, covering explorer drops plus document, terminal, and browser pane moves/splits through the existing drag manager.
- Extracted terminal pane orchestration from `App.tsx` into `useTerminalPaneController`, covering terminal create/attach/focus/close behavior while keeping terminal process state in `useTerminalSessions`.
- Extracted command-server workspace listeners and global keyboard shortcuts from `App.tsx` into focused hooks, with e2e coverage for save and daily-note shortcuts.
- Extracted workspace layout persistence from `App.tsx` into `useWorkspaceLayoutPersistence`, preserving debounced layout saves and reload coverage while reducing the shell to composition.
- Added a typed desktop IPC contract shared by main, preload, and renderer-facing API code so channel names, argument lists, and return types cannot silently drift.
- Repaired the Electron e2e launch harness by running the large shell spec in parallel under a capped worker count, then verified the full desktop e2e suite passes.
- Fixed two QA findings from the full e2e pass: external clean-file refresh now preserves editor scroll through CodeMirror refresh timing, and editor/terminal tab strips share a stable 40px chrome height in mixed pane graphs.
- Refactored runtime/main-process responsibilities into settings, workspace watcher, terminal IPC, transcript retention, and shared command protocol layers.
- Hardened search request handling and open-document polling against stale async failures.
- Made core workspace defaults portable and attached the Exo repo as the first default project root.
- Added project-file editing modes and JSON linting.
- Added explorer search pane and removed search from the top bar.
- Added MCP setup/install helpers through `exo integrations`.
- Added canonical `pnpm check` harness and CI alignment.
- Rewrote README around shared-exocortex / agentic-development positioning.
- Rewrote `AGENTS.md`, `docs/strategy.md`, `tasks.md`, and `roadmap.md` to remove stale phase-first framing.
- Completed first-time setup hardening on a fresh machine: pnpm build-script allowlist, portable workspace defaults, note-root creation, renderer crash fix, settings scroll/Apply behavior, and empty folder display.
- Added Exo-managed QMD indexing UX: footer status, Settings Index panel, sync/apply flows, Explore lexical-on-Enter, CLI/MCP parity, and conservative save-triggered refreshes.
- Added `docs/qmd-integration-notes.md` to track the QMD adapter boundary, current workarounds, and upstream upgrade checklist.
- Merged the fresh-setup/QMD integration PR as `0.1.0-alpha.1`, including QMD docid read safety, multi-root hybrid search, long-running index command timeouts, workspace-root command-server refresh, and an active root `postinstall` script.
- Simplified terminal history controls around explicit live scrollback policies, then moved terminal scrollback to numeric line settings that also size tmux history; transcripts remain the durable full-history path.
- Removed hidden terminal transcript byte caps and hidden character-based buffer trimming; live terminal buffers follow workspace settings.
- Hardened terminal rendering against xterm device-response input leaks and avoided recurring tmux snapshot replay into visible terminals.
- Made Markdown task checkboxes clickable in live preview by toggling the underlying `- [ ]` / `- [x]` source text.
- Hardened CLI/MCP indexed search for full-vault QMD use by giving search a dedicated 30s default timeout, preserving fast normal request timeouts, and adding structured timeout errors plus regression coverage.
- Verified a fresh Exo-hosted Codex session can call Exo MCP `search` and `index_status` against the 1155-document lab notes index without timing out.
- Added workspace-layout persistence for editor/terminal pane trees, side-pane placement, split ratios, sidebar width, and inspector/terminal collapsed state, with guarded settings normalization and e2e coverage for terminal panes restored in the editor canvas after reload.
- Completed the first shared file/terminal pane graph behavior: canvas terminal leaves now accept document/file edge drops to split the main workspace graph, while the separate terminal dock still rejects document drops.
- Broadened workspace pane regression coverage for canvas terminal streaming and pruning after closing the last workspace terminal session.
- Hardened the repo-backed `exo` launcher and local installer against stale Corepack package-manager signature metadata by defaulting `COREPACK_ENABLE_PROJECT_SPEC=0` for Exo-managed pnpm invocations.
- Aligned terminal pane tab chrome with editor panes by using the same 40px strip rhythm in dock and canvas placements, and added e2e geometry coverage for canvas terminal headers.
- Documented the mixed file/terminal tab-group migration path: typed tabs inside one pane leaf, shared chrome above typed bodies, and terminal process lifecycle kept separate from pane layout persistence.
- Added live project-root management through the command server, CLI, and MCP: list attached roots, attach explicit project folders, and detach folders without deleting files.
- Added a first changed-files review surface in the Projects drawer by parsing `git status --porcelain` for each attached project root and linking changed files directly into the editor.
- Linked changed project files to live terminal sessions whose cwd is inside the same attached project root, with a jump affordance from the Changes list back to the associated terminal.
- Scoped external-file refresh scroll preservation to the editor pane showing the refreshed path, and added e2e coverage for clean refreshes, scroll retention, and unsaved-document protection during external writes.
- Added the reverse project-review affordance: active terminal panes now show associated changed files for their cwd-linked session and can jump directly back into the editor.
- Added first changed-line targeting by deriving tracked-file hunk starts from `git diff --unified=0 HEAD -- .`, showing line chips in review surfaces, and scrolling/selecting the editor line when opening a changed file.
- Added a first workspace browser pane backed by Electron `webview`: users can open a preview pane from the rail, enter local URLs, keep it in the shared split graph, and persist browser leaves in workspace layout settings.
- Added the first agent context manager surface in Workspace Settings: Exo lists global, note-root, and project-root `AGENTS.md` / `CLAUDE.md` files, lets users inspect existing or new files, and saves edits through a constrained IPC route.
- Added a conservative provenance foundation: workspace file-change events are recorded as observed write candidates for the most-specific live terminal cwd, then review badges prefer observed associations over broad cwd matching without claiming certain authorship.
- Polished the agent context manager with global/local comparison signals for duplicated instructions, package-manager conflicts, and global coverage, plus an Exo snippet insertion action for CLI/MCP guidance.
- Added a unified agent instruction composer in Workspace Settings so users can choose a global/note/project scope once, write one agent-agnostic instruction body, and let Exo keep `AGENTS.md`, `CLAUDE.md`, and future provider files aligned through an explained managed block.
- Hardened agent context writes to preserve manual file content outside the Exo-managed block and round-trip existing managed content back into the unified composer.
- Added agent context history under `.exo/agent-context-history/`: second and later changes record previous/current unified bodies, Settings can show a simple diff, and Restore previous writes the prior body back through all provider-compatible files for the scope.
- Moved agent context provider outputs behind a file-adapter registry: `AGENTS.md` and `CLAUDE.md` are defaults, and tests inject a `soul.md` adapter to prove future provider instruction files use the same compose/save/history path.
- Added generated Exo runtime overlays under `.exo/instructions/` for global, notes, and project scopes, with read-only Settings preview and e2e coverage that provider context files stay free of dynamic workspace facts.
- Added the runtime overlay launcher bridge: Claude/Codex terminal launches now regenerate overlays, select the most-specific overlay for the launch cwd, and expose it via `EXO_INSTRUCTIONS`.
- Split the agent context UX so Workspace Settings now shows a compact status/entry summary while the full composer, provider-file editor, runtime overlay preview, and history controls live in a dedicated Agent Context Manager.
- Added user-facing instruction output settings in the Agent Context Manager: users can enable/disable provider files and add workspace-scoped outputs such as `soul.md`, with the unified composer writing only enabled outputs.
- Upgraded agent context history browsing from latest-only restore to a per-scope version list with selectable diffs and restore of the selected version.
- Extended the Agent Context Manager beyond instruction files with a managed-config surface for global provider configs and workspace/root `.mcp.json` files, including constrained read/write IPC and e2e coverage for project MCP config edits.
- Added a schema-aware `.mcp.json` editor for managed MCP configs: users can edit server name, command, args, and env fields through controls while Exo writes normalized MCP JSON.
- Fixed EXO-ISSUE-004 by adding Codex readiness/queue semantics around Exo agent sends, including regression coverage for trust prompts, startup grace flushing, and raw interstitial input.
- Fixed EXO-ISSUE-009 by handling `exo agents create --help` and `exo agents create <provider> --help` before app connection or terminal creation, plus rejecting option-shaped create cwd values.
- Fixed EXO-ISSUE-010 by changing the Exo MCP launcher to import a bundled CommonJS runtime artifact, avoid rebuilding when `dist/index.cjs` already exists, and fall back with Corepack project-spec disabled; added a stdio launcher handshake regression and live Codex smoke.
- Fixed EXO-ISSUE-011 by splitting queued Codex submitted messages into body plus delayed Enter so Codex startup prompts execute without a second raw submit.
- Fixed EXO-ISSUE-012 by applying user-configured live terminal scrollback to renderer/main buffers while preserving complete transcript writes for reattached or actively streaming Codex sessions.
- Revisited the direct-pty-only terminal decision after real-world sleep/relaunch failures and moved daily Exo terminals back to one tmux-backed product path with `node-pty` as the attach bridge.
- Added the resident-runtime roadmap: Exo should keep process-owned services alive while the window is hidden, with menu bar controls as the first runtime control surface.
- Began current-package domain-module cleanup by extracting Electron window/tray/renderer-recovery ownership from `apps/desktop/src/main/index.ts` into `app-lifecycle.ts`.
- Continued main-process cleanup by extracting indexing timers, job metrics, sync/refresh scheduling, and indexed-root mutations into `indexing-service.ts`.
- Added the first resident runtime behavior: closing the workspace window hides it while process-owned services continue, `exo show` can reopen it, and explicit Quit warns before stopping live terminals.
- Added the macOS menu bar runtime controller with Show Exo, Settings, command-server status/restart, live terminal count, and explicit Quit.
- Added hidden-window CLI/MCP app QA coverage: with the workspace window hidden, `bin/exo` can status/list/create/send/read live agents and MCP stdio tools can list/create/send/read the same running Exo agent surface.
- Pruned MCP from 14 tools to the narrow 9-tool agent work plane, moved index/project-root administration to CLI/UI only, and deprecated `exo agents message/tell` in favor of `exo agents send`.
- Updated the roadmap around Obsidian CLI and LM Wiki lessons: CLI stays broad for operator/admin/debug and future note/graph maintenance; MCP stays compact for agent work; QMD remains the default local search provider behind a future provider-neutral search contract.
- Recentered roadmap/context around Exo as an exograph workspace and around Exo-on-Exo useability before broad platform expansion.
- Started cleanup-plan doc sync by removing stale tmux prerequisite language and documenting that current open QA includes the e2e launch harness and broader terminal bug-bash.
- Clarified the plugin architecture handoff: Exo core owns baseline workstation substrate, terminal, web viewer, scheduler, command server, settings, plugin registry/trust, and core graph data; plugins own replaceable capabilities such as harness adapters, QMD/other search providers, graph visualizations, analyzers, exporters, eval runners, dashboards, and routine templates.
- Added the plugin/profile distinction to durable context: a plugin is a replaceable capability; a profile is an opinionated bundle of recommended plugins, metadata/frontmatter conventions, context templates, AGENTS/CLAUDE templates, MCP config, skills, routine templates, graph views, analyzer settings, and review/output policies. Profiles may depend on plugins, but executable behavior should live in explicit plugin capabilities.
- Next plugin implementation resume point: complete the profile/apply and plugin-management path on top of the Plugin Manager foundation. Defer arbitrary executable plugin loading, native component plugins, and broad plugin-contributed surfaces until manifests/trust/permissions survive real use.
- Proposed background product-quality loop: a scheduled Codex automation can poll GitHub issues labeled `codex-loop` and `ready-for-codex`, take at most one actionable issue per run, fix in an isolated worktree/branch, run focused tests and app QA, then open a draft PR instead of pushing directly to `main`.

## Next Priorities

1. Use installed Exo as the default environment for daily work and record every friction point as live bug-bash input.
2. Stand up the GitHub issue-fix loop with conservative labels, isolated worktrees, test/app-QA requirements, and draft PR output.
3. Resume plugin architecture with profile apply, permission grants, plugin-owned settings, project knowledge sync, and remaining harness compatibility cleanup.
4. Define the profile manifest extension, graph-data API, graph visualization surface contract, and first semantic trace consumer.
5. Continue multi-agent coordination: roster, objectives, direct messages, changed-file/review links, file+SQLite transport, CLI/MCP access.
6. Exograph architecture: write the profile/schema/proposal spec, add read-only graph/document context primitives, then add scoped maintainer writes.

## Operating Rules

- Keep README, AGENTS, architecture, roadmap, tasks, ledger, and MCP docs aligned when changing product behavior or public interfaces.
- Use `tasks.md` for active tasks and `roadmap.md` for future systems.
- Do not put private local paths in source defaults.
- Do not infer provenance with AI detection; track it through observable workflows.
- Keep QMD focused on notes unless project indexing is explicitly designed later.
- Keep QMD integration behind `packages/core/src/qmd.ts`; document workarounds in `docs/qmd-integration-notes.md`.
- Keep search provider-neutral at the product/API boundary: QMD is the default local provider, not the only possible retrieval backend.
- Keep CLI broad for operator/admin/debug workflows and MCP narrow for agent work-plane tools.
- Keep Exo-on-Exo as the default proving loop; do not add broad platform features if notes, terminals, agent coordination, or review surfaces are blocking real use.

## Validation

Broad gate:

```bash
pnpm check
```

Focused UI/runtime gate:

```bash
npx playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/shell.spec.ts
```
