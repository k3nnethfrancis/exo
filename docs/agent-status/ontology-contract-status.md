# Ontology contract status

## Scope

- Base: `abe0ddea08960197299360ff594289e03e8927d2`
- Branch: `launch/ontology-contract`
- Canonical source: `<Workspace Root>/ontology.yaml`
- Accepted checkpoint: configured runtime `.exo/ontology/activation.json`
- Knowledge Graph public schema: 0.3 (`origin` and `ontology-rule`)

## Revised contract after lifecycle audit

`ontology.yaml` is always a Candidate. File creation or editing never activates
it and never invalidates the graph. `WorkspaceOntologyStore` parses the
Candidate, compares exact revisions for Keep/Reject, and persists only an
explicitly kept source/revision as local derived state. `WorkspaceGraph`
consumes Active only; no configured runtime means Generic Markdown.

The parser/compiler supports open Concept Types, Property shapes and allowed
values, bounded path defaults, reference Relations, target expectations, and
required/recommended Findings. Unknown source keys survive. Interpretation is
pure, emits explicit Concept endpoints for unresolved references, includes
Property plus exact Ontology-rule Evidence, and cannot mutate Notes or carry
presentation/execution/inference policy.

## Final evidence

- Candidate/Active store tests cover exact accepted source bytes, restart,
  stale-revision CAS, Reject, explicit Keep-to-Generic, record hash mismatch,
  truncated/unknown/oversized state, and activation-path symlink refusal.
- Core parser/compiler/origin/Active-only graph suite: 18 files / 165 tests.
- Desktop suite, including real candidate watcher event: 59 files / 508 tests.
- CLI suite: 4 files / 27 tests. Root runtime/packaging smoke: 21 tests.
- `pnpm check:repo` and full `pnpm check` (recursive typecheck, all unit tests,
  desktop build, CLI build) pass on the exact tree.
- The real filesystem watcher observes only the canonical candidate outside a
  nested Note Root. Downstream graph refresh deliberately ignores that event.
- Knowledge Graph 0.3 migration is complete in executable graph code;
  invocation `ReviewPathAuthority` remains an unrelated filesystem concept.
- Active-only graph tests prove Candidate edits preserve snapshot, topology, and
  layout identity; unresolved references have explicit Concept endpoints; Note
  bytes remain unchanged.
- Canonical Exo context/docs and the graph stability skill now use Format,
  Ontology, Origin, and Ontology-rule terminology. Internal
  `KnowledgeProfile` and topology `profileHash` remain named compatibility seams
  for the later bounded Note Root Format migration.

Candidate graph-effect preview, graph-generation CAS publication, and product
Keep/Reject/status UI are intentionally the next vertical slice. This commit
provides their stable store/compiler seam; it does not claim Launch Gate E
complete and contains no product path that can create an Active checkpoint.
