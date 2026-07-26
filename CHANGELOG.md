# Changelog

## Unreleased

Note-native workspace simplification: a filesystem-first Markdown editor with titlebar search, Folder Indexes, one utility destination, and configured Commands.

### Added

- Adds a flat user-owned Ontology library: root `ontology.yaml`, direct
  `ontologies/*.yaml` sources, Generic Markdown as none, one active
  interpretation at a time, and explicit effect review before every switch.
- Adds optional Ontology discovery through a trusted Claude or Codex Command.
  The provider sees only a disposable Markdown snapshot under read-only
  controls; Exo validates and stages a proposal, but never activates it without
  Keep.
- Adds the first provider-neutral graph-maintenance Skill, **Find and connect
  relevant context**. A graph-selected Note opens an ordinary inline
  Invocation carrying bounded evidence plus exact Skill, Ontology, and graph
  snapshot identities; all resulting writes use Changeset review.
- Adds a reusable, harness-only mini trace assessment that runs a Skill through
  fresh read-only Claude and Codex sessions and generates a private local
  comparison dashboard without defining an automated quality gate.
- Adds `Mod+B` and `Mod+Alt+B` shell shortcuts for Explorer and Utility,
  plus a compact lower-menu Help surface sourced from Exo's current
  keybinding and CLI command catalogs.
- Adds `/today` and `/tomorrow` editor commands that expand to ordinary date
  wikilinks and open or create the corresponding daily Note through the
  existing link path.
- Adds explicit Workspace Ontology review in Settings: bounded graph effects,
  exact stale-review guards, atomic Keep/Reject, restart-stable activation, and
  Ontology-origin Connections edges without changing authored Links or Notes.
- Adds the reviewed Workspace Ontology foundation: an atomic `ontology.yaml`
  parser/compiler, Candidate/Active revision store, persisted accepted source,
  exact rule Evidence, and Generic Markdown fallback without modifying Notes.
- Adds the experimental feature-branch graph-system tracer: an open Knowledge
  Graph 0.3, Generic Markdown and permissive OKF Formats, evidence-backed
  dimensions, dense renderer-neutral projection, and an interactive Canvas
  Graph Pane whose semantic construction and finite layout run outside the
  editor critical path. Canvas projection and painting remain renderer work.
- Adds Markdown-native `⌘B` and `⌘I` formatting: selections are wrapped in
  bold or italic markers and an empty selection leaves the caret between them.
- Renders Obsidian-style `![[image.png]]` embeds from contained files in the
  current Note Root, including the common `|width` suffix.
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

- Reorganizes public documentation around separate user and contributor paths,
  adds focused guides for daily use, search, graph behavior, CLI/MCP, and
  troubleshooting, and removes superseded pre-refactor release material.
- Draws the Connections neighborhood through the same deterministic scene,
  focal-label, presentation-compiler, and Canvas contracts as the full Graph
  Pane instead of maintaining a separate circular SVG renderer.
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

- Keeps canonical editor bytes synchronous with CodeMirror through autosave and
  inline Command composition, preventing deferred controlled renders from
  replacing newer typed text.
- Keeps active Workspace transitions atomic across settings, watchers, Search,
  graph publication, terminals, and command discovery; stale asynchronous work
  can no longer republish an older Workspace.
- Makes the focused Canvas pane the sole document owner, so delayed Note loads
  cannot steal focus from a newer Note, Graph, Terminal, or Preview choice.
- Honors the configured Command list exactly—empty or disabled Commands remain
  unavailable instead of silently restoring Claude.
- Keeps folded Markdown lists attached to their actual parent through edits
  instead of transferring the fold to whichever item later occupies a line.
- Closes Note Root Format selection to immutable built-in Generic Markdown and
  OKF semantics, with no arbitrary renderer, IPC, worker, or cache selector.
- Keeps the Properties surface open or closed independently in each split
  editor pane instead of mirroring one pane's toggle across the canvas.
- Makes inline `#tags` visible, highlighted, and clickable like wikilinks, and
  refines ordered-list numbering, nesting, marker alignment, and continuation.
- Upgrades pre-Changeset single-note invocation reviews into the exact review
  model without losing pending, kept, or rejected decisions.
- Makes the exact multi-file Changeset the sole invocation review model; new
  records no longer persist guessed likely/ambiguous attribution or a lossy
  representative-file review alongside it.
- Keeps invocation recovery fail-closed when a durable record is missing or
  damaged, preserves same-process invocations across Workspace switches, and
  refuses to release a Command when its tagged Note changed during capture.
- Replays interrupted Reject transactions before retry preflight and compacts
  settled invocation snapshots to the exact Changeset and History payload,
  preserving recovery bytes while removing unrelated full-Workspace captures.
- Serializes per-file and bulk invocation review decisions so concurrent Keep
  and Reject actions cannot lose a decision or overwrite the accepted file state.
- Makes invocation review drain editor autosaves before an exact decision, so
  Reject cannot be reapplied by a stale dirty buffer, and shows frontmatter-only
  and Unix-permission changes in the page-native review surface.
- Makes Folder Overview open previously unloaded child Notes and newly created
  Folder Indexes through the canonical file-open transaction, while
  synchronously refreshing cached index state after explicit creation.
- Makes ordered Markdown list markers match the surrounding text size and
  weight, with a stable gap before the list content.
- Enables native spell checking in Markdown editors and renders Markdown images
  referenced by `http:` or `https:` URLs directly, while keeping local image
  paths behind Note Root containment checks.
- Prevents viewBox-only SVGs, including the Self-Improving Business Systems
  diagrams, from collapsing to zero width in the live editor.
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
  maintenance workers, truthful Simple-search fallback, bounded retries that
  stay exhausted for unchanged work and re-arm on a genuinely newer save, and
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
- Keeps fast typing within a one-frame readiness budget on large Markdown notes by incrementally mapping persisted invocation decorations and avoiding whole-document protocol scans for ordinary keystrokes; covers both normal editing and active `@agent` composition.
- Keeps rapid multiline backspacing within one frame by repairing list metadata inside the affected block, remapping unrelated table/fence metadata, and rendering repeated authored links as one Reference per target Note instead of thousands of duplicate editor controls; the gate uses trusted key events and keydown-to-frame-ready samples recorded after forced layout.
- Keeps a tab switch atomic with its CodeMirror document before paint, so the first edit cannot land in the previously active Note while the controlled editor value catches up.
- Keeps editor navigation independent of derived workspace work: Folder Overview renders immediately and enriches progressively, WorkspaceGraph/folder/filename data are watcher-invalidated caches, graph refresh waits for editor idle time, and live filename results no longer parse every Markdown body per query.
- Applies the Markdown image radius directly to the rendered asset so all four corners remain symmetrical regardless of widget sizing.
- Resolves root-relative Markdown images from the nearest matching source ancestor inside the Note Root, so nested site/content wikis render their local assets without weakening path containment.
- Gives viewBox-only SVG attachments a definite editor width so successfully loaded vectors cannot collapse to an invisible zero-width image.
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
