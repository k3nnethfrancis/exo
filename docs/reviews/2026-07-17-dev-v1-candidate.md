# Dev v1 candidate review

Date: 2026-07-17
Branch source: `feat/graph-system-foundation`
Promotion target: `dev`

## Candidate

This checkpoint combines the unpublished editor, indexing, invocation, and graph-system work that belongs together as the next Exo development baseline. `main` remains the stable public line. Graph Canvas is deliberately marked experimental until its transport is compact enough for 10K-note workspaces.

Included:

- editor durability and input-latency hardening
- derived indexing work moved off the editor-critical path
- schema-agnostic knowledge graph and projection foundations
- an experimental spatial Graph Canvas with deterministic layout
- local Connections restored as the default inspector experience
- exact graph evidence ranges, stable identities, path semantics, and stale-epoch protection
- architecture, product-context, roadmap, issue, and stability-skill updates

Excluded:

- private screenshots and QA artifacts under `artifacts/`
- obsolete workspace-scope spikes and unrelated historical branches
- visual-presence experiments that change node sizing, labels, or capture presentation
- the expanded GraphBench suite, which continues on an isolated branch

## Independent review findings resolved

- Connections no longer substitutes a whole-workspace graph for the selected note's neighborhood.
- Graph detail is fetched on demand and rejected when its source snapshot is stale.
- Layout identity no longer changes after property-only edits.
- Unreachable paths no longer fabricate routes.
- Link and tag evidence uses exact body-relative UTF-16, end-exclusive ranges.
- Workspace graph construction is cached, bounded, case-preserving, and indexed by adjacency.
- Continuous typing receives a hard durability checkpoint without weakening the idle autosave path.
- Quit waits for dirty-document flush.
- Folder overview enrichment is stale-while-revalidate and off the navigation-critical path.

## Acceptance evidence

- `pnpm ci:check`: passed (core 123, desktop 240, CLI 27, typecheck, build, install dry run)
- `pnpm stable:smoke`: passed (9 scenarios)
- sustained Markdown typing: p90 12.5-12.6 ms; p99 14.7-14.9 ms
- sustained backspace: p90 9.2-9.8 ms; p99 11.8-12.3 ms
- invocation typing, three isolated runs: p90 16.5-16.8 ms; p99 18.8-19.3 ms; zero long tasks
- filename search: p90 47.3 ms
- large-workspace filename search: p90 8.5 ms
- breadcrumb shell/content: p90 24.9/26.2 ms
- backlinks: p90 40.2 ms

One mixed full-suite run recorded two invocation long tasks at 60 and 68 ms. Three immediate isolated repetitions were clean. Promotion therefore requires a fresh full-suite pass; the signal remains tracked as EXO-ISSUE-120 rather than being hidden by a weaker budget.

## Known boundaries

- EXO-ISSUE-119: the current object-shaped Graph View transport is not yet 10K-safe under the 8 MiB IPC target.
- EXO-ISSUE-111: Node 26 can make the CLI startup p50 hover around the 99 ms budget even while app navigation remains green.
- The graph is derived from canonical Markdown. Projection and visualization never become canonical knowledge state.
- Visual profiles may change presentation only; they may not change topology or layout checksums.

## Promotion rule

Publish `dev` only after the full editor latency suite, CI, stable smoke, and macOS packaging pass from the exact committed tree. Continue GraphBench and monumental visual-presence work from a separate worktree based on that checkpoint.
