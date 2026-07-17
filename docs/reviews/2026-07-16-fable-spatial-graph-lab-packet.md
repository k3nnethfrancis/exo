# Fable review packet: spatial graph interaction lab

Date: 2026-07-16
Repository: Exo (`main`) and isolated graph lab
Decision owner: Exo orchestrator

## Scope and privacy boundary

This reviews an **isolated, non-production experiment** at
`/Users/kenneth/Desktop/lab/projects/exo-graph-viz-lab`. It must not change
Exo's production renderer, Markdown graph data contract, or editor critical
path yet.

The lab has a local derived graph snapshot from a personal vault, but that
snapshot, its titles, paths, and contents are explicitly out of scope. Review
only the source and the checked-in synthetic/public topology fixture. Do not
request or infer private-vault data.

## Product context

Exo is a local-first Markdown exocortex. Its graph is a user-owned graph over
notes, folders, links, tags, properties, and attachments. Derived layout,
inference, and rendering state must remain disposable and must never make
editing, navigation, typing, or normal page loading slower.

The first graph-management vertical slice begins with an interaction lab,
because we must prove that a graph is useful before choosing a production graph
surface. The current experiment has 235 synthetic/derived nodes and 418 links.
It deliberately preserves the old static prototype for comparison.

## Current experiment

Relevant source:

- `projects/exo-graph-viz-lab/public/kinetic.html`
- `projects/exo-graph-viz-lab/public/kinetic-worker.js`
- `projects/exo-graph-viz-lab/kinetic-stability.cjs`
- `projects/exo-graph-viz-lab/public/topology.json`
- `projects/exo/tasks.md` under "First graph-management Skill"

The current implementation is a dependency-free Canvas 2D/2.5D scene:

- worker-owned force layout with clustered, cached positions;
- Canvas edges/nodes and a CPU focal-label overlay;
- semantic label selection based on camera focus, selection, neighborhood,
  degree, and collision avoidance;
- rotation and zoom are currently a 2D visual transform, not a real 3D scene;
- automated stability coverage samples the Canvas after settling and after a
  reset, and currently proves a stationary frame at 60+ fps for the fixture.

The prototype still exposes visible Map / Focus / Path / angle / physics /
reset chrome. The product direction rejects that control surface. A person
should navigate directly using familiar desktop/mobile spatial gestures:

- primary drag / one-finger drag: orbit the view;
- scroll or pinch: dolly/zoom;
- two-finger, middle-button, or modifier drag: pan;
- tap/click: select;
- second selected node: explain a path;
- double click/tap empty space: overview;
- direct node movement, if retained, must have an explicit modifier and must
  never be confused with camera movement.

The UI should use gesture and selection state, not persistent visible mode
buttons, as the primary interaction model. Labels must stay calm and readable:
the view should show only a small focal set and reveal different labels as the
camera changes, rather than attempting to label all nodes.

## Decision needed

We need a product-worthy technical direction for a graph that *feels* spatial,
remains legible and low-latency, and has truthful semantics. Please rule on:

1. Is actual 3D (node `x,y,z`, perspective camera, depth-aware picking) the
   correct next lab contract, or should Exo keep a 2.5D projection until real
   task evidence proves depth improves orientation?
2. If actual 3D is justified, what is the smallest renderer-independent
   `GraphScene` boundary that permits a WebGPU renderer and a Canvas fallback
   to consume one topology/layout/selection model without duplicating graph
   semantics?
3. How should z/depth be assigned and stabilized so it represents useful
   structure rather than arbitrary eye candy, preserves a person's mental map,
   and does not turn links into an unreadable hairball?
4. Should we pursue a staged WebGPU fast path now—GPU nodes/links, worker
   layout, CPU/Canvas label overlay, automatic Canvas fallback—or stay Canvas
   until a larger density threshold is demonstrated? What objective threshold
   and capability guard should govern the choice?
5. What interaction rules are missing for browser and touch: orbit, pan,
   dolly, selection, path, overview, keyboard access, reduced motion, and
   cancellation of an in-progress gesture?
6. Which acceptance gates are mandatory before this lab can inform production:
   stable layout, frame time, picking accuracy, focal-label overlap, gesture
   latency, memory, accessibility, low-density usefulness, and high-density
   degradation?

## Options

### A. Refine 2.5D Canvas only

Remove control chrome and use direct gestures over the current 2D layout with
camera rotation, zoom, pan, focal labels, and selection-derived path behavior.

Benefit: smallest and safest. Cost: the spatial affordance can be cosmetic;
large dense graphs remain CPU-bound.

### B. Move directly to a fully 3D WebGPU graph

Add `x,y,z` layout, perspective projection, GPU nodes/edges/picking, and
gesture-driven orbital camera immediately.

Benefit: maximally expressive. Cost: greatest risk of novelty outrunning
orientation, accessibility, and a stable production fallback.

### C. Staged scene contract and progressive renderer

Define a renderer-independent `GraphScene` and camera/gesture contract now;
retain worker-owned layout and CPU focal labels; first add a WebGPU draw path
for nodes/links with automatic Canvas fallback. Keep 3D depth either disabled
by default or constrained to an explicit, meaningful layer/cluster signal
until comparison tasks show it helps. No visible mode chrome.

Benefit: isolates semantics from rendering, keeps the experiment reversible,
and makes performance evidence decisive. Cost: initial adapter work and two
render backends.

## Orchestrator's current recommendation

Approve **C**, with a strict evidence-first sequence:

1. Write a minimal, data-independent scene/camera contract in the lab.
2. Replace top controls with direct gestures and selection-derived behavior in
   the existing Canvas lab; preserve the original prototype unchanged.
3. Add a capability-gated WebGPU node/link renderer against the same scene,
   retaining Canvas labels and a Canvas fallback.
4. Treat z as a semantic design decision, not an animation setting. Begin with
   deterministic cluster layering or keep z=0; only enable depth when a
   comparison task improves orientation without harming label/picking accuracy.
5. Measure frame times and task outcomes on synthetic and permitted local
   snapshots; only then decide whether any part belongs in Exo.

No production Exo contract, public CLI, IPC, or persisted workspace data change
is proposed in this review.

## Please review

- Choose A/B/C or propose a narrower alternative.
- Identify flaws in the scene/camera/data boundary and gesture model.
- Define realistic performance and usability gates for 235-node and future
  high-density graphs.
- State whether GPU picking belongs in the first fast path or can remain CPU
  spatial-index picking.
- Specify the decision records/tests needed before a lab result becomes a
  production Exo proposal.

Do not implement the work. This is an architectural ruling for the
orchestrator to incorporate while the lab remains isolated.

-- Shoshin | 2026-07-16
