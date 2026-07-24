# Ontology interoperability fixtures status

## Phase 0 — oriented

- Branch: `launch/ontology-fixtures`
- Base: `73eccde41af78d8a556e02f42350918fe3700b56`
- Layer: Knowledge Graph / Note Root Format verification
- Invariants: Markdown remains canonical; OKF remains permissive; reserved
  documents are Notes but not Concepts; Workspace Ontology meaning remains
  separate from Format compatibility.

## Phase 1 — upstream contract pinning

- Google Knowledge Catalog pinned at
  `d44368c15e38e7c92481c5992e4f9b5b421a801d`.
- LangChain OpenWiki pinned at release `0.2.1`, commit
  `264ee8465f3c9874b822bcbb7ca68de471143798`.
- The checked-in OpenWiki indexes at that revision predate the pinned
  deterministic index generator's current contract: they carry Concept
  frontmatter and omit the root `okf_version`. The fixture therefore records a
  tiny deterministic generator output from the public middleware test inputs;
  it does not relabel the stale checked-in wiki as conformant.
- Licenses: Google OKF is Apache-2.0 (covered by the repository Apache-2.0
  license); the complete OpenWiki MIT notice is vendored with its fixture.

## Phase 2 — implementation

- Added a checksum-pinned manifest plus the exact Google five-file slice, a
  deterministic OpenWiki generator-output wiki, full MIT notice, and one local
  Format/Ontology boundary case.
- Extended the two earned Format implementations with passive policy for
  Concept-document inclusion and root-absolute Markdown-link base. The graph
  boundary consumes that policy; it does not branch on a concrete Format id.
- OKF excludes every `index.md` and `log.md` from Concepts, Format validation,
  document Relation sources, and document/Ontology Relation targets. Target
  admission also recognizes extensionless and fragment-bearing reserved paths;
  external URLs remain external Relations. Generic Markdown retains its prior
  behavior.
- OKF leading-slash links and ontology reference values resolve by exact path
  inside the source Note Root. Missing, traversal, and colliding targets never
  fall through to Workspace-global basename guessing.
- Added renderer-independent contract coverage for public optional fields and
  open types, exact relation counts/resolution/Evidence, reserved files,
  endpoint closure, deterministic snapshots, byte immutability, unknown nested
  producer fields, kept-Ontology Evidence, and cross-root containment.

## Verification

- `pnpm --filter @exo/core exec vitest run src/__tests__/interoperability-fixtures.test.ts src/__tests__/workspace-graph.test.ts src/__tests__/workspace-ontology.test.ts`
  - pass: 3 files, 36 tests
- `pnpm --filter @exo/core typecheck`
  - pass
- `pnpm --filter @exo/core test`
  - pass: 20 files, 177 tests
- `pnpm check:repo`
  - pass
- The first new-suite failure was test-only: it assumed extraction ordering for
  Relations even though snapshots sort by id. The assertion now checks exact
  resolution counts and selected facts rather than incidental array order.

## Blockers

- None. Two bounded existing compatibility gaps were found and corrected in
  this slice: OKF reserved files entering the Concept set, and bundle-absolute
  links resolving as machine-absolute paths.
