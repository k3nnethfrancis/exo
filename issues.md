# Exo Issues

Last updated: 2026-07-19

This is the canonical active bug, release-QA, and dogfood tracker. It contains
only work that can still change a current Exo decision or release claim. Git
history, `ledger.md`, and dated reviews retain resolved refactor archaeology.

## Human QA gates

### EXO-ISSUE-102: Opening Workspace Settings can erase Agent Commands and pane layout

- Status: implementation complete; packaged-app and real-vault-copy QA remain
- Severity: critical until the manual gate passes
- Area: workspace settings, Commands, canvas layout, data preservation
- Current guarantee:
  - Main-process, revision-aware patches preserve Commands, canvas layout,
    indexing/migration metadata, and unknown future fields.
  - `projectRoots` and retired terminal implementation knobs are named removed
    keys; normalization strips only those compatibility keys.
- Automated proof:
  - `3b90db2` exercises every non-structural Settings section and proves a
    saved Command still launches after round trips.
  - `1b067ae` proves legacy terminal settings are removed without losing the
    retained settings state.
- Human acceptance:
  - [ ] In a packaged app on a guarded copy of the real vault, open/close each
    Settings section, change one setting, restart, and verify Commands, pane
    layout, indexed roots, and unrelated future keys are retained.

### EXO-ISSUE-103: Note paths can escape Note Roots and mutate arbitrary filesystem locations

- Status: resolved 2026-07-19; guarded packaged-app containment journey passed
- Severity: resolved
- Area: Note Root authorization, workspace files, IPC, command server
- Current guarantee:
  - Main-process `WorkspaceFiles` canonical-path authorization protects desktop
    mutations and command-server document reads.
  - Traversal, symlink escapes, missing-ancestor escapes, rename/delete escapes,
    duplicate roots, and former Project Root paths fail closed. Normal
    in-root note and wikilink creation remains allowed.
  - Project Roots/Attached Folders were deleted rather than retained as a
    compatibility authorization class (`93ad629`, `c4819db`). Fable deferred
    root-relative identities as a later interface-quality improvement.
  - The guarded journey exposed one remaining enumeration gap: renderer IPC
    could call `workspace:list-tree` for an arbitrary directory. The handler
    now routes through the same canonical authorization seam before listing.
- Acceptance proof:
  - [x] In a packaged app on a privacy-safe synthetic corpus matching the real
    vault's aggregate scale/depth and generated path-shape threats, verify normal note,
    wikilink, rename, and delete flows within a Note Root; verify stale former
    Project Root paths are neither shown nor authorized; preserve the emitted
    one-time normalization notice for dropped legacy paths as evidence.
  - Evidence: `docs/reviews/output/2026-07-19-note-root-containment-proof.json`.

### EXO-ISSUE-101: Direct-PTY terminal and configured-Command runtime need packaged-app QA

- Status: implementation complete; packaged-app terminal dogfood remains
- Severity: high
- Area: terminal runtime, xterm, configured Command launch
- Current guarantee:
  - The product uses direct `node-pty` plus xterm with bounded in-memory
    replay. It has no tmux durability layer or durable terminal transcripts.
  - Retired transcript/tuning settings were removed in `1b067ae`; Terminal
    Settings retains only the live terminal-font preference.
- Human acceptance:
  - [ ] In the packaged app, exercise rapid typing, paste, Enter, Ctrl-C,
    resize, ordinary scrollback, pane/tab hide-reveal, a configured Command,
    renderer reload, and app exit. Reopen this issue only with a reproducible
    direct-PTY failure artifact.

### EXO-ISSUE-106: Inline Command invocation needs real-work dogfood

- Status: implementation complete; real-work review loop remains
- Severity: high
- Area: editor invocation, document context, changed-file review
- Current guarantee:
  - `@` opens configured Command autocomplete; Enter creates a transient,
    page-native multiline draft; only Command+Enter invokes. Saving a note and
    arbitrary Markdown mentions never invoke a Command.
  - The prompt includes the explicit message and exact saved document snapshot.
    Note invocations run headlessly; a real Claude session can be resumed in a
    visible Shell after completion.
  - Legacy nested invocation envelopes render as one agent-colored request in
    live preview, while raw mode exposes the durable source markup.
  - Dirty-buffer protection, permission-denial failure, changed-file review,
    provider session capture, and a real Claude edit are covered by focused
    unit and Electron tests.
- Human acceptance:
  - [ ] On real work, send a multiline `@claude` request with document context,
    inspect the resulting Markdown changes, and explicitly keep or reject
    them. Record repeatable friction as a new issue rather than broadening the
    invocation boundary speculatively.

## Monitoring

### EXO-ISSUE-118: Folder breadcrumb and invocation throughput gates regressed

- Status: resolved on the exact `dev` checkpoint `5cf870a`; the earlier mixed-
  worktree regression did not reproduce
- Severity: high
- Area: editor navigation, Folder Overview enrichment, inline Command composer
- Reproduction: on 2026-07-17, the existing Electron latency suite measured
  breadcrumb Folder contents at 128 ms p50 against the 99 ms budget and active
  invocation entry at 34 ms/character against the 24 ms/character budget. The
  Graph Pane was never opened. Direct Explorer, filename Search, large-Workspace
  Search, backlinks, ordinary typing, backspacing, and the 1,200-Note concurrent
  derived-work scenario passed. The separate CLI failure is already tracked as
  `EXO-ISSUE-111`.
- Guardrail: do not attribute the regression to graph rendering without a trace,
  weaken the existing budgets, or add another cache/fallback. Reproduce in a
  clean worktree, inspect the retained Playwright traces, and isolate the first
  transaction that exceeds the budget.
- Acceptance:
  - [x] Attempt reproduction from the committed dev checkpoint with no Graph
    Pane open; breadcrumb shell/content measured p50 `24.69/25.87 ms` and
    invocation typing p90 `18.10 ms` with zero long tasks.
  - [x] Isolate the remaining failure to the separately tracked Node 26 CLI
    process-start floor rather than graph imports or renderer work.
  - [x] Rerun the full editor and derived-work latency specs; every in-app path
    passed. CLI process-start accounting remains `EXO-ISSUE-111`.

### EXO-ISSUE-116: Inline agent composition can blank the renderer

- Status: investigation required; non-reproducible dogfood report
- Severity: critical until renderer liveness is understood
- Area: CodeMirror inline composer, live preview, React renderer, invocation envelopes
- Observed: after selecting `@claude` and typing an inline request, the Exo
  editor surface went blank. A hard refresh recovered the app. The reporter
  could not reproduce it immediately and no console/process artifact was
  captured.
- Guardrail: do not add a retry, error suppression, or protocol workaround
  without a failure trace. The saved Markdown file remains canonical; this is
  an editor-renderer liveness investigation, not evidence of a write failure.
- Current evidence, 2026-07-19: the Gate B large-note probe now records editor
  mount/visibility after every measured ordinary-input, trusted-Backspace, and
  active-`@agent` input paint. All samples remained live with no long tasks.
  This broadens deterministic liveness coverage but did not reproduce the
  reported blank renderer, so the issue remains open.
- Instrumentation, 2026-07-22: each editor pane now has a non-retrying error
  boundary. On a renderer exception it keeps the failed pane explicit instead
  of silently blank and writes a local main-log record with note path, editor
  mode, selection, agent handle, and a content-free error signature. The live
  renderer console retains the original error for the active debugging session.
  This makes the next occurrence diagnosable; it is not a resolution.
- Next evidence:
  - [x] Add a small renderer error boundary / diagnostic capture around the
    editor and inline composer that records the active note path, mode,
    selection, agent handle, and error without logging document content.
  - [ ] On the next occurrence, preserve the renderer console error and main
    process logs, then reduce the typing sequence to a fixture.
  - [ ] Add a focused Electron regression that opens `@claude`, types the
    reduced sequence, and asserts the editor remains mounted, visible, and
    editable after each transaction.

### EXO-ISSUE-115: Inline invocation needs context, legible review, and explicit session continuity

- Status: resolved 2026-07-13
- Severity: high
- Area: document-agent protocol, InvocationRunner, CodeMirror review, Command settings/onboarding
- Observed:
  - A Command can receive the working note snapshot yet fail to follow a
    referenced note because the prompt does not explain Workspace/wikilink/Search
    behavior.
  - The linked `<exo-agent-response>` is agent-colored, while other observed
    Markdown edits are not; current UI does not explain that the former is the
    durable answer/receipt and the latter are reviewable edits.
  - Review uses an uncolored whole-file unified patch detached from the edited
    prose.
  - The Exo invocation UUID is distinct from provider session provenance, and
    every invocation currently starts a fresh provider session.
- Expected:
  - Commands receive a compact, bounded Exo Workspace/document contract and can
    resolve durable aliased wikilinks with native filesystem or Exo Search.
  - Response markup and ordinary edit attribution have one documented meaning.
  - Pending changes are legible in the editor with protected Keep/Reject.
  - Users can choose continued or fresh provider context per configured Command;
    continuity never crosses Workspaces and has defined concurrency/reset rules.
- Acceptance and sequencing: `docs/reviews/2026-07-13-invocation-context-session-review-packet.md`.
- Resolution:
  - Prompts now include bounded Workspace, Note Root, wikilink, and
    answer-versus-edit semantics.
  - Review renders additions and deletions inline from retained snapshots;
    Keep/Reject remains invocation-wide and drift-safe.
  - Claude continuity is per Command and defaults on, with Workspace-local
    heads, visible provenance, reset, exact stale fallback, and fail-visible
    lane locking. Codex/generic remain truthfully fresh-only.
  - `pnpm ci:check`, focused Electron review tests, and a live two-turn Claude
    continuity gate pass. Verification: `docs/reviews/output/session-continuity-implementation-status.md`.

### EXO-ISSUE-117: Semantic embeddings become stale unless users manually sync

- Status: resolved 2026-07-19; implemented under the explicit user-approved
  Fable exception and closed by source plus packaged real-model convergence QA
- Severity: high
- Area: QMD indexing, background scheduling, derived worker lifecycle, Search status
- Observed behavior:
  - Save-triggered indexing refreshes QMD documents but intentionally defers
    embeddings. Semantic and hybrid retrieval therefore accumulate pending
    document hashes until the user runs Sync or Build embeddings.
  - Running the previously unbounded QMD embed automatically would reintroduce
    latency risk: the old installed QMD processed the complete pending set,
    exposed no public work budget, and Exo serialized QMD search, maintenance,
    and graph work through one utility-process queue.
  - QMD update is root-scoped rather than path-scoped and scans, reads, and
    hashes every matching file to discover a one-file change.
- Expected behavior:
  - `On save` means automatic eventual semantic freshness after a quiet period;
    `Manual only` remains an explicit pause/override.
  - Canonical Markdown and lexical search stay usable while semantic derived
    state catches up. Foreground editor, navigation, Terminal, graph, and Search
    work never wait on an unbounded embedding operation.
  - Status exposes pending, active, paused, and failed states; full rebuild is a
    repair/model/schema action rather than the normal sync path.
- Architecture gate:
  - [x] Fable transport failed authentication; Kenneth explicitly approved
    proceeding without Fable on 2026-07-15. Preserve the failed review and
    exception in `docs/reviews/2026-07-15-embedding-sync-runtime-session.md`.
- Acceptance:
  - [x] Add a deterministic quiet-period scheduler with bounded automatic work,
    retry/backoff, and no automatic large-backlog job. Exhausted unchanged work
    stays tripped with an explicit repair warning; a genuinely newer canonical
    save receives a fresh bounded retry budget. Exo now carries a narrow,
    reproducible QMD 2.5.3 patch for work budgets and atomic vector publication.
  - [x] Preserve lexical fallback and existing public CLI/command-server routes.
  - [x] Prove foreground search does not wait behind automatic embedding.
  - [x] Prove rapid save bursts coalesce and Manual only cancels automatic work.
  - [x] Exercise sustained typing, navigation, Terminal, graph context, and
    hybrid search while background catch-up is eligible, then prove convergence
    after activity stops with the real embedding model. The 1,200-note source
    gate measured typing at 6.9/12.1/14.5 ms p50/p90/p99, navigation at
    40.2/42.1/47.8 ms, warmed Search at 9.2/10.0/10.0 ms, and zero long tasks.
    The packaged app measured 6.8/12.0/13.8 ms typing,
    40.3/41.5/47.8 ms navigation, 9.7/10.2/10.2 ms warmed Search, and zero long
    tasks. Source and packaged real-model journeys both converged to zero
    pending hashes; see
    `docs/reviews/output/2026-07-19-derived-work-convergence.md`.

### EXO-ISSUE-111: Node 26 cold startup breaks the CLI-open latency gate

- Status: open; runtime investigation required
- Severity: medium
- Area: CLI startup, `exo open`, editor navigation measurement
- Reproduction: after Homebrew upgraded the local runtime from Node 25 to Node
  26.5.0, the compiled `bin/exo open` path measured roughly 103 ms p50 / 109 ms
  p90 in the existing 100-sample Electron navigation gate. The same route had
  measured roughly 64/67 ms on Node 25; direct compiled CLI commands now spend
  about 100 ms in process startup before Exo-specific work.
- Fable ruling, 2026-07-17: this is an acceptable documented process-start
  exception for main promotion, not an Exo renderer regression. Preserve the
  `99 ms` in-app navigation budget; split the CLI measurement into the measured
  per-runtime startup floor and Exo-side work, and keep this issue open for the
  native/single-executable launcher decision.
- Required:
  - [ ] Confirm the regression across supported Node runtimes and the packaged
    CLI distribution rather than weakening the 99 ms p50 navigation target.
  - [ ] Keep the app command-server path lean; if Node startup remains the
    floor, evaluate an earned native/single-executable launcher separately from
    the editor renderer.

### EXO-ISSUE-110: Derived graph/search work can stall editor navigation

- Status: resolved on 2026-07-15
- Severity: high
- Area: editor input/navigation latency, Folder Overview, Search, WorkspaceGraph, QMD
- Reproduction: on a 400-note workspace, opening an indexed Folder rebuilt a
  fresh whole-workspace graph and measured 401 ms p50 / 416 ms p90. Live
  filename search reparsed Markdown bodies twice per query and measured 377 ms
  p50 / 380 ms p90.
- Current guarantee:
  - Folder shells render from known path state immediately; index metadata,
    children, and graph context enrich progressively.
  - Folder metadata, filename catalogs, and one WorkspaceGraph snapshot are
    cached and invalidated by workspace watcher events.
  - Note and external-file refresh paint document state before idle-scheduled
    graph enrichment.
  - Sustained ordinary Markdown and active `@agent` typing are measured on a
    roughly 500 KB note with existing invocation protocol markup. Ordinary
    keystrokes map existing protocol decorations incrementally and do not scan
    the whole document for an agent completion unless an `@` query is active.
  - Rapid backspacing through multiline list content is measured with trusted
    Electron key events and keydown-to-frame-ready samples, recorded after
    forced layout, on the same large-note fixture. Live preview repairs list
    metadata only inside the affected blank-line-bounded block, remaps
    unrelated table/fence metadata, and reparses only a touched table when its
    structure is unchanged.
    References render one navigation item per target Note rather than one DOM
    control per authored mention. The retained 50-deletions/second gate now
    measures p50/p90/p99 ranges of `7.3–7.5/10.8–11.3/11.9–12.7 ms` across
    three consecutive runs, max `16.8 ms`, with zero long tasks and a live
    editor after every measured frame-ready sample.
  - The 400-note gates now measure roughly 55/60 ms for Folder Overview shell
    and contents and 11/20 ms for live filename results.
  - QMD foreground status/search, QMD maintenance, and cold/incremental
    WorkspaceGraph work use three independent bounded Electron utility-process
    queues. Each retains cancellation, timeout/kill/restart, exit recovery,
    serialized operations, and bounded responses; cold graph work cannot queue
    foreground Search behind it. Public IPC and CLI response shapes are
    unchanged.
  - On-save indexing is root-scoped update-only in lexical, semantic, and
    hybrid modes; embedding work runs only on explicit Sync.
  - Ready graph snapshots update only the changed Markdown entry. Completed
    graph context and autosave work wait for real editor idle time before
    committing renderer state or disk work.
  - Rapid same-pane navigation ignores stale async loads without serializing
    independent panes, and active inline Command decorations/widget DOM map
    incrementally while typing.
- Resolution evidence:
  - A real Electron gate ran hybrid/on-save QMD update plus cold graph context
    over the same 1,200-note root while Terminal remained live: typing measured
    6.7/11.8/14.1 ms p50/p90/p99 and alternating note navigation measured
    39.9/42.4/49.5 ms, with no renderer long tasks.
  - A later 1,200-note source/package gate isolated graph and foreground Search.
    Source Search measured 98.4 ms cold and 9.2/10.0/10.0 ms warmed
    p50/p90/p99; packaged Search measured 114.8 ms cold and 9.7/10.2/10.2 ms
    warmed. Terminal writes stayed below 1 ms and both runs had zero renderer
    long tasks. See `docs/reviews/output/2026-07-19-derived-work-convergence.md`.
  - The roughly 500 KB sustained-editor gate measured ordinary typing p99 14.9
    ms, rapid backspace p99 11.3 ms, and active inline Command typing p99 24.0
    ms at roughly 56 characters/second while preserving the widget DOM node.


### EXO-ISSUE-109: Nested-site root-relative Markdown images show unavailable

- Status: resolved on 2026-07-13
- Severity: high
- Area: Markdown live preview, Note Root containment
- Reproduction: a Note under `kenneth-dot-computer/garden/blog/` references
  `/images/...`, while the asset lives under the nested `garden/images/` site
  root. The prior resolver checked only `<Note Root>/images/...`.
- Resolution: root-relative local images now choose the nearest source ancestor
  containing an existing regular file, stopping at the authorized Note Root.
  Relative paths retain source-folder semantics; remote URLs, `file:` URLs,
  traversal, missing files, and symlink escapes continue to fail closed.
- Evidence: focused resolver coverage plus
  `apps/desktop/tests/e2e/markdown-images.spec.ts`, which loads the exact syntax
  through Electron and asserts `naturalWidth > 0` on the real `<img>`.

### EXO-ISSUE-107: Preferred Exo-managed Fable review path is unavailable

- Status: resolved on 2026-07-13; affects architectural-review workflow, not end-user runtime
- Area: configured Commands, operator tooling, public-contract review
- Resolution: `exo-fable-oracle` is now a named tmux session, not an Exo-owned
  lifecycle. A focused packet runs through `claude -p --model fable` in a
  dedicated tmux window, writes a durable result artifact, and can be inspected
  through tmux or an Exo terminal. The consent rule and externalized ruling
  remain mandatory.

### EXO-ISSUE-108: Exo MCP must stabilize caller scope before public release

- Status: implementation complete; public-alpha proof and dogfood required
- Severity: high before public MCP stabilization
- Area: `exo mcp serve`, provider setup, Workspace scope, agent-context onboarding
- Current decision: keep the frozen read-only two-tool MCP (`workspace_status`,
  `search_notes`), narrowed by user decision from Fable's original three-tool
  recommendation because agents can use returned paths under their own native
  permissions. Resolve its
  Workspace from caller cwd rather than app-active state. Permit a
  single-Workspace fallback only when unambiguous; report ambiguity and refuse
  retrieval otherwise. `workspace_status` must state the resolved identity and
  roots, and app retrieval must not cross that resolved scope.
- Completed proof: caller-cwd, singleton fallback, ambiguity refusal, and
  app-mismatch fallback tests. The adapter reports resolved Workspace identity
  and roots and never consumes a running app outside that scope. Provider setup
  also treats an existing registration as success and names a missing provider
  CLI directly.
- Remaining proof: bounded-output/protocol snapshots, provider-native removal
  documentation, and 10–20 real Claude/Codex sessions measuring Exo discovery,
  search-before-read, and zero out-of-root reads.

### EXO-ISSUE-104: Preview pane lifecycle evidence

- Status: monitoring; not reproduced on the clean current tree
- Severity: high if a clean repro returns
- Area: preview pane, Electron startup, iframe readiness
- Current evidence: the full Electron suite and stable-smoke journeys passed
  after the original ordering-sensitive failure. No speculative lifecycle retry
  or sleep was added.
- Follow-up:
  - [ ] Monitor packaged-app and real-vault use. Reopen only with a clean-run
    failure artifact that distinguishes app-window startup from preview-frame
    readiness.

### EXO-ISSUE-105: Breadcrumb-created Folder Index — resolved

- Status: resolved in Folder Overview vertical slice
- Area: Folder Indexes, titlebar breadcrumbs, filesystem mutation
- Resolution: folder breadcrumbs and Explorer double-click now open a read-only
  Folder Overview. It surfaces an explicit `Create index` action only when the
  writable Folder has no `index.md`; raw indexes remain ordinary Markdown.

### EXO-ISSUE-119: Experimental Graph View transport is not yet 10K-safe

- Status: resolved 2026-07-20 by Launch Gate D
- Severity: resolved
- Area: Knowledge Graph projection, derived-process IPC, Graph Pane
- Resolution evidence: the object projection and its duplicate graph models
  were deleted. The compact packet measures 0.66 / 3.30 / 6.60 MB at
  10K/50K, 50K/250K, and 100K/500K nodes/edges; source and package exercise the
  same scene through hardware WebGPU and Canvas recovery.
- Required:
  - [x] Transfer compact typed topology and fetch bounded label/concept detail
    by `sourceSnapshotId` on demand.
  - [x] Record transport/profile hashes and payload bytes at 10K/50K/100K.
  - [x] Gate Graph-open, orbit, zoom, selection, editor concurrency, idle
    quiescence, and Canvas fallback before removing the Experimental label.
  - Evidence: `docs/reviews/output/2026-07-20-launch-gate-d.md`.

### EXO-ISSUE-120: Mixed dev candidate must re-earn editor latency gates

- Status: resolved for `dev` promotion at `5cf870a`; main promotion is governed
  by the Fable checklist in `EXO-ISSUE-121` and the `EXO-ISSUE-111` budget split
- Severity: high
- Area: inline Command typing, breadcrumb Folder Overview, Node CLI startup
- Review evidence: ordinary typing, backspace, and input-to-frame-ready remain within
  budget, but the mixed tree measured about 32 ms/character for the synthetic
  Playwright invocation burst, about 128 ms p50 for breadcrumb Folder contents,
  and about 101 ms p50 for Node 26 CLI open.
- Required:
  - [x] Preserve zero renderer long tasks; do not weaken the existing gate.
  - [x] Separate driver overhead from in-app input-to-frame-ready while retaining a
    real accelerated-typing journey.
  - [x] Isolate the only remaining miss to Node 26 CLI process startup before
    publishing `dev`; all in-app navigation and typing paths passed.

### EXO-ISSUE-121: Graph navigation and Connections physical-device polish

- Status: production navigation and Connections projection resolved; physical-
  device polish remains
- Severity: medium follow-up; no longer blocks the production Graph Pane
- Area: Stellar interaction, Graph Pane, editor chrome, Connections rail,
  Properties, graph selection/provenance
- Observed:
  - Production now has adaptive node/hit radii, bounded focal labels, anchored
    wheel zoom, coarse-pointer pinch/pan, and one WebGPU/Canvas scene. Broader
    physical-device legibility evidence remains a polish gate rather than a
    renderer split.
  - Canvas and WebGPU now use one interaction contract; empty-space reset is
    gone and frame-all is explicit.
  - The editor Graph action, App-owned inspected Concept, Outline/Links split,
    and conditional History are implemented.
  - Connections Graph now adapts the canonical bounded neighborhood into compact
    typed topology, then uses the full Graph Pane's deterministic scene, focal
    labels, presentation compiler, and Canvas renderer without adding another
    worker, gesture model, or idle loop.
- Required:
  - [x] Before main, fix the three defects confirmed by Fable: backlink source
    Notes missing from local neighborhoods; Expand passing a MouseEvent as
    `focusPath`; and unchanged-snapshot Refresh resetting the relaxed layout
    without rerunning it.
  - [x] Define and test one interaction contract across Canvas and WebGPU:
    click selects; double-click opens the Note; double-click of an already open
    Note focuses/zooms; frame-all is explicit; no accidental empty-space reset.
  - [ ] Tune adaptive wheel/pinch dolly and node visual/hit radii on real desktop
    trackpads and mobile, with overview/mid/focus legibility screenshots and
    gesture-count evidence.
  - [x] Add an icon-only Graph action beside editor Properties that opens the
    Graph Pane with the current Note selected and framed.
  - [x] Give Outline only headings; give Links backlinks, internal outgoing,
    and external links.
  - [x] Make Graph a local spatial neighborhood compiled from the same
    projection/presentation path as the full graph; the custom SVG is deleted
    after Electron parity passed.
  - [x] Keep editor Properties editable and graph/Connections properties
    explanatory; share one inspected Concept and show Relation origin,
    Evidence, profile interpretation, and the visual mappings a property drives.
  - [x] Hide Activity until it has a real invocation/change/provenance stream,
    then define its empty and populated states.
  - [x] Add a packaged-app E2E covering editor → focused graph → Note open →
    repeated-node focus → Properties/Links/Outline consistency → back navigation.

### EXO-ISSUE-122: Index history repeats the pending-embedding policy warning

- Status: open; non-blocking status-surface cleanup
- Severity: low
- Area: QMD update results, IndexingService status presentation, recent jobs
- Observed: the final packaged real-model Gate B run recorded both “document
  hashes need embeddings and are waiting for automatic catch-up” and
  “embeddings are waiting for automatic catch-up” on the same completed update
  job. The state is truthful, but the repeated policy is noisy and makes
  provider versus desktop status ownership look ambiguous.
- Required:
  - [ ] Give each user-facing maintenance fact one owner and one rendering.
  - [ ] Preserve provider diagnostics, desktop scheduling policy, retry
    exhaustion, Manual mode, and bounded-slice warnings without semantic
    duplicates in `recentJobs` or the active status.
  - [ ] Add a focused test for the completed-update job warning list.

### EXO-ISSUE-123: Sustained editor latency journey has an autosave/content assertion race

- Status: resolved 2026-07-22
- Severity: medium
- Area: Electron editor latency harness, autosave/external refresh, inline
  invocation composer
- Cause: Markdown serialization through `gray-matter` appended a final newline
  even when the live editor body did not contain one. A later file-watch reload
  could therefore create a character the person never typed. Separately, the
  test probe reset its buffers before prior `requestAnimationFrame` callbacks
  had drained, so autocomplete frames could be misattributed to invocation
  typing.
- Repair: preserve the exact trailing-newline contract on save; assert exact
  on-disk Markdown rather than normalizing the expected body; make invocation
  preflight compare those same exact persisted bytes; scope the input probe to
  the editor and drain the prior interaction before measuring the next one.
- Verification: focused core tests (178) and typechecks pass. The full Electron
  journey passed once plus three consecutive repetitions with no long tasks:
  ordinary 2,000-character typing p90 `14.9–15.1 ms`, accelerated Backspace
  p90 `11 ms`, and inline invocation typing p90 `14.3 ms` in the logged run.

-- Shoshin | 2026-07-21
