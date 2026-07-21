# Launch Gate E — Reviewed Workspace Ontology

Date: 2026-07-20
Result: passed on the clean launch integration branch; promotion remains separate

## What passed

Exo now treats `<Workspace Root>/ontology.yaml` as a user-owned Candidate, not
an instruction that silently changes the graph.

- Candidate parsing is passive, bounded, and atomic. Invalid input never becomes
  a partial interpreter.
- Workspace Settings shows one compact, path-free effect row with icon-only Keep
  and Reject.
- Preview reports bounded typed-Concept, Ontology-Relation, and Finding effects
  without publishing a new graph identity.
- Keep and Reject compare the Candidate revision, Active checkpoint revision,
  previewed graph snapshot, and an exact disk-fresh manifest of every Markdown
  Note. A stale review writes and publishes nothing.
- Keep persists the exact reviewed Ontology source atomically, publishes the
  already-reviewed graph once, and survives restart with the same Active identity.
- Reject preserves Active Ontology state, graph topology, and every Note byte.
- Candidate watcher events do not wake Explorer, invalidate Note caches, or
  replace graph identity. Successful Keep emits the one ordinary graph-change
  event.

## Truthful graph integration

Ontology interpretation adds graph meaning without pretending the user authored
new links.

- Authored outgoing links, backlinks, unresolved links, and editor References
  remain unchanged.
- Resolved local Ontology Relations appear in the bounded Connections graph
  neighborhood and the full topology with the `ontology` visual class.
- Graph detail retains `origin: ontology` plus Property and exact Ontology-rule
  Evidence. The compact Connections payload carries only endpoint identities and
  relation display facts; detail remains the Evidence surface.
- Note Root Formats remain separate: Generic Markdown and the bounded OKF
  compatibility interpreter project base Concepts; the kept Workspace Ontology
  interprets meaning afterward.

## Real Electron proof

The focused Electron journey exercised the user-visible lifecycle:

1. Open a two-Note Workspace with a valid Candidate.
2. Verify no Ontology edge exists before Keep and authored links remain empty.
3. Inspect the compact Candidate effect row in Workspace Settings.
4. Change a Note after preview and verify the first Keep returns
   `Changed—review again` without publishing.
5. Keep the refreshed review and verify one Ontology Relation, its origin and
   rule Evidence, a visible Connections edge, and unchanged authored Links.
6. Restart Exo and verify the exact Active Ontology identity and graph Relation.
7. Create a second Candidate, Reject it, and verify topology, Active identity,
   rendered graph, and every Markdown byte remain unchanged.

The first implementation run exposed a real lifecycle bug: a harmless duplicate
filesystem refresh could erase a newly restaged review between the stale response
and the second Keep. Staging now survives ordinary refreshes; exact manifest and
snapshot guards still reject real changes. A focused core regression preserves
that sequence.

## Verification

- `pnpm check` — 21 runtime/script tests, 171 core tests, 516 desktop tests, 27
  CLI tests, all typechecks, and production builds passed.
- `pnpm check:repo` — passed.
- `pnpm graph:presentation:perf` — 2/2 isolated presentation gates passed.
- focused Electron Ontology tracer — 1/1 passed in 5.1 seconds.
- visual inspection — compact Candidate row and visible kept Connections edge
  passed; no Candidate path or revision leaked into the review row.

## Honest remaining work

- Freeze the public OKF and OpenWiki interoperability fixtures before claiming
  broader Format compatibility.
- Build the optional, evaluation-gated Workspace Ontology discovery/design Skill
  on top of those fixtures and this exact review path.
- Add broader conformance/explanation UX only when a concrete workflow earns it.
- An oversized unreadable Candidate remains inert and diagnostic-only; explicit
  rejection of a file that cannot be bounded-hashed is deliberately deferred.
- Gate E has source-Electron evidence. It does not by itself authorize promotion
  or replace the eventual release-candidate package proof.

-- Exo | 2026-07-20
