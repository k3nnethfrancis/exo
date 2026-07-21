# Connections shared projection status

Branch: `feat/connections-shared-projection`
Base: `abe0ddea08960197299360ff594289e03e8927d2`

## Gate 1 — orientation and interface decision

Status: complete

- Affected layers: Graph projection, layout/scene, renderer, and Connections
  product integration.
- Invariant at risk: Connections must not invent a second graph scene or pixel
  contract, and its bounded local view must not move ontology strings into the
  render hot path.
- Current defect: `GraphNeighborhoodView` independently chooses circular SVG
  coordinates, line geometry, node radii, labels, and colors.
- Chosen seam: adapt the already-bounded canonical `RendererGraphNeighborhood`
  once into compact typed topology, then use the production deterministic
  layout, renderer-neutral scene, focal label planner, reusable presentation
  compiler, and Canvas pixel adapter. The compact rail remains passive; its
  existing accessible Note buttons own navigation, while Expand continues to
  open the full Graph Pane at the inspected Note.
- Deliberate non-change: no new IPC, shared protocol, worker, gesture model,
  ontology vocabulary, or full-Workspace topology fetch. The rail projection
  remains capped at eight nodes and draws only edges whose endpoints are in
  that bounded set.

Next gate: encode the typed projection and shared-presentation contract in
focused tests, then replace the SVG without changing Connections behavior.

## Gate 2 — shared thumbnail implementation

Status: complete

- Added a pure, deterministic, eight-node adapter from the canonical bounded
  neighborhood to compact typed topology. `focusPath`, not caller array order,
  selects the first/focal Concept; remaining nodes and induced edges have
  stable ordering.
- The rail now draws through `createGraphScene`, `selectGraphPath`,
  `planGraphLabels`, `GraphPresentationCompiler`, and `GraphCanvasRenderer`.
  It owns no animation frame, worker, renderer host, or gesture state and does
  no work after an explicit data, resize, or theme change.
- Removed the SVG-specific coordinate, edge, node, and label rules. The existing
  accessible Note buttons remain the navigation surface, and the Canvas exposes
  an equivalent image label.
- Focused contract tests cover deterministic string-free topology, induced-edge
  bounds, selected/path state, required focal labels, and production compiler
  output. The existing component test now rejects any return to SVG.
- Desktop unit suite: 60 files / 510 tests passed. Desktop typecheck and
  repository structural checks passed.

Next gate: exercise the real Electron Connections → local Canvas → Expand flow,
then run broad verification and inspect the final diff for stale custom paths.

## Gate 3 — Electron and broad verification

Status: complete

- The real Electron navigation journey passed. It verifies a visible local
  Canvas with non-transparent graph pixels, the bounded edge count, and Expand
  returning to the full Graph Pane at the same inspected Note.
- The local renderer contains no SVG, custom point function, animation frame,
  graph worker, Graph Pane runtime import, or gesture implementation. Shared
  theme-to-palette resolution now lives in a small renderer-neutral module.
  Draws occur only on mount/data, element resize, or theme change;
  renderer/compiler instances are disposed with the tab surface.
- `pnpm check` passed: all workspace typechecks; core 17 files / 153 tests;
  desktop 60 files / 510 tests; CLI 4 files / 27 tests; desktop and CLI builds.
- `pnpm check:repo` passed.
- `pnpm graph:presentation:perf` passed (1 file / 2 scale tests).
- Focused Electron command passed:
  `pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/shell.spec.ts --grep "keeps editor, full graph"`
  (1 test, 3.7 seconds on the final source build).

Residual risk: this bounded rail intentionally uses the deterministic seed
layout, not the full Pane's relaxed worker coordinates. It shares graph meaning,
selection, label, presentation, and pixels but does not promise identical node
positions between the thumbnail and full map. Earning that continuity would
require App-owned derived layout state, a materially broader product boundary.
