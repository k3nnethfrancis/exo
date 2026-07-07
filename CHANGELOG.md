# Changelog

## Unreleased

Plugin architecture, tmux terminal persistence/readiness, packaged onboarding hardening, agent configuration/skills, profile/proposal workflows, and MCP transport compatibility.

### Added

- Adds metadata-only plugin manifests in `@exo/core`: `exo.plugin.json` discovery, strict validation, plugin source/trust metadata, duplicate-safe plugin/capability registration, and tests.
- Adds internal plugin seams for built-in QMD search providers and shell/Claude/Codex agent harnesses, while preserving existing desktop, CLI, MCP, and command-server behavior.
- Adds core Routine, Run, artifact, trace, evaluation-result, routine-store, and manual executor primitives that future routine/template, trace collector, eval runner, and exporter plugins can build on.
- Adds plugin-declared routine templates that can be instantiated into concrete user/workspace Routine definitions without executing plugin code.
- Adds `exo routines` CLI commands for listing plugin templates, creating concrete routines, listing routines, recording explicit dry-run executions, and inspecting run records/artifacts.
- Adds `exo routines run --agent` to create an Exo-managed shell/Claude/Codex terminal through the running app, send the routine prompt, and record the agent-session artifact for review.
- Adds a bundled dev `graph-health.template` routine plugin manifest.
- Adds a permissioned surface policy for desktop, CLI, MCP, command-server, and internal capability exposure.
- Adds optional Streamable HTTP MCP transport for remote-only MCP hosts while keeping stdio as the default local transport.
- Adds tmux-backed terminal persistence with Exo-owned tmux sessions, node-pty attach bridges, session registry reattach, power-resume recovery, reconnect affordances, tmux history sizing, and deterministic terminal QA coverage.
- Adds Agent Config skill inventory/editing, skill file-tree controls, Git-backed skill sources, and provider-independent agent instruction management outside Workspace Settings.
- Adds renderer theme registry support, top-bar Exograph branding, installed-app/menu-bar icon updates, and UI polish for settings, explorer, editor chrome, project Markdown rendering, and Plugin Manager density.
- Adds Plugin Manager and profile settings foundations: plugin inventory/detail views, local plugin directories, enablement state, plugin-owned settings state, readiness filters, profile customize/copy/preview flows, active profile status, and tool-surface descriptors.
- Adds profile/proposal infrastructure for template apply proposals, proposal review contracts, native review/apply UI, recovery manifests, and rollback CLI support.
- Adds semantic trace contracts, trace store hygiene, trace cleanup commands, and Claude/Pi trace capture hooks.
- Adds Project Knowledge Sync profile metadata, terminal monitor mode, `Cmd+T` new-terminal shortcut, stable smoke coverage, and monitor-mode QA coverage.
- Adds staged onboarding profile setup, profile-choice surfacing in settings, agent instruction sync flow foundations, and GitHub-first Exo issue submission skill updates.
- Adds dynamic Exograph agent-context generation that includes active workspace roots, notes/project roots, indexed-search mode guidance, and MCP/CLI surface guidance before applying the managed global instruction block.

### Changed

- Makes bare `exo` and `exo start` the end-user launcher for the resident packaged app, moves MCP autostart defaults from `exo dev` to `exo start`, and leaves `exo dev` as a deprecated source-QA shortcut.
- Reopens and supersedes the alpha.3 direct-pty-only terminal decision: Exo core terminals now use tmux for persistence and sleep/relaunch resilience, with node-pty retained as the live attach/render bridge.
- Makes terminal scrollback a numeric setting and applies it to both renderer/live buffers and tmux history instead of coarse `full` / `custom` labels.
- Stops live terminal hydration from resetting xterm and replaying stale scrollback over active agent output.
- Keeps Guardian Angel out of Exo core. GA is treated as a downstream/reference plugin workload that should use generic Exo plugin primitives.
- Reframes OKF, LM Wiki, Shoshin profiles, feed/scheduler concepts, and routines as optional exograph/plugin architecture directions rather than hardwired folder/schema requirements.
- Splits Workspace Settings from Agent Config and Plugin/Profile configuration so agent instructions, skills, harnesses, plugins, and profile state each have clearer ownership.
- Stages onboarding as workspace basics, plugin choices, agent context, routines, and profile review instead of a single settings-like form; unavailable harnesses are hidden and QMD is treated as an optional search-provider plugin after workspace load.
- Reorders profile onboarding to Plugins -> Routines -> Agent Context -> Skills -> Profile, clarifies Graph Health and Agent Instruction Sync as manual starter routine templates, and keeps skill installation/enabling routed through Agent Config instead of silent harness-folder writes.
- Adds a routine execution-kind contract so current routines are explicitly agent-prompt routines, reserves shell-command routines for future work, and removes shell from prompt-routine default harness choices.
- Removes generated file/folder tree snapshots from managed Exograph agent context; future live directory and index navigation should be handled through explicit scoped tools instead of stale prompt text.
- Simplifies Plugin Manager around optional capability lifecycle: core is summarized as always-on context, core rows are hidden from plugin inventory/category filters, and routine-template rows explain that scheduling/running belongs in a future Routine Manager.
- Documents the onboarding versus Settings ownership boundary and reframes Settings search as core search plus the QMD advanced provider with Plugin Manager as the provider lifecycle surface.
- Treats the default Exograph profile as the baseline product configuration rather than a user-selected preset.
- Routes agent launches by harness id, removes renderer `ManagedAgentKind` residue, and hardens harness descriptors for installed and source runtimes.
- Persists Pi harness configuration, gates Pi launch on backend readiness, and can auto-start the configured Pi backend before launch.
- Clarifies official/local plugin inventory, external contract status rules, public-contract review guardrails, proposal review flow, and core-versus-plugin boundaries in docs and skills.
- Consolidates active Exo trackers to root `issues.md` and `tasks.md`, with docs reserved for durable architecture/product references.
- Moves project change indicators into the explorer tree, reduces folder/editor chrome weight, and keeps project Markdown files on the Markdown renderer path.

### Fixed

- Fixes markdown editor cursor preservation across clean-file refreshes and improves live-preview editing so Enter continues bullets/numbered lists, empty list items exit cleanly, normal cursor navigation and line-boundary selection avoid hidden list markers, and Tab/Enter exits `[[wikilinks]]` without adding whitespace.
- Fixes markdown task-list continuation so Enter from `- [ ]` / `- [x]` creates a new unchecked task item, while empty task items exit cleanly.
- Adds existing-note suggestions while typing `[[wikilinks]]`, capped to three matches, with Enter selecting the first match and no popup when no note matches.
- Fixes wikilink completion edge cases where popups were clipped by the editor surface, completion required repeated Enter presses, and first-line wikilinks prevented inserting a line above them.
- Fixes generated graph references so the read-only backlinks/references section does not inherit list indentation or become an editable cursor target.
- Tightens terminal resize handoff between xterm and the tmux/node-pty bridge to reduce split-pane prompt rendering drift during active Claude/Codex typing.
- Fixes fresh packaged startup when no workspace registry exists by loading the active workspace/onboarding path instead of falling back to `/`.
- Simplifies first-run onboarding so the initial path is notes-folder selection instead of a confusing non-working workspace button.
- Fixes dependency/setup friction from blocked `fast-uri` and package-wide `picomatch` overrides.
- Narrows and then adjusts the default explorer pane width, improves pane-to-terminal focus behavior, and adds terminal bottom inset so terminal status lines are not clipped by the bottom bar.
- Fixes stale/blank managed agent terminal starts and improves Claude/Codex terminal startup handling.
- Fixes Markdown list outdent behavior in the editor.
- Fixes terminal Unicode stream corruption, tmux UTF-8 decoding, parity handling, scrollback bridge behavior, renderer write batching, hydration/replay drift, blank panes after reload, generated-input artifacts, pane identity in monitor mode, runtime registry isolation, and Codex MCP restart coverage.
- Fixes Monitor Mode live terminal additions so new sessions converge on the same balanced split layout used when entering Monitor Mode, avoiding repeated skinny columns.
- Fixes terminal input/render regressions where a broken default user tmux server could make Exo terminals unavailable, stale hydration could mask unhealthy panes as restoring, tab activation could force xterm replay, missing Unicode width rules could corrupt Claude-style TUI glyphs, and xterm custom glyph drawing could corrupt wide TUI lines despite byte-correct tmux tails.
- Fixes preview pane target replacement, preview clipping, and preview-triggered terminal replay/focus regressions.
- Fixes packaged/onboarding startup paths so missing workspace state reaches onboarding before synthetic workspace defaults or terminal transcript initialization.
- Fixes interrupted first-run onboarding so saved workspace settings do not imply profile setup completion and reloads resume setup.
- Fixes plugin manager layout overlap, settings modal spacing, index settings status copy, and stale MCP/integration diagnostics.
- Fixes Electron e2e terminal fixture isolation by running tests against a test-specific tmux server name instead of the developer's active tmux server state.
- Fixes mac packaging collector stalls and documents launch-mode/setup expectations for packaged, installed, source, and MCP contexts.

### Removed

- Removes Guardian Angel-specific capability/code/docs from Exo core after the plugin boundary was clarified.
- Keeps plugin entrypoint execution, Plugin Manager UI, plugin-owned CLI/MCP tools, marketplace/package loading, and permission grants out of this release until the manifest/trust model survives real use.
- Removes the terminal attach-copy header button, agent config tab from Workspace Settings, legacy plugin kind aliases, and renderer-managed harness kind leftovers.

## 0.1.0-alpha.3 - 2026-05-31

Installed-app readiness, direct-pty terminal reliability, Exo-on-Exo harness cleanup, and resident runtime support.

- Makes the packaged macOS app the intended stable daily runtime and adds `./scripts/install-mac-app` / `pnpm install:mac-app` for local unsigned app installation.
- Adds `pnpm dev:qa` so source QA uses isolated `.exo-dev/` runtime and user-data state while installed Exo keeps coordinating notes, agents, CLI, and MCP.
- Adds a resident runtime menu-bar controller: closing the window hides Exo, the process keeps the command server/MCP/watchers/transcripts/live pty agents alive, and explicit Quit warns before stopping live terminals.
- Replaces core tmux terminal runtime paths with direct `node-pty` sessions, disk-backed transcripts, bounded live-tail hydration, terminal health diagnostics, semantic agent-message delivery, and coalesced resize handling.
- Refactors major desktop ownership boundaries out of the shell: app lifecycle, indexing, workspace notes, project review, agent instructions, workspace settings, renderer workspace/bootstrap/settings/mutation/open-document/terminal/pane-layout hooks, and typed desktop IPC.
- Prunes MCP to the narrow agent work plane while keeping CLI as the broader operator/admin/debug surface.
- Simplifies the Agent Config Editor to global and active exocortex instruction layers that align `AGENTS.md` and `CLAUDE.md`.
- Adds and verifies hidden-window CLI/MCP QA, refreshed desktop visual baselines, full desktop e2e coverage, and the usability-readiness standard for installed daily use.
- Installs and verifies `/Applications/Exo.app` as the local stable runtime with a visible macOS menu bar icon; normal `exo status` resolves to the installed runtime while `pnpm dev:qa` can run side-by-side.
- Tracks the remaining CI Node 20 GitHub Actions deprecation warning as `EXO-ISSUE-025`.

## 0.1.0-alpha.2 - 2026-05-17

Tester-readiness hardening for terminal history, Markdown tasks, and agent search.

- Simplifies terminal history behavior around explicit `full` and `custom` modes: `full` keeps Exo buffers untrimmed and transcripts default to forever.
- Removes hidden terminal transcript byte caps and renderer-side terminal buffer trimming.
- Filters xterm device-response sequences so terminal control replies cannot leak into Claude/Codex input.
- Makes rendered Markdown task checkboxes clickable, toggling the underlying `- [ ]` / `- [x]` source text directly.
- Gives CLI and MCP search a dedicated 30s default timeout while keeping normal command-server requests fast, and includes structured timeout errors for search failures.
- Adds regression coverage for terminal scrollback/device responses, clickable task checkboxes, CLI/MCP search timeout behavior, and MCP integration config.

## 0.1.0-alpha.1 - 2026-05-17

Fresh setup and QMD integration hardening.

- Adds repo-backed local install flow with `./scripts/install-local`, CI dry-run coverage, and pnpm dependency build-script allowlisting.
- Hardens first launch by creating missing note roots, using portable workspace defaults, preserving empty folders in the explorer, and fixing the blank renderer hook-order crash.
- Adds Exo-managed QMD indexing as an active optional substrate with lexical, semantic, and hybrid modes, Settings controls, status UI, sync/update/embed actions, and Explore indexed search on Enter.
- Exposes QMD-backed index status, search, read, sync, update, and embed flows through the Exo CLI/MCP command server while keeping terminal-agent CLI/MCP tools intact.
- Keeps QMD state under workspace-local `.exo/qmd`, credits upstream QMD by Tobi Lutke, and documents the adapter boundary and upgrade checklist.
- Fixes merge-blocking review issues: stale QMD docid read safety, multi-root hybrid search, long-running index command timeouts, workspace-root command-server refresh, and the ignored root `postinstall` script.

## 0.1.0-alpha.0 - 2026-05-12

Initial public alpha.

- Defines Exo as a local-first agentic development environment built around a shared exocortex.
- Ships the Electron desktop shell with Markdown notes, explicit note/project roots, project file viewing/editing, and terminal panes.
- Adds Claude, Codex, and shell terminal launchers with tmux-backed agent recovery.
- Adds Exo CLI and MCP control surfaces for live terminal agents.
- Adds MCP integration setup helpers for Codex and Claude Code.
- Narrows app search to fast note filename/path search while QMD remains future notes index infrastructure.
- Adds the current docs, roadmap, task tracker, harness notes, and plugin architecture direction.
