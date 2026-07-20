# Changelog

## Unreleased

Note-native workspace simplification: a filesystem-first Markdown editor with titlebar search, Folder Indexes, one utility destination, and configured Commands.

### Added

- Adds the experimental feature-branch graph-system tracer: an open Knowledge Graph 0.2,
  Generic Markdown and permissive OKF profiles, evidence-backed utility
  dimensions, dense renderer-neutral projection, and an interactive Canvas
  Graph Pane whose semantic construction and finite layout run outside the
  editor critical path. Canvas projection and painting remain renderer work.
- Adds automatic semantic catch-up for QMD `On save` indexing: small pending
  sets run in bounded slices only after Exo is quiet and the system is idle,
  while `Manual only` remains an explicit pause.
- Adds Exo-aware inline Command prompts, snapshot-backed inline editor diffs,
  and per-Command Claude context continuity with visible provenance and reset.
- Adds a focused first-run flow: choose one main wiki, optionally install Exo's Workspace status/search MCP tools into Claude and Codex, then persist editable local invocation commands.
- Renders contained Markdown image attachments in the live editor while preserving raw source editing at the caret.
- Adds reviewable inline Command outcomes: exact tagged-note patch, Keep/Reject with dirty-buffer and disk-drift protection, and Claude **Resume in Shell** when the command returned a real session id.
- Adds an **Agents** section to Workspace Settings for configuring the commands behind `@` mentions.
- Adds one shared right-side utility destination with mutually exclusive Preview, Terminal, and Connections views.
- Adds centered workspace search with an anchored result popover, typed titlebar breadcrumbs, and explicit Folder Index creation/maintenance.
- Adds a version-three mixed-pane layout format. Existing terminal and preview tabs can move into a canvas split while retaining their live session/tab identity.
- Adds compact saved-Command readiness and explicitly confirmed one-shot Test controls inside Terminal.

### Changed

- Keeps first-run activation explicit when active Workspace settings are missing
  or invalid: saved registry entries remain selectable but never reopen on their
  own.
- Prevents a packaged app's bundled plugin resources from being mistaken for a
  source checkout when Exo reports CLI installation status.
- Restores the local Electron runtime after macOS packaging so development and
  source E2E launches continue without reinstalling dependencies.
- Replaces incomplete cached Electron distributions before recovery instead of
  extracting over a half-consumed app bundle.
- Removes stale metadata-only plugin manifests and stops copying them into the
  packaged app; future Plugins remain distribution bundles, not a dormant runtime.
- Makes the graph interaction contract concrete in the desktop surface: the
  editor Graph action focuses the active Note, note-open double-click zooms
  instead of reopening, empty-space double-click is inert, and Connections now
  keeps headings, links, tags, and the local neighborhood in their own views.
- Makes Search settings explicitly choose recommended **QMD** or **Simple search**; QMD now starts new Workspaces in lexical mode, keeps its configuration while Simple search is active, and shows maintenance only when selected.
- Narrows the CLI to orientation, paginated path-first search, explicit
  configured-Command invocation, index status/sync, and desktop handoff;
  removes CLI file reading and remote preview/terminal/configuration control.
- Makes CLI and MCP search return the shared bounded `exo.search.v1` page with
  paths, root-relative metadata, retrieval warnings, and an opaque cursor;
  agents inspect returned paths with their own filesystem tools.
- Sends inline agent invocations with Command+Return and presents the compact `⌘ ↵` shortcut glyph beside the active request.
- Narrows the optional Exo MCP from status/search/read to workspace status and search only; agents use returned paths through their own native file permissions.
- Resolves Exo MCP scope from the provider process's caller directory, refuses ambiguous Workspace matches, and falls back to scoped filesystem retrieval when a running app belongs elsewhere.
- Keeps Preview and Terminal as independent utility destinations with their own tabs, while allowing a tab to be dragged into an editor split and returned by closing its canvas pane.
- Makes folder creation create a minimal `index.md`, while imported folders remain read-only until the user explicitly creates an index.
- Moves workspace Settings to the lower workspace menu and tightens Explorer/titlebar chrome.
- Refines Workspace Settings around user-facing outcomes, compact responsive rows, and provider-neutral search maintenance.

### Fixed

- Makes Folder Overview open previously unloaded child Notes and newly created
  Folder Indexes through the canonical file-open transaction, while
  synchronously refreshing cached index state after explicit creation.
- Repairs a cached Electron runtime whose host binary exists but whose required
  `path.txt` metadata is missing, and fails setup clearly if upstream install
  still leaves the runtime incomplete.
- Routes Explorer tree reads through the same canonical Note Root containment
  seam as document reads and mutations, preventing renderer requests from
  enumerating retired, outside, or symlink-escaped directories.
- Keeps backlink-only Notes coherent across Links and the local Graph, opens
  the full Graph at the inspected Note without leaking click events into graph
  state, and preserves settled layout and camera state across unchanged
  refreshes.
- Keeps search responsive during index maintenance with separate foreground and
  maintenance workers, truthful Simple-search fallback, bounded retries, and
  transactional QMD metadata/vector publication so interrupted writes remain
  pending instead of appearing complete.
- Keeps cold graph construction from queueing foreground Search by giving
  WorkspaceGraph its own restartable utility process.
- Loads sqlite-vec from the unpacked native dependency path in packaged macOS
  apps so semantic indexing works outside the source checkout.
- Keeps the editor responsive when indexing and graph enrichment overlap: QMD
  and WorkspaceGraph derived work now run in restartable utility processes,
  hybrid/semantic saves defer embeddings, graph watcher events update one note,
  and graph results commit only after editor input goes idle.
- Stops periodic autosave from interrupting sustained typing, keeps the inline
  Command widget/decorations stable and incremental, and prevents stale slower
  note loads from replacing a newer same-pane selection.
- Stops inherited operator note-root environment variables from skipping the first-run desktop setup; only explicit test fixtures may use that bypass.
- Distinguishes a headless Command's chat/stdout from the Exo note in the invocation prompt, requires a successful filesystem write for linked responses, and fails stdout-only protocol completions that never reach the document.
- Starts with an empty editor when no saved layout chooses a note instead of hard-coding an Exo `tasks.md`; restores only user-selected tabs and migrates saved canvas layouts from v2 to the renderer's canonical v3 schema.
- Gives the built-in headless Claude command explicit prompt-free access to the bounded read/edit tools it needs for inline responses, while leaving custom commands unchanged.
- Keeps provider identity separate from editable `@` handles, prevents
  continued sessions crossing Workspaces or overlapping in one lane, and
  retries only Claude's proven pre-turn stale-session failure.
- Keeps fast typing within a one-frame paint budget on large Markdown notes by incrementally mapping persisted invocation decorations and avoiding whole-document protocol scans for ordinary keystrokes; covers both normal editing and active `@agent` composition.
- Keeps rapid multiline backspacing within one frame by repairing list metadata inside the affected block, skipping unrelated table/fence scans, and rendering repeated authored links as one Reference per target Note instead of thousands of duplicate editor controls; the gate uses trusted key events and keydown-to-paint samples.
- Keeps a tab switch atomic with its CodeMirror document before paint, so the first edit cannot land in the previously active Note while the controlled editor value catches up.
- Keeps editor navigation independent of derived workspace work: Folder Overview renders immediately and enriches progressively, WorkspaceGraph/folder/filename data are watcher-invalidated caches, graph refresh waits for editor idle time, and live filename results no longer parse every Markdown body per query.
- Applies the Markdown image radius directly to the rendered asset so all four corners remain symmetrical regardless of widget sizing.
- Resolves root-relative Markdown images from the nearest matching source ancestor inside the Note Root, so nested site/content wikis render their local assets without weakening path containment.
- Unifies inline invocation feedback around running, review, completed, and failed states; failed Claude sessions show the exact resume command, successful terminal handoff dismisses the status surface, and the authorization modal no longer survives a settled launch decision.
- Clarifies onboarding's separate MCP and CLI access paths, shows only the two read-only MCP tools, treats an existing provider registration as installed, gives an actionable missing-provider-CLI error, and keeps configured agent commands on one full-width line.
- Diagnoses the CLI visible to the desktop app during onboarding—current checkout, legacy Exo shim, missing command, or a command owned by something else—and offers an explicit checkout install/update command without ever changing it from MCP setup.
- Reserves a scroll-safe lower edge in the Explorer so long file lists fade out above the floating workspace menu instead of disappearing behind it.
- Makes the inline `@claude` path genuinely headless and writable: the visible, fingerprinted default now uses `acceptEdits`, real Claude event-array output supplies session provenance, structured permission denials fail explicitly, and process finalization waits for drained output.
- Keeps sent invocation envelopes visible only in raw Markdown, retains the agent-colored mention in live preview, prevents re-wrapping an existing invocation, and saves/prompts/baselines the same document snapshot before observation.
- Captures bounded structured output from headless invocations so Claude session provenance is retained instead of silently discarded; generic Commands remain output-agnostic.
- Makes Markdown completion insert readable link aliases and removes whole-note live-preview work from ordinary editor selection and typing.
- Keeps inline agent typing off the synchronous workspace render path, clarifies headless command failures, and moves invocation status into a compact bottom-left toast.
- Restores bounded CodeMirror editor scrolling after the editor action chrome became an out-of-flow overlay.

### Removed

- Removes legacy terminal/browser layout restoration that lacks stable session/tab identities.
- Removes the duplicate Explorer search surface and dead Preview control.

### Superseded pre-refactor draft material

The following historical draft was written before the note-native simplification. It is retained temporarily for audit context only; it does not describe the current product or release scope.

### Historical additions

- Adds metadata-only plugin manifests in `@exo/core`: `exo.plugin.json` discovery, strict validation, plugin source/trust metadata, duplicate-safe plugin/capability registration, and tests.
- Adds internal plugin seams for built-in QMD search providers and shell/Claude/Codex agent harnesses, while preserving existing desktop, CLI, MCP, and command-server behavior.
- Adds core Routine, Run, artifact, trace, evaluation-result, routine-store, and manual executor primitives that future routine/template, trace collector, eval runner, and exporter plugins can build on.
- Adds plugin-declared routine templates that can be instantiated into concrete user/workspace Routine definitions without executing plugin code.
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
- Adds a typed control-plane catalog for MCP/CLI/Desktop/Internal surfaces and MCP exposure profiles (`dev`, `everyday`, `off`, and `custom`) so local agent tool access can be narrowed without changing the default Exo-on-Exo surface.

### Changed

- Makes bare `exo` and `exo start` the end-user launcher for the resident packaged app, moves MCP autostart defaults from `exo dev` to `exo start`, and leaves `exo dev` as a deprecated source-QA shortcut.
- Reopens and supersedes the alpha.3 direct-pty-only terminal decision: Exo core terminals now use tmux for persistence and sleep/relaunch resilience, with node-pty retained as the live attach/render bridge.
- Makes terminal scrollback a numeric setting and applies it to both renderer/live buffers and tmux history instead of coarse `full` / `custom` labels.
- Stops live terminal hydration from resetting xterm and replaying stale scrollback over active agent output.
- Keeps Guardian Angel out of Exo core. GA is treated as a downstream/reference plugin workload that should use generic Exo plugin primitives.
- Reframes OKF, LM Wiki, Shoshin profiles, feed/scheduler concepts, and routines as optional exograph/plugin architecture directions rather than hardwired folder/schema requirements.
- Splits Workspace Settings from Agent Config and Plugin/Profile configuration so agent instructions, skills, harnesses, plugins, and profile state each have clearer ownership.
- Stages onboarding as workspace basics, plugin choices, agent context, and profile review instead of a single settings-like form; unavailable harnesses are hidden and QMD is treated as an optional search-provider plugin after workspace load.
- Reorders profile onboarding to Plugins -> Agent Context -> Profile, removes starter routine and bulk skill setup panes from first-run setup, and keeps skill management in Agent Config.
- Makes onboarding configuration trustworthy: Agent Context now previews the actual global and active-notes `AGENTS.md` / `CLAUDE.md` files, Exograph context apply refreshes visible file previews, instruction-file sync is labeled as an overwrite-from-selected-file action with confirmation, Skills onboarding installs/enables bundled Exo skills through the shared Agent Config skill service, and onboarding Profile setup exposes direct profile name/config editing with immediate save.
- Treats shell as terminal substrate in user-facing setup surfaces: shell remains a core terminal tool for compatibility and CLI/MCP use, but it is hidden from agent-harness/profile/routine selection lists that expect a promptable agent.
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
- Wires MCP tool registration through the control-plane catalog, keeps `dev` as the default full tool surface, fails closed on invalid explicit exposure profiles, and warns when custom MCP tool allow-lists contain unknown tool names.

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
- Fixes terminal input/render regressions where a broken default user tmux server could make Exo terminals unavailable, stale hydration could mask unhealthy panes as restoring, tab activation could force xterm replay, missing Unicode width rules could corrupt Claude-style TUI glyphs, and xterm custom glyph drawing could corrupt wide TUI lines despite byte-correct tmux tails.
- Fixes preview pane target replacement, preview clipping, and preview-triggered terminal replay/focus regressions.
- Fixes packaged/onboarding startup paths so missing workspace state reaches onboarding before synthetic workspace defaults or terminal transcript initialization.
- Fixes interrupted first-run onboarding so saved workspace settings do not imply profile setup completion and reloads resume setup.
- Fixes a fresh-onboarding blank screen caused by terminal Unicode addon initialization during the workspace-to-profile handoff, and keeps terminal bootstrap failures from blocking the workspace shell.
- Fixes plugin manager layout overlap, settings modal spacing, index settings status copy, and stale MCP/integration diagnostics.
- Fixes Electron e2e terminal fixture isolation by running tests against a test-specific tmux server name instead of the developer's active tmux server state.
- Fixes mac packaging collector stalls and documents launch-mode/setup expectations for packaged, installed, source, and MCP contexts.

### Removed

- Removes Guardian Angel-specific capability/code/docs from Exo core after the plugin boundary was clarified.
- Keeps plugin entrypoint execution, Plugin Manager UI, plugin-owned CLI/MCP tools, marketplace/package loading, and permission grants out of this release until the manifest/trust model survives real use.
- Removes the terminal attach-copy header button, agent config tab from Workspace Settings, legacy plugin kind aliases, and renderer-managed harness kind leftovers.
- Removes the legacy `exo routines` CLI surface and the onboarding routine/standard-skills setup panes from the note-native Exograph branch.
- Removes the MCP package and setup surface from the note-native Exograph branch: `packages/mcp`, `exo integrations`, MCP capability surfaces, MCP profile config templates, MCP public-contract guard slices, and hidden Codex MCP launch injection are gone. CLI remains the local integration surface.

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
