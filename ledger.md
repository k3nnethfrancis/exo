# Exo Ledger

Last updated: 2026-05-30

This is the fastest current-state handoff for Exo. It records what exists now, what changed recently, and what is next. Active tasks live in `docs/tasks.md`; future systems live in `docs/roadmap.md`; product/system strategy lives in `docs/strategy.md`.

## Product Thesis

Exo is a local-first agentic development environment built around a shared exocortex for humans and terminal agents.

The shared exocortex is grounded in Markdown notes and project context. Humans and agents should be able to read, write, search, coordinate, and develop from the same knowledge graph.

Research IDE, note-taking system, agent control room, code-review surface, and training workspace are all valid Exo use cases. They are not the category. The category is shared exocortex for agentic development.

## Current Shipped Surface

- Electron desktop shell with sidebar/explorer, editor, and terminal dock.
- Markdown live-preview editor with properties/frontmatter, links, tags, backlinks, branch families, code blocks, horizontal rules, foldable lists, and table widgets.
- Project-file editor path with CodeMirror support for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell.
- JSON linting in code-file editor mode.
- Explicit note roots and project roots.
- Explorer search mode with fast note filename/path results, snippets, and hover previews.
- Optional QMD-backed notes index with lexical, semantic, and hybrid modes.
- Index status pill in the footer and Index settings panel with `Sync index`.
- CLI and MCP notes-index routes for status, search, read, sync, update, and embed flows through the running Exo command server.
- Claude, Codex, and shell terminal launchers.
- Direct pty Claude/Codex/shell sessions supervised by Exo.
- Terminal reload hydration from bounded main-process tails.
- Disk-backed terminal transcripts with retention policy.
- Terminal scroll hardening and file-drop path handling.
- Runtime command server discovered through `${workspace_root}/.exo/server.json`.
- `bin/exo` CLI for runtime, workspace, terminal, and agent operations.
- Exo MCP bridge exposing live terminal agents.
- MCP autostart and `exo integrations doctor|config|install|test`.
- `pnpm check` canonical harness used by CI.

## Current Intentional Limits

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

## Recent Completed Work

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
- Rewrote `AGENTS.md`, `docs/strategy.md`, `docs/tasks.md`, and `docs/roadmap.md` to remove stale phase-first framing.
- Completed first-time setup hardening on a fresh machine: pnpm build-script allowlist, portable workspace defaults, note-root creation, renderer crash fix, settings scroll/Apply behavior, and empty folder display.
- Added Exo-managed QMD indexing UX: footer status, Settings Index panel, sync/apply flows, Explore lexical-on-Enter, CLI/MCP parity, and conservative save-triggered refreshes.
- Added `docs/qmd-integration-notes.md` to track the QMD adapter boundary, current workarounds, and upstream upgrade checklist.
- Merged the fresh-setup/QMD integration PR as `0.1.0-alpha.1`, including QMD docid read safety, multi-root hybrid search, long-running index command timeouts, workspace-root command-server refresh, and an active root `postinstall` script.
- Simplified terminal history controls around explicit `full` and `custom` modes: `full` uses Exo's maximum configured live scrollback line window, transcripts default to forever, and direct pty sessions keep durable history in disk-backed transcripts.
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
- Removed tmux from the core terminal runtime, standardized live terminal reads around bounded tails plus disk transcripts, and documented the direct-pty runtime decision.
- Added the resident-runtime roadmap: Exo should keep process-owned services alive while the window is hidden, with menu bar controls as the next feature phase.
- Began current-package domain-module cleanup by extracting Electron window/tray/renderer-recovery ownership from `apps/desktop/src/main/index.ts` into `app-lifecycle.ts`.
- Continued main-process cleanup by extracting indexing timers, job metrics, sync/refresh scheduling, and indexed-root mutations into `indexing-service.ts`.
- Added the first resident runtime behavior: closing the workspace window hides it while process-owned services continue, `exo show` can reopen it, and explicit Quit warns before stopping live terminals.
- Started cleanup-plan doc sync by removing stale tmux prerequisite language and documenting that current open QA includes the e2e launch harness and broader terminal bug-bash.

## Next Priorities

1. Push `0.1.0-alpha.2` tester-readiness fixes to main.
2. Continue current-package domain-module cleanup: workspace notes/search service, project review service, agent-instructions service, workspace settings service, typed desktop IPC contract, and renderer state-machine hooks.
3. Runtime lifecycle/menu bar: finish menu bar status/actions and hidden-window CLI/MCP QA on top of the cleaned service boundaries.
4. Authorship/provenance: promote observed write candidates into explicit human vs agent review states only when Exo controls the write path or receives a trusted session event.
5. Multi-agent coordination: roster, objectives, direct messages, file+SQLite transport, CLI/MCP access.
6. QMD notes index: improve performance, add true incremental file-level updates when QMD exposes them, and refine triggers/profiles.

## Operating Rules

- Keep README, AGENTS, architecture, roadmap, tasks, ledger, and MCP docs aligned when changing product behavior or public interfaces.
- Use `docs/tasks.md` for active tasks and `docs/roadmap.md` for future systems.
- Do not put private local paths in source defaults.
- Do not infer provenance with AI detection; track it through observable workflows.
- Keep QMD focused on notes unless project indexing is explicitly designed later.
- Keep QMD integration behind `packages/core/src/qmd.ts`; document workarounds in `docs/qmd-integration-notes.md`.
- Use CLI/MCP as canonical agent-facing control surfaces.

## Validation

Broad gate:

```bash
pnpm check
```

Focused UI/runtime gate:

```bash
npx playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/shell.spec.ts
```
