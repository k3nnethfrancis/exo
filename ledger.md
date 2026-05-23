# Exo Ledger

Last updated: 2026-05-23

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
- Tmux-backed Claude/Codex sessions supervised by Exo.
- Terminal reload hydration from main-process buffers.
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
- Terminal panes cannot yet move into the editor canvas.
- Exo does not yet track authorship/provenance for agent-authored writes.
- Exo does not yet have durable agent-to-agent communication beyond terminal/CLI/MCP control.
- Exo does not yet manage global/local `AGENTS.md` / `CLAUDE.md` context files.

## Recent Completed Work

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
- Simplified terminal history controls around explicit `full` and `custom` modes: `full` keeps Exo buffers untrimmed, transcripts default to forever, tmux/xterm use the configured line window, and restored tmux-backed agents seed visible scrollback once before returning to live PTY streaming.
- Removed hidden terminal transcript byte caps and renderer-side buffer trimming; terminal history policy now lives in the main terminal manager and workspace settings.
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

## Next Priorities

1. Push `0.1.0-alpha.2` tester-readiness fixes to main.
2. Project roots and code review: CLI/MCP root management plus changed-file review for agent-authored edits.
3. Core WebView/browser pane for local previews, docs, dashboards, and future plugin-hosted apps.
4. Agent context manager: inspect/edit/compare global and local `AGENTS.md` / `CLAUDE.md`.
5. Authorship/provenance: observed human vs agent-written changes by session/task/file.
6. QMD notes index: improve performance, add true incremental file-level updates when QMD exposes them, and refine triggers/profiles.
7. Multi-agent coordination: roster, objectives, direct messages, file+SQLite transport, CLI/MCP access.
8. Graph/memory view: backlinks plus QMD-derived relationships and agent/session context.
9. Plugin architecture: optional workflows and shareable extensions without growing core by default.

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
