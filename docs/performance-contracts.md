# Performance contracts

Last verified against source at `5a780ab` on 2026-07-24. A numeric value below
is a test gate, not a claimed benchmark result. Where no gate measures an
action, the status is explicitly unmeasured.

| User action | Current p50 / p90 / p99 | Architecture constraint | Gate owner | Command / test | Must stay off the critical path |
| --- | --- | --- | --- | --- | --- |
| Markdown typing | ≤17 / ≤34 / ≤50 ms frame-ready | React propagation and structural metadata must not serialize ordinary keystrokes. | Renderer editor owner | [`editor-latency.spec.ts`](../apps/desktop/tests/e2e/editor-latency.spec.ts) | Markdown parse/projection work, graph/index refresh, and invocation enrichment |
| Markdown backspace | ≤17 / ≤17 / ≤34 ms input-to-frame-ready; transaction fixture ≤17 / ≤17 / ≤17 ms | Deletion must retain the same direct editor path as typing. | Renderer editor owner | [`editor-latency.spec.ts`](../apps/desktop/tests/e2e/editor-latency.spec.ts) | Deferred live-preview and derived document work |
| Explorer, filename-search, breadcrumb, backlink, and CLI note navigation | ≤99 / ≤150 / ≤300 ms | Commit known pane state and canonical file read before enrichment; latest navigation wins. | Canvas/editor navigation owner | [`editor-latency.spec.ts`](../apps/desktop/tests/e2e/editor-latency.spec.ts) | New graph construction, QMD, full-text parsing, and Folder enrichment |
| Live filename results during derived work | index search ≤99 / ≤150 / ≤300 ms after warm-up; concurrent navigation ≤99 / ≤150 / ≤300 ms | Filename search uses loaded metadata; maintenance cannot queue foreground retrieval. | Search/index owner | [`derived-work-latency.spec.ts`](../apps/desktop/tests/e2e/derived-work-latency.spec.ts) | QMD maintenance, graph refresh, embedding/sync work |
| Inline invocation compose typing | p90 ≤34 ms; p99 ≤50 ms | Composer state is editor-local and does not wait for command authorization or process work. | Renderer invocation owner | [`editor-latency.spec.ts`](../apps/desktop/tests/e2e/editor-latency.spec.ts) | Launch, trust lookup, observed-change capture, review hydration |
| Graph interaction and topology rendering | No single p50/p90/p99 launch gate recorded here; graph performance is separately measured by its focused suite. | `WorkspaceGraph` publishes compact topology; labels/evidence remain bounded cold reads and Canvas/WebGPU cannot invent semantics. | Graph owner | [`benchmarks/graphbench/contract.md`](../benchmarks/graphbench/contract.md), [`graphWebGpuRenderer.test.ts`](../apps/desktop/src/renderer/src/graphWebGpuRenderer.test.ts) | Semantic graph rebuild, unbounded detail lookup, QMD/index maintenance |
| Terminal input echo | p50 <75 ms; p90 <150 ms | One direct `node-pty` lifecycle; xterm owns live rendering and scrollback. | Terminal owner | [`shell.spec.ts`](../apps/desktop/tests/e2e/shell.spec.ts) | Renderer metadata/replay reads and work in another terminal |
| Terminal input while another terminal streams | p50 <100 ms; p90 <250 ms | Streaming output cannot monopolize the active terminal's input path. | Terminal owner | [`shell.spec.ts`](../apps/desktop/tests/e2e/shell.spec.ts) | Other-terminal output processing |
| Workspace switch | Unmeasured | The current configuration store uses revisioned atomic settings writes; no source-level latency budget is asserted. | Workspace configuration owner | [`workspace-config-store.test.ts`](../apps/desktop/src/main/workspace/workspace-config-store.test.ts) (coherence only) | A future measured gate must keep watcher/index/invocation rebind work out of the visible transition path. |

The implementation owner for derived lifecycle is the utility-process boundary
in [`derived-index-process.ts`](../apps/desktop/src/main/indexing/derived-index-process.ts):
QMD, filesystem scans, graph refresh, and Ontology review run outside Electron
main, with cancellation and worker restart. The contract does not prescribe a
future Workspace-switch implementation.
