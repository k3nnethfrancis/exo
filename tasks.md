# Exo Tasks

Last updated: 2026-07-11

This is Exo's active execution ledger. It records only current work. Completed implementation belongs in Git and `ledger.md`; reproducible bugs belong in `issues.md`; architecture rationale belongs in `docs/exograph-simplification-plan.md`.

## Product Frame

> **Exo is a local Markdown exocortex with modular search, inline configured-Command invocation, and graph-management skills.**

Launch requires four things:

1. A trustworthy, user-owned Markdown workspace.
2. Filesystem and QMD search as the two concrete implementations.
3. Actionable Connections and graph context.
4. Explicit configured-Command invocation of editable skills, followed by reviewable Markdown changes.

Folder paths are primary structural homes. A writable Note Root may contain a user-owned `index.md` Folder Index; tags, links, and properties preserve multiple membership. Existing imported folders are never mutated merely by viewing them.

Exo scopes a workspace to its Note Roots only. It does not import, attach, or manage projects as a second class of filesystem context.

## Current Baseline

- The UI convergence wave is installed and passing: compact Settings, centered search, breadcrumbs, title/properties chrome, one resizable utility pane, Preview/Terminal/Connections switching, and direct terminal creation.
- The direct-PTY terminal and configured Command readiness/Test flow are live.
- `exo start` launches the resident packaged app; app-off `status`, `search`, and `read` remain useful through filesystem roots.
- `pnpm check`, `pnpm check:repo`, and `pnpm stable:smoke` are green on the current branch.

## Now — Trust Before Features

### 1. Finish Settings preservation proof — `EXO-ISSUE-102`

- [x] Prove opening, waiting, closing, and reopening Settings performs no write when unchanged.
- [ ] Prove appearance/search/terminal-only edits preserve Commands, layout, unknown keys, and migration metadata. Appearance now has Electron proof for Commands and unknown keys; layout and the remaining sections need the same journey coverage.
- [x] Prove stale/concurrent settings patches reject rather than silently overwrite one another.
- [ ] Prove a saved Command remains invokable after every Settings round trip.

### 2. Finish Note Root containment proof — `EXO-ISSUE-103`

- [ ] Move remaining note operations to root-relative identities behind `WorkspaceFiles`.
- [ ] Complete escape coverage: traversal, absolute paths, duplicate roots, symlink files/directories, missing ancestors, rename, and recursive delete. Existing focused proof covers traversal, absolute paths, symlink escapes, and missing ancestors; add explicit rename/delete/duplicate-root cases.
- [x] Prove desktop IPC and command-server reads share the same containment seam.
- [ ] Dogfood a guarded copy of the real vault before closing the issue.

### 3. Installed core loop — complete

- [x] Rebuilt, installed, and relaunched the packaged app after the renderer-recovery fix and inline invocation work.
- [x] Verified `exo` exposes resident-app `start` plus app-off `status`, `search`, and `read` modes; focused Electron journey coverage remains green.
- [x] The remaining terminal and first-launch observations are ordinary dogfood follow-ups, not a blocker for the shipped core loop.

### 4. Finish the editor and invocation loop

- [ ] Polish live Markdown typography, list hierarchy, indentation, and spacing with real-note visual QA.
- [ ] Make new Markdown notes start with an editable H1; at the initial caret, Markdown syntax must remain visible.
- [x] Replace the one-line mention launcher with the editor-owned `@agent` composer: autocomplete, transient multiline draft, Enter for lines, Shift+Enter to invoke, explicit confirmation, visible terminal execution, and review.
- [ ] Dogfood the default `@claude` path on real work, including a multiline request and a full document-context handoff.
- [ ] Dogfood the full loop on real work: write a note, invoke a Command, inspect changes, and keep or reject them.

### 5. Distill the repository

- [ ] Reduce stale tmux/transcript/plugin/harness/MCP plans and completion-plan families to the canonical docs or delete them.
- [ ] Delete Attached Folder / Project Root configuration, UI, IPC, and documentation rather than renaming the old project-context model.
- [ ] Run a type and data-model review: every durable type, persisted setting, IPC payload, and filesystem object has one current product meaning, an owning module, validation/normalization where needed, and no legacy aliases or dead fields.
- [ ] Refresh the documentation system as one coherent set: vision (`ashby.md`), `CONTEXT.md`, README, architecture, feature/interaction docs, ADRs, roadmap, tasks, issues, and changelog must agree with the shipped note-native product and link to their canonical source rather than duplicate stale plans.
- [ ] Add a compact feature/data-model coverage index so a future worker can locate the implementation, tests, user-facing behavior, and source-of-truth documentation for every retained feature.
- [ ] Review the untracked Command-readiness draft files and the current dirty documentation intentionally before the branch is declared clean.

## Next — The First Exograph Vertical Slice

Start only after the trust gates above pass.

### Folder Overview and Folder Index

- [ ] Double-click a Folder to open its Overview: durable title/properties from optional `index.md`, direct children, local graph, and relevant context.
- [ ] Keep raw `index.md` accessible while hiding only its duplicate Explorer row.
- [ ] Create a Folder Index only through an explicit Note Root action.
- [ ] Test nested folders, moves/renames, missing indexes, explicit property overrides, raw-file access, and no-write viewing.

### First graph-management Skill

- [ ] Ship one provider-neutral, editable **Find and connect relevant context** skill through an existing trusted Command.
- [ ] Combine Search with links, backlinks, tags, properties, and neighborhood evidence.
- [ ] Require explanations and reviewable proposed Markdown/frontmatter changes; inferred similarity stays derived.
- [ ] Measure retrieval lift, irrelevant-context cost, edit burden, and proposal acceptance before adding another skill.

## Dogfood Queue

- [ ] Use Exo for non-Exo work and promote only repeatable friction into `issues.md`.
- [ ] Monitor `EXO-ISSUE-104` preview/window lifecycle evidence; reopen only with a clean repro artifact.
- [ ] Monitor Folder breadcrumb-created indexes (`EXO-ISSUE-105`) on a real vault; replace with an explicit authoring action if the side effect feels surprising.

## Explicitly Deferred

Do not reopen Plugin Manager, MCP, routines, a harness manager, Feed/Gym/training, cloud indexing, or a general extension runtime. A future Plugin is a distribution bundle only after proven skills, Commands, and providers need repeatable installation, versioning, or sharing.

-- Shoshin | 2026-07-11
