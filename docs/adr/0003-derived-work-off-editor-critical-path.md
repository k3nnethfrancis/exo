# ADR 0003: Derived Work Stays Off the Editor Critical Path

Date: 2026-07-13

## Status

Accepted and implemented. QMD and WorkspaceGraph derived work cross the same
bounded utility-process boundary; the completed incident is recorded in
`../../issues.md#exo-issue-110-derived-graphsearch-work-can-stall-editor-navigation`.

## Context

Folder Overview initially constructed a new `WorkspaceGraph` and reread the entire Workspace before rendering. In a 400-note fixture this produced 401 ms p50 / 416 ms p90 navigation. Live filename search also parsed Markdown bodies twice for each debounced query and produced 377 ms p50 / 380 ms p90 result latency.

Both operations are derived-data work. A Note or Folder is already identifiable from the user's action and the loaded workspace tree; graph freshness, full-text retrieval, embeddings, and aggregate folder context are not prerequisites for presenting it.

## Decision

Editor-critical work is limited to committing the requested pane state and reading the selected canonical file when its content is required. The renderer must present known state immediately.

Derived modules follow three execution classes:

1. **Immediate and cached:** pane selection, known path/title, open-document buffers, loaded tree data, filename catalog, cached Folder metadata.
2. **Deferred enrichment:** Folder Index metadata/children, graph context, backlinks, attachment resolution, watcher-driven refresh, and other context that can arrive after the page is interactive. Repeated work is cached and watcher-invalidated.
3. **Process-isolated:** QMD status/search/update/embed/sync and any future CPU-heavy graph rebuild, embedding, inference, or bulk corpus analysis. A Promise inside Electron main is not isolation; these operations must cross a worker, utility-process, child-process, or external-provider seam with cancellation, bounded output, and restart behavior hidden inside the module.

QMD uses separate foreground and maintenance utility processes. Maintenance
waits for an already-running foreground operation, but new search requests never
join the maintenance queue: they use Simple search with an explicit warning
until the writer finishes. Status uses the last measured snapshot during that
window rather than opening a competing QMD store.

`On save` performs one coalesced document update, then semantic catch-up becomes
eligible after a 45-second save quiet period and 10 seconds of system idle. Each
automatic call is limited to four pending documents, one document per batch,
and a cooperative 15-second session budget. Large backlogs remain visible for a
manual Build or Sync. `Manual only` prevents future automatic work but never
interrupts a vector publication already in progress.

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

QMD now runs through its SDK in utility processes. Exo carries a narrow patched
QMD 2.5.3 package because the upstream SDK did not expose per-call document/time
budgets and could publish embedding metadata separately from its vector row.
The patch is reproducible through pnpm, keeps the public Exo command routes
unchanged, and makes metadata/vector publication atomic.
