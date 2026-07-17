# GraphBench contract

Status: v1 tracer bullet
Date: 2026-07-16

## Fixture

A fixture is an undirected simple graph with deterministic node identifiers,
edges, group labels, and fixed 3D coordinates. `edgeRatio` means `E / V`; mean
degree is therefore `2 × edgeRatio`.

Synthetic runs are identified by `(generatorVersion, seed, nodes, edgeRatio)`.
Real runs additionally record the canonical source URL and source checksum.

## Tracks

### Render

- Layout is disabled.
- All engines receive the fixture's fixed positions.
- Measure navigation-to-ready, actual `requestAnimationFrame` cadence during a
  controlled camera gesture, CPU work exposed by the engine, optional GPU time,
  JS heap, errors, and viewport containment.

### Layout

- Engine-native layout begins from the fixture's deterministic initial state.
- Measure time to first usable frame, convergence time, iteration/epoch count,
  deterministic checksum, memory, edge uniformity, sampled stress, and sampled
  one-hop neighborhood preservation.
- An engine without layout reports `unsupported`; it does not fail render.

### Product

- Measure pointer-to-next-paint latency, selection latency, label overlap,
  camera response, path behavior, and idle quiescence.
- Capabilities absent from a baseline are explicit `unsupported` values.

## Fairness invariants

- Same fixture bytes, viewport, DPR, browser binary, and hardware per comparison.
- No graph generation, network download, or dependency installation inside a
  timed region.
- Warm-up and measured windows are distinct.
- Report frame-time distributions; never infer latency from average FPS alone.
- CPU submission time and GPU completion time are different metrics.
- Quality scores always include their sample size and dimension count.
- A run with browser errors, missing fixture counts, or a checksum mismatch is
  invalid rather than slow.
- Publication profiles run at least three independent page trials per case and
  report the distribution across trials. A single lucky frame window is not a
  public benchmark result.
- Every renderer records a frozen visual-profile identifier. Presentation
  experiments never silently change the workload of an existing profile.
