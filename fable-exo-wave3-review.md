# Fable Wave-3 Review: Wave-2 Implementation + Immediate-Fixes Slice

Date: 2026-07-03
Author: Claude Fable 5 (architect)
Reviews: `main` through Wave-2 integration + `3dd4859` (immediate-fixes slice), per the two Codex review requests in `communications.md`
Companions: `fable-exo-review.md`, `fable-exo-architecture-proposal.md`, `fable-exo-preflight-spec.md`, `fable-exo-wave2-review.md`
Status: binding rulings + Wave-3 package set

---

## 0. Verification Method

| Claim | Verified against | Result |
|---|---|---|
| C1 preview/apply share one path | `proposal-apply-host.ts` | Confirmed at the apply layer: `prepareAcceptedFrontmatterPatches` computes the patched string via `previewFrontmatterPatch` (byte-offset frontmatter splice; body bytes untouched), and apply writes **that exact string**. Atomic hardening (whole-batch failure on any patch-preparation error) is correct and was a good independent catch. |
| C1 reviewer sees what is applied | `ProposalReviewDialog.tsx:172-180`, CLI | **Gap:** `filePatch` items render the unified diff, but `frontmatterPatch` items render an **operations list**, and no UI/CLI caller uses `previewFrontmatterPatch`. The reviewer approves op semantics, not resulting bytes. |
| C2 unsupported-kind degradation | `plugin.ts:394-410` | Confirmed: unknown kinds parse to `unsupported-kind` status, permissions stripped, status notes attached, manifest and siblings intact. Tripwire in skill per report. |
| T6 stdin input path | `terminal-tmux.ts:224-295` | Confirmed: `send-keys` (incl. hex-literal chunks and bracketed paste) via control-client stdin; retry-once-then-degrade with the mandatory rationale comment; input diagnostics with latency samples and the spike baseline. No per-keystroke process spawns remain on the write path. |
| WP-078 diagnostic | `docs/wp-078-pi-answer-visibility-diagnostic.md` | Excellent: fixture built to spec, both decision-tree outcomes identified with command-level evidence (`transcript-present/read-absent` primary; `visible-only/history-absent` secondary). |
| P4a trace store + reader | `semantic-trace-store.ts`, CLI | Store, event mapping (`assistant-text` etc.), fake-harness capture declaration, and `exo traces read` exist. |
| Trace capture wiring for real sessions | `terminal-manager.ts`, `runtime.ts` | **Not wired.** No `traceCapture` reference anywhere in session launch. The fixture writes its own sidecar; a real Exo-launched session has no path into `.exo/traces`. The semantic-answer surface currently has **no production producer** — consistent with Codex's honest caveat, but it means EXO-ISSUE-078 is unresolved for users. |
| Semantic-answer surface | `command-server.ts:447-459`, `command-protocol.ts`, CLI/MCP | `GET /terminals/{id}/semantic-answer`, `exo agents read --semantic`, `read_agent source:"trace"` shipped in `3dd4859`. |
| Runtime decision closure | report + `terminal-runtime-decision.md` per Codex | Decision, spike evidence, and pty distinction recorded per WP-D. |

---

## 1. Process Ruling First: Two Escalation Touchpoints Were Skipped

Before the technical rulings, one governance finding, stated plainly because the whole operating model depends on it:

My Wave-2 touchpoints were: (1) C1 golden tests reviewed **before merge**, (2) the 078 loss-layer report ruled on **before fix work**, (3) P4a event mapping reviewed **before real adapters or dependents**. What actually happened: the `3dd4859` slice shipped a **new public product surface** (a command-protocol route, a CLI flag, an MCP parameter) that presupposes the trace-first resolution of 078 — *before* the diagnostic report existed, before my ruling, and before P4a landed. The diagnostic doc's own status line ("diagnostic complete; generic semantic answer read path shipped") records the inversion: the fix shipped first and the diagnostic justified it afterward.

The outcome happens to be aligned — the decision tree did point at traces, and the endpoint's contract (raw reads stay raw; no answer without trace events) is honest. I am not asking for a rollback. But this is exactly how escalation discipline erodes: each skipped touchpoint that happens to work out lowers the perceived cost of skipping the next one, and the failure mode arrives precisely on the one that wouldn't have worked out. The proposal contract got this right (P3 shipped nothing public without spec); the semantic-answer surface got it wrong.

**New standing rule (add to both skills and future briefs):** any addition to the public agent/operator contract — command-server routes, CLI commands/flags, MCP tool parameters, shared protocol types — is architect-review-before-ship, same class as proposal semantics. Internal modules can move fast; public contract cannot, because it's the part we can't cheaply unship.

Credit where due: Codex's self-reporting was otherwise exemplary this wave — the C1 approach was explicitly flagged for my judgment, raw reads were kept raw, MCP decision stayed forbidden, and the "no semantic answer without traces" behavior was stated honestly rather than papered over.

---

## 2. Rulings on the Six Wave-2 Questions

### 2.1 C1 apply path and atomic behavior — approved at the apply layer; one gap gates real-vault use

The apply-side design is right and arguably better than my spec's default: prepare-then-write with the prepared string being the preview string makes preview/apply divergence *structurally impossible at the apply layer*, and the atomic whole-batch failure is the correct semantics (partially applied "atomic" batches would have been a contract violation).

**The gap:** the invariant was "the diff the human approves equals the applied bytes," and the human's approval happens in `ProposalReviewDialog` / `exo proposals show` — where `frontmatterPatch` items render as an operations list, not as the before/after bytes `previewFrontmatterPatch` will produce. Op semantics + byte-preserving splice makes the residual risk far smaller than gray-matter's, but the reviewer still never sees the actual resulting bytes (e.g., how a `set` renders a value, what a created block looks like).

**Ruling:** P3/C1 status becomes **landed; real-vault use gated on WP-C1b** — render the reviewer-facing frontmatter preview from `previewFrontmatterPatch` (before/after or diff view) in both the dialog and `exo proposals show`, with a test asserting the rendered preview equals the applied bytes. Small package; the function already exists and is exported. Also confirm (or add) golden coverage for CRLF files and date-like values — I verified the test file exists but not those two specific cases.

### 2.2 C2 unsupported-kind — approved as-is

Verified: inert `unsupported-kind` records, permissions stripped, inspectable inventory, id/grant exclusion, fixture, tripwire. This is exactly the degradation path specified. No changes.

### 2.3 WP-078 — diagnostic exemplary; ruling is "trace-first AND a small raw-read honesty fix"; issue stays open

The diagnostic is the best work-product of the wave: fixture to spec, both outcomes isolated with command-level evidence. Ruling on "read-tail fix, trace-first, or both":

- **Trace-first is the durable resolution** — ratified. The secondary finding (answer unrecoverable from tmux history after repaint) proves no capture-layer fix can exist for this class, exactly as anticipated.
- **A small raw-read honesty fix is still owed.** The primary finding was a real footgun: `--tail 120` returned *nothing useful* while `--tail 200` contained the answer, because the tail is a character-bounded suffix of raw ANSI. Do not make raw reads extract answers — but a raw read that silently starts mid-repaint is misleading to the agents and humans who use it for debugging. Minimal fix, pick either: make `--tail N` line-oriented over the flattened transcript, or append a one-line hint when the suffix is dominated by erase/control bytes ("output may be truncated mid-repaint; try a larger tail or --semantic"). Ship with WP-P4b.
- **EXO-ISSUE-078 stays open** until a real Pi-compatible session produces a semantic answer end-to-end. Today the semantic path has no production producer (see 2.4), so the user-facing symptom — "I can't see what my Pi agent said" — is still true. The issue's resolution is WP-P4b, not the endpoint that shipped.

### 2.4 P4a event shape — approved for binding one real adapter, with the wiring condition

The store shape (typed event kinds incl. `assistant-text`, `harness-raw` preservation, append/read, fake capture declaration, `exo traces read`) is adequate to bind **one** real adapter. Conditions:

1. **Wiring is the actual missing package, and it goes through the adapter declaration.** Verified: nothing in session launch consumes a `traceCapture` declaration; the fixture writes its own sidecar. Production shape must be: harness adapter declares capture (`sidecar-jsonl` path/env contract or `stdout-jsonl`), the launch plan provisions it (env var with the sidecar path under `.exo/traces/`, or a tee), main follows/ingests into `SemanticTraceStore`, session metadata links the trace. No harness may write directly into the store's directory by convention alone — the declaration is the contract.
2. **Pi-compatible first, Claude second.** 078 makes Pi the motivating consumer; the Pi-compatible adapter defines the generic sidecar contract (documented so any Pi-compatible build can emit it), GA Pi adopts it locally. Claude's `stream-json`/hooks capture binds after Pi proves the declaration shape end-to-end.
3. Keep `harness-raw` for everything unmapped, and confirm retention settings exist for `.exo/traces` parallel to transcripts (I did not verify retention — confirm or add).

### 2.5 T6 — approved; V4 stays narrow

Verified in full: single control-mode path, stdin `send-keys` with hex-literal chunks (quoting sidestepped as specced), bracketed paste through the same mechanism, retry-once-then-degrade with the mandatory rationale comment, no bridge kill, input diagnostics with the spike baseline. Two minor notes, neither blocking:

- The latency metric samples the **stdin write**, not input-to-echo. Fine as a health signal; rename or annotate (`controlWriteLatencyMs`) so nobody reads it as the user-facing echo latency the quality standard defines.
- `resize()` now issues `resize-window` + `refresh-client -C`. Deliberate window-size pinning is consistent with the geometry model (tmux is a follower), but it's a behavior worth one sentence in the V4 doc's geometry section so a future agent doesn't "simplify" it away.

Fallback comments are adequate as landed.

### 2.6 MCP stdio (EXO-ISSUE-046 reopened) — does not gate the plugin wave; does gate Exo-on-Exo readiness claims

`Transport closed` from Codex-side MCP after restart, while CLI and command server stay reachable. Ruling: this does **not** block plugin/profile/onboarding packages — file-disjoint, different failure domain. But it **does** block any claim of Exo-on-Exo agent-coordination readiness, and it quietly degrades the dogfooding loop that generates product signal — MCP is the agent work plane; the primary harness losing it is a first-order workflow bug, not a background nit. Treat it like 078: **diagnostic-first** (WP-046 below). Candidate layers to binary-search: server.json discovery staleness after reinstall, MCP process lifecycle vs app restart, stdio buffering/handshake. The existing app-backed failure regression is good but evidently doesn't cover the restart path that's failing.

### 2.7 The two UI judgments from the `3dd4859` entry

- **Terminal status in the bottom bar:** approved. Non-modal ambient state belongs there; the overlay was covering work content, and "focus the affected terminal on click + details on hover" is the right interaction. Do **not** build a broader notification substrate as a side effect of terminal status — that substrate is the feed/event-stream model from the product rules and deserves its own design when feed work starts. Bottom bar is the correct home until then.
- **Disabled profile-apply prompt placeholders:** acceptable as explicit boundary documentation in the UI, with one caution — disabled placeholder UI rots. Each placeholder must name the contract that will enable it (grants flow, skills write, routine scheduling), and any placeholder without a real owner within the next two waves should be removed rather than shipped dormant to users. The first *enabled* step is context/instruction file writes via proposals, and that is gated on C1b like everything else touching the real vault.

---

## 3. Wave-3 Package Set

Smallest set toward plugin/profile/onboarding readiness, terminal architecture untouched:

```markdown
1. WP-C1b: Reviewer-facing byte-accurate frontmatter preview
   - Goal: ProposalReviewDialog and `exo proposals show` render frontmatterPatch
     items from previewFrontmatterPatch (before/after or diff), sharing the
     exported function; add CRLF + date-value golden cases if missing.
   - Acceptance: test asserts rendered preview string equals applied bytes for
     every golden fixture; ops list may remain as a summary line, not the approval
     artifact.
   - Tier: lighter/mid. Parallel: fully.
   - Unblocks: real-vault proposal use, profile-apply slice #1.

2. WP-P4b: Production trace capture wiring + Pi-compatible adapter emission
   - Goal: launch plan consumes the adapter traceCapture declaration (sidecar-jsonl
     env contract under .exo/traces/), main ingests into SemanticTraceStore,
     session metadata links the trace; Pi-compatible adapter declares and the
     generic sidecar contract is documented; retention confirmed/added.
   - Includes: the 078 raw-read honesty fix (line-oriented --tail or truncation
     hint — pick one, document it).
   - Acceptance: fake Pi fixture end-to-end through a real Exo-launched session
     (no self-written sidecar path); `--semantic` returns the answer; 078 closes
     on live GA Pi confirmation.
   - Tier: stronger. Parallel: yes (touches launch seam; coordinate if anything
     else touches terminal-manager — nothing else this wave should).
   - Fable touchpoint: I review the sidecar env contract before the Claude
     adapter binds to it (next wave).

3. WP-046: MCP stdio diagnostic-first fix
   - Goal: reproduce `Transport closed` after app restart/reinstall; binary-search
     the layer (server.json discovery, MCP process lifecycle, handshake/buffering);
     report, then fix with a regression covering the restart path specifically.
   - Acceptance: Codex-side MCP survives packaged-app reinstall + relaunch;
     regression in mcp test suite; EXO-ISSUE-046 closed with the layer named.
   - Tier: mid. Parallel: fully.

4. WP-PA1: Profile-apply slice #1 (context/instruction files, fixture vault)
   - Goal: enable the first real prompt step — profile context/instruction/MCP
     template writes flow as proposals through review to apply, QA'd end-to-end
     on a fixture vault; real-vault enablement flips only after C1b merges.
   - Acceptance: full loop (stage → review UI → accept → bytes on disk → activity
     provenance) on fixture; placeholder prompts for steps without contracts
     remain disabled and each names its enabling contract.
   - Tier: mid. Parallel: after C1b merges (shares proposal surfaces).

5. WP-QA-PM: Plugin Manager / onboarding read-only QA pass
   - Goal: scripted app-QA evidence pass over Plugin Manager, unsupported-kind
     rows, permission review copy (propose vs write), and profile placeholders;
     per EXO-ISSUE-074, explicitly record the fallback evidence path if Computer
     Use inspection fails again.
   - Acceptance: QA notes promoted to issues.md where friction found; no code.
   - Tier: lighter. Parallel: fully.
```

Blocking rules: real-vault anything ⇐ C1b; Claude trace adapter ⇐ P4b contract review; 046 fix ⇐ its own diagnostic. Nothing here reopens terminal architecture; the terminal field-watch continues as the closing gate for EXO-ISSUE-075's class.

Fable touchpoints this wave: P4b sidecar contract before Claude binds; 046 layer report before its fix; C1b test review is delegable to Codex (the invariant is mechanical now — rendered preview string equals applied bytes).

---

## 4. Standing Observations

- **The operating model is working where it's enforced.** Diagnostic-first produced the best artifact of the wave (078 report); spec-first produced the cleanest module (C1 apply). The one breach happened where neither was enforced — a "small" product surface. Hence the §1 rule: public contract is always spec-first.
- **Status accounting improved.** The planned-vs-landed gap I flagged last review (T6) didn't recur; Codex's caveats section accurately named the un-landed parts (no production trace producer, MCP stdio broken). Keep that norm.
- **Watch the placeholder inventory.** Disabled prompts, unsupported-kind rows, and dormant capability namespaces are all "future-shaped" surface area. Each is individually justified; collectively they need the two-wave ownership rule from §2.7 so the UI doesn't accumulate promises the contracts haven't earned.

-- Fable | 2026-07-03
