---
name: graph-system-stability
description: Use before changing Exograph graph domain types, snapshot construction, relationship extraction, graph queries, Note Root Formats, Workspace Ontology interpretation, graph integrity checks, layout, scene logic, WebGPU/Canvas rendering, Graph Pane integration, or graph performance tests. Preserves Markdown ownership, open ontology, evidence, renderer independence, editor latency, deterministic layout, and fallback behavior.
---

# Graph System Stability

Protect Exograph's graph architecture while changing its knowledge model or spatial
view. Apply only the branch of this workflow relevant to the task.

## Required orientation

Read these current sources first:

- `AGENTS.md` and `docs/glossary.md`
- `docs/architecture.md`
- `docs/knowledge-graph.md`
- `docs/note-root-formats.md` and `docs/workspace-ontology.md`
- `evals/graph/README.md`

For graph meaning or projection also read the affected owners:

- `packages/core/src/knowledge-graph.ts`
- `packages/core/src/workspace-graph.ts`
- `packages/core/src/graph-projection.ts`

For layout, scene, rendering, gestures, or labels read only the affected owners:

- `apps/desktop/src/renderer/src/spatialGraphRuntime.ts`
- `apps/desktop/src/renderer/src/graphSceneFoundation.ts`
- `apps/desktop/src/renderer/src/graphLayoutSimulation.ts`
- `apps/desktop/src/renderer/src/graphInteraction.ts`
- `apps/desktop/src/renderer/src/graphPresentation.ts`
- `apps/desktop/src/renderer/src/graphRendererHost.ts`
- `apps/desktop/src/renderer/src/components/SpatialGraphView.tsx`
- `apps/desktop/src/renderer/src/graphWebGpuRenderer.ts`

Keep production graph semantics in Exograph's stable contracts; do not introduce a
second graph application or graph model.

## Classify the change

Choose the narrowest affected layer:

1. **Knowledge Graph** — `WorkspaceGraph` and `KnowledgeGraphSnapshot`: Concepts,
   Properties, Relations, Evidence, resolution, origin, Format/Ontology
   interpretation, and graph queries.
2. **Graph projection** — `GraphTopology`: semantic facts compiled into numeric
   topology, visual classes, weights, and snapshot-qualified cold metadata.
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

- `WorkspaceGraph` is the one production knowledge-graph boundary and emits
  `KnowledgeGraphSnapshot`.
- `GraphTopology` is the compact presentation projection of that snapshot, not
  a second semantic model. Do not create a parallel production graph.
- Closed numeric kinds may exist inside a compiled Graph View for performance;
  they must not become durable ontology enums.
- Scene and interaction modules own camera, selection, paths, and picking.
- `GraphPresentationCompiler` owns resolved visual classes and label policy.
- Renderers draw resolved numeric state. They do not interpret properties,
  choose relations, run pathfinding, or mutate graph meaning.
- The GPU owns reconstructible render copies only; CPU state remains sufficient
  for recovery and Canvas fallback.

### Responsiveness and stability

- Known Note/editor state paints independently of graph, layout, or index
  freshness.
- Graph extraction, Format/Ontology validation, topology compilation, layout,
  and enrichment stay in derived workers and off keystroke and Note-navigation
  critical paths.
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
3. Preserve compatibility only for a proven public or durable contract; do not
   retain parallel graph models as speculative fallbacks.
4. Write the smallest test that distinguishes the intended contract from the
   old behavior.
5. Run only the focused gates required by the affected layer, then broaden in
   proportion to integration risk.
6. Update `docs/glossary.md` only for changed domain language and an ADR only for a
   hard-to-reverse decision. Track follow-up work in GitHub Issues.
7. Record benchmark results with exact fixtures and do not convert lab success
   into a production claim without packaged-app evidence.

Before changing a public CLI command, command-server route, IPC/shared protocol,
or externally consumed graph snapshot, stop unless the task includes the
repository's required architecture approval.

## Gates

### Knowledge Graph changes

```bash
pnpm --filter @exograph/core exec vitest run \
  src/__tests__/workspace-graph.test.ts \
  src/__tests__/graph-projection.test.ts \
  src/__tests__/graph-integrity.test.ts
pnpm typecheck
```

Require fixtures for unknown property preservation, open types/predicates,
resolution, Evidence, deterministic snapshots, and compatibility behavior.

### Spatial scene or renderer changes

```bash
pnpm --filter @exograph/desktop exec vitest run \
  src/renderer/src/graphSceneFoundation.test.ts \
  src/renderer/src/graphLayoutSimulation.test.ts \
  src/renderer/src/graphInteraction.test.ts \
  src/renderer/src/graphPresentation.test.ts \
  src/renderer/src/graphRendererHost.test.ts
pnpm graph:eval:test
pnpm graph:eval:smoke
pnpm graph:eval:resilience
```

Run only applicable tracks, but never substitute a render pass for a layout or
product claim.

### Production Graph Pane integration

```bash
pnpm --filter @exograph/desktop typecheck
pnpm --filter @exograph/desktop test
pnpm --filter @exograph/core test
pnpm build
```

Add focused Electron coverage for graph interaction and editor latency while
graph extraction/layout work runs. Verify the real packaged app for device
fallback, viewport containment, accessibility, continuity after Note changes,
and idle quiescence.

### Graph integrity changes

Run the Core graph tests above plus the affected Format/Ontology tests. Do not
use layout or renderer metrics as a proxy for schema conformance, relation
resolution, or Evidence coverage.

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

-- Exograph | 2026-07-17
