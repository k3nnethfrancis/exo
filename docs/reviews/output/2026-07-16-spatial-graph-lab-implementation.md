# Spatial graph lab — Fable ruling implementation status

Date: 2026-07-16
Scope: isolated `projects/exo-graph-viz-lab` only

## Ruling applied

Fable selected Option C with amendments. The lab keeps a flat, Canvas-rendered
scene: positions now reserve `x,y,z` with `z = 0`; camera pitch is reserved at
zero; there is no WebGPU renderer, GPU picking, production graph surface, CLI,
IPC, or persistent Exo workspace contract.

## Completed safe implementation

- Replaced the accidentally public/private default graph with a deterministic,
  opaque synthetic fixture generator (20 / 250 / 2,500 / 10,000 nodes).
- Bound the local stability server to `127.0.0.1`; default tests assert the
  synthetic medium fixture and cannot silently use a local vault snapshot.
- Removed Map / Focus / Path / angle / physics / reset chrome.
- Corrected direct manipulation: primary drag and ordinary wheel pan;
  pinch/modifier-wheel dollies; tap selects; the second selected node computes
  an explainable path; double-tap empty space frames the overview; Alt+drag is
  the only node-move gesture.
- Added a renderer-independent scene module for topology normalization,
  x/y/z layout projection, path finding, world/screen transforms, and CPU
  picking. Canvas remains draw-only relative to those primitives.
- Made local layout cache fixture-keyed and index-based, so private absolute
  node identifiers are not persisted in browser storage.
- Extended the kinetic gate to prove no old controls remain, primary pan and
  ordinary scroll move the camera, modifier-wheel zooms, pitch/bearing stay
  flat, and the renderer-independent layout has three position dimensions.

## Evidence

`node kinetic-stability.cjs` passes against the generated 250-node fixture:

```text
250 nodes · 438 links · mean degree 3.504
at-rest movement: 0
post-overview movement: 0
pan distance: 289.71
ordinary-scroll distance: 89.62
modifier-wheel scale: 0.566 → 0.648
position dimensions: 3; pitch: 0; bearing: 0; page errors: 0
```

## Remaining lab gates

The lab still needs scene-state-based p95 frame/gesture-latency and label
collision assertions, deterministic settle/mental-map tests, keyboard/reduced
motion walkthrough evidence, and density tests against the 20 / 2,500 / 10,000
fixtures. A WebGPU spike remains explicitly blocked until the Canvas p95 gate
fails at an intended density.

-- Shoshin | 2026-07-16
