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

## Current Baseline

- The UI convergence wave is installed and passing: compact Settings, centered search, breadcrumbs, title/properties chrome, one resizable utility pane, Preview/Terminal/Connections switching, and direct terminal creation.
- The direct-PTY terminal and configured Command readiness/Test flow are live.
- `exo start` launches the resident packaged app; app-off `status`, `search`, and `read` remain useful through filesystem roots.
- `pnpm check`, `pnpm check:repo`, and `pnpm stable:smoke` are green on the current branch.

## Now — Trust Before Features

### 1. Finish Settings preservation proof — `EXO-ISSUE-102`

- [ ] Prove opening, waiting, closing, and reopening Settings performs no write when unchanged.
- [ ] Prove appearance/search/terminal-only edits preserve Commands, layout, unknown keys, and migration metadata.
- [ ] Prove stale/concurrent settings patches reject rather than silently overwrite one another.
- [ ] Prove a saved Command remains invokable after every Settings round trip.

### 2. Finish workspace containment proof — `EXO-ISSUE-103`

- [ ] Move remaining note operations to root-relative identities behind `WorkspaceFiles`.
- [ ] Complete escape coverage: traversal, absolute paths, duplicate roots, symlink files/directories, missing ancestors, rename, and recursive delete.
- [ ] Prove desktop IPC and command-server reads share the same containment seam.
- [ ] Dogfood a guarded copy of the real vault before closing the issue.

### 3. Prove the installed core loop

- [ ] Run fresh-user-data packaged-app onboarding: choose notes, create/open/edit a note, invoke `@claude` inline, review the change, restart, and verify recovery.
- [ ] Verify `exo start` and app-off retrieval from outside the repository against that clean install.
- [ ] Complete direct-PTY field QA: ordinary shell typing/paste/Ctrl-C, resize, Preview focus switch, long session, and macOS sleep/wake. Classify every real render defect under `EXO-ISSUE-062`/`069`.
- [ ] Resolve or reproduce packaged first-launch exit behavior (`EXO-ISSUE-031`) on a clean account/runtime.

### 4. Finish the editor and invocation loop

- [ ] Polish live Markdown typography, list hierarchy, indentation, and spacing with real-note visual QA.
- [ ] Make new Markdown notes start with an editable H1; at the initial caret, Markdown syntax must remain visible.
- [x] Replace the one-line mention launcher with the editor-owned `@agent` composer: autocomplete, transient multiline draft, Enter for lines, Shift+Enter to invoke, explicit confirmation, visible terminal execution, and review.
- [ ] Dogfood the default `@claude` path on real work, including a multiline request and a full document-context handoff.
- [ ] Dogfood the full loop on real work: write a note, invoke a Command, inspect changes, and keep or reject them.

### 5. Distill the repository

- [ ] Reduce stale tmux/transcript/plugin/harness/MCP plans and completion-plan families to the canonical docs or delete them.
- [ ] Make `README.md`, `docs/architecture.md`, `AGENTS.md`, `CONTEXT.md`, `issues.md`, and `CHANGELOG.md` describe only current behavior.
- [ ] Review the untracked Command-readiness draft files and the current dirty documentation intentionally before the branch is declared clean.

## Next — The First Exograph Vertical Slice

Start only after the trust gates above pass.

### Folder Overview and Folder Index

- [ ] Double-click a Folder to open its Overview: durable title/properties from optional `index.md`, direct children, local graph, and relevant context.
- [ ] Keep raw `index.md` accessible while hiding only its duplicate Explorer row.
- [ ] Create a Folder Index only through an explicit writable-root action; never mutate attached folders by viewing them.
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
