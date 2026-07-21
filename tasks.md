# Exo Tasks

Last updated: 2026-07-20

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
- Editor input now has a large-note sustained-typing and trusted keydown-to-frame-ready rapid multiline-backspace gate for ordinary Markdown and active `@agent` composition. Samples are recorded after forced layout; list metadata repairs stay within the affected block, table/fence metadata updates incrementally, repeated links produce one navigable Reference per target Note, and every sample asserts editor liveness and exact editor/disk content.
- `exo start` launches the resident packaged app; app-off `status` and `search`
  return workspace orientation plus path-first results for native filesystem use.
- `pnpm check`, `pnpm check:repo`, and `pnpm stable:smoke` are green on the current branch.

## Loop 01 architectural ruling — 2026-07-12

Fable approved the execution order: decide P0, then run Settings preservation and editor/invocation polish in parallel, then delete Project Roots while closing containment, then distill types/docs. The review is recorded in `docs/reviews/2026-07-12-fable-loop-01-packet.md`.

- Park or discard the uncalled Command-readiness draft; do not integrate a new settings surface without a live product caller.
- P2 is pre-authorized to remove—not empty—`workspace.projectRoots` from status output, `EXO_PROJECT_ROOTS` from Command environments, and persisted settings. `projectRoots` is a known removed key, not an unknown field to preserve.
- EXO-ISSUE-103 closes on canonical-path authorization plus expanded fail-closed coverage and guarded real-vault dogfood. Root-relative identities are a later interface-quality improvement.
- Keep P3 deliberate: no save-triggered or arbitrary-mention invocation; real-work dogfood closes the loop.

## Now — Trust Before Features

### Launch Gate B — complete

- [x] Keep Folder Overview, Explorer, Search, backlinks, breadcrumbs, Graph,
  and CLI opens on one canonical Note transaction, including unloaded children
  and already-open background tabs.
- [x] Hold trusted typing, rapid Backspace, active invocation input, navigation,
  and structured Markdown edits inside their existing frame-ready budgets with
  exact sample/content/liveness assertions and no renderer long tasks.
- [x] Isolate QMD foreground work, QMD maintenance, and WorkspaceGraph; prove
  1,200-Note concurrent responsiveness plus source and packaged real-model
  convergence.
- [x] Build the exact unsigned macOS app and dogfood a guarded 1,555-Note copy:
  Settings preservation, contained images, Properties, direct/Search opens,
  deliberate save/restart durability, and byte-identical non-control files all
  passed. Evidence: `docs/reviews/output/2026-07-20-launch-gate-b.md`.

### Launch Gate C — Invocation Changeset — complete

- [x] Audit the current invocation lifecycle, trust boundary, persistence, and
  review UI against the aligned Gate C product specs.
- [x] Define the provider-neutral Changeset contract: exact file operations,
  per-file decisions, aggregate review state, conservative rename proof, and
  clean-base derivation.
- [x] Persist clean base, launch and settled manifests, content-addressed file
  snapshots, and restart-safe review state beneath `.exo/invocations/`.
- [x] Close authorization fingerprint drift, implement a real process Stop,
  and add bounded provider-neutral activity events without streaming reasoning.
- [x] Capture every changed file inside authorized Note Roots and implement
  hash-guarded per-file and batch Keep/Reject with conflict handling.
- [x] Replace invocation modals/banners with page-native authorization,
  activity, inline review controls, a multi-file queue, and conditional History.
- [x] Prove packaged single/multi-file review, create/delete/rename reversal,
  drift conflict, restart recovery, and Gate B latency preservation.
  Evidence: `docs/reviews/output/2026-07-20-launch-gate-c.md`.

### Launch Gate D — Graph as a product surface — complete

- [x] Replace object-heavy Graph View IPC with compact typed topology,
  version/profile/transport hashes, and bounded node/Relation detail reads;
  prove payload bounds at 10K/50K/100K.
- [x] Make editor, Graph Pane, Connections, and explanatory Properties share
  one inspected Concept; make Canvas and WebGPU share one renderer-neutral
  selection/path model. The bounded Connections thumbnail now compiles through
  that same scene, label, palette, and Canvas presentation path.
- [x] Close one interaction contract across Canvas and WebGPU: click selects,
  double-click opens, repeated open focuses, frame-all is explicit, and
  keyboard/reduced-motion behavior is deterministic.
- [x] Tune legible node/hit radii, focal label budgets, direct orbit/pan/dolly,
  and adaptive wheel/pinch zoom for desktop trackpads and coarse-pointer
  gestures; retain broader physical-device tuning as product polish.
- [x] Keep the finite layout deterministic and continuous across graph updates;
  prove accurate picking, zero redraw/worker wakeups at rest, bounded labels,
  Canvas fallback, and WebGPU device-loss recovery.
- [x] Prove the Graph Pane under concurrent graph/index work without weakening
  Gate B editor/navigation budgets, then dogfood a guarded private real-vault
  copy in both renderer paths.
- [x] Remove the Experimental label only after source and exact packaged-app
  journeys, hardware-stamped scale evidence, truthful docs, and a clean launch
  surface ledger all pass. Evidence:
  `docs/reviews/output/2026-07-20-launch-gate-d.md`.

### Embedding sync strategy — research complete

- [x] Compare automatic indexing/embedding behavior and user controls in current code editors and knowledge tools using primary product documentation.
- [x] Audit QMD internals and upstream for incremental embedding, batching, scheduling, cancellation, and fork-level optimization opportunities.
- [x] Recommend an Exo sync policy with freshness targets, idle/resource gates, recovery semantics, observability, and a reversible rollout plan. See `notes/shoshin-codex/exo-embedding-sync-strategy.md`.

### Automatic embedding catch-up — implemented (`EXO-ISSUE-117`)

- [x] Attempt and record Fable review; after CLI authentication failed, proceed under Kenneth's explicit 2026-07-15 exception without claiming a ruling.
- [x] Implement the deterministic scheduler, dual-worker runtime boundary, bounded retry/backoff, and truthful pending/paused/failed status behavior.
- [x] Carry the narrow QMD 2.5.3 patch for bounded embedding calls and atomic metadata/vector publication; align desktop, core, and CLI on the patched package.
- [x] Run focused and full automated gates plus the real Electron 1,200-note concurrent update/typing/navigation latency scenario.
- [x] Add a deterministic packaged-app gate using the real embedding model that proves automatic post-idle convergence while Terminal, graph context, and hybrid search remain usable. Evidence: `docs/reviews/output/2026-07-19-derived-work-convergence.md`.

### Latency stabilization — complete

- [x] Move QMD status/search/update/embed/sync behind an out-of-process derived-data boundary and stop hybrid on-save indexing from rebuilding embeddings.
- [x] Replace save-triggered whole-workspace graph invalidation/rebuild with bounded incremental refresh behavior.
- [x] Keep the inline agent composer widget stable while typing and suppress stale rapid-navigation completions.
- [x] Add concurrent editor/navigation latency coverage using the real hybrid/on-save configuration and multiple active surfaces.
- [x] Re-run focused Electron latency gates on a realistic Workspace, then close or re-scope `EXO-ISSUE-110` from measured evidence.

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
- [x] Exercise a privacy-safe synthetic corpus matching the real vault's
  aggregate Markdown scale and depth, plus generated spaces/Unicode/
  punctuation/long-path cases, through both source Electron and the exact
  unsigned package; close the one tree-list containment gap exposed by that journey. Evidence:
  `docs/reviews/output/2026-07-19-note-root-containment-proof.json`.

### 3. Installed core loop — complete

- [x] Rebuilt, installed, and relaunched the packaged app after the renderer-recovery fix and inline invocation work.
- [x] Verified `exo` exposes resident-app `start` plus app-off `status` and
  `search`; focused Electron journey coverage remains green.
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
- [ ] Stabilize the CLI as the shell-capable agent/operator contract: retain
  orient/retrieve/explicit-invoke/desktop-handoff commands, rename
  `spawn` to `invoke`, remove shallow UI remote control, classify/update legacy
  Exo shims only through the CLI installer, and make first-run MCP/CLI states
  visibly independent. `docs/reviews/2026-07-14-cli-contract-and-installation-response.md`.

### Folder Overview and Folder Index

- [x] Double-click a Folder to open its Overview: durable title/properties from optional `index.md`, direct children, local graph, and relevant context.
- [x] Keep raw `index.md` accessible while hiding only its duplicate Explorer row.
- [x] Create a Folder Index only through an explicit Note Root action.
- [x] Test nested folders, moves/renames, missing indexes, explicit property overrides, raw-file access, and no-write viewing.

### First graph-management Skill

- [x] Run an isolated graph-visualization interaction lab before choosing an Exo graph surface; validate neighborhood, path, and overview usefulness against synthetic and then real-vault snapshots without changing production renderer/data contracts.
  - [x] Record Fable's 2026-07-16 lab ruling: keep a flat `z = 0` scene with Canvas as the reference renderer; reserve `x,y,z`/pitch without turning screen roll into fake depth; no WebGPU path until a synthetic high-density gesture gate shows Canvas p95 frame time above 8 ms. `docs/reviews/2026-07-16-fable-spatial-graph-lab-response.md`.
  - [x] Build a separate flagship true-3D spatial graph under Kenneth's explicit 2026-07-16 product override: deterministic self-suspending worker layout, WebGPU-instanced nodes/links, renderer-independent scene/picking/labels, direct orbit/pan/dolly gestures, paths, device-loss recovery, and Canvas fallback. The stable 2D kinetic prototype remains untouched; Stellar stays outside production Exo until real-graph dogfood proves it. `../exo-graph-viz-lab/stellar-contract.md`.
  - [x] Prototype a separate kinetic graph surface with worker-owned layout, stable clustered positions, semantic zoom, direct manipulation, focus/path lenses, and explicit frame-latency instrumentation; preserve the original graph-lab prototype for comparison.
  - [x] Use seeded synthetic 20 / 250 / 2,500 / 10,000-node fixtures to prove deterministic settle, picking, label collision, p95 frame time, gesture latency, memory stability, mental-map continuity, and low/high-density behavior. Private snapshots remain local-only.
  - [ ] Maintain Exo's repo-local, hardware-stamped graph performance suite: seeded 10k / 50k / 100k / 200k fixtures at edge ratios 2 / 5 / 10 / 20; representative SuiteSparse graphs; common Exo/Sigma/GraphWaGu adapters; actual frame cadence, CPU, optional GPU timestamps, input latency, memory, initialization, convergence, and layout-quality metrics.
    - [x] Land the v1 harness contract, deterministic fixtures, Exo/Sigma adapters, pinned upstream GraphWaGu preparation/adapter, canonical SuiteSparse ingestion, hardware stamps, frame/input/memory/convergence/quality metrics, count validation, and reproducible JSON/Markdown reports under `benchmarks/graphbench/`.
    - [x] Record the first M2 Max synthetic, `fe_4elt2`, product, and layout baselines in `benchmarks/graphbench/reports/2026-07-16-m2-max-baseline.md`; preserve the weak layout-quality result as a product finding.
    - [x] Make the suite reproducible inside an Exo checkout and document its monorepo boundary.
    - [ ] Add cross-adapter GPU timestamp queries and run the opt-in 100k/200k matrix on at least two hardware classes.
  - [x] Supersede the conditional WebGPU deferral under Kenneth's explicit product override while retaining the sound boundary: CPU scene/picking/labels, WebGPU pixels, and a tested Canvas fallback. The separate 10,000-node WebGPU gate is reproducible in `../exo-graph-viz-lab/stellar-density-benchmark.cjs`.
  - [x] Replace graph-lab control chrome with conventional spatial navigation: primary drag or touch drag to pan; pinch or modifier-wheel to dolly; two-finger/modifier drag to pan; tap to select; second selection to explain a path; double-tap empty space for overview; Alt+drag to move a node. No visible Map/Focus/Path/physics/angle modes.

### Production graph-system integration — accepted 2026-07-17

- [x] Create `feat/graph-system-foundation` from `main` and write the branch-
  executable plan in `docs/graph-system-implementation-plan.md`. This branch
  stops at the canonical knowledge model, Generic/OKF profiles, utility tracer,
  and renderer-neutral projection contract; Launch Gate D subsequently earned
  the production spatial integration.
- [x] Distill the visualization work, benchmark evidence, quality findings,
  domain model, and production gates in
  `docs/graph-system-report-and-plan.md`.
- [x] Record the durable schema-agnostic graph / optional Workspace Ontology
  decision in `docs/adr/0005-schema-agnostic-graph-and-knowledge-profiles.md` and
  align `CONTEXT.md`, architecture, roadmap, insight, and research logs.
- [x] Add the repo-owned `graph-system-stability` engineering skill and expose it
  to Claude/Codex contributors; formally retire the fixed-taxonomy, scheduled-
  mutation `graph-evolve` vault skill. Defer `evaluate-exograph`,
  `find-connect-context`, and `propose-knowledge-profile` until their underlying
  contracts exist.
- [ ] Phase 0: pin one public Google OKF bundle and one OpenWiki wiki fixture and
  define deterministic schema/compatibility cases with expected facts.
- [x] Phase 1: consolidate `GraphSnapshot` and `WorkspaceGraph` behind snapshot
  0.3 with open Concept types, lossless Properties, Relation predicates,
  origin, resolution, and Evidence; preserve current Connections, Folder
  Overview, and search behavior through compatibility tests.
  - [x] Land snapshot 0.3 behind `WorkspaceGraph`: open Concept types, recursive
    Properties, Relation origin/resolution/Evidence, deterministic identity,
    and compatibility coverage; remove the legacy snapshot/query, object Graph
    View, unbounded detail, and duplicate renderer-scene contracts after audit.
- [ ] Phase 2: add Generic Markdown and permissive OKF 0.1 Formats, then earn
  the smallest reviewed Workspace Ontology contract from fixtures.
  - [x] Add built-in Generic Markdown and permissive OKF 0.1 interpretation;
    missing OKF type is a finding and unknown fields survive. User-owned
    Candidate parsing/compilation and persisted Active checkpointing are now
    implemented; graph-effect preview and product Keep/Reject remain unearned.
- [x] Phase 3: cover identity, resolution, Evidence, and Format/Ontology conformance in
  deterministic graph contract tests. Keep AI-system evaluation outside Exo.
- [x] Phase 4: compile renderer-neutral dense topology and stable layout epochs
  from the consolidated graph; keep ontology strings and semantics out of hot
  renderer paths.
  - [x] Add deterministic projection, a finite worker layout, and scene-level
    picking/path/camera tests.
  - [x] Replace object IPC with compact typed topology plus epoch-qualified,
    bounded detail reads and deterministic 10K/50K/100K payload gates; preserve
    stable surviving scene state across graph generations (`EXO-ISSUE-119`).
- [x] Phase 5: integrate the spatial renderer as a normal Graph Pane after
  source and packaged-app
  interaction, fallback, accessibility, quiescence, continuity, and editor-
  latency-under-load gates pass on a private real-Workspace copy.
  - [x] Prove the pane and IPC boundary through hardware WebGPU and the complete
    Canvas recovery path; source and exact-package interaction passed.
  - [x] Close the production portion of `EXO-ISSUE-121`: tune node legibility and trackpad/pinch zoom;
    add an editor Graph action focused on the current Note; unify single-select,
    double-click-open, repeated-node-focus, and explicit frame-all semantics;
    rebuild Connections/Properties around one inspected Concept, and compile
    the compact Connections neighborhood through the full presentation path.
    Broader physical-device polish remains a follow-up.
- [ ] Phase 6: ship **Find and connect relevant context** through the existing
  configured-Command review loop and measure product behavior before adding
  another Skill.
- [ ] Phase 7: prototype ontology onboarding only after the graph model can show
  a meaningful, reversible before/after result.

### Dev → main promotion checkpoint — Fable reviewed 2026-07-17

- [x] Fast-forward and push `dev` to the exact reviewed graph checkpoint
  `5cf870a`; keep `main` unchanged.
- [x] Run exact-tree evidence: `ci:check`, 9/9 stable smoke, GraphBench, and
  unsigned macOS packaging passed. Seven of eight latency scenarios passed;
  only the tracked Node 26 CLI process-start floor missed p50.
- [x] Obtain Fable ruling: **approve after listed fixes**. Review artifacts:
  `docs/reviews/2026-07-17-dev-to-main-promotion-fable-{packet,response}.md`.
- [x] Fix Fable F1–F3: backlink-source neighborhoods, typed focused Graph
  expansion, and unchanged-snapshot layout refresh stability.
- [x] Add the packaged graph interaction journey and split CLI startup-floor
  measurement from Exo-side navigation work without weakening in-app budgets.
- [x] Re-run `ci:check`, `stable:smoke`, full `test:e2e`, latency gates, and
  `pack:mac` on the exact fixed tree; merge that SHA to `main`, then return to
  `dev` for the explicitly deferred graph/profile roadmap.

- [ ] Ship one provider-neutral, editable **Find and connect relevant context** skill through an existing trusted Command.
- [ ] Combine Search with links, backlinks, tags, properties, and neighborhood evidence.
- [ ] Require explanations and reviewable proposed Markdown/frontmatter changes; inferred similarity stays derived.
- [ ] Verify proposals remain understandable, reviewable, and reversible before adding another skill.

## Dogfood Queue

- [ ] Use Exo for non-Exo work and promote only repeatable friction into `issues.md`.
- [ ] Publish the reviewed `dev` candidate only after the full stable smoke,
  installed-app durability, and editor latency suite are green. Keep `main`
  unchanged until then (`EXO-ISSUE-120`).
- [x] Resolve `EXO-ISSUE-118`: reproduce the breadcrumb Folder-contents and
  active-invocation throughput regressions in a clean worktree before accepting
  the graph foundation; do not weaken the existing latency budgets.
- [ ] Investigate `EXO-ISSUE-116`: capture and reduce the non-reproducible
  blank renderer seen while typing an inline `@agent` request; add a
  renderer-liveness regression once a minimal sequence exists.
- [ ] Monitor `EXO-ISSUE-104` preview/window lifecycle evidence; reopen only with a clean repro artifact.
- [ ] Dogfood Folder Overview on a real vault: nested folders, explicit index creation, raw-index editing, and rename/delete continuity.

## Explicitly Deferred

Do not reopen Plugin Manager, routines, a harness manager, Feed/Gym/training, cloud indexing, or a general extension runtime. The only MCP surface permitted is the narrow, read-only Exo server explicitly installed into Claude/Codex during setup; it is not an MCP manager, arbitrary-server form, plugin system, or mutation surface. A future Plugin is a distribution bundle only after proven skills, Commands, and providers need repeatable installation, versioning, or sharing.

-- Shoshin | 2026-07-11
