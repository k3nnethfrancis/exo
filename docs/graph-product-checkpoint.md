# Graph product checkpoint

Date: 2026-07-20

## Source packet for a short technical post

This is the canonical concise account. Use
[`graph-system-report-and-plan.md`](./graph-system-report-and-plan.md) for the
full experiment history, architecture, product lessons, domain model, and
implementation plan. Use the
[`M2 Max baseline`](../benchmarks/graphbench/reports/2026-07-16-m2-max-baseline.md)
for reproducible numbers and the
[`graph performance suite`](../benchmarks/graphbench/README.md)
for metric definitions and commands. The Fable decision history remains in
`docs/reviews/`; it is context, not the source of benchmark claims.

## What we built

In plain English, we proved that Exo can turn a large Markdown workspace into a
fast, fluid spatial graph rather than a slow diagram. The graph has a stable
layout, real three-dimensional camera movement, focal labels, selection,
neighbor and path highlighting, WebGPU rendering, a Canvas fallback, and
desktop/mobile gestures. It stops doing work when the scene settles. Exo's
internal performance suite separates rendering speed, layout quality,
interaction, resilience, and incremental stability so a fast renderer cannot
hide a bad layout or broken interaction.

The latest benchmark work made those claims concrete. It runs the same fixed
workload through Exo and Sigma, includes a real SuiteSparse topology, verifies
that a 1% update to a 10,000-node graph preserves the old mental map, recovers
from an injected WebGPU failure to Canvas in about 22 ms with selection and
layout intact, and verifies that the settled renderer schedules zero frames.

We also built the production foundation beneath the pixels. Markdown remains
canonical. The graph preserves open Concept types, lossless Properties, typed
Relations, authored/declared/derived authority, resolution state, and Evidence.
Generic Markdown works without configuration; OKF 0.1 is the first optional
interoperability profile. A renderer-neutral projection keeps ontology and file
objects out of hot GPU/draw paths.

## How we built it

1. Exo compiles canonical Markdown relationships into a typed,
   renderer-neutral graph snapshot. The GPU never owns note meaning.
2. A deterministic worker lays out typed-array node and edge data, preserves a
   stable mental map across small topology changes, and suspends completely
   after convergence.
3. The CPU owns scene state, camera math, picking, paths, focal-label choice,
   and fallback semantics. WebGPU performs instanced node/link drawing; Canvas
   implements the same scene contract when WebGPU is unavailable or lost.
4. Direct pan, orbit, dolly, select, focus, and path gestures manipulate one
   spatial camera. Labels are a bounded focal resource rather than DOM attached
   to every node.
5. The graph performance suite runs fixed-coordinate render, native layout,
   product interaction, resilience, and incremental stability as separate
   tracks. Every
   result carries hardware, browser, viewport, fixture checksum, profile, and
   metric definitions.

## Measured checkpoint

- The 10,000-node / 17,500-link density case settled in 4.52 seconds with
  1.2 ms p95 main-thread frame work in the graph lab.
- The 10,000-node / 20,000-link product run measured 1.38 ms p95 from
  pointer event to next frame and 16.3 MiB measured JS memory on an Apple M2
  Max.
- With fixed coordinates at 50,000 nodes / 100,000 links, Exo maintained
  14.36 ms p95 browser frame cadence while Sigma measured 40.03 ms in the same
  run. This is a refresh-cadence comparison, not mislabeled GPU time.
- A deterministic 1% update to the 10,000-node graph produced 0.067 p95 aligned
  displacement for unchanged nodes against a 0.10 mental-map gate.
- The resilience track verifies semantic Canvas fallback after an injected
  WebGPU failure and zero recurring scheduled frames once the scene settles.

These are checkpoint measurements, not universal performance claims. The
machine, browser, fixture, profile, repetitions, and distribution must accompany
any published number.

## What this proves

- Large graphs can feel immediate on ordinary hardware.
- WebGPU can own pixels without owning graph meaning or interaction.
- The same graph can support authored links, properties, semantic overlays, and
  future model-space projections without confusing them as equally canonical.
- Speed and readable layout are separate engineering properties and need
  separate tests.

## What remains after Launch Gate D

Launch Gate D is complete for the current macOS product surface. Source and the
exact packaged app now run the production shaders on hardware WebGPU, recover
to the same complete Canvas scene, remain idle at rest, and preserve editor
latency under graph/index/Search/Terminal load. The guarded private-copy journey
passes both renderer paths without touching its source. Canonical evidence:
[`2026-07-20-launch-gate-d.md`](./reviews/output/2026-07-20-launch-gate-d.md).

The next work is product capability, not unfinished renderer integration:

1. Add cross-adapter GPU timestamps and expand the multi-hardware evidence.
2. Freeze the OKF/OpenWiki fixtures and schema/compatibility expectations.
3. Define and ship user-owned `ontology.yaml`, conformance, and explanations.
4. Run the bounded embeddings-index projection after those graph contracts
   settle, using only a supported provider export seam.
5. Ship and evaluate the first reviewable graph-maintenance Skill only after the
   graph can show trustworthy evidence for its proposals.

## Interaction and product work we have not finished

Production Exo now uses adaptive visual/hit radii and a bounded focal-label
planner. The normalized performance profile deliberately remains visually
plain so benchmark comparisons do not silently change workload. Continued
real-device tuning at overview, middle, and focus distances remains product
polish and must not alter that normalized benchmark profile.

Canvas and WebGPU now consume the same anchored camera and gesture intentions,
including pixel-trackpad pan, modifier/discrete-wheel zoom, and two-pointer
pinch/pan. The remaining evidence is physical-device gesture counts and visual
captures, not another input implementation.

The intended navigation contract is:

- click/tap a node: select it;
- double-click: open its Note;
- double-click a node whose Note is already open: immediately frame and zoom to
  that node;
- empty-space double-click: do nothing surprising;
- frame the full graph through an explicit control or shortcut;
- click the Graph icon beside editor Properties: open the graph focused on the
  current Note.

## Connections and Properties direction

Connections now gives Outline only headings, groups backlinks/internal/external
links under Links, uses the shared inspected Concept, and hides History until
it has content. Its local Graph adapts the bounded canonical neighborhood into
compact topology and compiles it through the full graph's scene, focal labels,
palette, presentation compiler, and Canvas renderer. It has no second worker,
gesture model, animation loop, or SVG renderer.

The local graph is deliberately passive and uses deterministic seed positions
rather than the full Pane worker's relaxed coordinates. Exact coordinate
continuity would require App-owned layout state and is not implied by sharing
Knowledge Graph meaning, inspected Concept, scene, and pixels.

Keep both property surfaces for now. Editor Properties edits canonical Markdown
frontmatter. Connections/graph Properties explains the currently inspected
Concept: its interpreted type, Relations, Evidence, profile findings, and which
properties affect graph color, size, grouping, filtering, or physics. Editor,
Connections, local graph, and full graph must share one explicit inspected
Concept so changing Pane focus cannot produce unrelated “No properties” states.

The executable backlog is tracked in `issues.md#exo-issue-121-graph-navigation-and-connections-do-not-yet-form-one-system`.

## Implemented in the first integration slice

- The editor Properties chrome now exposes a Graph action that opens the full
  graph focused on the active Note.
- Canvas graph double-click no longer resets the camera on empty space; an
  already-open Note double-clicks into a focused zoom, while another Note opens
  normally.
- Connections Outline is headings-only; Links owns backlinks, internal links,
  external links, and tags; Graph now shows a compact connected neighborhood
  using the same local relation contract.
