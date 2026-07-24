# Ontology review status

## Phase 0 — oriented

- Branch: `launch/ontology-review` at `b64810e`.
- Layer: Knowledge Graph plus product integration. The invariant at risk is that
  Candidate Ontology bytes must remain inert until an exact reviewed Keep.
- Read the repo instructions, graph/settings skills, approved implementation
  plan, foundation docs, ADR 0006, and private Specs 07/13.
- Implementation decision: extend the existing serialized graph utility worker;
  do not create a renderer parser, second graph model, or parallel coordinator.
- No blocker. Next: pure effect contract and parameterized snapshot build.

## Phase 1 — pure effect contract and staging complete

- Added deterministic, bounded Ontology effect counts and affected-Concept
  comparison in core. The contract contains identities/counts only.
- Parameterized the one `WorkspaceGraph` snapshot builder for Active or staged
  Candidate interpretation. Normal reads still consume Active only.
- Added worker-local staging and three-part guards. Candidate preview mutates no
  Note, Active cache, topology cache, or renderer-visible graph identity.
- Cached the integrity-checked Active checkpoint in the graph owner; ordinary
  topology/detail reads no longer reread or reparse activation state.
- Focused core proof covers stale Markdown, exact staged publication, restart,
  Reject preservation, explicit deactivation, and unchanged Note bytes.
- Gate: 18 files / 166 core tests pass. No blocker. Next: utility operations and
  thin service/IPC.

## Phase 2 — serialized preview/review owner complete

- Added `ontology-preview`, `ontology-keep`, and `ontology-reject` to the
  existing serialized derived graph worker. No second worker/coordinator exists.
- Keep CASes Candidate revision, activation-record revision, and base snapshot;
  publishes the complete staged snapshot only after exact-byte atomic
  persistence. Stale guards write and publish nothing.
- Reject validates the exact staged guard and preserves Active caches. Explicit
  deactivation Reject is durable and keeps the Active Ontology.
- Current/already-kept candidates are not staged, so one Candidate can emit one
  successful graph publication only.
- Hardened foundation reads with no-follow handles, regular-file/realpath checks,
  fstat caps, and bounded handle reads for Candidate, Keep reread, and activation.
  Invalid Active state cannot be rewritten through Reject.
- Corrected type precedence to explicit value, then path default, then Format
  type fallback. Added in-memory Active-checkpoint proof across normal reads.
- IPC guards and renderer payload text are mechanically bounded and path-free.
- Gates: core 19 files / 170 tests; desktop 60 files / 513 tests; desktop
  typecheck all pass. No blocker. Next: compact Workspace Settings row.

## Phase 3 — review surface and graph convergence complete

- Added one compact, path-free Ontology row directly below the Notes folder in
  Workspace Settings. Valid Candidates show bounded before/after effects with
  icon-only Keep/Reject; invalid, stale, rejected, current, busy, and unavailable
  states remain explicit without exposing revisions, snapshots, or filesystem
  paths.
- Preview/Keep/Reject requests use one monotonic epoch, so stale responses cannot
  overwrite newer state. Candidate file notifications reopen review without
  waking Explorer, Note caches, or the normal workspace-changed path.
- Successful Keep emits exactly one graph-changed event after persistence;
  Reject and repeated Keep emit none. Open Connections contexts refresh from
  that event without reloading Note bodies.
- Preserved authored Links truthfulness: Ontology edges do not enter outgoing,
  backlinks, unresolved links, or editor References. Resolved local Ontology
  edges live in a distinct bounded graph-only neighborhood projection, retain
  their `ontology` origin/visual class, and query the cached local-degree index.
- Focused core proof covers no relation before Keep, a `supports` relation from
  both endpoint neighborhoods after Keep, authored Links remaining empty, and
  removal after explicit deactivation. Renderer proof covers ontology edge
  projection without changing authored References.
- Gates: core 19 files / 170 tests; desktop 60 files / 516 tests; desktop
  typecheck all pass. No blocker. Next: real Electron tracer, restart proof,
  screenshot evidence, docs, and full repository gates.

## Phase 4 — real Electron tracer complete

- The real Electron path passes Candidate → external Markdown change → stale
  Keep → refreshed Keep → Connections convergence → restart → later Reject.
- The tracer compares every Markdown Note byte, counts zero Ontology edges
  before Keep and one after Keep/restart/Reject, inspects the accepted Relation
  as `origin: ontology` with `ontology-rule` Evidence, and compares the exact
  Active Ontology identity/revision across restart.
- The first refreshed review remains actionable through duplicate same-content
  watcher events. Keep and Reject both compare an exact path+byte SHA-256 Note
  manifest, so preserving staged review across cache refresh remains safe.
- Common Generic/no-Candidate preview does not build the graph or compute a
  manifest. The compact Connections payload deduplicates endpoint Notes and
  carries at most 64 local Relations with bounded Evidence.
- Electron screenshots inspected at
  `apps/desktop/test-results/ontology-review-reviews-On-15c9d-one-persistent-graph-change/ontology-review-candidate.png`
  and `ontology-review-kept-graph.png`. The Candidate row is compact/path-free;
  the kept local graph visibly renders one edge.
- Gates: core 19 files / 171 tests; desktop 60 files / 516 tests and typecheck;
  desktop production build; focused Electron tracer all pass. No blocker.
  Next: final repository gates, diff hygiene, and commit.
