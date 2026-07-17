# Fable review packet: automatic embedding catch-up runtime

Date: 2026-07-15
Repository: Exo, `main`, working base `6a254da870b0b40c4967898b6f695315944ce182`
Issue: `EXO-ISSUE-117`
Research: `notes/shoshin-codex/exo-embedding-sync-strategy.md`

## Context

Exo is a local-first Markdown workspace. Markdown is canonical; QMD indexes and
embeddings are rebuildable derived state. `WorkspaceIndex` is the
provider-neutral boundary. Filesystem and QMD are its concrete providers.

The just-completed latency stabilization moved QMD status/search/update/embed/
sync and cold graph work out of Electron main into one bounded utility process.
The process currently serializes all operations through a FIFO promise queue.
Cancellation suppresses a result but cannot interrupt an active QMD native
operation; a five-minute timeout kills and recycles the process.

On save, `IndexingService` waits 15 seconds, coalesces affected root IDs, and
runs QMD update only. This protects the editor but leaves semantic/hybrid
embeddings pending until explicit Sync. The product setting already distinguishes
`On save` from `Manual only`; the desired product meaning is automatic eventual
freshness versus an explicit pause, without adding another settings switch.

Installed `@tobilu/qmd` 2.1.0 already embeds only pending content hashes. It is
not normally a full vector rebuild. Its limitations are consequential:

- update scans, synchronously reads, and hashes the whole selected collection;
- there is no public per-file update/delete API;
- embed processes the complete pending set; batch options bound memory, not work;
- there is no public AbortSignal or max-documents/chunks/duration budget;
- Exo opens/closes the QMD store per operation and loses model warmth;
- 2.1.0 has partial-embedding/model-awareness correctness gaps already repaired
  on unreleased upstream `main` by QMD PR #654 and related concurrency work.

Relevant source:

- `apps/desktop/src/main/indexing-service.ts`
- `apps/desktop/src/main/derived-index-process.ts`
- `apps/desktop/src/main/derived-index-worker.ts`
- `packages/core/src/search-providers/qmd-provider.ts`
- `apps/desktop/src/renderer/src/components/WorkspaceSettingsDialog.tsx`
- `docs/adr/0003-derived-work-off-editor-critical-path.md`
- `issues.md#exo-issue-117-semantic-embeddings-become-stale-unless-users-manually-sync`

The worktree contains the uncommitted latency-stabilization implementation that
established this worker boundary. Preserve it; this packet reviews the next
layer rather than reopening the isolation decision.

## Decision needed

What is the smallest safe runtime architecture for automatic semantic catch-up
before QMD exposes per-file mutation and bounded cooperative embedding?

Specifically:

1. May Phase 1 automatically embed a small pending set in the existing serial
   worker after a quiet/idle gate, or does the lack of a true work bound make
   any automatic call unsafe?
2. Must foreground search and graph work use a separate process from QMD
   maintenance before automatic embedding ships? If so, how should Exo contain
   QMD 2.1.0 SQLite/schema-open concurrency risk?
3. Is QMD's durable pending-vector state plus periodic full-root reconciliation
   sufficient for Phase 1, or must Exo introduce a durable dirty-file journal
   before it has a per-file QMD API?
4. Which implementation milestone should trigger a narrow QMD fork rather than
   further Exo-side scheduling work?

## Options

### A. Conservative existing-worker catch-up

After the root update completes, wait for a 30–60 second per-file quiet period
and 10–20 seconds of global app/system idle. If pending embeddings are below a
small cap, run the existing QMD embed operation in the serial worker. Defer large
backlogs to `Embed now`; Manual only cancels timers. Use QMD pending state as the
durable source and full-root startup/periodic reconciliation as the safety net.

Tradeoff: smallest reversible change, but a single large document can make a
small pending count an unbounded job and foreground QMD/graph requests queue
behind it.

### B. Dedicated maintenance process with foreground fallback

Run automatic update/embed in a separately recyclable utility process. Keep
foreground graph work independent and route foreground Search to QMD only when
maintenance is idle; otherwise return explicit lexical fallback. Kill the
maintenance process when foreground activity resumes. Still cap automatic work
by pending document count until QMD exposes real budgets.

Tradeoff: protects the product interaction path and makes coarse cancellation
honest, but adds process lifecycle and concurrent SQLite-open complexity on an
installed QMD release whose stronger busy/WAL handling is still unreleased.

### C. Correctness foundation first; no automatic embedding yet

Implement scheduler policy, status states, tests, and measurements, but retain
manual embedding until Exo upgrades to the corrected QMD release or lands a
narrow fork with `applyChanges()` and bounded, cancellable `embedPending()`.

Tradeoff: avoids pretending document-count caps are work bounds, but leaves the
reported stale-semantic product failure in place longer.

## Orchestrator recommendation

Use a staged B/C hybrid:

1. Build the deterministic scheduler and observability now, owned by Exo.
2. Separate graph/foreground responsiveness from maintenance before enabling
   automatic embedding. During maintenance, foreground Search must immediately
   use explicit lexical fallback rather than queue.
3. Treat QMD pending hashes as the durable Phase 1 backlog; do not invent a
   second journal until per-file QMD mutation exists. Reconcile roots on startup
   and periodically because filesystem watchers are not durable.
4. Enable automatic embedding only after either upgrading to upstream's
   partial-embedding/concurrency fixes or proving the exact installed SQLite
   concurrency path with a race/kill/restart test. Keep large backlog manual.
5. Fork only for three library primitives: exact per-file upsert/delete;
   bounded resumable embedding with cooperative cancellation; and atomic,
   model-aware complete-chunk publication. Product scheduling remains in Exo.

This preserves the accepted derived-work ADR, avoids a new public CLI or shared
command protocol, and gives `On save` its expected automatic-eventual meaning.

## Proposed work packages

### WP1 — scheduler state machine and tests (independent)

Owner: desktop main/indexing service. Implement pure, deterministic decisions
for save coalescing, quiet/idle eligibility, backlog cap, retry/backoff, manual
pause, and disposal. No new worker topology or persistence contract.

Acceptance: fake-clock coverage proves bursts coalesce, activity defers,
Manual only cancels, retries are bounded, and large backlogs never auto-run.

### WP2 — foreground/maintenance runtime boundary (architecture-gated)

Owner: utility-process lifecycle. Apply Fable's ruling to process topology,
coarse cancellation, search fallback, store lifecycle, and SQLite concurrency.

Acceptance: foreground lexical search never waits behind embedding; worker
failure/restart cannot corrupt or falsely complete index state.

### WP3 — truthful status and controls

Owner: Settings/status UI. Reuse `On save`/`Manual only`, pending counts, Sync,
and Build embeddings. Present automatic waiting/running/paused/failed states
without adding implementation-mode switches.

Acceptance: component tests cover pending, active, paused, failed, and manual
states; lexical fallback remains explicit.

### WP4 — concurrency and real-app QA

Owner: test/evidence. Extend the real Electron latency gate with eligible
background catch-up, continuous typing/navigation, Terminal, graph context, and
hybrid search. Prove convergence after activity stops and capture p50/p90/p99,
long tasks, foreground search wait, cancellation latency, and oldest pending age.

## Please review

- Identify missing correctness, concurrency, persistence, power, or lifecycle
  constraints.
- Rule on Options A/B/C or propose a narrower sequence.
- Decide whether QMD pending state is sufficient durability before per-file
  mutation exists.
- Define the minimum proof required before automatic embedding is enabled.
- Confirm or revise the fork trigger and package ordering.

Do not review routine UI copy or implement the work. This is an architecture
ruling for the orchestrator to incorporate before gated runtime integration.
