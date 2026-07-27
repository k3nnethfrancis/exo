# Graph evaluation

This is Stem's internal, hardware-stamped regression suite for the graph scene.
It measures Stem only. It is not a public cross-library benchmark or an AI
evaluation.

The runner uses deterministic synthetic topology and a frozen visual profile to
separate four claims that should not be conflated:

- **Render** — frame cadence and readiness with fixed coordinates.
- **Layout** — convergence time and structural quality of native layout.
- **Product** — input-to-next-paint latency, selection, labels, memory, and
  idle quiescence.
- **Recovery and incremental layout** — renderer fallback continuity and how
  much an existing layout moves after a 1% topology update.

The browser scene in `public/harness` is an evaluation harness, not the desktop
Graph Pane. Keep it only as the deterministic measurement surface; production
integration belongs in the desktop graph tests.

## Run

```sh
pnpm graph:eval:test
pnpm graph:eval:smoke
```

Additional focused profiles:

```sh
pnpm graph:eval:standard
pnpm graph:eval:mobile
pnpm graph:eval:resilience
pnpm graph:eval:incremental
```

| Profile | Scope | Trials |
| --- | --- | ---: |
| `smoke` | 10k nodes, 2 links/node; render, layout, product | 1 |
| `standard` | 10k and 50k nodes; 2 and 5 links/node; render, layout, product | 3 |
| `mobile` | 10k nodes at 390×844 DPR 2; product | 3 |
| `resilience` | 10k nodes; forced WebGPU recovery and Canvas continuity | 3 |
| `incremental` | 10k nodes; one 1% topology update | 3 |

Each run writes gitignored artifacts under `artifacts/`: fixture checksum,
hardware/browser stamp, per-trial results, and aggregate distributions. Do not
pool results from different hardware.

## Evaluation contract

- A fixture is a deterministic, undirected simple graph with fixed 3D
  coordinates. `edgeRatio` is links divided by nodes.
- No graph generation, network download, or dependency installation occurs in a
  timed region.
- Browser errors, checksum mismatches, and fixture-count mismatches invalidate a
  trial; they are never silently reported as slow measurements.
- Frame-time distributions and input-to-next-paint are reported directly. Average
  FPS is not treated as latency.
- CPU submission time and optional WebGPU timestamp-query time are distinct.
- Layout quality reports its sample size and dimension count. The incremental
  gate aligns unchanged nodes before scoring displacement, so a global transform
  is not counted as mental-map damage. Current p95 displacement limit: `0.10`
  after a deterministic 1% update.
- The visual profile is named and hashed in every result so presentation changes
  cannot silently change the workload.
