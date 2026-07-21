---
name: graph-system-stability
description: Use before changing Exo graph domain types, snapshot construction, relationship extraction, graph queries, Note Root Formats, Workspace Ontology interpretation, graph integrity checks, layout, scene logic, WebGPU/Canvas rendering, Graph Pane integration, or graph performance tests. Preserves Markdown ownership, open ontology, evidence, renderer independence, editor latency, deterministic layout, and fallback behavior.
---

# Graph System Stability

Protect Exo's graph architecture while changing its knowledge model or spatial
view. Apply only the branch of this workflow relevant to the task.

## Required orientation

Read these current sources first:

- `AGENTS.md`, `CONTEXT.md`, `tasks.md`, and `issues.md`
- `docs/graph-system-report-and-plan.md`
- `docs/adr/0005-schema-agnostic-graph-and-knowledge-profiles.md`
- `docs/architecture.md`

For layout, scene, renderer, gestures, or labels also read:

- `../exo-graph-viz-lab/stellar-contract.md`
- `../exo-graph-viz-lab/graphbench/contract.md`

Treat the graph lab as experiment evidence. Production Exo must consume a stable
contract, not import the lab as a second application or semantics path.

## Classify the change

Choose the narrowest affected layer:

1. **Knowledge Graph** — Concepts, Properties, Relations, Evidence, resolution,
   origin, Format/Ontology interpretation, graph queries.
2. **Graph projection** — semantic facts compiled into numeric topology, visual
   classes, weights, and cold metadata.
3. **Layout and scene** — deterministic positions, camera, selection, paths,
   picking, focal labels, and mental-map continuity.
4. **Renderer** — WebGPU or Canvas pixels and device recovery only.
5. **Product integration** — Graph Pane, workers, IPC, persistence, editor-load
   isolation, accessibility, and packaged-app behavior.
6. **Verification** — graph contract/integrity tests or the repo-local graph
   performance suite.

Do not solve a lower-layer problem by moving ownership into a higher layer.

## Hard invariants

### Knowledge ownership

- Markdown and frontmatter remain canonical.
- Preserve unknown types, properties, and supported nested YAML values.
- Keep Concept types and Relation predicates open vocabularies.
- Record `document | ontology | inferred` origin, resolution, and inspectable Evidence for Relations.
- Keep semantic similarity, inferred types, and proposed Relations as versioned
  Derived Signals until a user accepts a Markdown change.
- Generic Markdown remains usable without a Workspace Ontology.
- Treat `ontology.yaml` as Candidate source. Only an exact reviewed Keep may
  publish Active derived state; Candidate watcher events never invalidate the
  graph by themselves.
- A Format projects base Concepts and an Ontology may interpret their meaning;
  neither becomes a canonical database, mutation authority, or reason to reject
  unknown data.

### Layer ownership

```text
Markdown → Knowledge Graph → Graph projection → Layout → Scene → Renderer
```

- `WorkspaceGraph` is the one production knowledge-graph boundary.
- Do not add a third graph representation while consolidating `GraphSnapshot`
  and `WorkspaceGraph`.
- Closed numeric kinds may exist inside a compiled Graph View for performance;
  they must not become durable ontology enums.
- The scene owns selection, paths, picking, and label policy.
- Renderers draw resolved numeric state. They do not interpret properties,
  choose relations, run pathfinding, or mutate graph meaning.
- The GPU owns reconstructible render copies only; CPU state remains sufficient
  for recovery and Canvas fallback.

### Responsiveness and stability

- Known Note/editor state paints independently of graph, layout, or index
  freshness.
- Graph extraction, Format/Ontology validation, layout, and enrichment stay off the
  keystroke and navigation critical paths.
- Input mutates camera or selection synchronously; simulation never blocks a
  gesture.
- The same topology, algorithm version, and seed produce deterministic settled
  output within declared tolerances.
- Unchanged Concepts retain their mental map across graph epochs.
- Rest means rest: no recurring animation frame or worker timer after layout and
  camera motion settle.
- The Canvas fallback preserves graph meaning and interaction state.
- Private Workspace projections never enter public fixtures or tunnels.

### Honest quality

- Keep renderer throughput, layout geometry, product interaction, and graph
  integrity as separate results.
- Never present density, modularity, orphan count, semantic similarity, stress,
  or neighborhood preservation as universal knowledge quality.
- Quality claims name their fixture, profile, sample size, hardware,
  metric definition, and evidence.
- Unsupported metrics remain unsupported; never synthesize a passing zero.

## Change workflow

1. State the affected layer and the invariant at risk.
2. Inspect current consumers before changing shared graph types.
3. Add a compatibility path before removing an existing graph representation.
4. Write the smallest test that distinguishes the intended contract from the
   old behavior.
5. Run only the focused gates required by the affected layer, then broaden in
   proportion to integration risk.
6. Update `CONTEXT.md` only for changed domain language, an ADR only for a hard-
   to-reverse decision, and the graph report/tasks when sequencing changes.
7. Record benchmark results with exact fixtures and do not convert lab success
   into a production claim without packaged-app evidence.

Before changing a public CLI command, command-server route, IPC/shared protocol,
or externally consumed graph snapshot, stop unless the task includes the
repository's required architecture approval.

## Gates

### Knowledge Graph changes

```bash
pnpm --filter @exo/core test
pnpm typecheck
```

Require fixtures for unknown property preservation, open types/predicates,
resolution, Evidence, deterministic snapshots, and compatibility behavior.

### Spatial scene or renderer changes

From `../exo-graph-viz-lab`:

```bash
node stellar-benchmark.cjs
node stellar-density-benchmark.cjs
node stellar-grid-artifact-check.cjs
cd graphbench
npm run smoke
npm run layout:smoke
```

Run only applicable tracks, but never substitute a render pass for a layout or
product claim.

### Production Graph Pane integration

```bash
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
pnpm --filter @exo/core test
pnpm build
```

Add focused Electron coverage for graph interaction and editor latency while
graph extraction/layout work runs. Verify the real packaged app for device
fallback, viewport containment, accessibility, continuity after Note changes,
and idle quiescence.

### Graph integrity changes

Run the versioned graph contract tests. Do not use layout or renderer metrics as
a proxy for schema conformance, relation resolution, or Evidence coverage.

## Red flags

Stop and redesign if a change introduces:

- a fixed global taxonomy or `switch` over user Concept types;
- lossy frontmatter normalization;
- semantic edges promoted without review;
- graph meaning inside WebGPU, Canvas, or layout code;
- a separate production graph model created for the Graph Pane;
- continuous animation or simulation at rest;
- whole-Workspace graph work on typing, save, or Note-open paths;
- renderer-only tests for graph-integrity claims;
- a universal graph-quality score; or
- private Note titles, paths, or topology in public artifacts.

-- Exo | 2026-07-17
