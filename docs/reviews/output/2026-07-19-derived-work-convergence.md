# Gate B derived-work convergence

## Outcome

QMD maintenance, automatic embedding, and WorkspaceGraph construction are not
on the editor critical path. Automatic catch-up converges with the real local
embedding model in both source Electron and the packaged macOS app.

Graph work now owns a third utility process. QMD foreground queries, QMD
maintenance, and WorkspaceGraph can therefore make progress independently;
the renderer still treats graph context as deferred enrichment.

## Deterministic concurrent-load gate

The Electron gate uses 1,200 Markdown notes while QMD update, cold graph
construction, ten foreground Search requests, cached status, Terminal IO,
400 sequential editor keystrokes, and 20 alternating Note navigations overlap.

Source build:

- typing: 6.9 / 12.1 / 14.5 ms p50/p90/p99
- navigation: 40.2 / 42.1 / 47.8 ms p50/p90/p99
- Search: 98.4 ms cold; 9.2 / 10.0 / 10.0 ms warmed p50/p90/p99
- graph context: 217.9 ms, independently available
- Terminal write: 0.7 ms
- renderer long tasks: 0

Packaged macOS app:

- typing: 6.8 / 12.0 / 13.8 ms p50/p90/p99
- navigation: 40.3 / 41.5 / 47.8 ms p50/p90/p99
- Search: 114.8 ms cold; 9.7 / 10.2 / 10.2 ms warmed p50/p90/p99
- graph context: 236.7 ms, independently available
- Terminal write: 1.4 ms
- renderer long tasks: 0

The first Search includes cold utility-process and module startup. The next
nine requests measure warmed foreground query work. The enforced limits are
300 ms cold and 99 / 150 / 300 ms warmed p50/p90/p99.

## Real-model convergence gate

The opt-in journey creates a two-note hybrid QMD Workspace, establishes a real
vector baseline, saves changed Markdown, observes a pending embedding, waits
for quiet/idle automatic eligibility, and proves the pending count returns to
zero. During the embedding call it also proves:

- graph context remains available;
- Terminal IO remains available;
- Search returns explicit filesystem results instead of joining maintenance;
- status returns its cached snapshot with an explicit maintenance warning;
- semantic Search returns to QMD after convergence.

Source Electron passed in 48.3 seconds; the pending hash converged in 46.3
seconds. The final packaged macOS app passed in 49.9 seconds; the pending hash
converged in 46.4 seconds. Both finished with two documents,
`pendingEmbeddings: 0`, and `hasVectorIndex: true`.

The gate is skipped unless `EXO_REAL_EMBEDDING_GATE=1`; CI has no model or
network dependency. Operators may point `EXO_REAL_EMBEDDING_CACHE_ROOT` at an
already populated local model cache.

## Packaged vector repair

The first packaged run exposed a real release defect: `sqlite-vec` resolved its
native extension through `app.asar`, which SQLite cannot load. SQLite then
reported a misleading doubled `.dylib` path and semantic indexing remained
pending. Exo's narrow QMD patch now translates an ASAR dependency path to the
matching `app.asar.unpacked` path before calling SQLite's extension loader.
The rebuilt app passed the full real-model journey.

## Status ownership

QMD reports structured readiness (`documentCount`, `pendingEmbeddings`, and
`hasVectorIndex`) plus provider-owned degradation/repair facts. The desktop
indexing service alone turns pending state into policy language: waiting for
automatic catch-up, beyond the bounded automatic slice, or paused by Manual
mode. A healthy automatic path never tells the user to run a CLI repair.

The retry circuit is work-sensitive. Repeated failures of unchanged pending
work remain exhausted and status reports the failed automatic path plus the
explicit Sync repair. A strictly newer canonical save clears that exhausted
budget, observes fresh pending state, and may converge through the same bounded
automatic path. Deterministic scheduler and service tests cover exhaustion,
truthful status, no repeated retry, newer save, and recovery to zero pending.

## Commands

```sh
pnpm --filter @exo/desktop exec playwright test tests/e2e/derived-work-latency.spec.ts --reporter=line
EXO_REAL_EMBEDDING_GATE=1 EXO_REAL_EMBEDDING_CACHE_ROOT="$HOME/.cache" pnpm --filter @exo/desktop exec playwright test tests/e2e/derived-work-convergence.spec.ts --reporter=line
pnpm pack:mac
EXO_PACKAGED_APP_PATH="$PWD/release/mac-arm64/Exo.app" pnpm --filter @exo/desktop exec playwright test tests/e2e/derived-work-latency.spec.ts --reporter=line
EXO_PACKAGED_APP_PATH="$PWD/release/mac-arm64/Exo.app" EXO_REAL_EMBEDDING_GATE=1 EXO_REAL_EMBEDDING_CACHE_ROOT="$HOME/.cache" pnpm --filter @exo/desktop exec playwright test tests/e2e/derived-work-convergence.spec.ts --reporter=line
```

-- Exo | 2026-07-19
