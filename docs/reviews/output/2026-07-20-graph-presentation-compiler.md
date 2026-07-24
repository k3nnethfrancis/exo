# Gate D renderer-neutral presentation compiler

Date: 2026-07-20
Scope: presentation compilation only; no product Graph Pane, WebGPU host, IPC, or graph-semantic changes

## Result

`GraphPresentationCompiler` now produces the exact `GraphPresentationPlan`
bytes emitted by `createGraphPresentationPlan` while retaining geometrically
grown typed-array capacities between synchronous pixel-adapter calls. The pure
function remains the detached truth oracle.

The compiler keeps graph meaning outside renderers and invalidates only the
affected presentation layer:

| Input change | Rebuilt work |
| --- | --- |
| Topology | static radii/colors, order, geometry, styles; capacities grow only when required |
| Projection / layout frame | visibility/order, projected centers and curves, styles |
| Selection / hover / path | emphasis/order/styles; projected curve geometry is reused |
| Theme | cached colors and color-dependent order only when palette cardinality changes |
| Presentation profile / camera radius | radii, opacity, and widths |
| Labels only | bounded detached label snapshot; numeric arrays are reused |
| No relevant change | no numeric rebuild |

The hot path has no boxed sort, node identity strings, or labels. Counting
buckets and output buffers are reused. Returned numeric views are compiler-
owned and valid until the next `compile`; Canvas/WebGPU consume them
synchronously. This lifetime is what removes large per-frame ArrayBuffer churn.

## Exactness gates

Focused parity covers:

- overview, exploration, and focus profiles;
- same-cardinality and changed-cardinality themes, including transparency;
- camera-only and projection changes;
- selection, hover, path, and path target;
- layout epoch and topology epoch changes;
- labels-only updates; and
- empty and fully culled scenes.

Every case compares the full plan, including every typed-array byte, against
the detached pure oracle. Separate tests prove all nineteen numeric buffers
retain their backing `ArrayBuffer` across camera, interaction, theme, profile,
and stable frames.

## M2 Max measurements

Hardware: Apple M2 Max, arm64, macOS, Node 26.5.0.
Fixture: deterministic all-visible synthetic topology, 1:5 node/edge ratio,
1,440 × 900 viewport, DPR 2. Each distribution is 30 measured runs after three
warmups. These are CPU presentation measurements, not FPS or product-input
claims.

Recorded focused-gate run, milliseconds:

| Fixture | Workload | p50 | p95 | max |
| --- | --- | ---: | ---: | ---: |
| 10K nodes / 50K edges | detached pure oracle | 3.41 | 3.87 | 4.14 |
|  | compiled camera/projection frame | 2.98 | 3.51 | 3.62 |
|  | compiled interaction-only frame | 1.39 | 2.18 | 2.54 |
|  | unchanged numeric frame | 0.00 | 0.00 | 0.00 |
| 50K nodes / 250K edges | detached pure oracle | 16.31 | 17.25 | 17.37 |
|  | compiled camera/projection frame | 13.43 | 13.51 | 13.52 |
|  | compiled interaction-only frame | 6.81 | 6.86 | 7.16 |
|  | unchanged numeric frame | 0.00 | 0.00 | 0.00 |

Across five consecutive isolated repeats, the 50K/250K compiled-camera p95
range was 13.54–16.15 ms. The focused M2 Max gate is therefore `< 16.7 ms`.
It is hardware-stamped rather than generalized to other machines.

Run the wall-clock gate in isolation:

```sh
pnpm graph:presentation:perf
```

That command fails explicitly on hardware without a declared threshold. Use
`pnpm graph:presentation:measure` to collect the same hardware-stamped
distribution on another machine without misrepresenting it as acceptance.

Ordinary unit suites still verify exact output parity, capacity reuse, and
finite measurements, but do not enforce wall-clock time while other test files
compete for the same CPU. The dedicated command sets the explicit performance
gate and runs this file with one worker.

Capacity evidence:

| Fixture | Node capacity | Edge capacity | Resident typed capacity | Measured-frame growth | Measured-frame capacity bytes |
| --- | ---: | ---: | ---: | ---: | ---: |
| 10K / 50K | 16,384 | 65,536 | 6,621,184 bytes | 0 | 0 |
| 50K / 250K | 65,536 | 262,144 | 24,905,728 bytes | 0 | 0 |

“0 bytes” here means no new compiler-owned typed-array capacity. Small plan
wrappers and bounded detached label arrays remain ordinary per-call objects.

## Irreducible work

A new camera/projection frame must still inspect visible nodes and edges,
rebuild deterministic depth/style order, copy projected centers, and calculate
quadratic edge curves: `O(visible V + visible E)`. The compiler removes repeat
allocation and static derivation; it does not pretend this projection work can
disappear. Interaction-only frames reuse curve geometry but still reorder and
rewrite visible presentation values. Product FPS, input latency, label planning,
scene projection, and concurrent editor behavior remain separate Gate D proof.
