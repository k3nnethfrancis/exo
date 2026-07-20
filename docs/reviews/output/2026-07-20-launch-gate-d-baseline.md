# Launch Gate D baseline — production Graph

Date: 2026-07-20  
Branch: `launch/gate-d`  
Base: `ccbf81e`

## Outcome

Launch Gate D promotes Graph from an experimental Canvas tracer into one coherent product surface. The editor, Connections, Properties, and the full Graph must inspect the same Concept; topology transport must remain bounded at production scale; Canvas and WebGPU must implement one scene contract; and the graph must preserve Exo's editor latency and idle-efficiency gates.

## Baseline findings

### Transport

The graph is dense only in indexing, not in its current transport. Every node repeats strings for identity, label, absolute path, group, and kind. Every edge repeats a relation ID and semantic strings. The utility process then `JSON.stringify`s the complete object graph to enforce an 8 MiB response ceiling before the same graph is cloned into the main process, renderer, and layout worker.

Measured at five edges per node:

| Shape | Current object projection | Proposed typed topology |
| --- | ---: | ---: |
| 10K nodes / 50K edges | 14.34 MiB | 0.54 MiB |
| 50K / 250K | 72.31 MiB | 2.67 MiB |
| 100K / 500K | 144.83 MiB | 5.34 MiB |

The production boundary therefore needs semantic-free typed arrays for hot topology and separately bounded Concept summaries/details. Labels, paths, properties, findings, relation origin, and evidence do not belong in the hot packet.

### Interaction ownership

Three surfaces currently own different truths:

- `App` owns only the active editor path and a graph focus path;
- `SpatialGraphView` privately owns selection, route, camera, and detail;
- `InspectorDock` follows the active editor and a separate neighborhood context.

The approved contract is one App-owned inspected Concept. The scene owns numeric projection indices and camera mechanics, not product identity. Ordinary click inspects; Shift-click requests a route; double-click opens a Note or refocuses it when already open; explicit frame-all preserves inspection; empty-space double-click is inert; Escape clears route before returning inspection to the active editor Note.

### Renderer and scale

Production Exo contains no WebGPU renderer. Stellar exists only in GraphBench and the external visualization lab, and those copies have already diverged. The production Canvas implementation mixes React state, drawing, labels, picking, and lifecycle in one component. It also lacks changed-topology continuity, radius/depth-correct picking, multi-pointer gestures, renderer recovery, and production quiescence gates.

The production sequence is therefore:

1. compact topology and bounded details;
2. pure scene/controller/scheduler;
3. Canvas as the semantic reference renderer;
4. production interaction, continuity, latency, and fallback gates;
5. capability-gated WebGPU pixels through the same scene buffers;
6. one recreation attempt after device loss, then state-preserving Canvas fallback.

## Non-negotiable gates

- deterministic topology, profile, layout, and transport hashes;
- hot packets below 1 MiB / 4 MiB / 8 MiB at 10K / 50K / 100K nodes with five edges per node;
- bounded cold metadata reads with explicit stale-epoch results;
- repeated Graph actions refocus even when the path is unchanged;
- editor, Graph, Connections, and explanatory Properties show one inspected Concept;
- pointer-anchored adaptive zoom, real pinch/two-finger pan, pointer cancellation, coarse-pointer hit targets, keyboard navigation, and reduced-motion behavior;
- deterministic layout checksum and bounded mental-map displacement after small topology changes;
- frontmost radius-aware picking and collision-free focal label budgets;
- zero recurring RAF, label, or worker work once settled;
- state-preserving WebGPU recovery and Canvas fallback;
- Gate B editor latency remains green with the graph open under navigation and indexing load;
- source and packaged Electron journeys pass on synthetic fixtures and an opt-in read-only copy of the private vault.

## Active implementation waves

- Compact topology and bounded metadata boundary.
- Shared inspected-Concept ownership and navigation.
- Renderer-neutral scene, input transforms, continuity, label/picking policy, and idle scheduler.

Canvas integration, WebGPU acceleration, packaged proof, private-vault dogfood, stale-surface deletion, and launch documentation follow those dependency-setting waves.

## Integrated foundation checkpoint

The dependency-setting waves are now integrated on `launch/gate-d`:

- `9e6481d` — compact typed topology and bounded evidenced detail;
- `0d9ae51` — renderer-neutral scene, picking, labels, controllers, and idle scheduler;
- `e8aa2f5` — one compile-time topology contract shared by core and scene;
- `26a22ce` — App-owned inspected Concept and navigation contract;
- `f0a5188` — bounded O(1) Concept-ID/file-path lookup;
- `fb92a0a` — renderer-neutral presentation plan and Canvas reference adapter;
- `4033e16` — deterministic typed layout worker.

The scale contract uses a 64-bit stable Concept key for continuity and a separate
32-bit layout seed. A 32-bit identity would have roughly a 69% probability of at
least one collision at 100K nodes; the extra identity word preserves exact
continuity while keeping the 100K / 500K hot packet at `6,600,563` bytes.

Current evidence:

| Gate | Result |
| --- | --- |
| Compact transport, 10K / 50K | 660,560 bytes |
| Compact transport, 50K / 250K | 3,300,562 bytes |
| Compact transport, 100K / 500K | 6,600,563 bytes |
| Renderer-neutral scene preparation, 10K / 50K | 2.95 ms p50 / 5.30 ms p95 |
| Canvas plan + dispatch, 10K / 50K | ~6.19 ms combined p95, 9 draw calls |
| Canvas plan + dispatch, 50K / 250K | ~21.45 ms combined p95, 9 draw calls |
| Typed layout, 10K / 50K | ~579 ms to terminal; ~4.1 MiB typed working memory |
| 1% topology update continuity | aligned displacement p95 0.0119, budget <= 0.10 |

These are component measurements, not production FPS claims. The atomic product
migration must still connect topology, lookup, scene, worker, Canvas, bounded
metadata, shared inspection, gestures, and quiescence before Gate D can claim a
working production path. The 50K presentation tier must cache static plan data
rather than rebuilding the full plan on every camera frame.
