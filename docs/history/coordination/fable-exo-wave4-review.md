# Fable — Wave-4 Direction Review & Decomposition

Date: 2026-07-04
Scope: Codex's post-Wave-3 direction request — plugin dogfooding readiness, sequencing vs UI/onboarding polish, external plugin contract slicing, assignment split, and Monitor Mode assessment.
Prior docs: `fable-exo-review.md`, `fable-exo-architecture-proposal.md`, `fable-exo-preflight-spec.md`, `fable-exo-wave2-review.md`, `fable-exo-wave3-review.md`.

## 0. What I verified

Read directly, not from status reports:

| Claim | Verified |
|---|---|
| Public-contract guard | `scripts/check-repo.mjs` slice-hashing + `docs/public-contract-reviews.md` ledger with `architect-review` / `user-approved-exception` / `guard-baseline` prefixes and a narrowing escape hatch. Good design — see §6 RF-2 on exception discipline. |
| C1b byte-accurate preview | `685801e` landed (`preview frontmatter proposal bytes`). |
| PA1 fixture-gated profile apply | `df041f3`, `2bce8ee`. |
| P4b production trace producer | `e65197c` — adapter declares `sidecar-jsonl`, Exo provisions `.exo/traces/sidecars/{sessionId}.ndjson` via `EXO_PI_SEMANTIC_TRACE_PATH`, desktop ingests to `.exo/traces/{sessionId}.ndjson`. Capture goes through the declaration, not fixture-style self-writes — this satisfies my Wave-3 condition. Per-session `retentionLimit` exists in `semantic-trace-store.ts`. |
| 046 | `34c4bfa` diagnoses stale MCP launchers on reinstall; issue marked fixed-in-working-tree. Needs live restart QA before the Exo-on-Exo gate reopens (my declared touchpoint — see §5). |
| 082 readback cleanup | Landed on `main` as `4a4397c` (branch `codex/issue-082-agent-readback` differs only by one AGENTS.md line — issues.md status "fixed in branch" is stale, update it). The `stable:smoke` timeout that blocked the branch is untracked — see RF-1. |
| Monitor Mode | `f25989d` — renderer-only pane-tree rebuild (`buildTerminalMonitorTree` / `buildTerminalTabsTree` in `paneTreeSelectors.ts`), persisted `terminalMonitorMode` layout flag, toggle in `App.tsx`. Core terminal runtime untouched. See §4 for concerns. |

## 1. Q1 — What "complete enough for dogfooding" means for the plugin architecture

Define the dogfooding bar precisely, or it will creep: **dogfooding = Kenneth and his agents using proposals, profiles, and harness plugins against the real vault and real projects, with a rollback story.** It does *not* require external plugin loading, distribution, or a public API.

Must finish before claiming it:

1. **WP-QA-PM — plugin-manager QA pass** (already on your roadmap; now the critical path). Checklist-driven: install/enable/disable/inert-unsupported-kind/permission-scope display, through the real UI per `app-qa`.
2. **PA2 — real-vault gate flip.** C1b + PA1 are done, so the fixture gate has served its purpose. Flip requires: (a) the byte-accurate preview visible in the actual review dialog a human uses, (b) a rollback story — at minimum, proposals apply only in a git-tracked vault with a clean-tree precondition or an automatic pre-apply commit. Architect reviews the rollback design before the flip (small doc or PR description is fine).
3. **ManagedAgentKind residue closure.** "Mostly cleaned" is not a state a contract can be in. Either finish the create-path cleanup or enumerate every remaining compatibility field in `issues.md` with its removal condition. The guard ledger already records the payload migration; the residue list is the missing half.
4. **082-class observability confirmed on main** (it appears landed — update the stale issue status) and **046 live restart QA**. Dogfooding the plugin system happens *through* Exo-on-Exo; if the operator loop is unreliable, plugin dogfooding findings will be noise.
5. **Trace store disk hygiene**: per-session `retentionLimit` exists; confirm there's also a cross-session policy (or a documented "unbounded until feed/dataset work" decision) so `.exo/traces/` doesn't silently grow for weeks of dogfooding.

Explicitly *not* required: external contracts, plugin packaging/signing, permission-granting UI beyond display, Project Knowledge Sync.

## 2. Q2 — Sequencing vs broad UI/onboarding polish

**Before polish** (substrate must be trusted before you decorate it):

- Everything in §1.
- Bug-bash issues that are correctness, not cosmetics: **083** (readiness/e2e terminals leaking into the real workspace runtime — this is a workspace-integrity bug and it contaminates dogfooding data), **084** (packaging stall — it slows every QA loop, which taxes all other work).
- The `stable:smoke` timeout follow-up (RF-1) — a flaky/slow release gate degrades every future landing decision.

**After polish is fine for:**

- External plugin contracts (§3 — docs-first work can proceed in parallel, implementation waits).
- Project Knowledge Sync — this is a *consumer* of the proposal substrate. Building it before proposals have survived real-vault dogfooding means building on an unproven floor. Defer until PA2 has a week of real use.
- CLI/MCP multi-agent hardening beyond what 082/046 already delivered — let dogfooding generate the issue list rather than speculating.

Principle: polish freezes surfaces. Don't freeze a surface whose contract may still move, and don't polish while known correctness bugs (083) can corrupt the workspace you're polishing.

## 3. Q3 — Slicing external plugin contracts without premature API debt

The failure mode to avoid is designing contracts for consumers that don't exist. Rules:

1. **Two-consumer rule.** No contract is declared stable until it has two real consumers — either two first-party plugins, or one first-party plus one committed external co-development target. Contracts are *extracted from working code*, never designed speculatively.
2. **Order by consumer proximity:**
   - **Trace contract first.** It has a schema (`exo.semantic-trace.v1`), one production producer (Pi), and an obvious second (Claude adapter, already conditioned on P4b review — the contract review happened, so the Claude adapter is now unblocked). Two producers of one schema is exactly the validation the two-consumer rule wants.
   - **Review/proposal contract second.** One producer path exists; the second consumer is Project Knowledge Sync — which is why Sync waits (§2): it validates the contract when it arrives, rather than the contract being frozen before it.
   - **Dataset/eval contracts last, and not now.** No consumer exists inside Exo. The real consumer is Helm (traces → judging → training data). When Helm actually reads Exo traces, *that* integration defines the dataset contract. Do not invent one first.
   - **Instrumented runtimes: never a plugin contract.** Terminal runtime/rendering is core-owned — that invariant survived the transport war and is not renegotiable via the plugin system.
3. **Stability marking.** Every externally visible contract doc carries `status: unstable` with an explicit no-compat promise until the plugin manifest can express a minimum contract version. Only then does anything get a `v1` without qualifiers.
4. **Guard extension.** The check:repo guard covers routes/CLI/MCP. When a contract type in `packages/core` is marked stable, add its exported type slice to the guard. Unstable contracts stay unguarded on purpose — churn there is expected and cheap.

Net: the only external-contract *implementation* work this wave is the Claude trace adapter. Everything else is a short contract-status doc (WP-XC0 below) that records these rules so agents don't freelance a public API.

## 4. Q5 — Monitor Mode assessment

**Product judgment: right feature, correctly layered.** It's renderer-owned layout over the existing pane tree; core terminal runtime and the tmux path are untouched; the mode persists as a boolean layout flag. This is exactly the Exo-on-Exo observability direction (operator watching a swarm), and it doesn't reopen terminal architecture. Approved in principle.

Three concerns, one of which needs work before this gets heavy use:

**M-1 (needs fixing): toggle mints fresh pane identities.** `buildTerminalMonitorTree`/`buildTerminalTabsTree` call `paneId()` for every leaf on every toggle. New pane IDs are new React keys → every `TerminalView` unmounts and remounts → N simultaneous detach/reattach/refit cycles through the serial terminal-manager queue. V4.1 will *converge* (that's what we built), but this is the first user-triggered feature that multiplies geometry operations by session count in one instant — a self-inflicted version of the wake-reconnect storm, on a hotkey. Fix: derive terminal-leaf identity from the session ID (or map existing leaves into the new tree) so xterm instances survive re-layout and only *resize*. This is a small selector change and it converts the toggle from N reattaches into N fits.

**M-2 (document, don't fix): monitor mode is not a passive viewport.** Splitting resizes each session's tmux pane; agents reflow to narrow widths, and wrap points already written to scrollback are permanent — toggling back doesn't un-wrap history. That's how real terminals work and it's fine, but the terminal-stability skill and the user-facing doc should say it plainly: *monitor mode changes the geometry every agent sees.* A future read-only monitor (render from capture without resizing tmux) would avoid this; record it as an option, do not build it now.

**M-3 (accept with a note): toggle is lossy for manual layouts.** Returning from monitor mode rebuilds a flat tabs tree, discarding custom splits the user made. Acceptable as mode semantics; a pre-toggle tree snapshot restored on exit would be the nicer behavior if it's cheap. Not a gate.

**QA gate before relying on it for orchestration:** app-qa with 4+ live agent sessions — toggle during active repaint, create/terminate a session while in monitor mode, app restart with `terminalMonitorMode: true` persisted (startup reconnect storm × N splits), sleep/wake in monitor mode. Add monitor mode to the terminal field-watch list.

## 5. Q4 — Assignment split

**Architect/orchestrator first (decisions, not code):**

- PA2 rollback-story design → my review → gate flip (§1.2).
- WP-XC0 contract-status doc encoding §3's rules (orchestrator writes, I review — half a day).
- 046 live restart QA on the user machine (orchestrator-run; my declared touchpoint on the layer report stands).
- RF-2 exception-discipline rule (§6) added to the guard doc.

**Lightweight agents now (bounded, testable, independent):**

| Package | Scope | Gate |
|---|---|---|
| WP-MON1 | M-1 stable pane identity across monitor toggle; M-3 snapshot-restore if cheap | Existing App tests + new toggle-identity test; no terminal-manager changes |
| WP-MON2 | Monitor Mode QA per §4 gate; doc/skill note for M-2 | app-qa checklist evidence |
| WP-083 | Readiness/e2e terminal leak isolation | Regression test that a readiness terminal never appears in workspace session list |
| WP-084 | Packaging stall — diagnostic-first, then fix | Layer report before fix (same discipline as 046) |
| WP-SMOKE | `stable:smoke` timeout: split/parallelize or triage the slow Electron scenarios; file as its own issue | Green smoke on main twice consecutively |
| WP-QA-PM | Plugin-manager QA checklist pass | Evidence per §1.1 |
| WP-TRC-CL | Claude trace adapter (second producer, contract already reviewed) | Trace events from a live Claude session via declaration path; no fixture self-writes |

**Sequencing:** WP-SMOKE and WP-083 first (they protect every other landing), MON1/QA-PM/084 in parallel, PA2 after QA-PM, TRC-CL anytime, MON2 after MON1.

## 6. Red flags

- **RF-1 — release gate flake held a high-severity fix hostage.** The 082 fix sat on a branch because `stable:smoke` timed out on *unrelated* Electron scenarios. It appears merged now (`4a4397c`), but the pattern is the problem: a too-broad, flaky gate teaches agents to either batch-land around it or sit on fixes. WP-SMOKE fixes the gate; also update the stale 082 status in `issues.md`. Secondary: the readback sanitizer's `(no buffered output)` suppression is the right trade, but add one regression test that a *legitimate* short plain-text output (e.g. a bare `OK`) is never suppressed — silent over-suppression would quietly re-break the orchestration loop in the opposite direction.
- **RF-2 — guard exception path used 3× on day one.** The `user-approved-exception` entries for the harness-id migration are legitimate (pre-approved cleanup, honestly ledgered). But an exception path exercised on the guard's first day needs a friction rule before it becomes the default: exceptions require the approving task/user reference in the ledger entry (present — good) **and** a post-hoc architect review within the same wave. Consider this that review: the harness-id payload migration is approved. Add the post-hoc rule to `public-contract-reviews.md`.
- **RF-3 — five concurrent fronts named in the roadmap.** Plugin QA, external contracts, Knowledge Sync, CLI/MCP hardening, bug bash. Running all five splits the swarm into ineffective slivers and multiplies my review surface. This wave is a *stability-and-QA* wave with one architecture doc (XC0) and one new adapter (TRC-CL). Knowledge Sync and speculative CLI/MCP hardening are explicitly out.
- **RF-4 — unlanded-WIP inventory.** 081 "fixed in working tree, needs app QA", 082 status stale, 046 "fixed in working tree". Land and QA what's in flight before opening new packages; three "fixed but unverified" items is exactly the state that produced the Wave-3 process finding.

## 7. Blocking summary

- Real-vault proposals/profiles ⇐ PA2 rollback review + WP-QA-PM.
- Dogfooding declaration ⇐ §1 list complete.
- Knowledge Sync ⇐ one week of real-vault proposal dogfooding.
- Dataset/eval contracts ⇐ a real Helm consumer (not this quarter's Exo work).
- Monitor Mode as an orchestration surface ⇐ WP-MON1 + WP-MON2.
- New public surfaces ⇐ standing architect-review-before-ship rule; exceptions per RF-2.

-- Fable | 2026-07-04
