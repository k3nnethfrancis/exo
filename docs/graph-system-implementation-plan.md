# Graph system foundation implementation plan

Status: historical implementation record. The foundation, clean replay,
production Graph Pane (Gate D), and reviewed Workspace Ontology activation
(Gate E) are complete on the clean launch branch. Current execution lives in
`../tasks.md`, `launch-surface-ledger.md`, and `ontology-review-implementation-plan.md`.
Branch recorded here: `feat/graph-system-foundation`
Date: 2026-07-17; status recentered 2026-07-20

Terminology note: this plan predates the final separation between Note Root
Formats and the user-owned Workspace `ontology.yaml`. Its `KnowledgeProfile`
code name now refers only to the bounded internal Format-compatibility seam;
it is not a second user-facing profile or ontology system.

All branch, worktree, pending-gate, and test-count statements below record the
2026-07-17 implementation checkpoint. They are retained as engineering history,
not current instructions.

## Outcome

This branch gives Exo one schema-agnostic Knowledge Graph that:

- projects canonical Markdown into open Concepts, Properties, Relations, and
  Evidence;
- preserves current Connections, Folder Overview, backlinks, search hydration,
  incremental refresh, and derived-process behavior;
- supports Generic Markdown without configuration and permissive Open Knowledge
  Format 0.1 interpretation;
- measures mechanical integrity as independent evidence-backed dimensions,
  without inventing a universal score;
- compiles a renderer-neutral dense projection; and
- proves that projection through a normal Exo Graph Pane and the existing
  Connections surface, using a finite worker layout and Canvas renderer.

The in-app renderer is deliberately a tracer, not the final Stellar port. It
proves the semantic boundary, derived-process transport, pane lifecycle,
selection, paths, camera interaction, and real-Workspace usefulness before
WebGPU enters the app. Production Stellar remains a separate replacement of the
pixel/layout layer after the acceptance gates below. This keeps the rollback
boundary small and leaves `main` usable throughout the work.

Canonical architecture:

- `graph-system-report-and-plan.md`
- `adr/0005-schema-agnostic-graph-and-knowledge-profiles.md`
- `../CONTEXT.md`
- `architecture.md`
- `../skills/graph-system-stability/SKILL.md`

## Branch and worktree discipline

The branch was created from the current `main` commit without changing the
`main` ref. The existing worktree already contained unrelated uncommitted Exo
work before branch creation. Therefore:

- never use `git add .`, `git add -A`, or broad formatting over the repository;
- stage only the files or explicit hunks owned by the current work package;
- record graph commits independently from the pre-existing derived-index,
  invocation, onboarding, and UI changes;
- do not reset, clean, stash, or overwrite unrelated work;
- before merge, replay the graph-only commits onto a clean worktree based on the
  latest `main` and rerun all gates there; and
- merge only after the clean-worktree proof, never directly from a mixed dirty
  worktree.

`main` and this branch currently share the same base commit (`407a746`). All
implementation is still uncommitted in the feature worktree, so no graph code
can reach `main` accidentally. The acceptance step must create graph-only
commits, replay them into a clean worktree, and prove the final diff before any
merge decision.

## Current implementation status

| Slice | State | Evidence / remaining gate |
| --- | --- | --- |
| Open Knowledge Graph 0.3 | tracer complete | open Concept Types, recursive Property values, Relation origin/resolution/Evidence, deterministic snapshot tests |
| Generic Markdown Format | tracer complete | zero-configuration interpretation covered by core tests |
| Permissive OKF 0.1 Format | tracer complete | unknown fields survive; missing `type` is a finding rather than rejection |
| Graph contract tracer | tracer complete | identity, resolution, Evidence, and conformance dimensions; no aggregate score |
| Dense Graph View projection | tracer complete | deterministic numeric topology; tag facts remain canonical but tag hubs are omitted from the default view |
| Derived-process transport | tracer complete | `graph-view` runs outside Electron's renderer/main critical path with bounded IPC response handling |
| Normal Graph Pane | tracer complete | Canvas view in Connections and Workspace Canvas; select, shortest path, orbit, pan, zoom, frame, refresh |
| Real-Workspace dogfood | passed in development Electron | 2,719 visible concepts / 1,929 links after default-view suppression; selection and path exercised with no renderer error |
| Interoperability fixtures | pending | pin OKF/OpenWiki subsets and freeze expected schema and relation facts |
| Stellar/WebGPU production renderer | pending | port only after packaged-app, fallback, accessibility, quiescence, continuity, and editor-latency gates |
| Clean replay | pending | isolate graph-only hunks from pre-existing dirty work, build/package, and review final branch diff |

This status table is the branch source of truth. The detailed work packages below
remain the acceptance sequence, including work that has not yet been earned.

### Verification ledger — 2026-07-17

- `pnpm ci:check`: passed, including repository checks, all package typechecks,
  17 core files / 118 tests, 32 desktop files / 239 tests, 4 CLI files / 27
  tests, production builds, and local-install dry run.
- Real development Electron against a private Workspace: Graph opened in
  Connections and a normal split Pane; selection and second-selection path
  behavior worked; no renderer errors were observed.
- Concurrent derived-work Electron gate with 1,200 Notes: typing 11.7 ms p90,
  navigation 41.2 ms p90, zero long tasks.
- Stellar reference gate: desktop/mobile passed with 0.4 ms p95 frame work and
  zero label overlaps. The 10,000-node / 17,500-link case settled in 4.52 s at
  1.2 ms p95 frame work.
- GraphBench unit-quality contract passed. The combined Exo/Sigma smoke was
  terminated after the Exo case completed because the Sigma adapter stalled;
  record/fix that harness behavior before using the comparison as merge proof.
- The full editor-latency suite is not green in this mixed worktree: the known
  Node 26 CLI-startup issue measured 106 ms p50; breadcrumb Folder contents
  measured 128 ms p50; active invocation throughput measured 34 ms/character.
  The Graph Pane was never opened in these cases. These failures are acceptance
  blockers for clean replay, not reasons to weaken budgets or add graph
  fallbacks.

## Reduction decision record

### Requirement ledger

| Requirement | Source / owner | Evidence | Verdict |
| --- | --- | --- | --- |
| Markdown and frontmatter remain canonical | Exo product contract / Kenneth | `CONTEXT.md`, ADR 0005, current app | **keep** |
| Unknown properties and types survive | OKF interoperability and user ownership / Kenneth | OKF 0.1; current permissive frontmatter | **keep** |
| One production graph model | simplification architecture / Exo | current duplicate `GraphSnapshot` and `WorkspaceGraph` | **keep** |
| Current Connections and Folder behavior cannot regress | shipped user behavior / Exo | renderer, IPC, core tests | **keep** |
| Derived graph work cannot block typing or navigation | measured performance invariant / Exo | ADR 0003, latency E2E | **keep** |
| Relations explain origin, resolution, and Evidence | quality model / Kenneth | graph report and OKF/OpenWiki analysis | **keep** |
| Generic Markdown works without setup | product simplicity / Kenneth | Exo launch direction | **keep** |
| OKF 0.1 is the first optional interoperability Format | product decision / Kenneth | ADR 0005 | **keep** |
| Graph integrity must be verified separately from layout | graph experiment / Kenneth | graph performance baseline | **keep** |
| Stellar ships in the same branch | inherited implementation convenience | no user requirement; raises rollback and review cost | **delete** |
| Snapshot 0.2 requires a long-lived compatibility layer | earlier plan assumption | current caller inventory shows old snapshot APIs are tests/docs only | **question; delete unless an external caller is proven** |
| A profile registry or profile UI is needed now | implementation convention | no validated user workflow | **delete** |
| Semantic similarity should create graph edges | earlier product possibility | conflicts with Evidence and review model | **delete** |

### Smallest coherent system

Keep four production concepts:

1. `graph.ts` — pure open graph data contract.
2. `WorkspaceGraph` — the one builder, cache, resolver, incremental updater, and
   query boundary.
3. `KnowledgeProfile` — a small pure interpreter selected explicitly or detected
   from a fixture; Generic Markdown and OKF are its first two implementations.
4. `GraphProjection` — a pure compiler from semantic graph facts to dense numeric
   topology, with no renderer dependency.

Delete the standalone legacy snapshot builder/query path once its useful tests
and behavior have moved into `WorkspaceGraph`. Do not introduce a third service,
database, registry, event bus, or renderer-specific graph model.

## Target data contract

Names may be adjusted during the red-test pass, but ownership and semantics are
fixed:

```ts
export type GraphPropertyValue =
  | null
  | boolean
  | number
  | string
  | readonly GraphPropertyValue[]
  | { readonly [key: string]: GraphPropertyValue };

export interface GraphConcept {
  id: string;
  noteId?: string;
  rootId?: string;
  relativePath?: string;
  filePath?: string;
  label: string;
  conceptType?: string;
  properties: Readonly<Record<string, GraphPropertyValue>>;
  resolution: "resolved" | "unresolved" | "external";
}

export interface GraphRelation {
  id: string;
  source: string;
  target: string;
  family:
    | "link"
    | "property-reference"
    | "tag-membership"
    | "hierarchy"
    | "semantic";
  predicate?: string;
  origin: "document" | "ontology" | "inferred";
  resolution: "resolved" | "unresolved" | "ambiguous" | "external";
  confidence?: number;
  evidence: readonly GraphEvidence[];
}

export interface GraphEvidence {
  kind: "source-span" | "property" | "path" | "ontology-rule" | "model";
  noteId?: string;
  property?: string;
  sourceRange?: { from: number; to: number };
  producer?: { id: string; version: string };
}

export interface KnowledgeGraphSnapshot {
  version: "0.3";
  snapshotId: string;
  generatedAt: string;
  scope: GraphScope;
  concepts: readonly GraphConcept[];
  relations: readonly GraphRelation[];
  findings: readonly GraphFinding[];
}
```

Rules:

- Stable IDs are Workspace/root/path-qualified; absolute paths remain cold local
  metadata, not portable identity.
- Properties preserve every supported YAML value without stringifying arrays or
  nested objects.
- A Markdown link produces a document-origin `link` Relation with source-span Evidence.
- A tag produces a `tag-membership` Relation; the tag may be a Concept in a
  compiled View without becoming a Note.
- Folder containment produces a `hierarchy` Relation with path Evidence.
- A kept Ontology reference Property produces an ontology-origin
  `property-reference` Relation with both Property and ontology-rule Evidence.
- Semantic observations use `origin: "inferred"`, include producer version and
  confidence, and are excluded from canonical neighborhoods unless a caller
  explicitly requests them.
- Findings are evidence-backed warnings/errors. They do not mutate Notes or
  prevent Generic Markdown use.

## File ownership

### Core files expected to change

- `packages/core/src/graph.ts`
- `packages/core/src/workspace-graph.ts`
- `packages/core/src/index.ts`
- `packages/core/src/types.ts` only where `WorkspaceGraphContext` requires it
- `packages/core/src/__tests__/workspace-graph.test.ts`
- existing graph snapshot/query tests while behavior is migrated

### Duplicate core files considered for removal after parity

- `packages/core/src/graph-snapshot.ts`
- `packages/core/src/graph-query.ts`
- tests that only preserve the superseded duplicate API

Deletion is conditional on a fresh caller audit and the protected-contract
checkpoint. Reuse their link-resolution cases and deterministic snapshot tests;
do not preserve forwarding wrappers without a caller.

### New focused foundation files

- `packages/core/src/knowledge-profile.ts`
- `packages/core/src/graph-projection.ts`
- `packages/core/src/graph-integrity.ts`
- `packages/core/src/__tests__/knowledge-profile.test.ts`
- `packages/core/src/__tests__/graph-projection.test.ts`
- `packages/core/src/__tests__/graph-integrity.test.ts`

Do not create profile subclasses, registries, factories, persistence stores, or
ontology-specific UI. The Graph Pane tracer is the sole UI exception: it exists
to verify that the contract is usable and remains replaceable by Stellar.

### Desktop and renderer consumers

These should retain their current user-facing behavior:

- `apps/desktop/src/main/derived-index-worker.ts`
- `apps/desktop/src/main/derived-index-protocol.ts`
- `apps/desktop/src/main/workspace-notes-service.ts`
- `apps/desktop/src/shared/api.ts`
- `apps/desktop/src/renderer/src/graphAffordances.ts`
- `apps/desktop/src/renderer/src/hooks/useOpenDocuments.ts`
- `apps/desktop/src/renderer/src/components/InspectorDock.tsx`

Prefer keeping `WorkspaceGraphContext` stable during the foundation migration.
Add optional evidence/profile fields only after existing serialized fixtures
pass. The tracer currently transports a bounded `GraphViewBundle` over the
derived utility-process channel so the Graph Pane can inspect a selected
Concept. Before scaling beyond the current private Workspace, measure payload
size and split cold Concept detail from dense topology if the 8 MiB response
bound or initialization budget is approached.

## Work packages

### WP0 — Clean fixture and contract packet

**Purpose:** freeze expected knowledge before changing code.

1. Record exact revisions, licenses, and source URLs for one small Google OKF
   bundle and one OpenWiki-generated wiki.
2. Include only the smallest redistributable subset needed for tests; otherwise
   provide a checksum-pinned preparation script instead of copying content.
3. Add deterministic synthetic fixtures for:
   - nested scalar/array/object properties;
   - unknown concept types and properties;
   - path collisions across Note Roots;
   - resolved, ambiguous, unresolved, and external links;
   - typed reference properties;
   - hierarchy and tags;
   - malformed frontmatter and missing OKF `type`; and
   - derived semantic observations with producer versions.
4. Freeze expected identity, property, relation, resolution, and preservation
   facts independently of any renderer.

**Gate:** another engineer can inspect fixtures and expected graph facts without
running Exo.

**Commit:** fixtures, manifest, tasks, and expected answers only.

### WP1 — Characterization tests before migration

**Purpose:** make current behavior a compatibility contract.

1. Capture current `WorkspaceGraphContext` for representative existing fixtures.
2. Add cases for link labels, duplicate basenames, relative paths, external
   links, tags, frontmatter, backlinks, neighborhoods, incremental refresh,
   deletion, and deterministic ordering.
3. Add a build-count/read-count assertion so the migration cannot accidentally
   reintroduce whole-Workspace work per query.
4. Add a derived-process serialization fixture for `WorkspaceGraphContext`.

**Gate:** tests fail for an intentional resolution/order/context regression and
pass against the current implementation.

**Commit:** characterization tests only.

### WP2 — Canonical open graph model

**Purpose:** deepen `WorkspaceGraph` without changing desktop behavior.

1. Replace closed ontology kinds with `GraphConcept`, `GraphRelation`,
   `GraphEvidence`, and lossless property values.
2. Build one immutable internal snapshot inside `WorkspaceGraph`.
3. Move deterministic IDs, resolution, backlinks, neighborhoods, findings, and
   snapshot hashing onto that state.
4. Attach Evidence during extraction rather than reconstructing it in the UI.
5. Preserve watcher-driven `refreshFile` and generation/race protections.
6. Adapt current `WorkspaceGraphContext` queries from the canonical snapshot.
7. Prove current desktop/core behavior through WP1 tests.

**Gate:** current context payloads remain compatible; open properties and
Evidence pass new tests; cold build and incremental refresh do not regress their
existing latency/read-count budgets.

**Commit:** canonical model and WorkspaceGraph migration.

### WP3 — Delete the duplicate graph path

**Purpose:** finish consolidation instead of freezing two APIs forever.

1. Repeat repository and package-consumer search for `GraphSnapshot`,
   `buildGraphSnapshot`, and free graph-query functions.
2. Determine whether any published consumer exists beyond tests/docs.
3. If no consumer exists, migrate useful tests, remove the duplicate exports and
   files, and update stale agent-plan references.
4. If a real consumer exists, write the smallest time-bounded adapter and name
   its deletion release/task. Do not maintain two builders.

**Protected-contract checkpoint:** removing exported snapshot symbols requires
explicit architecture approval with the caller inventory and proposed diff.
Kenneth is the product decision-maker; Fable review is optional evidence, not a
blocking ceremony unless requested.

**Gate:** `rg` finds no live duplicate builder/query caller; core typecheck,
tests, and desktop typecheck pass.

**Commit:** deletion or explicitly bounded adapter.

### WP4 — Generic Markdown and OKF profiles

**Purpose:** prove optional interpretation without building a schema platform.

1. Define the smallest pure `KnowledgeProfile` interface from two concrete
   implementations—not from imagined providers.
2. Generic Markdown:
   - no required fields;
   - one Concept per Note;
   - ordinary links, tags, hierarchy, and preserved properties.
3. OKF 0.1:
   - one Concept per non-reserved Markdown document;
   - bundle-relative path identity;
   - required nonempty `type` finding;
   - ordinary Markdown relation links;
   - reserved `index.md` / `log.md` behavior;
   - arbitrary unknown properties preserved; and
   - unknown types rendered/interpreted generically.
4. A Workspace Ontology may identify reference-valued Properties and validation
   rules. It may not execute code or write Notes.
5. Profile selection remains API/config input in this branch; no onboarding or
   settings UI.

**Gate:** both public fixtures load without mutation; unknown fields survive;
every Ontology Relation cites Property/rule Evidence; absent/unknown Ontologies
fall back safely to Generic Markdown.

**Commit:** profile contract and two implementations.

### WP5 — Graph contract tracer

**Purpose:** verify graph semantics independently from rendering.

1. Implement a deterministic runner over the WP0 fixture/task contract.
2. Report separate dimensions:
   - conformance;
   - integrity;
   - semantic alignment when a derived provider is supplied;
   - stability/determinism.
3. Verify path identity, document links, tags/Properties/Ontology Relations, and
   deterministic precomputed semantic observations.
4. Emit versioned JSON and concise Markdown. Do not aggregate dimensions into a
   universal score.
5. Add corruption runs that remove types, links, tags, or reference properties
   and confirm the affected dimension/task changes in the expected direction.

**Gate:** the runner detects known corruptions, preserves unknown data, and is
deterministic without affecting editor latency.

**Commit:** contract runner, metric definitions, and first baseline report.

### WP6 — Renderer-neutral projection contract

**Purpose:** give later Stellar integration one fast input without importing
ontology into pixels.

1. Compile a selected semantic snapshot into:
   - dense numeric Concept indices;
   - CSR adjacency;
   - numeric relation style classes local to the View;
   - edge weights explicitly derived from view rules;
   - group/facet indices;
   - degrees and stable seeds; and
   - cold metadata lookup by dense index.
2. Keep strings and arbitrary property objects out of hot layout/draw arrays.
3. Make inclusion of derived Relations explicit.
4. Make the same graph/profile/view versions produce the same projection hash.
5. Verify that unknown types receive deterministic generic classes.

**Gate:** deterministic projection tests pass at 20, 250, 2,500, and 10,000
Concepts; projection is renderer-independent and contains enough cold metadata
to explain every selected Relation.

**Commit:** pure projection compiler and scale tests.

### WP7 — Foundation acceptance and clean replay

1. Run the full focused gates below.
2. Generate a before/after type and dependency inventory proving one graph model
   replaced two.
3. Record benchmark hardware, fixtures, commands, and outputs.
4. Update architecture, roadmap, tasks, changelog, and public contract ledger.
5. Reproduce graph-only commits on a clean worktree from latest `main`.
6. Run `pnpm ci:check` in that clean worktree.
7. Review the merge as a foundation plus interaction-tracer change, not as proof
   that the production Stellar/WebGPU renderer is finished.

**Gate:** clean replay and CI pass; no user Markdown migration occurred; current
installed Exo behavior remains intact.

## Test matrix

### Required on every graph-model work package

```bash
pnpm --filter @exo/core typecheck
pnpm --filter @exo/core test
```

### Required when `WorkspaceGraphContext`, workers, or desktop consumers change

```bash
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
```

Run the focused derived-work/editor latency specs whenever graph construction,
incremental refresh, worker protocol, or query timing changes:

```bash
pnpm --filter @exo/desktop build
pnpm exec playwright test -c apps/desktop/playwright.config.ts \
  apps/desktop/tests/e2e/derived-work-latency.spec.ts \
  apps/desktop/tests/e2e/editor-latency.spec.ts
```

### Foundation acceptance

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm ci:check
```

Graph performance/Stellar gates are not required for pure semantic-model commits,
but they are required before accepting the Graph Pane tracer because this branch
now changes spatial interaction. Never use them as substitutes for graph
contract tests.

## Performance budgets

- Ordinary typing and Note opening remain within existing editor latency gates.
- A graph context query against a warm snapshot performs no file reads.
- One file watcher event reparses and re-resolves only the affected Note plus
  bounded dependent indexes; it does not rebuild every document.
- Cold graph construction reports p50/p90 over representative 400-, 2,500-, and
  10,000-Note synthetic fixtures before the branch merges.
- Projection of a settled 10,000-Concept snapshot must not require DOM or GPU
  access and must be deterministic.

Do not invent tighter numeric cold-build budgets before measuring the current
foundation on the same fixtures. Record the baseline first, then set a regression
budget with explicit hardware.

## Stop conditions

Stop the affected work package and report evidence if:

- lossless property preservation requires changing the Markdown parser or save
  contract beyond this branch;
- a real external consumer makes deletion of the old snapshot API consequential;
- canonical IDs cannot be made stable across the selected multi-root fixtures;
- incremental graph work regresses typing or Note navigation;
- OKF fixtures require behavior that conflicts with ordinary Exo Markdown;
- profile interpretation requires executable code or a registry to pass the
  chosen fixtures; or
- unrelated dirty work prevents a clean replay of graph-only commits.

Do not compensate with fallbacks, hidden feature flags, duplicate builders, or
weaker tests. Narrow the branch or return to the architecture decision.

## Deferred branches

### `feat/spatial-graph-pane`

Begins only after this branch proves its Graph Pane contract. It replaces the
finite Canvas tracer with the renderer-independent Stellar scene, retains the
same semantic/projection boundary, and runs WebGPU, Canvas fallback,
device-loss, packaged-app interaction, accessibility, quiescence, continuity,
and editor-latency-under-load gates.

### `feat/find-connect-context`

Begins after the graph contract tests establish trustworthy evidence. It ships
the first reviewed maintenance Skill and verifies that proposals remain
understandable, reviewable, and reversible.

### Ontology onboarding

Remains a later product experiment. It may propose a Workspace Ontology and
migration plan only after the foundation can demonstrate a meaningful,
reversible before/after result.

## Next implementation move

Freeze WP0's public fixtures and expected task answers before deepening the
utility tracer. In parallel, isolate the already passing tracer into graph-only
commits, then replay it into a clean worktree. Do not add ontology UI, semantic
edges, or a WebGPU port until those evidence and clean-replay gates pass.

-- Shoshin | 2026-07-17
