# Exo Issues

Last updated: 2026-07-12

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
  - The prompt includes the explicit message and current document snapshot;
    terminal execution, dirty-buffer protection, and changed-file review are
    covered by focused Electron tests (`04d74c3`).
- Human acceptance:
  - [ ] On real work, send a multiline `@claude` request with document context,
    inspect the resulting Markdown changes, and explicitly keep or reject
    them. Record repeatable friction as a new issue rather than broadening the
    invocation boundary speculatively.

## Monitoring

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

### EXO-ISSUE-105: Breadcrumb-created Folder Index is a monitored product exception

- Status: accepted exception; monitor on a real vault
- Severity: low
- Area: Folder Indexes, titlebar breadcrumbs, filesystem mutation
- Current behavior: clicking a writable Note Root folder breadcrumb creates a
  minimal `index.md` only when absent, then opens it. Startup/viewing is
  read-only; existing files are never overwritten; paths outside a Note Root
  are not eligible.
- Follow-up:
  - [ ] Dogfood this navigation on a real vault. If it feels surprising,
    replace it with the planned non-creating Folder Overview plus an explicit
    “Create index” action. The future Folder Overview does not inherit this
    create-on-navigation side effect.

-- Shoshin | 2026-07-12
