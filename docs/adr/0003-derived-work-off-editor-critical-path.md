# ADR 0003: Derived Work Stays Off the Editor Critical Path

Date: 2026-07-13

## Status

Accepted. Process isolation for QMD remains an implementation task tracked in `../../issues.md#exo-issue-110-derived-graphsearch-work-can-stall-editor-navigation`.

## Context

Folder Overview initially constructed a new `WorkspaceGraph` and reread the entire Workspace before rendering. In a 400-note fixture this produced 401 ms p50 / 416 ms p90 navigation. Live filename search also parsed Markdown bodies twice for each debounced query and produced 377 ms p50 / 380 ms p90 result latency.

Both operations are derived-data work. A Note or Folder is already identifiable from the user's action and the loaded workspace tree; graph freshness, full-text retrieval, embeddings, and aggregate folder context are not prerequisites for presenting it.

## Decision

Editor-critical work is limited to committing the requested pane state and reading the selected canonical file when its content is required. The renderer must present known state immediately.

Derived modules follow three execution classes:

1. **Immediate and cached:** pane selection, known path/title, open-document buffers, loaded tree data, filename catalog, cached Folder metadata.
2. **Deferred enrichment:** Folder Index metadata/children, graph context, backlinks, attachment resolution, watcher-driven refresh, and other context that can arrive after the page is interactive. Repeated work is cached and watcher-invalidated.
3. **Process-isolated:** QMD status/search/update/embed/sync and any future CPU-heavy graph rebuild, embedding, inference, or bulk corpus analysis. A Promise inside Electron main is not isolation; these operations must cross a worker, utility-process, child-process, or external-provider seam with cancellation, bounded output, and restart behavior hidden inside the module.

File reads, writes, authorization, configuration, window lifecycle, and IPC routing remain in Electron main because they are small, authoritative operations. Agent Commands and terminal processes already execute out of process.

The deep module for derived retrieval keeps the existing provider-neutral `WorkspaceIndex` interface. Callers do not learn worker lifecycle, QMD store construction, model loading, or retry details.

## Performance contract

- Page and Folder shell transitions are measured from user action to visible target state.
- Full contents are measured separately from progressive enrichment.
- Live filename results use cached paths/metadata and never parse bodies.
- Indexed Search is explicit and cancellable.
- Tests retain p50, p90, p99, and maximum samples; regressions are evaluated on realistic multi-hundred-note fixtures rather than the tiny default fixture alone.

## Consequences

The UI may briefly show path-derived titles or incomplete context before durable Folder Index metadata and graph enrichment arrive. This is preferable to blocking navigation. Derived data can be stale for a short interval after a filesystem event, but canonical Markdown never is.

QMD currently runs through its SDK in Electron main. The measured regression earns an out-of-process implementation; it is no longer only a speculative extension question.
