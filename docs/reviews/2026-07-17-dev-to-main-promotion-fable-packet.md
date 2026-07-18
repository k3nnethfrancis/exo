# Fable review packet — dev to main promotion checkpoint

Date: 2026-07-17
Repository: `/Users/kenneth/Desktop/lab/projects/exo`
Branch: `dev`
Reviewed code checkpoint: `5cf870a49c7b6dbefc6fb39ab9be9a1d7e9c3d85`
Comparison: `origin/main...dev` (14 commits; main is an ancestor)
Fable session: `fea71ccb-6103-48cc-9e1b-a4b27310b29c`

## Context

Kenneth wants this exact development checkpoint reviewed before promotion to
`main`. After Fable findings are addressed, the intended flow is to merge the
reviewed checkpoint to `main`, return to `dev`, and continue graph/profile work
there.

The checkpoint combines the previously accepted dev foundation with:

- repo-local graph performance tooling, including deterministic fixtures,
  Exo/Sigma/GraphWaGu adapters, resilience and incremental-stability checks;
- an experimental Canvas Graph Pane backed by the renderer-neutral knowledge
  projection and worker layout;
- editor-to-Graph navigation, focused Note framing, more responsive zoom and
  legible node radii;
- Connections information architecture: Outline owns headings, Links owns
  backlinks/internal/external links and tags, and Graph shows a local
  neighborhood;
- the schema-agnostic graph direction: canonical Markdown Notes, open Concept
  types, lossless Properties, Relations with authority/resolution/Evidence,
  built-in Generic Markdown and permissive OKF profiles, and future user-owned
  Knowledge Profiles rather than an app-owned ontology database.

The graph remains explicitly experimental. The current object IPC is not
claimed to support 10K production workspaces, Stellar/WebGPU is not integrated
into the app, and user-authored profiles/ontology onboarding are not shipped.

## Relevant evidence and paths

Please inspect the named sources rather than reconstructing the whole project:

- Prior dev checkpoint review and promotion rule:
  `docs/reviews/2026-07-17-dev-v1-candidate.md`
- Consolidated graph architecture and sequencing:
  `docs/graph-system-report-and-plan.md`
- Product checkpoint and current interaction contract:
  `docs/graph-product-checkpoint.md`
- Durable profile/ontology decision:
  `docs/adr/0005-schema-agnostic-graph-and-knowledge-profiles.md`
- Canonical graph/profile/projection implementation:
  `packages/core/src/knowledge-graph.ts`,
  `packages/core/src/knowledge-profile.ts`,
  `packages/core/src/graph-projection.ts`,
  `packages/core/src/workspace-graph.ts`
- Desktop graph implementation:
  `apps/desktop/src/renderer/src/components/SpatialGraphView.tsx`,
  `apps/desktop/src/renderer/src/components/InspectorDock.tsx`,
  `apps/desktop/src/renderer/src/graphScene.ts`
- Benchmark contract and current evidence:
  `benchmarks/graphbench/contract.md`,
  `benchmarks/graphbench/README.md`,
  `benchmarks/graphbench/reports/2026-07-16-m2-max-baseline.md`
- Open boundaries and merge risks: `issues.md`, especially
  `EXO-ISSUE-111`, `EXO-ISSUE-119`, `EXO-ISSUE-120`, and `EXO-ISSUE-121`.

## Exact-tree verification at `5cf870a`

- `pnpm ci:check`: passed. Repo checks, typecheck, core 123 tests, desktop
  241 tests, CLI 27 tests, builds, and install dry run passed.
- `pnpm stable:smoke`: 9/9 scenarios passed.
- `pnpm graphbench:test`: passed.
- `pnpm pack:mac`: passed; unsigned arm64 `Exo.app` was produced.
- Derived-work/editor latency: 7/8 scenarios passed. Concurrent 1,200-note
  derived work, Explorer, filename search, large-workspace search, breadcrumbs,
  backlinks, sustained typing/backspace, and invocation typing passed with no
  long tasks.
- The only failure reproduced the tracked Node 26 CLI startup issue:
  `exo open` p50 `100.94 ms` against the intentionally strict `99 ms` budget;
  p90 `103.57 ms` and p99 `120.18 ms` remained under their `150/300 ms`
  budgets. The ordinary in-app navigation paths were roughly 25–47 ms.

## Decision needed

What is the smallest honest set of changes and verification required before
this exact development baseline may be promoted to `main` while preserving the
experimental boundary around the graph?

The review should distinguish merge blockers from post-main work. In
particular, decide whether the Node 26 CLI p50 miss, the uncompressed graph IPC,
the partially unified inspected-Concept/Properties model, or inclusion of the
isolated GraphBench suite require correction before main promotion.

## Options

### A — Require production graph completion before main

Finish compact typed topology/epoch IPC, shared inspected-Concept properties,
packaged graph E2E, Stellar fallback/accessibility/quiescence gates, and close
the CLI latency issue before promotion.

Tradeoff: strongest release surface, but conflates an explicitly experimental
tracer with the post-main graph roadmap and delays a useful stable baseline.

### B — Promote a bounded experimental graph after narrow acceptance fixes

Keep Canvas Graph visibly experimental and make no 10K/Stellar/custom-profile
claims. Before main, require only concrete user-facing coherence and exact-tree
release evidence: a packaged editor → focused graph → Note open/refocus →
Connections consistency journey, honest resolution or isolation of the Node 26
CLI p50 miss, and any high-confidence architectural defects found here.

Tradeoff: preserves development momentum while carrying explicit tracked
limits. This is the orchestrator's recommendation.

### C — Split GraphBench and/or graph UI from the checkpoint

Promote the editor/indexing/profile foundation but remove benchmark tooling or
the experimental Graph Pane from the main-bound diff.

Tradeoff: reduces apparent surface area, but creates replay work and risks
separating the benchmark and architectural evidence from the code it governs.
GraphBench is not a runtime dependency.

## My recommendation

Proceed with Option B. Treat the strict CLI p50 miss as a real finding: either
fix Node 26 startup or explicitly isolate the CLI process-start budget from the
already-green app navigation budget with evidence—do not weaken the number to
make the suite green. Add the packaged graph interaction journey and complete
the minimum shared inspected-Concept behavior needed to avoid contradictory UI.

Do not block main on compact 10K IPC, full Stellar/WebGPU integration, custom
Knowledge Profile authoring, the 100K/200K publication matrix, the first graph
maintenance Skill, or ontology onboarding. Those are sequenced development
work after returning to `dev`.

## Please review

1. Identify any concrete correctness, trust-boundary, persistence, concurrency,
   or architecture defect in the named implementation that must block main.
2. Decide whether Option B is sound and list the exact required pre-main fixes
   and verification, ranked by severity.
3. Decide whether the built-in Generic/OKF profile foundation correctly leaves
   room for user-owned custom ontologies without making renderer enums or app
   storage canonical.
4. Decide whether GraphBench belongs in this checkpoint as isolated tooling or
   should be split before promotion.
5. Classify the Node 26 CLI p50 miss: required code fix, acceptable documented
   process-start exception, or evidence of a deeper boundary problem.
6. Name the work that should explicitly remain post-main on `dev` so the merge
   gate does not silently expand into the entire graph roadmap.

Return a direct ruling: **approve after listed fixes**, **revise architecture**,
or **do not promote**, with evidence tied to the named paths.

-- Shoshin | 2026-07-17
