# Fable — Wave-6 Plugin Closeout Review

Date: 2026-07-05
Scope: Codex's dogfooding-baseline decision request — profile-recovery CLI, traces CLI, MCP `workspace_status` enrichment, Project Knowledge Sync metadata contract, Plugin Manager boundary polish.
Prior docs: `fable-exo-wave4-review.md` (sequencing rules, two-consumer rule, exception discipline), earlier waves.

## 0. Decision

**SHIP — Wave 6 stands as the plugin architecture dogfooding baseline**, with three small required fixes before push (§2). None are contract-shape revisions; all are markers, reporting, and ledger hygiene. Codex's own recommendations (keep Knowledge Sync inert, keep trace cleanup CLI-only, treat `workspace_status` as the single orientation tool) are all ratified.

## 1. What I verified

- **Profile-recovery restore** (`profile-apply-recovery.ts`): hash-guard confirmed — every selected item's current file hash is checked against the recorded post-apply hash *before* any mutation, whole-manifest restores preflight all items first, duplicate-path assertion present, deleted-file restores handled. This is the right rollback semantics.
- **Traces cleanup**: requires explicit `--session` or `--before`; no hidden retention cap. Correct — destructive defaults are how you lose research data.
- **`workspace_status`**: composes read-only sources with per-source error fields (`optionalCommandServerRead`, `terminalDiagnosticsError`) so a degraded command server degrades the answer instead of failing the tool. No new MCP tools. Verified in `packages/mcp/src/index.ts`.
- **Knowledge Sync contract** (`project-knowledge-sync.ts`): typed metadata only, path trimming + traversal/URI/backslash rejection present, no sync behavior anywhere. `docs/plugins.md` states Exo "does not yet watch, sync, copy, symlink, propose, or call remote services from those declarations."
- **XC0 stability rules** (`0c7d9dc`): landed faithfully — `status: unstable` markers, trace-contract-first ordering, dataset/eval deferred to a real Helm consumer. This matches my Wave-4 §3 exactly.
- **Guard ledger** (`ff3dda0`): all three Wave-6 exception entries carry the task/user reference and explicitly request post-hoc review. The RF-2 discipline worked as designed this wave.

## 2. Required fixes before push

1. **Knowledge Sync stability marker + reserved-words line.** The type file and its doc section lack the `status: unstable` marker the other contracts got in XC0. Add it, plus one sentence where the relationship modes are documented: *"`index` and `proposal` are the modes core intends to implement first; `copy`, `symlink`, and `remote` are reserved words, not commitments, and may be removed without compatibility shims."* And a freeze: no further vocabulary growth (new modes, new conflict actions, new providers) until the first acting implementation exists. Rationale in §3.3.
2. **Partial-restore reporting.** `restoreProfileApplyRecoveryManifest` preflights hashes but the mutation loop is sequential — if write N of M fails (disk, permissions), the operator must learn exactly which items were restored and which were not. Verify the CLI surfaces `restoredItems` on the error path too; add one test for a mid-loop failure. Rollback tooling that can leave you unsure of state defeats its purpose. Small.
3. **Ledger closure.** Append `architect-review: 2026-07-05 fable-exo-wave6-review.md — confirmed` lines to the three Wave-6 exception entries. This review *is* the post-hoc review they request; the ledger should say so, not remain open-ended.

## 3. Rulings on the six questions

**3.1 CLI operator surfaces — acceptably narrow, keep names.** `profile-recovery list|show|restore` and `traces list|cleanup` are local, operator-only, non-MCP, with the right guards. Do not rename now — renaming churns the guard ledger for cosmetics. At stabilization time, consider folding into `exo profile recovery …` / keeping `traces` as-is; note it as a stabilization-time decision, not a task. The deliberate *absence* of MCP accept/reject/rollback tools is load-bearing — agents propose, humans recover. Keep it.

**3.2 `workspace_status` — right shape, ratified as the single orientation tool.** Read-only composition with graceful per-source degradation is exactly what an Exo-on-Exo agent needs to orient without being handed admin capability. Two standing rules: (a) no new MCP admin/mutation tools without prior architect review — no exception path for MCP mutations, ever, because agents (not just operators) depend on that surface; (b) the response stays a bounded summary — if any section starts growing (e.g., per-terminal diagnostics), it becomes a pointer to a CLI/read path, not inline payload.

**3.3 Knowledge Sync metadata — acceptable, with the §2.1 corrections; this was the closest call.** My Wave-4 ruling deferred Knowledge Sync until proposal dogfooding, and XC0 says contracts are extracted from working code. Shipping a five-mode relationship vocabulary with GitHub remote metadata and five conflict actions, all with zero behavior, is speculative contract design — precisely the debt pattern those rules exist to prevent. It stays because: it lives inside the profile payload (already declared unstable/metadata-only), the docs are honest that nothing acts on it, and deleting it now costs more than freezing it. But rich inert vocabulary *invites an implementer* — that's why the reserved-words line and the growth freeze are required, not optional. The activation gate from Wave-4 stands: no acting implementation until real-vault proposal dogfooding has a week of evidence, and `proposal` mode is the first (and initially only) acting mode.

**3.4 CLI-only trace cleanup — sufficient for dogfooding.** A Settings-visible retention UI is a pain-triggered follow-up, not a gate. Record it; build it when trace volume is actually felt. Agree with Codex.

**3.5 Plugin Manager boundary — accepted on the e2e evidence.** Core substrate vs official vs local/dev plugins, plugin-owned settings, and non-destructive onboarding is the right taxonomy. One watch item for dogfooding: the place confusion will show up is *profile* vs *plugin settings* — a profile that writes files and a plugin that owns settings look similar to a user mid-flow. Don't fix speculatively; log the first confusion incident as an issue.

**3.6 Next phase — push and dogfood; one build track.** Ruling:

- **Push after §2 fixes**, then declare the dogfooding window open.
- **Dogfooding needs a protocol, not just a declaration**: (a) one-week window, Kenneth + agents on the real vault; (b) all friction promoted to `issues.md` with EXO-ISSUE ids per the intake rule; (c) exercise the recovery path *deliberately at least once* early in the week — apply a profile, restore it — so the first real rollback isn't also the first-ever rollback; (d) run `traces list`/`cleanup` once against real accumulation; (e) exit criteria: zero data-loss incidents, rollback proven, and a triaged issue list that seeds the next wave.
- **Parallel build track: profile apply prompts/grants** — it's the natural continuation of the proposal substrate and doesn't compete with dogfooding for the same surfaces. Single track only (Wave-4 RF-3 stands).
- **Explicitly not now**: external workload contracts (the trace contract now has its second producer via the Claude sidecar capture — but *stabilization* should wait for dogfooding evidence that the events are actually useful, then it's a docs-status change, not a build); MCP robustness beyond 046's landed work (let dogfooding generate the list); Knowledge Sync activation (gated per §3.3).

## 4. Process note

Wave 6 landed public surfaces before review again — but this time through the exception mechanism as designed: user-directed, ledgered with task references, post-hoc review requested and now delivered. That is the system working, not a breach. One tightening (§3.2a): MCP-surface *mutations* are excluded from the exception path entirely. Read-only MCP enrichment under user direction, as done here, is acceptable.

-- Fable | 2026-07-05
