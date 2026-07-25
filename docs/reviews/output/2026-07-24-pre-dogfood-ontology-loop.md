# Pre-dogfood Ontology loop

**Date:** 2026-07-24  
**Branch:** `launch/pre-dogfood-loop-20260724`  
**Base:** `32688f6f10cc019a0701bb50c4aa96509b8327f0`

## Shipped slice

- One user-owned Ontology library: root `ontology.yaml`, direct
  `ontologies/*.yaml`, or Generic Markdown.
- Exactly one active interpretation. Every selection compiles in isolation,
  previews bounded graph effects, and requires explicit Keep.
- Optional discovery through one trusted Claude or Codex Command over a
  disposable Markdown-only snapshot. The provider is mechanically read-only;
  only the host may stage a validated root Candidate.
- The first provider-neutral graph-maintenance Skill, **Find and connect
  relevant context**, launched from the selected graph Note through the
  existing inline Invocation and exact Changeset review.
- The existing compact Invocation lifecycle remains canonical: bounded
  activity, quiet completion, progressive failure detail, inline review
  controls, and multi-file Keep/Reject.

## Safety boundary

- Ontology sources are user-owned and never merged.
- Candidate edits and discovery proposals remain inert until Keep.
- Discovery cannot see or mutate the live Workspace; malformed, stale, failed,
  question, and abstain outcomes stage nothing.
- Maintenance receives exact Skill, active Ontology, and graph snapshot
  identities. It cannot edit an Ontology source and gains no write path outside
  ordinary Invocation Changesets.
- Forced ontology onboarding and a bespoke Ontology editor remain deferred
  until real-work dogfood.

## Verification

- `pnpm stable:check`
  - repository and unused-export checks passed
  - all package typechecks passed
  - core: 254 tests passed
  - desktop: 655 tests passed
  - CLI: 34 tests passed
  - terminal matrix: 26 tests passed
  - all nine stable Electron smoke journeys passed
  - builds and local-install dry-run passed
- Source Electron Ontology journey passed:
  root Candidate → Keep → restart → reject stale edit → select saved
  `criticism` Ontology → Keep → select Generic → Keep.
- Unsigned arm64 package built at `release/mac-arm64/Exo.app`.
- The same Ontology journey passed against that exact packaged app.
- `git diff --check` passed.

## Dogfood focus

The next evidence is qualitative real-Workspace use:

1. discover a Candidate and assess whether the proposed meaning is useful;
2. edit or reject it without affecting the current graph;
3. Keep one source and compare its graph against Generic and another source;
4. invoke **Find and connect relevant context** from a selected Note;
5. inspect the resulting exact Changeset and Keep or Reject it.

Discovery quality is not an automated launch gate yet. Real traces should
expose failure modes before Exo invents a corpus, judge, or threshold.
