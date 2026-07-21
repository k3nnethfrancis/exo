# Exo graph system: experiment report and production plan

Status: Launch Gate D complete; production graph foundation accepted
Date: 2026-07-20

## Executive decision

The graph lab proved that Exo can render and directly manipulate a large spatial
graph with desktop- and mobile-grade responsiveness. It also proved that
rendering speed, layout quality, and knowledge integrity are different problems
and must have different owners and verification.

Exo will therefore integrate the work as two systems joined by a narrow data
contract:

1. a schema-agnostic **Knowledge Graph** that losslessly projects user-owned
   Markdown into concepts, properties, relations, and evidence; and
2. a renderer-independent **Graph View** that turns a chosen projection of
   those facts into stable positions, visual encodings, labels, paths, and
   interaction.

Exo will not impose one ontology. Generic Markdown remains the zero-configuration
profile. Optional user-owned **Knowledge Profiles** may interpret properties and
relationships, with Open Knowledge Format 0.1 as the first interoperability
profile. Profiles never become a second canonical database, and unknown
properties or types must survive round trips.

Graph quality will not be reduced to a universal scalar. Exo will report
evidenced mechanical integrity, profile conformance, and stability separately
from visual layout quality.

## What the graph lab built

### 1. The first flat interaction prototype

The initial static prototype tested three user intents rather than renderer
technology:

- **Neighborhood:** understand the useful local context of one Note.
- **Path:** explain how two Notes are connected.
- **Map:** orient within the broader Workspace without making every label visible.

It established the durable interaction insight that a graph should be one place,
not a dashboard of graph modes. Selection and camera state should determine what
becomes legible.

### 2. Kinetic, the stable two-dimensional comparison surface

`../../exo-graph-viz-lab/public/kinetic.html` added a worker-owned force layout,
stable clustered positions, semantic zoom, curved connections, focus and path
lenses, and direct manipulation. It retained a flat `z = 0` scene and a Canvas
renderer. Kinetic remains useful as a deliberately simpler reference rather
than code that Stellar must inherit.

### 3. Stellar, the flagship spatial experiment

`../../exo-graph-viz-lab/public/stellar.html` became a true three-dimensional graph
with:

- deterministic, self-suspending layout in a worker;
- dense typed-array topology and bounded transferable buffers;
- WebGPU-instanced nodes and links;
- a renderer-independent scene owning selection, pathfinding, labels, and
  picking;
- direct orbit, pan, dolly, tap, and overview gestures;
- focal, collision-free labels rather than thousands of DOM labels;
- device-loss recovery and a Canvas fallback; and
- zero recurring render or worker work after the scene settles.

The architectural achievement is not merely WebGPU. Graph meaning, layout,
camera, interaction, labels, and pixels each have one owner. The GPU is a
reconstructible projection, never the source of truth.

### 4. Reproducible interaction and density gates

The lab now exercises the real page at desktop and mobile sizes. On the recorded
250-node / 438-link WebGPU fixture, both form factors passed with 0.7 ms p95 main-
thread frame work, no label overlap, no overflow, and no browser errors. The
10,000-node / 17,500-link density fixture settled in 4.95 seconds with 1.3 ms p95
main-thread frame work. The forced Canvas fallback also passed its medium
fixture.

The mobile raster gate caught the former screen-aligned Bayer artifact rather
than relying on visual opinion. Continuous alpha and analytic edge
antialiasing replaced topology-breaking stipple while preserving the layout and
interaction contract.

### 5. GraphBench

GraphBench separates three workloads that graph demonstrations commonly
conflate:

- **Render:** fixed graph and fixed coordinates, measuring renderer throughput.
- **Layout:** native layout convergence and geometric quality.
- **Product:** input latency, selection, labels, paths, memory, and idle behavior.

On the first Apple M2 Max baseline, Exo reached the fixed-layout render gate in
99–144 ms across representative 10k and 50k fixtures and remained near the
display cadence where Sigma degraded on denser fixtures. At 10,000 nodes and
20,000 links, pointer-to-next-paint measured 1.38 ms p95.

The same run exposed weak native layout quality: 1.459 edge-length coefficient
of variation, 0.579 sampled normalized stress, and zero strict sampled one-hop
neighborhood preservation. This is a valuable result, not a failed renderer.
It proves the benchmark is capable of rejecting a fast but structurally poor
layout.

Canonical evidence:

- `../../exo-graph-viz-lab/stellar-contract.md`
- `../../exo-graph-viz-lab/stellar-benchmark-status.md`
- `../benchmarks/graphbench/contract.md`
- `../benchmarks/graphbench/reports/2026-07-16-m2-max-baseline.md`

## What the experiment taught us

### Rendering and layout are separate systems

A fast renderer cannot repair a bad layout. A good layout cannot compensate for
slow input. Production Exo must retain the lab boundary:

```text
knowledge facts → graph projection → layout → scene → renderer
```

No later layer may invent or mutate knowledge semantics owned by an earlier
layer.

### The graph is a place, not a card or mode switcher

The useful graph occupies its Pane. Conventional spatial gestures control the
camera directly. Selection changes emphasis and focal labels without relaying
out the graph. Unrelated context becomes quiet, not absent. The graph must
settle, preserve its mental map across edits, and consume no continuous work at
rest.

### Labels are a focal resource

Attempting to label every node made the graph unreadable. Label visibility must
be budgeted in screen space from selection, route membership, proximity to the
camera focal point, centrality, and degree. Camera movement changes the focal
set; an explicit label-density control is unnecessary.

### Visual topology is not knowledge quality

Edge uniformity, stress, overlap, and neighborhood preservation describe a
layout. They do not tell us whether a Note is true, whether the user's ontology
is appropriate, or whether an agent can find the right evidence. Density,
orphan count, and modularity are likewise descriptive unless a declared profile
or task makes them normative.

### Semantic similarity is evidence, not an authored relation

Embeddings can reveal likely duplicates, missing tags, or unlinked related
concepts. They must remain versioned Derived Signals until accepted. A strong
semantic match is a proposal candidate; a weak semantic match across an
authored link may be an important bridge rather than a defect.

### Quality is multidimensional

There is no honest universal `graph quality = 82` metric. The useful model is:

```text
Q(graph, knowledge profile) =
  [conformance, integrity, semantic alignment, stability]
```

Each dimension must show its evidence and confidence. A quality report should
say “seven Metric concepts have no declared source relation,” not merely display
a score.

### Interoperability and ontology are different

Google's draft Open Knowledge Format 0.1 is intentionally schema-minimal:
Markdown files are concepts, Markdown links are relations, `type` is the only
required property, arbitrary producer fields are allowed, and consumers should
preserve unknown fields and types. OpenWiki adds an opinionated authoring policy
on top of OKF. Exo should implement the permissive interchange contract, not
copy OpenWiki's narrower current validator.

Sources:

- <https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md>
- <https://github.com/langchain-ai/openwiki>
- <https://github.com/langchain-ai/openwiki/blob/main/src/agent/prompt.ts>
- <https://github.com/langchain-ai/openwiki/blob/main/src/agent/frontmatter-validator.ts>

## Production domain model

The following language is canonical. `../CONTEXT.md` contains the terse glossary;
this section describes the architectural relationships.

### Canonical and interpreted knowledge

**Note** is the Markdown file and remains canonical. **Property** is a lossless
frontmatter fact on that Note. **Concept** is the graph identity projected from
a Note by the active format/profile rules. Generic Markdown and OKF both default
to one Concept per Note.

**Relation** connects two Concepts. It records a family, optional user-defined
predicate, authority, resolution, and Evidence. A Relation may be authored in
Markdown, declared through a profile-interpreted property, or derived by a
versioned machine process.

**Knowledge Profile** is optional, user-owned interpretation. It can declare
concept types, property value shapes, which properties contain concept
references, expected relations, and validation rules. It does not own Notes,
silently rewrite them, or reject unknown data.

**Graph View** maps a selected graph projection into encodings and layout
weights. It changes presentation, not knowledge.

### Knowledge graph snapshot 0.2

The implemented semantic snapshot preserves these fields:

```ts
type PropertyValue =
  | null | boolean | number | string
  | readonly PropertyValue[]
  | { readonly [key: string]: PropertyValue };

interface ConceptNode {
  id: string;                    // Workspace/root/path-qualified identity
  noteId?: string;               // canonical Note projection when local
  label: string;
  conceptType?: string;          // open vocabulary
  properties: Readonly<Record<string, PropertyValue>>;
  resolution: "resolved" | "unresolved" | "external";
}

interface RelationEdge {
  id: string;
  source: string;
  target: string;
  family: "link" | "property-reference" | "tag-membership" |
          "hierarchy" | "semantic";
  predicate?: string;            // open vocabulary
  authority: "authored" | "declared" | "derived";
  resolution: "resolved" | "unresolved" | "ambiguous" | "external";
  confidence?: number;
  evidence: readonly RelationEvidence[];
}

interface RelationEvidence {
  kind: "source-span" | "property" | "path" | "profile-rule" | "model";
  noteId?: string;
  property?: string;
  sourceRange?: { from: number; to: number };
  producer?: { id: string; version: string };
}
```

Closed renderer enums must not become ontology enums. Dense numeric node kinds
and edge styles may still exist inside a compiled Graph View, but they are
projection-local performance data rather than the durable graph contract.

### Consolidated production contract

`WorkspaceGraph` is the only production knowledge-graph boundary. Its
schema-agnostic 0.2 snapshot owns open Concept types, lossless Properties,
Relations, resolution, authority, and Evidence. Connections adapts that graph
to a bounded focused-Note context. The full Graph Pane receives a compact,
string-free typed topology with profile/topology/transport hashes and retrieves
labels, paths, Properties, Findings, and Relation Evidence through bounded,
snapshot-qualified lookup, summary, and index-detail reads.

The former 0.1 `GraphSnapshot`/query modules, object `GraphViewProjection`
compiler and IPC route, unbounded concept-id detail route, and duplicate
renderer scene have been deleted. Canvas and WebGPU now share the same scene
contract rather than carrying a compatibility graph representation.

## How properties become useful without becoming mandatory

The base graph preserves every supported YAML value and exposes it through a
generic property inspector and filter. A Knowledge Profile may then interpret
selected keys:

| Fact | Possible Graph View projection |
| --- | --- |
| `type` | glyph, color, legend, filter, optional region |
| tags | overlapping membership and weak cluster attraction |
| path / Folder | stable primary geography |
| timestamp | time lens, freshness, filtering |
| canonical resource | external identity and duplicate checks |
| numeric property | optional size, heat, or priority |
| enum property | facet, color, or region |
| reference property | directed typed Relation |
| Markdown link | strong authored directed Relation |
| semantic similarity | faint derived overlay or proposal evidence |

No property should affect physics merely because it exists. The user or a
profile chooses that mapping. The same graph can therefore support topology,
lineage, ontology, semantic, and temporal views without changing its Notes.

## Graph verification

### Universal integrity checks

- lossless frontmatter parse and round trip;
- stable and unambiguous Concept identity;
- link resolution and explicit unresolved/ambiguous states;
- preservation of unknown types and properties;
- Evidence coverage for every nontrivial Relation;
- deterministic graph snapshots and derived layouts;
- bounded update, query, traversal, and render latency; and
- graceful behavior under malformed or partially available documents.

### Profile conformance checks

- required properties and valid value shapes;
- declared relationship expectations;
- duplicate canonical resources;
- reachability from declared entry Concepts;
- domain-specific citation or provenance requirements; and
- profile/version compatibility.

Graph contract tests own schema conformance, identity, link resolution,
Evidence, unknown-field preservation, deterministic snapshots, and malformed
input behavior. The repo-local graph performance suite independently owns
pixels, positions, interactions, memory, resilience, and latency.

## Detailed implementation plan

### Phase 0 — Freeze the contracts and fixtures

1. Check in this report, ADR 0005, glossary updates, and roadmap changes.
2. Select one small Google OKF bundle and one OpenWiki-generated wiki as
   read-only fixtures; record source revisions and licenses.
3. Create deterministic corruptions: missing `type`, unknown properties, broken
   and ambiguous links, duplicate resources, wrong tags, and dropped relations.
4. Freeze expected schema, relation, resolution, and preservation facts before
   changing the production graph model.

Gate: the fixtures and expected facts are reviewable without any renderer.

### Phase 1 — Consolidate the knowledge graph — complete

1. Inventory consumers of `GraphSnapshot` and `WorkspaceGraph`.
2. Introduce knowledge snapshot 0.2 behind `WorkspaceGraph`.
3. Preserve arbitrary nested frontmatter values and stable Note identity.
4. Add Relation authority, resolution, predicate, and Evidence.
5. Keep backlinks, neighborhoods, and graph context on the consolidated model.
6. Delete the superseded snapshot/query, object-IPC, and renderer-scene paths
   after their consumer and parity audits pass.

Gate: current links, backlinks, tags, Folder Overview, Connections, and search
hydration remain behaviorally identical; unknown fields survive a round trip.

### Phase 2 — Add profile interpretation

1. Implement Generic Markdown as the zero-requirement profile.
2. Implement OKF 0.1 as a data-only built-in profile: one Markdown concept per
   document, path-relative concept IDs, required `type`, permissive properties,
   ordinary Markdown relation edges, and reserved-file handling.
3. Define the smallest user-owned Knowledge Profile format for concept types,
   property shapes, reference-valued properties, relation expectations, and
   visual hints.
4. Add best-effort behavior for unknown profile versions and types.
5. Expose profile status and violations without blocking ordinary Markdown use.

Gate: Exo loads both fixtures without mutation, preserves unknown data, explains
every interpreted edge, and falls back to Generic Markdown when no profile is
selected.

### Phase 3 — Complete graph contract verification

1. Add conformance, integrity, and corruption-tolerance suites.
2. Verify identity, link resolution, unknown-field preservation, Relation
   Evidence, and deterministic snapshots.
3. Report each dimension with evidence rather than a composite score.

Gate: the suite detects every deterministic fixture corruption and preserves all
unknown data without affecting editor latency.

### Phase 4 — Compile production Graph Views

1. Define a renderer-neutral projection from the consolidated graph to dense
   topology: numeric indices, CSR adjacency, visual classes, weights, and cold
   metadata.
2. Keep ontology strings and properties out of hot draw loops.
3. Derive stable layout seeds from graph/profile/view versions.
4. Preserve positions for unchanged Concepts and align new layout epochs to the
   previous mental map.
5. Compile selection, path, focal labels, and relation explanations in the scene,
   not the renderer.

Gate: the same projection drives WebGPU and Canvas fallback with identical
selection, path, labels, and relation explanations.

### Phase 5 — Integrate the spatial graph into Exo — complete

1. Add Graph as a normal Workspace Canvas Pane using the renderer-neutral scene.
2. Stream topology/layout epochs from isolated derived work; never block Note
   navigation or typing.
3. Support desktop and mobile spatial gestures from `stellar-contract.md`, then
   tune node legibility and adaptive trackpad/pinch dolly against real devices.
4. Add an icon beside editor Properties that opens the Graph Pane selected and
   framed on the current Note. Use one interaction contract across renderers:
   click selects; double-click opens; double-click of an already open Note
   focuses/zooms; frame-all remains explicit.
5. Rebuild Connections around the same inspected Concept and projection:
   Outline owns headings; Links owns backlinks plus internal/external outgoing
   links; Graph is a compact local spatial neighborhood; Activity is hidden
   until a real provenance/change stream exists.
6. Keep editable canonical frontmatter in the editor Properties surface and use
   graph/Connections detail to explain Concept properties, visual mappings,
   Relation authority, Evidence, and profile findings.
7. Provide a focused Concept detail surface with properties, authored/derived
   relationship distinction, Evidence, and profile violations.
8. Make semantic overlays and suggestions opt-in and visibly derived.
9. Persist only derived layout state under `.exo/`; never write canonical Notes
   from graph navigation.

Gate passed: source and packaged-app journeys cover interaction, hardware
WebGPU, Canvas/device-loss fallback, idle quiescence, Note-update continuity,
Terminal coexistence, and editor/navigation latency under graph/index load.
The guarded private-copy journey covers both renderer paths without modifying
the source. Evidence:
`docs/reviews/output/2026-07-20-launch-gate-d.md`.

### Phase 6 — Ship the first graph-maintenance Skill

1. Implement **Find and connect relevant context** against the consolidated graph
   and current configured-Command invocation path.
2. Require proposed tags, properties, or relations to include Evidence and an
   explanation.
3. Show Markdown/frontmatter diffs and the affected graph facts.
4. Verify that proposals remain understandable, reviewable, and reversible.
5. Do not add another maintenance Skill until this one demonstrates value.

Gate: reviewed proposals resolve a declared profile violation without silently
expanding Exo's authority.

### Phase 7 — Ontology onboarding

Only after the prior gates, let a configured Command inspect selected Note Roots
and propose a Knowledge Profile, Folder/Index guidance, and migration plan.
Show before/after graph and utility evidence. Every filesystem change remains a
normal explicit invocation diff; ontology inference never becomes an automatic
initializer.

## Explicit non-goals

- No app-owned ontology database.
- No fixed universal type taxonomy.
- No automatic semantic edge promotion.
- No graph-quality vanity score.
- No renderer-owned graph semantics.
- No continuous force animation at rest.
- No production dependency on the graph lab directory.
- No cross-Workspace write graph or restored Project Root model.
- No ontology onboarding implementation before the fixture and eval gates.

## Documentation realignment

This report is the canonical detailed plan. The surrounding documents carry
only their appropriate slice:

- `graph-product-checkpoint.md` — plain-English progress, remaining work, and
  the accepted navigation/Connections/Properties direction.
- `../CONTEXT.md` — canonical product language.
- `adr/0005-schema-agnostic-graph-and-knowledge-profiles.md` — durable decision.
- `architecture.md` — production boundaries and current/planned ownership.
- `../roadmap.md` — sequencing and gates.
- `../tasks.md` — active executable work.
- `../../../notes/shoshin-codex/projects/exo/insights.md` — evidence-backed
  product learning.
- `../../../notes/shoshin-codex/projects/exo/research-log.md` — experiment record.

-- Shoshin | 2026-07-17
