# Fable Preflight Spec: Answers Before Fan-Out

Date: 2026-07-02
Author: Claude Fable 5 (architect)
Answers: Codex preflight questions in `communications.md` (2026-07-02 entry)
Companion to: `fable-exo-architecture-proposal.md` (referenced as "proposal" below)

These are binding clarifications for implementation agents. Where this doc and the proposal conflict, this doc wins (it is newer and more specific). Agents who find a contradiction between either doc and observed code behavior stop and escalate — do not invent architecture.

---

## 1. Terminal V4.1 Red-Test Specs

### 1.1 `reconnect-at-wrong-size`

**Host:** new spec `apps/desktop/tests/e2e/terminal-geometry.spec.ts`, wired into `pnpm terminal:check`. The geometry class deserves its own named spec; do not bloat `shell.spec.ts`.

**Fake agent fixture:** new script `apps/desktop/tests/fixtures/fake-ink-agent.sh` that emulates the Ink repaint discipline deterministically:

- On start and on every `SIGWINCH` (`trap ... WINCH`), repaint a frame of exactly 6 lines:
  1. header: `FAKE-INK v1 frame=<n> cols=<C>` where `<C>` is `$(tput cols)` at repaint time and `<n>` increments per repaint;
  2. a full-width ruler line built to exactly `<C>` chars: repeating `----+----1----+----2...` (column-position encoded in the text);
  3. a box-drawing line `┌─...─┐` of exactly `<C>` chars;
  4. an echo line: `input: <last line typed>`;
  5. a spinner/status line with braille + emoji from the existing render-stability corpus;
  6. footer: `─` × `<C>`.
- Repaint is incremental, Ink-style: move cursor up 6 (`\x1b[6A`), erase each line (`\x1b[2K`), rewrite. **Never clear screen.**
- Reads stdin line-buffered; each line updates the echo line via a repaint.

This fixture is the geometry oracle: the ruler and box lines make width mismatch and wrap corruption directly assertable from terminal text, and the frame counter makes duplicated/overlapping frames assertable (`frame=` must appear exactly once in the visible viewport).

**Test flow:**

1. Launch Electron with a window sized so the terminal pane fits ≥ 180 cols (assert actual cols from xterm, don't assume).
2. Create a shell terminal, run the fixture. Assert: exactly one `frame=` in viewport; ruler length == `terminal.cols`; box line unbroken (no wrapped fragment on the next row).
3. Force the wrong-size attach **through the real product path**: trigger reconnect via the existing renderer reconnect action (or command-server reconnect route if the UI path is flaky under Playwright). No test-only size stubbing is needed — on current `main`, `reconnect()` attaches at `initialColumns×initialRows` by construction, which *is* the bug.
4. After reconnect settles (health healthy, bounded wait ≤ 5s): re-assert the three invariants from step 2. On current `main` this fails: the WINCH repaint renders `cols=120`, ruler length 120 ≠ xterm cols. That is the red assertion.
5. Type `hello-after-reconnect\n`. Assert echo line updates, `frame=` still appears exactly once, no residual fragment of any earlier frame remains above the current frame beyond the expected pre-reconnect scrollback.

**What fails on current main:** step 4 (width mismatch) and typically step 5 (frame duplication/drift). Steps 1–2 must pass on current main — if they don't, the fixture is wrong, not the product.

### 1.2 `wake/reconnect simulation`

**Trigger:** add a command-server route `POST /terminals/reconnect-recoverable` that calls `reconnectRecoverableTerminals()` — the exact code path the power-resume hook invokes. This is deliberately a product surface, not a test hook: it doubles as an operator recovery action (aligned with "health/recovery states are visible and actionable") and keeps the test on real plumbing. Small enough to include in the red-test package.

**Flow:**

1. Fixture running as in 1.1, wide pane, invariants green.
2. Sever the bridge the way sleep does: read the control-mode child pid from terminal diagnostics and `kill` it (do **not** kill the tmux session). Assert the session reaches bridge-detached/degraded health.
3. `POST /terminals/reconnect-recoverable`.
4. Recovery definition (all required, bounded wait ≤ 10s): health healthy; `attachGeneration` incremented in diagnostics (post-T1/T3; omit this assertion in the red version); ruler length == xterm cols; typed input echoes; `frame=` exactly once.
5. Second case in the same spec: repeat with a browser-preview pane open beside the terminal. Include from day one — preview+terminal is a known interaction class (EXO-ISSUE-056) — but tag it so it can be quarantined if Electron webview flake appears; it must not block Wave 1 merges.

**Determinism/speed:** fake fixture only, no inference; all waits poll health/diagnostics with hard timeouts; target < 30s per case so `terminal:check` stays a minutes-fast gate.

### 1.3 Red-test landing policy

Land both as **one tests-only PR before any fix slice**, with the failing assertions wrapped in Playwright `test.fail()` annotations (expected-failure) so `main` CI stays green while the breakage is executable and documented. WP-T3's PR removes the annotations — that is the auditable red→green flip. If a `test.fail()` test unexpectedly passes, Playwright fails it, so we also get a signal if something else accidentally fixes or masks the bug.

---

## 2. Terminal Geometry API Shape

```ts
// packages/... shared type (lives with terminal settings/types in @exo/core or shared/api)
interface TerminalGeometryRecord {
  cols: number;                 // xterm character cells (integer ≥ 1)
  rows: number;                 // xterm character cells (integer ≥ 1)
  reportedAt: string;           // ISO timestamp of last renderer measurement
  source: "renderer-fit" | "initial-default";
}
```

- **Persistence:** a new optional `geometry` field on the existing session record in `.exo/terminal-sessions.json`. No second file — the registry already owns reconciliation and corruption recovery, and geometry is per-session state. Older records without the field behave as today (initial defaults + `source: "initial-default"`); registry parsing stays byte-compatible for existing fields.
- **`attachGeneration`: process-local only, never persisted.** Starts at 1 on first attach each app run. Rationale: after app relaunch the renderer remounts anyway, which forces initial measurement; persisting generations would add cross-process reconciliation for zero benefit.
- **Shared API:** add `attachGeneration: number` to `TerminalSessionInfo`; terminal data IPC events become `{ id, generation, data }`. Preload/renderer types updated in the same slice (WP-T3).
- **Renderer naming:** rename the `TerminalView` prop `onResize` → `onGeometryMeasured` to encode ownership (renderer measures; it does not "resize" anything). Keep the preload/IPC route name `terminals.resize` unchanged — it is a public protocol surface and the rename is renderer-internal.
- **Diagnostics shape (WP-T5):**

```ts
geometry: {
  renderer: { cols, rows, reportedAt, source },
  tmuxPane: { width, height },        // from #{pane_width}/#{pane_height}
  tmuxClient: { width, height },      // from #{client_width}/#{client_height}
  divergent: boolean,                  // renderer vs tmuxPane mismatch
  divergentSinceMs?: number,
  attachGeneration: number
}
```

- **Not exposed via CLI/MCP yet:** no geometry *mutation* surface (`exo terminals resize` does not exist and should not); `attachGeneration` appears in diagnostics output only, not in MCP `read_agent`/`list_agents` payloads. Read-only diagnostics via CLI is fine.

---

## 3. Terminal Snapshot Semantics

Three artifacts, three purposes — enforce the split in the type system, not in comments:

| Artifact | Purpose | Fidelity rule |
|---|---|---|
| Live-restore snapshot | Make xterm's grid + cursor identical to tmux's | Byte-faithful; zero normalization |
| CLI/MCP read tail | Human/agent-readable recent text | Display trimming allowed |
| Transcript tail | Durable append-only history | Unchanged (existing UTF-8-safe reads) |

**v1 live-restore snapshot spec:**

- Include bounded scrollback, not just viewport: `capture-pane -e -p -J -S -{min(liveScrollbackLines, historyLimit)}` — users expect history after reload, and with `-J` plus identical width, xterm re-wraps to the same layout. Do not trim anything, including trailing blank lines (they are part of the grid).
- Cursor restore: fetch `display-message -p -t {pane} '#{cursor_x} #{cursor_y}'` and append `\x1b[{y+1};{x+1}H` **to the same string** delivered as the snapshot. One string, one write path — interleaving xterm API calls with the chunked write queue creates ordering races. (The chunker preserves escape sequences; if the CUP could straddle a chunk boundary, the chunker's existing sequence-preservation must cover CSI — verify, add test.)
- **Alt-screen v1: no snapshot.** If `#{alternate_on}` = 1, skip content restore entirely and rely on the reconnect repaint nudge (proposal §1.2 step 5) — alt-screen apps own their full screen and repaint on SIGWINCH. Document as a known v1 limitation in the doc addendum. Claude Code does not use the alt screen, so the daily path is unaffected. Full alt-screen restore is a v2 item, only if a real harness needs it.
- Sanity guard: read `#{pane_mode}`; if the pane is in copy-mode, capture normal content (`capture-pane` reads the underlying screen regardless) but log a diagnostics counter — a pane stuck in copy-mode during reconnect is a signal worth seeing.

**Renames/splits (WP-T4, mandatory):**

- `normalizeCapturedTmuxPane` → `normalizeCapturedTailForDisplay`. Its doc comment must state: "Display-only. Never use for live restore — trimming desynchronizes xterm's grid from tmux's (see EXO-ISSUE-075)."
- Runtime interface splits capture into two typed methods: `captureTailForDisplay(options)` and `captureRestoreSnapshot(options): { content: string; cols: number; rows: number; altScreen: boolean }`. The returned geometry makes the "snapshot at asserted size" invariant checkable: manager asserts `snapshot.cols === geometryRecord.cols` before delivery (dev-build assert, diagnostics counter in production).

---

## 4. Terminal Work Package Boundaries

**Worktree safety:** T7, T8, T9 are safely parallel to everything (T7 touches only `splitTmuxInput`/input helpers in `terminal-tmux.ts`; T8 is tests+one command-server route; T9 is an isolated branch). T1, T2, T3, T5, T6 all touch `terminal-manager.ts` and/or the renderer hydration seam and must serialize. T4 touches the runtime capture seam plus a narrow manager call site — schedule after T3, ideally same agent as T3 or immediately following.

**Enforced merge order:** `T8(red) → T1+T2 (one package) → T3 (flips T8/T3 tests green) → T4 → T5 → T6 → T7 (anytime except concurrent with T6 — both edit terminal-tmux.ts write/input paths)`.

Fold T2 into T1's assignment: T2 is a ~20-line change in the same file with shared test context; a separate worktree buys conflict risk and nothing else.

**Staffing:**

- Stronger agents: **T3** (cross main/renderer protocol; generation semantics; simplification of pending-data buffering — highest judgment density), **T4** (escape-sequence and capture subtleties), **T9** (evidence judgment), **P1** (type migration breadth across core consumers).
- Lighter agents: T1+T2, T5, T7, T8, P2 (after P1 defines shapes).

**Mandatory Codex review before merge (even on green):**

- T3: verify no code path can still deliver stale-generation data to a mounted xterm, and that `useTerminalSessions` pending-data machinery got *simpler*, not another layer. If the diff adds a new buffering path, reject.
- T4: grep the diff for any trimming/regex-normalization applied to the restore path; verify the type split exists so display capture cannot be passed to hydration.
- T6: verify `detachAfterWriteFailure`'s bridge-kill behavior is gone and replaced by retry-then-degrade; an input failure must be provably unable to stop the output stream.
- Any diff that touches hydration in `useTerminalSessions.ts` or `terminalHydration.ts`, regardless of package.

**Mandatory comments (encode decisions, not mechanics):**

- `TerminalGeometryService` header: the measure/record/follow ownership rule and why attach must never use defaults when a record exists.
- `safeFit`: dedupe is valid only within an attach generation; why.
- Capture site: snapshot must be captured after size assertion under the same generation; why (Ink cursor-relative repaint).
- `normalizeCapturedTailForDisplay`: the display-only warning above.
- Input write failure handler: retry-then-degrade, never kill the bridge; why (a keystroke must not take down a healthy output stream).

---

## 5. Plain-Attach Spike Scope

- **Form:** a real `PtyAttachTerminalRuntime` implementing `TerminalRuntime`, living **entirely on a spike branch/worktree that is never merged to `main`**. Selected in that branch via `EXO_TERMINAL_RUNTIME=pty-attach-spike` (env guard, no settings UI, no product toggle). `main` receives exactly one artifact: `docs/terminal-attach-spike-report.md`. Rationale: the questions that matter (xterm scrollback pollution, Electron-context latency) cannot be answered by a throwaway script outside the app; but a merged second runtime is exactly the "hidden fallback transport" the fallback audit forbids. The branch form gives real evidence with zero main-branch surface.
- **Attach method:** `node-pty` (spike-branch devDependency only) running `tmux -u attach -t {session}`. Not Terminal.app/iTerm — that would measure their emulators, not our stack.
- **node-pty risk, honestly:** native module ABI builds against Electron (electron-rebuild churn), packaging exclusions, and it re-normalizes a dependency the architecture deliberately removed. All three are why it stays branch-confined. If the spike wins, reintroduction is a deliberate ADR with packaging work, not a dependency bump.
- **Promote threshold (all three):** (a) passes the full render-stability corpus + both geometry e2e tests on the spike branch; (b) scrollback pollution materially low — ≤ 1 repaint-artifact block per *reattach* and ~0 per *resize* when scrolling history after the §1.5 evidence protocol; (c) input latency p50/p90 ≤ the post-T6 control-mode path.
- **Kill threshold (either):** (a) V4.1 runs field-clean for two weeks of daily dogfooding (zero hard-refresh events, no new geometry-class fixtures), or (b) spike shows ≥ 1 repaint-artifact block per resize in scrollback — the expected failure mode, and disqualifying for the "full useful scrollback" requirement. On kill: archive the report, keep the branch as reference, document plain attach as the manual debug path (`tmux attach` in any external terminal already covers recovery).

---

## 6. Plugin P1/P2 Migration Details

**Kind migration mapping (exact):**

| Current | New id | Status |
|---|---|---|
| `searchProvider` | `core:searchProvider` | hosted by core |
| `agentHarness` | `core:agentHarness` | hosted by core |
| `profile` | `core:profile` | hosted by core |
| `routineTemplate` | `core:routineTemplate` | hosted by core |
| `analyzer` | `exo.graph:analyzer` | inert (no host) |
| `graphVisualization` | `exo.graph:visualization` | inert |
| `traceCollector` | `exo.training:traceCollector` | inert |
| `datasetExporter` | `exo.training:datasetExporter` | inert |
| `evalRunner` | `exo.training:evalRunner` | inert |

Inert = discoverable, inspectable in Plugin Manager with a "no contract host" status, never active. When the trace/eval work later needs these kinds, a host registers the contract descriptor — the ids are reserved now so manifests written today stay valid.

**Migration mechanics:** one hard migration internally, with a **parse-time alias shim** at the manifest boundary: bare legacy ids (`"searchProvider"`) are normalized to namespaced ids during manifest/`builtInCapabilities` parsing, with a deprecation note surfaced in plugin status. All internal code, registries, and tests use namespaced ids only. The shim carries a removal TODO tied to one release cycle. Rationale: the manifest population is tiny (in-repo plugins + Kenneth's machines), but a hard break with zero shim would make old workspace manifests silently invalid — a status-visible normalization is kinder and costs ~20 lines. Existing tests: update expectations mechanically to namespaced ids; add exactly one new test asserting a legacy manifest normalizes with the deprecation status.

**Scoped permission serialization (exact):** string form in `plugin-permissions.json` arrays, `"<resource>:<action>"` or `"<resource>:<action>:<scope>"`, parsed to the structured `PermissionGrant`. Scope grammar: `root:<noteRootId>` | `path:<workspace-relative-prefix>` | `harness:<harnessId>`. Examples: `notes:propose:root:shoshin-codex`, `projects:read:path:projects/exo`, `agents:launch:harness:core.claude`. Grant records stay keyed by plugin id + source + root path + manifest path + manifest hash (unchanged). An unscoped `write` grant must render with explicit breadth copy at review time ("can edit any file in your vault, without review").

**UI copy for `propose` vs `write`:**

- propose: "**Suggest changes** — the plugin drafts edits; nothing is written until you review and accept."
- write: "**Edit files directly** — changes are applied immediately, without review."

The visual hierarchy should make `propose` read as the normal, safe grant and `write` as the exceptional one.

---

## 7. Proposal/Review Contract Edge-Case Rulings

- **Batch vs items:** a proposal is an **ordered list of independently-decidable items**, plus an optional `atomic: true` flag. v1 honors atomic by refusing per-item decisions (accept-all or reject-all). Ordered because application order matters once moves/creates interact; independent because partial acceptance is the realistic review outcome.
- **One accepts, one goes stale:** proposal status becomes `partial`; each item carries its own `itemStatus: "accepted" | "rejected" | "stale" | "pending"` with a reason on stale (`baseHash mismatch: file changed since proposal`). CLI/UI offer "re-propose stale items", which creates a *new* proposal with `supersedes: <oldId>` — never mutate a decided proposal's items.
- **Diff format:** unified diff only in v1, applied strictly (baseHash must match; zero fuzz). If the hash matches, the diff applies cleanly by construction. Structured ranges rejected for v1: unified diffs are human-reviewable in the `.md` render, git-native for provenance, and every agent knows how to produce them. Revisit only if real usage shows a need for intra-line structured ops.
- **Frontmatter fidelity:** operate on a comment/format-preserving YAML document AST (the `yaml` package Document API), not parse-to-JS-and-reserialize. Ops (`set`/`remove`/`appendToList`) mutate the AST; key order and comments of untouched keys are preserved byte-for-byte. Golden tests must include commented, oddly-ordered frontmatter.
- **Moves/deletes:** types ship in v1 (they are part of the contract), the apply engine rejects them with `"not yet supported: fileMove/fileDelete land in proposals v2"`. Design-only, exactly as the proposal doc stated.
- **Provenance linkage:** `provenance.activityId` is required and points at the activity substrate record for the run/routine/session that produced the proposal; `provenance.sessionId` joins to terminal session ids when the source is a harness session; `provenance.traceRef` is optional now (format `traces/{sessionId}.ndjson#{firstSeq}-{lastSeq}`) and becomes populated once WP-P4 lands. Activity records gain a `proposalIds` artifact-reference list — one join point, both directions.
- **MCP "propose but never accept" shape:** `accept` is simply **absent from the MCP tool schema** — the primary enforcement is that the capability does not exist on that surface. Defense-in-depth for argument abuse or future schema drift: the command server rejects accept/reject requests bearing MCP-plane auth with a structured error `{ code: "proposal-decision-forbidden", message: "Proposals are decided by the user in Exo (UI or CLI). Agent surfaces may create and list proposals only." }` and a test asserts both layers.

---

## 8. Trace Contract: First Consumer

**Ruling: fake-harness fixture first, Claude adapter second, both inside WP-P4. Codex JSON adapter is deferred** until the Claude adapter proves the `traceCapture` declaration shape (one real adapter, then generalize — same discipline as the harness registry).

- The fixture: extend the fake-Claude e2e agent to emit a deterministic `stream-json`-shaped side-channel; this proves the capture substrate (launch-plan extension, follow/tee, NDJSON store, session linkage) with zero inference and becomes the permanent CI guard.
- The first *reader* (so plumbing isn't abstract): `exo traces read <sessionId>` (bounded, human-readable rendering of turns/tool-calls) plus the activity-record artifact reference. No MCP trace surface in v1.
- Minimal v1 event kinds that must be captured: `session-start` (harnessId, command, cwd), `turn-start`, `assistant-text` (concatenated per turn), `tool-call` (name + input digest), `tool-result` (status + output digest), `lifecycle` (exit/interrupt). `cost` and `readiness` are optional-if-cheap; everything unmapped is preserved as `harness-raw` so no source data is dropped before we know what matters.

---

## 9. First Swarm Plan (Wave 1)

Five packages, one integration branch:

| # | Package | Agent tier | Parallel? | Produces |
|---|---|---|---|---|
| 1 | Red tests: geometry spec (1.1, 1.2) + fake-ink fixture + `/terminals/reconnect-recoverable` route | mid | yes | tests-only PR (`test.fail()` annotated) + short report |
| 2 | WP-T1+T2: GeometryService + attach-uses-record + clamp removal | mid | yes — **integration branch base** | code + unit tests + report |
| 3 | WP-T7: escape-sequence pass-through | lighter | yes | code + unit tests + report |
| 4 | WP-T9: plain-attach spike | stronger | yes (isolated branch) | spike branch + `docs/terminal-attach-spike-report.md`; **no product code** |
| 5 | WP-P1: namespaced capability kinds + alias shim | stronger | yes (core package only) | code + tests + migration note + report |

- **Integration branch:** `terminal-v4.1`, based on `main`, with package 2 merging first; WP-T3 (Wave 2, stronger agent) rebases onto it and flips package 1's tests green. Wave 2 = T3, then T4; Wave 3 = T5, T6, P2, P3-design-review.
- **Each agent reads, in order:** the relevant repo skill (`terminal-stability` or `plugin-development`); the relevant section of `fable-exo-review.md` (findings) and `fable-exo-architecture-proposal.md` (spec); the matching section of **this doc**; the files listed in their package. Nothing else — briefs should link sections, not say "read everything."
- **Each agent produces:** code + tests per package acceptance; gates run and named in the handoff (`terminal:check` for T-packages, `--filter @exo/core test` + `check:repo` for P-packages); a short worktree report: what moved, gate results, and any deviation from spec (a deviation without an escalation note is a review-rejection).
- **Stop-and-escalate conditions for every brief:** (a) needs to touch a file outside the package's listed set; (b) a test can only pass by weakening an assertion or widening a timeout; (c) observed behavior contradicts the spec in this doc or the proposal; (d) the change seems to require a new fallback path (fallback discipline: escalate, don't add); (e) for terminal packages, anything that would call `terminal.reset()` or `terminals.read()` outside the documented hydration/reconnect paths.

---

## 10. Docs / ADR Promotion

- **`docs/terminal-architecture-v4.md`:** do not rewrite now. After WP-T3 lands (the protocol becomes real), add a concise "V4.1: Geometry Convergence" section to the existing doc — ownership model, reconnect protocol, snapshot spec — and mark superseded assumptions inline. **Edit the existing doc, no new `v4.1.md` file**: the repo already carries a v3/refactor-plan doc graveyard; version the content, not the filename. Skill invariants (proposal §1.7) merge in the same PR as T3 per docs-move-with-behavior.
- **Plugin execution ADR:** write when WP-P8 starts, not before. The decision is recorded in proposal §2.5 and is stable; an ADR authored months before implementation goes stale in its details. P1/P2 need no ADR — they update `docs/plugin-system-architecture.md` and the audit doc in their own PRs (the kind table in §6 above goes into the architecture doc verbatim).
- **The fable docs (`fable-exo-review.md`, `fable-exo-architecture-proposal.md`, this file):** commit them — they are coordination records with provenance value, not scratch. Keep them at repo root while the work is active (they are being read constantly). After the transport decision and P3 land, promote surviving durable content into `docs/` (terminal doc addendum, plugin architecture/audit updates, proposal contract doc) and move the fable trio to `docs/reviews/2026-07-fable/` as the archived record. `communications.md` stays at root as the living channel and gets pruned by the same protocol already written at its top.

---

Escalation reminder (unchanged from proposal §3.2): transport decision after the spike report, proposal item semantics changes, execution ADR review, and auto-accept policy design come back to Fable. Everything above is now specified; deviations are escalations, not improvisations.

-- Fable | 2026-07-02
