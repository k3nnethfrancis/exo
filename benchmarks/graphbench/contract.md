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

### Resilience

- Inject two renderer failures to exercise WebGPU retry followed by Canvas
  fallback.
- Verify node/edge counts, profile hash, coordinates, selection, and layout
  checksum survive the renderer transition.
- After recovery settles, verify the renderer schedules zero recurring frames.
- This is a deterministic recovery-path test, not a claim that the browser
  delivered a physical GPU device-loss event.

### Incremental layout

- Settle the original deterministic topology, add exactly 1% new nodes with
  deterministic attachment edges, and settle again.
- Compare unchanged nodes after removing global translation, rotation, and
  uniform scale with a Procrustes alignment.
- Report the displacement distribution and settle time separately. A global
  camera/layout transform is not counted as mental-map damage.
- The current deterministic layout gate requires normalized p95 displacement
  at or below `0.10` for unchanged nodes after a 1% update.

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
  comparison result.
- Every renderer records a frozen visual-profile identifier and parameter hash.
  Presentation experiments never silently change the workload of an existing
  profile.
- Desktop and mobile viewport results are separate cohorts. A narrow viewport
  run is never pooled with desktop or presented as equivalent hardware.
- GPU measurements come only from renderer timing facilities such as WebGPU
  timestamp queries. CPU submission time is never relabeled as GPU time.
