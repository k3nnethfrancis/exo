# Exo GraphBench

GraphBench is a hardware-stamped browser benchmark for interactive node-link
visualization. It borrows the scale matrix and layout-quality vocabulary from
GraphWaGu and the 2025 web-library comparison, while separating three workloads
that public claims often conflate:

1. **Render** — every engine receives the same graph and fixed coordinates.
2. **Layout** — an engine's native layout is timed and scored independently.
3. **Product** — camera/input latency, selection, labels, and memory are tested
   as user-facing capabilities rather than renderer throughput.

See [roadmap.md](./roadmap.md) for the full renderer, interaction, scale, and
future knowledge-usefulness suite. The latter is intentionally separate: a fast
layout benchmark cannot prove that a graph helps an agent answer questions.

The checked-in runner never downloads private data. Generated fixtures and
benchmark results live under `artifacts/`, which is safe to replace and should
not contain a real Exo workspace projection.

## Profiles

| Profile | Nodes | Edge / node ratios | Engines | Purpose |
| --- | --- | --- | --- | --- |
| `smoke` | 10,000 | 2 | Exo, Sigma | fast contract check |
| `compare` | 10k, 50k | 2, 10 | Exo, Sigma, pinned GraphWaGu | public comparator pass |
| `normalized` | 10k, 50k | 2, 10 | Exo, Sigma | same 4px nodes, 1px edges, zero labels, viewport, and DPR |
| `layout-smoke` | 10,000 | 2 | Exo | convergence and layout-quality gate |
| `standard` | 10k, 50k | 2, 5, 10 | Exo, Sigma | normal comparison |
| `full` | 10k, 50k, 100k, 200k | 2, 5, 10, 20 | Exo, Sigma, GraphWaGu when prepared | publication run |
| `million` | 500k, 1M | 2 | Exo | opt-in scale ceiling, not part of normal CI |
| `mobile` | 10k | 2 | Exo | 390×844 at DPR 2 product-interaction run |

Run from the Exo repository:

```sh
pnpm install
pnpm graphbench:test
pnpm graphbench:smoke
pnpm graphbench:mobile
pnpm --filter @exo/graphbench prepare:suitesparse
pnpm --filter @exo/graphbench normalized:suitesparse
```

Publication profiles repeat each case three times. Override deliberately with
`--repetitions 1..20` when diagnosing variance; never compare a one-off result
to a repeated publication result.

Every run writes a gitignored, hardware-stamped `artifacts/<run-id>/results.json` and a
readable `summary.md`. `artifacts/latest.*` points to the most recent run. A
missing capability is recorded as unsupported or unavailable; it is never
silently converted into a zero.

Every result records the fixture checksum, browser and OS, CPU/RAM, viewport,
device pixel ratio, renderer identity, capability gaps, and exact metric
definitions. Optional metrics are reported as unavailable, never synthesized.

Exo render trials report browser frame cadence and WebGPU pass time separately.
GPU time comes only from `timestamp-query`; unsupported adapters remain visibly
unsupported. Every Exo snapshot records the frozen presentation profile and its
parameter hash.

## Public comparison basis

- [GraphWaGu](https://stevepetruzza.io/pubs/graphwagu-2022.pdf): synthetic scales from 100 to 1,000,000 vertices at 20 edges per
  vertex, plus SuiteSparse datasets; FPS, layout iteration time, convergence,
  edge uniformity, stress, and neighborhood preservation.
- [Zhao et al. (2025)](https://link.springer.com/article/10.1186/s42492-025-00193-y): 481 static datasets from 100 to 200,000 vertices and edge
  ratios 1–10; construction time and FPS across SVG, Canvas, and WebGL.

GraphBench adds p50/p95/p99 frame cadence, next-paint input latency, precise JS
heap when Chromium exposes it, optional WebGPU timestamp queries, label overlap,
and deterministic convergence. Results from different hardware are not pooled.
