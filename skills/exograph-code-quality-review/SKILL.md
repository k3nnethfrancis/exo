---
name: exograph-code-quality-review
description: Run a coverage-accountable, unusually strict review of Exograph for correctness, structural simplicity, deep modules, lifecycle safety, performance, tests, and repository health. Use for whole-repository audits, architecture cleanup, launch reviews, thermonuclear code-quality reviews, or any pass that must prove which files were inspected and what remains unseen.
---

# Exograph Code Quality Review

Raise the approval bar above “works and passes tests.” Seek behavior-preserving
changes that delete concepts, branches, fallback paths, and unearned seams.
Prove coverage instead of implying it.

## Start the review

1. Read the root `AGENTS.md`, architecture, glossary, and the closest
   subdirectory `AGENTS.md`.
2. Freeze the scope: repository root, commit, base ref if reviewing a diff, and
   whether the pass is diagnostic or authorized to fix.
3. Read [references/rubric.md](references/rubric.md).
4. Initialize the private review map:

   ```sh
   node skills/exograph-code-quality-review/scripts/review-map.mjs init
   ```

   The default state is `docs/internal/code-quality-review/state.json`, which is
   ignored. Never commit review ledgers, agent logs, or generated reports.

## Traverse methodically

Review logical clusters, not arbitrary directory slices.

1. Start at an entrypoint, public contract, changed file, or high-risk owner.
2. After inspecting a file, follow the relationship that can validate or
   falsify your current model:
   - import or exporter;
   - importer or caller;
   - owning test;
   - linked contract or architecture document.
3. Ask for a bounded frontier:

   ```sh
   node skills/exograph-code-quality-review/scripts/review-map.mjs frontier \
     --from packages/core/src/workspace-graph.ts --depth 2 --page-size 12
   ```

   Narrow a noisy hub without losing the recorded graph:

   ```sh
   node skills/exograph-code-quality-review/scripts/review-map.mjs frontier \
     --from packages/core/src/workspace-graph.ts \
     --relation imports --relation tests --depth 2
   ```

4. State why the next file follows before reading it. Prefer the file that
   tests an invariant or crosses a seam over the merely adjacent file.
5. Mark each file only after inspecting it:

   ```sh
   node skills/exograph-code-quality-review/scripts/review-map.mjs mark \
     --file packages/core/src/workspace-graph.ts \
     --status reviewed \
     --reason "Graph owner; traced construction, consumers, and focused tests" \
     --evidence "pnpm --filter @exograph/core exec vitest run src/__tests__/workspace-graph.test.ts"
   ```

Use `excluded` only with a concrete reason such as generated binary, pinned
fixture, or vendored source. “Low risk” is not an exclusion reason. Re-running
`init` preserves a review only while the file content hash is unchanged.

## Review standard

Apply the rubric to the cluster, not just individual lines. In particular:

- search for a code-judo move that removes complexity instead of relocating it;
- evaluate module depth, interface burden, seam placement, and ownership;
- trace state, errors, concurrency, cancellation, persistence, and cleanup
  through their complete lifecycle;
- distinguish deliberate compatibility from stale fallbacks;
- verify public and durable contracts at their owning interface;
- prefer a few high-conviction findings with mechanisms and evidence over a
  long list of style nits.

Do not split a cohesive deep module merely because it is large. File size is a
reason to inspect interface burden and mixed ownership, not a verdict.

## Verify findings

For every finding:

1. Cite the smallest relevant file and line range.
2. Explain the mechanism and observable consequence.
3. Trace callers, consumers, tests, and cleanup paths until no accessible
   evidence is left unchecked.
4. Reproduce or write the smallest discriminating test when feasible.
5. Propose the smallest structural remedy and name what it deletes.
6. Separate confirmed defects from design opportunities and unknowns.

Never report “this may be handled elsewhere” when the repository lets you
check. Never preserve a claim that focused evidence disproves.

## Close coverage

Run:

```sh
node skills/exograph-code-quality-review/scripts/review-map.mjs report
```

A whole-repository pass is complete only when:

- every in-scope tracked file is `reviewed` or explicitly `excluded`;
- no changed file has a stale review hash;
- every high-risk cycle or cross-owner seam has been inspected as a cluster;
- high-conviction findings have verification evidence;
- the report names remaining blocked work and unseen frontier truthfully; and
- focused gates pass before the broad repository gate.

Coverage is not approval. A reviewed repository can still fail the quality bar.

## Exograph-specific invariants

Defer to the owning `AGENTS.md` and stability Skills. At minimum preserve:

- explicit Note Root filesystem authority;
- Markdown/frontmatter as canonical state;
- renderer isolation from filesystem and process authority;
- `Knowledge Graph → projection → layout → scene → renderer` ownership;
- provider-neutral, explicit, reviewable invocation;
- one direct `node-pty` lifecycle and byte-faithful xterm presentation; and
- exact CLI, command-server, IPC, and persisted-state contracts.

Do not use Workspace Ontology as a substitute for a code import graph. Exograph
currently models Markdown knowledge and artifact references; the review-map
script is the truthful code-review dependency surface.
