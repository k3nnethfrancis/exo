# Launch Gate D — Graph as a product surface

Date: 2026-07-20
Result: passed for the current macOS launch surface

## What passed

Exo now has one production graph path from canonical Markdown to pixels:

```text
Markdown → WorkspaceGraph → compact topology → deterministic layout
         → renderer-neutral scene → WebGPU or Canvas
```

- The former object Graph View IPC, duplicate graph snapshot/query model,
  unbounded Concept-detail route, and duplicate renderer scene are gone.
- Hot topology packets are string-free, snapshot-qualified, and bounded:
  `660,560` bytes at 10K/50K, `3,300,562` bytes at 50K/250K, and
  `6,600,563` bytes at 100K/500K nodes/edges.
- Editor, Connections, Properties, and the Graph Pane share the App-owned
  inspected Concept. Canvas and WebGPU share selection, route, camera, focal
  labels, picking, and interaction semantics.
- Click selects, Shift-click explains a route, double-click opens a Note,
  repeated open focuses it, and frame-all is explicit. Keyboard and reduced-
  motion behavior are deterministic; trackpad wheel and coarse-pointer pinch/
  pan policies have focused coverage.
- Layout is deterministic, preserves surviving state across graph generations,
  and stops scheduling worker or render work when settled.
- WebGPU owns only reconstructible pixels. Canvas is complete before GPU
  readiness and takes over immediately after device loss or a synchronous draw
  failure without losing CPU scene, selection, or route state.

## Runtime proof

The source Electron app and the exact unsigned packaged macOS app both created
a real hardware WebGPU adapter/device, compiled the production shaders and
pipelines, submitted two draws for a two-node/one-edge scene, and observed queue
completion. The tested runtime was Electron `41.0.2`, Chromium
`146.0.7680.72`, on an Apple Metal 3 adapter. Exo uses Electron's default GPU
policy; no GPU-enabling or unsafe Chromium flags are present. Full details are
in [`2026-07-20-launch-gate-d-webgpu-proof.md`](./2026-07-20-launch-gate-d-webgpu-proof.md).

Because the default GPU policy changed, the direct-PTY terminal was re-gated in
source and package: rapid typing, multiline paste, Enter, Backspace, history,
Escape, Ctrl-C recovery, resize, scrollback, utility-pane hide/reveal, and
editor coexistence all passed. No terminal runtime code changed.

## Scale and latency proof

The reusable presentation compiler owns 19 numeric buffers and performs no
capacity growth in measured steady-state frames. On the M2 Max proof machine:

- 10K nodes / 50K edges: camera p95 about `3.5 ms`; interaction about `2.2 ms`.
- 50K nodes / 250K edges: camera p95 `13.5–16.2 ms`; interaction about `6.9 ms`.
- Resident compiler capacity: `6.62 MB` and `24.91 MB` respectively.

The full Electron Graph Pane gate opened a 1,200-Note graph while indexing
maintenance, filesystem Search, Terminal, typing, and 20 Note navigations ran.
It forced WebGPU → Canvas halfway through typing and continued on the same
scene. Across repeated runs:

- typing p50 about `6.7 ms`, p90 `11.8–12.0 ms`, p99 `13.9–14.5 ms`;
- navigation p50 about `40 ms`, p90 `41–43 ms`, max `53.2 ms`;
- warm filesystem Search about `9–11 ms`; and
- zero renderer long tasks.

The performance command is intentionally isolated. Running it concurrently
with the full suite measures host contention rather than the declared graph
workload and is not acceptance evidence.

## Guarded real-workspace proof

An opt-in harness copied a private Markdown workspace into a fresh OS-temporary
directory, excluded derived state and symlinks, stripped private configuration
from Electron, disabled screenshots/traces/video, and fingerprinted the
original before and after. Only aggregate evidence was retained.

The disposable copy contained 1,567 Markdown files, 1,863 total files, 2,760
graph nodes, and 1,958 edges. Source and exact packaged Exo both passed:

- WebGPU first, then forced Canvas recovery;
- pan, zoom, select, and route on both renderers;
- Note open and Connections ↔ Graph ↔ Note identity;
- three close/reopen cycles; and
- a copy-only live graph rebuild in about `0.9 s`.

The original fingerprint was unchanged after both journeys. The reusable,
fail-closed harness is documented in
[`private-vault-graph-gate.md`](../../private-vault-graph-gate.md).

## Verification

- `pnpm check:repo`
- `pnpm --filter @exo/desktop typecheck`
- `pnpm --filter @exo/desktop test -- --run` — 59 files / 507 tests
- `pnpm graph:presentation:perf` — isolated hardware gate
- source and exact-package WebGPU probe
- source and exact-package direct-PTY smoke
- three repeated full Graph Pane concurrent-latency journeys
- source and exact-package guarded private-copy journey

## Honest remaining work

Gate D establishes the production graph foundation; it does not finish the
graph product. Remaining work is intentionally above this boundary:

- make the compact Connections neighborhood consume the same projection and
  presentation compiler as the full graph instead of its current bounded SVG;
- finish user-owned `ontology.yaml`, conformance, and graph-explanation UX;
- add opt-in semantic overlays and reviewable relationship proposals;
- broaden the performance matrix to more hardware and GPU timestamp support;
- continue real-device legibility and gesture tuning without changing the
  interaction contract; and
- ship the first reviewable graph-maintenance Skill.

-- Exo | 2026-07-20
