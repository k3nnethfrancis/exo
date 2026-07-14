# Exo Tasks

Last updated: 2026-07-13

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

- The UI convergence wave is installed and passing: compact Settings, centered search, breadcrumbs, title/properties chrome, one resizable utility pane, Preview/Terminal/Connections switching, direct terminal creation, and drag-to-split live terminal/preview tabs.
- Explorer file lists have a scroll-safe lower edge: the floating workspace menu owns a reserved, content-free landing area and rows fade out before reaching it.
- The direct-PTY terminal and configured Command readiness/Test flow are live.
- Editor input now has a large-note sustained-typing and rapid multiline-backspace gate for ordinary Markdown and active `@agent` composition; invocation protocol and live-preview structural metadata avoid whole-note reparsing for unrelated edits.
- `exo start` launches the resident packaged app; app-off `status`, `search`, and `read` remain useful through filesystem roots.
- `pnpm check`, `pnpm check:repo`, and `pnpm stable:smoke` are green on the current branch.

## Loop 01 architectural ruling — 2026-07-12

Fable approved the execution order: decide P0, then run Settings preservation and editor/invocation polish in parallel, then delete Project Roots while closing containment, then distill types/docs. The review is recorded in `docs/reviews/2026-07-12-fable-loop-01-packet.md`.

- Park or discard the uncalled Command-readiness draft; do not integrate a new settings surface without a live product caller.
- P2 is pre-authorized to remove—not empty—`workspace.projectRoots` from status output, `EXO_PROJECT_ROOTS` from Command environments, and persisted settings. `projectRoots` is a known removed key, not an unknown field to preserve.
- EXO-ISSUE-103 closes on canonical-path authorization plus expanded fail-closed coverage and guarded real-vault dogfood. Root-relative identities are a later interface-quality improvement.
- Keep P3 deliberate: no save-triggered or arbitrary-mention invocation; real-work dogfood closes the loop.

## Now — Trust Before Features

### Invocation follow-up loop — complete

- [x] Give every note invocation a compact Exo Workspace, wikilink, Search, and
  response/edit contract without injecting the whole vault or rebuilding a
  harness.
- [x] Make the page-native response envelope and ordinary reviewable edits
  visually and semantically distinct.
- [x] Replace the detached raw patch with inline editor review using retained
  before/after snapshots; keep invocation-level Keep/Reject for the first slice.
- [x] Add Fable-approved per-Command fresh/continued provider-session policy,
  Workspace-local derived heads, visible provenance, fail-visible concurrency,
  stale-session fallback, reset, migration, and cross-Workspace isolation.
- Review packet: `docs/reviews/2026-07-13-invocation-context-session-review-packet.md`.
- Verification: `docs/reviews/output/session-continuity-implementation-status.md`.

### 1. Finish Settings preservation proof — `EXO-ISSUE-102`

- [x] Prove opening, waiting, closing, and reopening Settings performs no write when unchanged.
- [x] Prove appearance/search/terminal-only edits preserve Commands, layout, unknown keys, and migration metadata. `3b90db2` adds an Electron journey across every non-structural section and fixes V2 canvas-layout normalization.
- [x] Prove stale/concurrent settings patches reject rather than silently overwrite one another.
- [x] Prove a saved Command remains invokable after every Settings round trip.

### 2. Finish Note Root containment proof — `EXO-ISSUE-103`

- [x] Keep canonical-path authorization behind `WorkspaceFiles`; Fable explicitly deferred root-relative identities as a later interface-quality improvement.
- [x] Complete escape coverage: traversal, absolute paths, duplicate roots, symlink files/directories, missing ancestors, rename, recursive delete, and former Project Root paths failing closed after removal.
- [x] Prove desktop IPC and command-server reads share the same containment seam.
- [ ] Dogfood a guarded copy of the real vault before closing the issue.

### 3. Installed core loop — complete

- [x] Rebuilt, installed, and relaunched the packaged app after the renderer-recovery fix and inline invocation work.
- [x] Verified `exo` exposes resident-app `start` plus app-off `status`, `search`, and `read` modes; focused Electron journey coverage remains green.
- [x] The remaining terminal and first-launch observations are ordinary dogfood follow-ups, not a blocker for the shipped core loop.

### 4. Finish the editor and invocation loop

- [x] Polish live Markdown typography, list hierarchy, indentation, and spacing with Electron coverage; human visual inspection remains in the dogfood gate.
- [x] Make new Markdown notes start with an editable H1; at the initial caret, Markdown syntax remains visible.
- [x] Replace the one-line mention launcher with a page-native `@agent` composer: autocomplete, in-document multiline request text, agent-colored highlight, anchored send affordance, Enter for lines, Command+Enter/click to invoke, explicit confirmation, headless execution, optional provider-session handoff to Shell, and review. `e4ffb89` plus the July 13 invocation repair.
- [x] Prove the real default `@claude` command edits a tagged note headlessly, returns session provenance, and produces a pending review from the exact saved document baseline. Real-work personal dogfood remains in `EXO-ISSUE-106`.
- [x] Dogfood the full loop on real work and through a live two-turn Electron
  gate that proves Claude resumes provider context after its first-turn source
  is removed.
- [x] Require inline Commands to perform the requested durable Workspace work, capture provider session provenance where available, show exact tagged-document diffs with Keep/Reject, and offer a Claude `Resume in Shell` handoff after completion.
- [x] Establish the V1 document-agent protocol: a UUID-addressed, inert `<exo-invocation>` source envelope and a linked `<exo-agent-response>` result envelope; Exo renders both as page-native Markdown while retaining raw portability. `docs/document-agent-protocol.md`.

### 5. Distill the repository

- [x] Decide P0: discard the uncalled Command-readiness draft and make a keep/discard decision for current dirty docs before P4; do not polish stale material in place.
- [x] Reduce stale tmux/transcript/plugin/harness/MCP plans and completion-plan families to the canonical docs or delete them.
- [x] Delete Attached Folder / Project Root configuration, UI, IPC, and documentation rather than renaming the old project-context model.
- [x] Run a type and data-model review: every durable type, persisted setting, IPC payload, and filesystem object has one current product meaning, an owning module, validation/normalization where needed, and no legacy aliases or dead fields.
- [x] Refresh the documentation system as one coherent set: vision (`ashby.md`), `CONTEXT.md`, README, architecture, feature/interaction docs, ADRs, roadmap, tasks, issues, and changelog agree with the shipped note-native product and link to canonical sources rather than duplicate stale plans.
- [x] Add a compact feature/data-model coverage index so a future worker can locate the implementation, tests, user-facing behavior, and source-of-truth documentation for every retained feature.
- [x] Review the untracked Command-readiness draft files and the current dirty documentation intentionally before the branch is declared clean.

## Next — The First Exograph Vertical Slice

Start only after the trust gates above pass.

### Product-model discovery: one Exo workspace, multiple wikis, and importable Markdown folders

- [x] Research current LLM-wiki practice and decide the future unit: `Workspace` is the existing named Markdown scope; do not add a Wiki type or restore Project Roots. `docs/adr/0004-workspace-is-the-scope-object.md`.
- [x] Define the operator model: per-Workspace indexes and trust; any future global view is a read-only, scope-qualified fan-out projection, never a writable/invokable Workspace.
- [x] Decide Skills/automations: Skills are Workspace-owned Markdown in a writable Note Root; human-triggered configured-Command invocation and diff review come first. No scheduler, hidden graph updates, global precedence, or plugin runtime.
- [ ] Dogfood personal and project-adjacent Workspaces for 2–4 weeks. Log real switching friction and concrete cross-scope requests; only recurring need may earn CLI-only `exo search --all` research.
- [x] Start a durable product-insight log at `notes/shoshin-codex/projects/exo/insights.md`; capture evidence, confidence, decision influence, and next validation rather than turning every observation into scope.

### Launch onboarding discovery — deliberately deferred

- [ ] Before launch, define and evaluate a human-approved ontology onboarding flow: selected active-Workspace Note Roots, global retrieval across those roots, configured Command selection, a provider-neutral ontology proposal, before/after graph comparison, explicit migration-plan approval, and ordinary diff review. Do not begin implementation until the current invocation/dogfood gates and a bounded fixture/eval packet are complete. `notes/shoshin-codex/projects/exo/insights.md#2026-07-13--ontology-first-onboarding-could-make-the-initial-graph-personally-valuable`.

### First-run essentials — 2026-07-13

- [x] Make first-run choose exactly one main wiki; separate wikis remain separate Workspaces for now.
- [x] Restore a narrow Exo MCP discovery server for Claude/Codex installation: `workspace_status` and `search_notes` expose scope and ranked note metadata. It is not a general MCP manager, plugin runtime, arbitrary-server form, or note-reading/write surface.
- [x] Reorder first-run as main wiki → optional Exo MCP install → editable local Claude/Codex invocation Commands. Commands have clear recommended defaults and a fully visible, editable command value.
- [x] Implement the Exo MCP scope contract: freeze the two discovery tools (`workspace_status`, `search_notes`); resolve retrieval from caller cwd with only an unambiguous single-Workspace fallback; report resolved scope in status; refuse ambiguity; and prevent app retrieval from crossing Workspace scope.
- [ ] Stabilize the Exo MCP public contract: add bounded-output/protocol coverage, document provider-native removal, and dogfood 10–20 real Claude/Codex context-seeking sessions before treating ambient instruction templates as earned.

### Folder Overview and Folder Index

- [x] Double-click a Folder to open its Overview: durable title/properties from optional `index.md`, direct children, local graph, and relevant context.
- [x] Keep raw `index.md` accessible while hiding only its duplicate Explorer row.
- [x] Create a Folder Index only through an explicit Note Root action.
- [x] Test nested folders, moves/renames, missing indexes, explicit property overrides, raw-file access, and no-write viewing.

### First graph-management Skill

- [ ] Ship one provider-neutral, editable **Find and connect relevant context** skill through an existing trusted Command.
- [ ] Combine Search with links, backlinks, tags, properties, and neighborhood evidence.
- [ ] Require explanations and reviewable proposed Markdown/frontmatter changes; inferred similarity stays derived.
- [ ] Measure retrieval lift, irrelevant-context cost, edit burden, and proposal acceptance before adding another skill.

## Dogfood Queue

- [ ] Use Exo for non-Exo work and promote only repeatable friction into `issues.md`.
- [ ] Monitor `EXO-ISSUE-104` preview/window lifecycle evidence; reopen only with a clean repro artifact.
- [ ] Dogfood Folder Overview on a real vault: nested folders, explicit index creation, raw-index editing, and rename/delete continuity.

## Explicitly Deferred

Do not reopen Plugin Manager, routines, a harness manager, Feed/Gym/training, cloud indexing, or a general extension runtime. The only MCP surface permitted is the narrow, read-only Exo server explicitly installed into Claude/Codex during setup; it is not an MCP manager, arbitrary-server form, plugin system, or mutation surface. A future Plugin is a distribution bundle only after proven skills, Commands, and providers need repeatable installation, versioning, or sharing.

-- Shoshin | 2026-07-11
