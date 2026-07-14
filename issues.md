# Exo Issues

Last updated: 2026-07-13

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

- Status: implementation complete; guarded real-vault-copy containment dogfood remains
- Severity: critical until the manual gate passes
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
- Human acceptance:
  - [ ] In a packaged app on a guarded real-vault copy, verify normal note,
    wikilink, rename, and delete flows within a Note Root; verify stale former
    Project Root paths are neither shown nor authorized; preserve the emitted
    one-time normalization notice for dropped legacy paths as evidence.

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
    page-native multiline draft; only Shift+Enter invokes. Saving a note and
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

### EXO-ISSUE-110: Derived graph/search work can stall editor navigation

- Status: foreground-path fix complete; process-isolation follow-up required
- Severity: high
- Area: editor latency, Folder Overview, Search, WorkspaceGraph, QMD
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
  - The 400-note gates now measure roughly 55/60 ms for Folder Overview shell
    and contents and 11/20 ms for live filename results.
- Remaining:
  - [ ] Move QMD store/update/embed/search/status work behind an out-of-process
    derived-data module so native/model work cannot block Electron main IPC.
  - [ ] Replace whole-graph invalidation with incremental or worker-owned graph
    updates if real-vault traces still show contention after caching and idle
    scheduling.
  - [ ] Add editor input/selection latency under concurrent graph and QMD work.


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

-- Shoshin | 2026-07-12
