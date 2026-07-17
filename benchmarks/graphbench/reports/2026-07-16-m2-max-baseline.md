# Exo GraphBench baseline — Apple M2 Max

Date: 2026-07-16 Pacific / 2026-07-17 UTC
Browser: headless Chrome 150.0.7871.128
Viewport: 1440 × 960 at DPR 1
Hardware: Apple M2 Max, 12 logical cores, 96 GiB RAM

## Fixed-layout render track

Every engine received the same deterministic graph bytes and fixed coordinates.
Layout, labels, and graph generation were outside the timed window. The reported
p95 is requestAnimationFrame cadence while requesting a render every frame; it
is refresh-bound near 14–15 ms on this machine until an engine misses that pace.

| Fixture | Engine | Ready | Frame p95 | Measured JS memory |
| --- | --- | ---: | ---: | ---: |
| synthetic 10k / 20k | Exo | 99.4 ms | 14.66 ms | 21.3 MiB |
|  | Sigma 3.0.3 | 139.5 ms | 14.10 ms | 59.1 MiB |
|  | GraphWaGu pinned | 687.1 ms | 14.70 ms | 34.3 MiB |
| synthetic 10k / 100k | Exo | 129.8 ms | 14.94 ms | 28.1 MiB |
|  | Sigma 3.0.3 | 244.5 ms | 26.70 ms | 79.0 MiB |
|  | GraphWaGu pinned | 233.3 ms | 15.01 ms | 39.3 MiB |
| synthetic 50k / 100k | Exo | 144.1 ms | 14.36 ms | 37.1 MiB |
|  | Sigma 3.0.3 | 303.0 ms | 40.03 ms | 95.1 MiB |
|  | GraphWaGu pinned | 294.7 ms | 15.06 ms | 43.1 MiB |
| SuiteSparse fe_4elt2 11,143 / 32,818 | Exo | 118.0 ms | 14.86 ms | 22.7 MiB |
|  | Sigma 3.0.3 | 155.0 ms | 13.85 ms | 63.5 MiB |
|  | GraphWaGu pinned | 221.4 ms | 14.97 ms | 37.2 MiB |

The first GraphWaGu case includes cold pipeline initialization; later readiness
figures are the useful steady-state comparison. The harness validates node and
edge counts after load and invalidates mismatches rather than timing them.

## Exo product track

At 10,000 nodes / 20,000 links, Exo measured 1.38 ms p95 from pointer event to
the next animation frame and used 16.3 MiB. The current selection-to-double-frame
probe measured 55.2 ms and is retained as an end-to-end feedback metric, not
reported as renderer CPU time.

## Exo layout track

At 10,000 nodes / 20,000 links, Exo settled after 4.93 s (237 epochs) using
25.0 MiB. Edge-length coefficient of variation was 1.459, sampled normalized
stress was 0.579, and strict sampled one-hop neighborhood preservation was 0.
The renderer is strong; this fixture shows the current native layout still needs
substantial quality work. Render and layout claims must remain separate.

## Reproduce

```sh
cd /path/to/exo
pnpm graphbench:smoke
pnpm --filter @exo/graphbench prepare:graphwagu
pnpm --filter @exo/graphbench compare
pnpm --filter @exo/graphbench prepare:suitesparse
pnpm --filter @exo/graphbench compare:suitesparse
pnpm --filter @exo/graphbench layout:smoke
```

Machine-readable source runs:

- `artifacts/2026-07-17T05-20-57Z-smoke/results.json`
- `artifacts/2026-07-17T05-26-01Z-compare/results.json`
- `artifacts/2026-07-17T05-29-49Z-compare/results.json`
- `artifacts/2026-07-17T05-31-55Z-layout-smoke/results.json`

Known measurement gap: GPU timestamp queries are detected in the hardware stamp
but not yet exposed by every adapter, so the suite reports them as unsupported.
No CPU timing is relabeled as GPU time.
