# GraphBench v1 roadmap

GraphBench measures the engineering properties of an interactive knowledge-graph surface. It does not pretend that one universal scalar can describe whether a person's knowledge graph is “good.” Renderer speed, layout legibility, knowledge structure, and agent usefulness are separate claims with separate evidence.

## Tracks

### 1. Render

Same topology and fixed coordinates for every renderer.

- ready time
- p50/p95/p99 frame cadence
- frame-budget misses
- CPU submission time
- GPU time when timestamp queries are supported
- JS and GPU memory
- idle quiescence

### 2. Layout

Same topology and deterministic initial positions; each engine uses its native layout.

- first usable frame and settle time
- convergence epoch and deterministic checksum
- edge-length dispersion
- sampled normalized stress
- one-hop neighborhood preservation
- component separation and community mixing
- stability after a 1% incremental topology change

These are diagnostic dimensions, not a composite “quality score.” Different tasks legitimately prefer different tradeoffs.

### 3. Product interaction

- pointer-to-next-paint p50/p95/p99
- selection-to-frame latency
- orbit, pan, zoom, and focus response
- CPU picking correctness against visible depth
- path correctness
- label overlap and focal-label recall
- WebGPU loss and Canvas fallback continuity
- zero recurring work after settle

### 4. Scale

- normal matrix: 10K and 50K nodes, E/V 2, 5, and 10
- publication matrix: through 200K nodes and E/V 20
- opt-in ceiling: 500K and 1M nodes at E/V 2
- every publication case runs at least three independent page trials
- results remain hardware-specific; machines are never pooled into one number

### 5. Knowledge usefulness

This is a future task-conditioned companion track, not a renderer benchmark.

- answerable navigation tasks with known source notes
- shortest explainable path recall
- linked-note and semantic-neighbor retrieval recall
- ontology/property constraint satisfaction
- agent search success, tokens loaded, tool calls, and time to evidence
- counterfactual tests after removing or adding suggested links/tags

Only this track can support claims that graph structure helps an AI system. It requires real or deliberately authored corpora with ground-truth tasks; synthetic force-layout fixtures cannot prove it.

## Frozen visual profiles

- `benchmark-v1`: historical Stellar workload; immutable after the first baseline.
- `benchmark-v2`: normalized cross-renderer pixel workload; ships only after Exo, Sigma, and GraphWaGu adapters expose equivalent settings.
- `explore-v1`: production exploration presentation; zoom-aware presence and bounded focal labels.
- `capture-v1`: internal screenshot/video presentation; stronger presence, never used for performance comparisons.

Every result records profile ID and parameter hash. Profiles may change radius, opacity, labels, and paint; they may never change topology, coordinates, layout seed, or layout checksum.

## Remaining implementation gates

1. **Done:** WebGPU timestamp-query instrumentation with explicit unsupported reporting.
2. **Done for Exo/Sigma:** normalized `benchmark-v2` node radius, edge width, label count, viewport, and DPR.
3. Fix or explicitly quarantine the Sigma combined-run stall.
4. **Done:** SuiteSparse fixtures with canonical source URL, archive SHA-256, and topology checksum.
5. **Metric done; workload pending:** Procrustes-aligned incremental displacement.
6. **Done:** mobile 390×844 product runs alongside 1440×960 desktop runs.
7. Add WebGPU/Canvas parity, device-loss recovery, and zero-idle-work gates.
8. Define the separate knowledge-usefulness task schema before adding any overall knowledge-graph assessment.

## Publication rule

A claim must name the hardware, browser, fixture checksum, view profile, renderer version, track, repetitions, and distribution. “Fast at 10K” is not a result; “1.2 ms p95 input-to-frame at 10K/20K edges on Apple M2 Max under `benchmark-v1`, three trials” is.
