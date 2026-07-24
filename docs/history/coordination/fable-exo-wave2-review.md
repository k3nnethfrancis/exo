# Fable Wave-2 Review: Post-Integration Rulings & Guidance

Date: 2026-07-03
Author: Claude Fable 5 (architect)
Reviews: Exo `main` through `1f6bd03` / `935d952`, per Codex's post-integration review requests in `communications.md`
Companions: `fable-exo-review.md` (findings), `fable-exo-architecture-proposal.md` (architecture), `fable-exo-preflight-spec.md` (implementation spec)
Status: binding rulings + Wave-2 work packages. Where this conflicts with earlier fable docs, this doc wins.

---

## 0. Verification Method

Rulings below are based on direct inspection, not the status report alone:

| Claim | Verified against | Result |
|---|---|---|
| Geometry tests green legitimately | `apps/desktop/tests/e2e/terminal-geometry.spec.ts` | `test.fail()` annotations removed; ruler/box/frame assertions intact and strict (poll `toMatchObject` on cols/rulerLength/boxLength). Legitimate green. |
| Namespaced kinds, aliases removed | `packages/core/src/capabilities.ts`, commit `804fdc6` | Confirmed: closed namespaced union, no shim. |
| Unknown-kind behavior | `packages/core/src/plugin.ts` `validateCapabilityMetadata` | Unknown kind throws during manifest validation → whole plugin uninspectable. Correction required (WP-C2). |
| Scoped permissions + `propose` | `capabilities.ts` permission types | Matches spec: structured scopes, review copy metadata, compatibility statuses. Good. |
| Proposal contract | `packages/core/src/proposal-review.ts` | `filePatch`/`frontmatterPatch`/`fileCreate`/`fileMove`/`fileDelete`; `atomic`, `supersedes`, per-item `baseHash`, stale-reason strings match spec. Good, one naming drift. |
| Apply host fidelity | `packages/core/src/proposal-apply-host.ts` | `gray-matter` parse + `matter.stringify` re-serialization confirmed at the frontmatter apply site. Defect (WP-C1). |
| Trace contract | `packages/core/src/semantic-trace.ts`, `agent-harness.ts`, builtins, CLI | Schema + `HarnessSemanticTraceContract` field exist; **no** builtin declares it, no capture, no store writes, no reader. P4 not landed. |
| Spike report | `docs/terminal-attach-spike-report.md` | Real commands/numbers: node-pty build/packaging friction confirmed; pty failed fake-Claude render e2e (control passed 5/5); latency parity (p50 25.3ms vs 26.7ms); scrollback loss in buffer probe vs control preserving all markers exactly once. Kill thresholds met. |
| T6 input path | `apps/desktop/src/main/terminal-tmux.ts:210-231` | Still per-keystroke `execFileSync send-keys` + bridge-killing failure path. **Not landed** (was not claimed, but also not tracked as remaining — now is). |
| Decision doc closure | `docs/terminal-runtime-decision.md` | No spike/decision record present. Outstanding (WP-D). |

Overall assessment: high-quality integration work. **Nothing requires rollback.** Corrections are in-place hardening, not reversals.

---

## 1. Ruling: Pi-Compatible Harness Boundary — Approved

The landed shape is exactly the rule the plugin-development skill encodes: a generic Pi-compatible harness contract in core adapters; Kenneth's GA Pi as a machine-local *configured instance* (persisted settings, env overrides winning); invalid commands (Codex binary, packaged `Exo.app` executable) rejected as Pi commands; the inference backend surfaced as explicit dependency/setup state rather than implied launchability.

The `process.execPath` bug behind EXO-ISSUE-077 — packaged Exo presenting itself as the Pi command — is precisely the failure class the "configured instance, not source default" rule exists to catch. Good catch, correct fix (resolve a real Node runtime, pass the CLI entrypoint as an argument).

**Standing watch item:** detection and launch hardening must keep accreting *inside the adapter*. The moment a `kind === "pi"` branch appears in terminal core, shared UI, or CLI/MCP validation outside the harness registry, that change is wrong regardless of tests. (Same rule that EXO-ISSUE-065 is slowly retiring for Codex.)

---

## 2. Ruling: EXO-ISSUE-078 — Cross-Boundary; Diagnose in the Terminal Read Path, Resolve (Probably) in the Trace Contract

The symptom: a live GA Pi session completes generation against the backend, but `exo agents read <id> --tail 120 --raw` surfaces only the model/status line — never the answer text — while a direct non-interactive GA-Pi CLI run returns `OK`.

### 2.1 Classification

Two layers, and naming them precisely matters for who works on what:

- **The diagnostic is terminal-read work** (bounded, this wave): find which layer loses the text.
- **The durable resolution is almost certainly harness-adapter/trace work**, because there is a real possibility that *no* capture fix can exist: TUI frameworks that manage their own viewport (scrolling answer text inside a widget region, repainting in place) can complete a generation without the answer ever being written into pane scrollback/history. If the bytes never enter the pane's history, then tmux capture, transcripts, and read tails are all correctly reporting what the screen contained — and "what did the agent say" is simply not a screen question. It is a semantic question whose correct API is the trace contract. EXO-ISSUE-078 is the field evidence for why WP-P4 was specced with a mandatory real consumer.

### 2.2 Diagnostic protocol (for the WP-078 agent — follow literally)

Reproduce with a **deterministic fake Pi-style TUI fixture** first; live GA Pi only to confirm at the end. Fixture spec: a script that (a) prints a persistent status line, (b) on receiving a line of input, renders an answer *by repainting a fixed screen region* (cursor-up + erase-line + rewrite, Ink-style — not by appending lines), then (c) restores the status line. This mimics the suspected viewport-widget behavior without inference.

Then binary-search the loss layer, in this order, recording evidence at each step:

1. **tmux pane layer:** while the answer is visible on screen, run `tmux capture-pane -p -t <pane>` directly (and `-S -200` for history). Is the answer text in the visible capture? In history after the TUI repaints past it?
2. **Transcript layer:** does `.exo/terminal-transcripts/<session>.ansi.log` contain the answer bytes (raw, pre-render)? Note: for repaint-style TUIs the transcript *should* contain the bytes (they were emitted) even if the final screen no longer shows them — if the transcript has them but reads don't, the bug is in read/tail selection or ANSI-to-text flattening.
3. **Read-path layer:** compare `exo agents read --tail N --raw` output against both captures. Check whether the live-tail policy is preferring a bounded capture of the *final* screen (status line only) over transcript content that includes the transient answer.

Outcome decision tree:

- Answer present in transcript but absent from reads → terminal-read/tail-policy fix; scope it narrowly, no Pi-specific behavior.
- Answer present in visible capture but lost after repaint, absent from history → confirms viewport-widget behavior → **no capture fix**; resolution is the Pi adapter declaring a semantic trace source (WP-P4 family), plus a documented limitation for screen reads of TUI harnesses.
- Answer never reaches the pane at all (alt buffer, secondary fd) → harness adapter launch-plan question; escalate with evidence before changing anything.

**Escalation rule:** any fix that would add new capture behavior, buffering, or TUI-special-casing to terminal core is an escalation, not an edit.

### 2.3 Skill addition (ride with WP-D)

Add to terminal-stability read-path guidance: "Screen reads (`capture-pane`, read tails) report what the terminal *displayed*, not what the agent *said*. For TUI harnesses these can differ permanently. Semantic agent output belongs to the trace contract; do not bend capture paths to recover it."

---

## 3. Rulings: The Four Standing Deviations

### 3.1 Closed capability kinds, no alias shim — accepted pre-public, two binding conditions

**Shim removal: accepted outright.** My shim recommendation was migration ergonomics for existing manifests; the manifest population is in-repo plus Kenneth's machines, and a hard migration during active pre-public development is cleaner. This was never an architecture question.

**Closed union: accepted conditionally.** The architectural requirement was never "open template-literal strings today." It is: **opening the kind space later must be an additive change, not a migration.** The namespaced id format (`core:*`, `exo.graph:*`, `exo.training:*`) already secures the wire format, which is the part that would have been expensive to change later. What remains at risk is behavior, hence:

**Condition 1 — unknown kinds must degrade, not reject (WP-C2).** Verified defect: `validateCapabilityMetadata` throws on an unrecognized kind, so a manifest containing *one* novel capability — from a future Exo version or a third party — becomes entirely unparseable: not listed, not inspectable, sibling capabilities lost. Required behavior: an unknown kind parses to a capability with `status: "unsupported-kind"` (inert, never activatable, no id reservation), the plugin remains discoverable and inspectable, and sibling capabilities are unaffected. Plugin Manager shows the unsupported row with the kind string and "not supported by this Exo version." This preserves everything the closed union buys (no accidental activation surface) while removing the forward-compat cliff.

**Condition 2 — tripwire, not just documentation (WP-C2, same PR).** Add to the plugin-development skill: "The closed `CapabilityKind` union is an intentional pre-public simplification. It **must be re-reviewed before**: (a) any external/community plugin support, (b) WP-P8 executable plugin work, or (c) any second in-tree consumer of a non-`core:*` kind. Do not extend the union for a new project-specific kind without that review." Documented deviations fossilize silently; tripwires fire.

### 3.2 gray-matter frontmatter fidelity — real defect; blocks real-vault use; fix in place (WP-C1)

This is the one deviation I will not soften. The review surface's entire trust story is: **the diff the human approves is byte-for-byte the change that lands.** `matter(existing)` + `matter.stringify(content, data)` re-serializes the *whole* frontmatter block on every `frontmatterPatch`: comments dropped, quoting styles normalized, key formatting rewritten, values coerced through a JS-object round-trip (dates are a classic casualty). An accepted one-key patch can silently rewrite ten lines the reviewer never saw in the preview. For a decade-horizon, hand-maintained vault, that is the unforgivable failure mode — worse than no write path, because it *looks* reviewed.

Ruling: **not a rollback** — the substrate (types, store, review flow, UI) is sound and stays. P3 remains `partial`. WP-C1 corrects the apply host in place, and until it lands the following are **blocked**: proposal apply against the real vault, profile-apply continuation, project-knowledge-sync implementation, and any plugin-UI/onboarding work that stages or applies proposals. (Fixture-workspace testing remains fine.)

**WP-C1 implementation guidance:**

- Replace gray-matter *at the apply site only* with the `yaml` package's Document API (`parseDocument` / `doc.setIn` / `doc.deleteIn` / stringify with preserved CST where possible). Read paths elsewhere may keep gray-matter — fidelity matters where bytes are written.
- Frontmatter block handling is Exo's, not the YAML lib's: split the leading `---\n...\n---\n` block by byte offsets; apply ops to the YAML document; splice the re-serialized block back; **never touch body bytes** on a frontmatter-only patch.
- Op mapping: `set` → `setIn(pathFromDottedKey, value)`; `remove` → `deleteIn`; `appendToList` → get node, assert/create YAML sequence, push. Dotted-key path semantics must match what the proposal preview renders.
- Edge cases with required tests: file with no frontmatter + `set` (create a minimal block; body untouched); empty frontmatter block; comments above/beside untouched keys survive byte-exact; quoting style of untouched values unchanged; date-like values not coerced; duplicate keys → item fails with a clear stale-style reason (do not guess); CRLF files round-trip.
- **The invariant test (the one I will review):** golden fixtures with commented, oddly-ordered, hand-formatted frontmatter; for each accepted item, assert (a) bytes outside the edited key's lines are identical to input, and (b) the applied result equals what the review preview rendered. If (b) can't be asserted directly, derive both from one function — the preview and the apply must share the serialization path so they cannot diverge.

### 3.3 `filePatch` vs `bodyEdit` — accepted; freeze naming now

`filePatch` is the better name: it correctly covers non-Markdown targets, where my `bodyEdit` implied a Markdown-body scope it didn't need. Ruling: keep `filePatch`; I'll use it when proposal docs are promoted to `docs/`. These types are about to be public CLI/MCP contract — **naming freezes now**; further renames require a schema-version bump, so don't.

### 3.4 Semantic trace — not landed; keep P4 open; 078 is the motivating consumer

What exists: a good schema (`exo.semantic-trace.v1`, sensible event kinds, actor/refs model) and the `HarnessSemanticTraceContract` field on the harness contract. What does not exist: any builtin declaring it, any capture, any store write, any reader. That is precisely the "abstract trace plumbing" the preflight spec forbade — schema without a consumer is untested design. Ruling: P4 stays open; WP-P4a (below) lands the first consumer with the fake fixture, per preflight §8 unchanged. The 078 outcome will likely make the Pi adapter the second declaring harness (after fake, alongside/before Claude) — let the diagnostic decide.

One guard while it's open: nothing else may take a dependency on `semantic-trace.ts` types (no UI, no exporters) until the fixture round-trips them — the fixture is what validates the schema.

---

## 4. Ruling: Transport Question Closed — Control Mode Is the Architecture

The spike met the kill thresholds cleanly and the evidence is good quality (real commands, real numbers, named failure shapes):

- **Scrollback:** the direct buffer probe lost useful xterm scrollback under pty attach, while control mode preserved all 220 generated markers **exactly once** through resize and reconnect. Note what that second clause is: independent validation that the V4.1 geometry-convergence work actually works — the strongest single data point in the report.
- **Latency:** parity (p50 25.3ms control vs 26.7ms pty) — nothing to buy with a transport switch.
- **Cost:** node-pty native build approval, Electron ABI rebuild, and bundler externalization friction, exactly as predicted.
- **Bonus:** pty attach *failed* the fake-Claude render-stability e2e that control mode passes 5/5. It wasn't even a correctness win.

**Decision, final: tmux control mode + geometry convergence loop is Exo's terminal architecture.** Plain attach is dead as a product path; the spike branch remains reference-only.

Required closure (WP-D — verified outstanding): `docs/terminal-runtime-decision.md` has no record of any of this. It must gain: the decision + date, a link to the spike report, the kill-threshold summary, and — critical for future agents — the explicit distinction between *direct pty to the harness process* (banned before, banned still) and *pty as a tmux attach transport* (a different thing; evaluated properly; killed on evidence). That conflation caused a month of ambiguity; retire it in writing.

The two-week field-watch (EXO-ISSUE-069/075 observation) stands as the confirmation period. After it passes clean: archive the fable docs to `docs/reviews/2026-07-fable/` per preflight §10 and promote surviving durable content into `docs/`.

---

## 5. Ruling: Ready for Wave 2 — With Corrections Woven In

Nothing rolls back. One gap the status report missed: **WP-T6 never landed.** Verified in `terminal-tmux.ts:210-231`: input is still one synchronous `execFileSync tmux send-keys` per keystroke chunk on the Electron main thread, and a transient failure still detaches the whole bridge. That is the remaining known latency/robustness debt from the original plan; the spike's latency probe conveniently established the baseline to beat (p50 ~25ms).

### 5.1 Wave-2 work packages

```markdown
1. WP-C1: Proposal apply fidelity (frontmatter byte-faithfulness)
   - Goal: §3.2 guidance; yaml Document API at the apply site; preview and apply
     share one serialization path.
   - Files: packages/core/src/proposal-apply-host.ts, proposal preview renderer,
     new golden fixtures.
   - Acceptance: byte-identity invariant test green on commented/odd-order/
     hand-formatted fixtures; untouched lines never change; dates/quoting preserved.
   - Tests: golden-file suite per §3.2 edge-case list.
   - Tier: mid. Parallel: with everything (core proposals files only).
   - Escalate: any case where fidelity is impossible (duplicate keys, exotic YAML) —
     define failure, don't guess.

2. WP-C2: Unknown capability kind degradation + skill tripwire
   - Goal: unknown kind → inert `unsupported-kind` capability status; plugin and
     sibling capabilities stay discoverable/inspectable; tripwire rule in
     plugin-development skill.
   - Files: packages/core/src/plugin.ts (validate/parse), capability-registry
     status handling, Plugin Manager row copy, skill file.
   - Acceptance: future-kind fixture manifest lists with one unsupported row and
     N-1 working capabilities; nothing activatable from the unsupported row.
   - Tests: parse/registry unit tests + fixture manifest.
   - Tier: lighter. Parallel: fully.

3. WP-078: Pi answer-visibility diagnostic (report-first)
   - Goal: execute §2.2 protocol with the fake Pi-style TUI fixture; identify the
     loss layer; recommend resolution path per the decision tree.
   - Files: new test fixture + diagnostic report; NO product code without escalation.
   - Acceptance: report states the loss layer with command-level evidence and the
     decision-tree outcome; EXO-ISSUE-078 updated.
   - Tests: the fixture itself (deterministic, no inference).
   - Tier: lighter. Parallel: fully.
   - Escalate: any fix requiring new capture/buffering/TUI-special-casing in core.

4. WP-P4a: Trace store + fake-harness capture + `exo traces read`
   - Goal: first trace consumer per preflight §8: NDJSON store under .exo/traces/
     with retention; launch-plan capture wiring for a `sidecar-jsonl`/`stdout-jsonl`
     source; deterministic fake harness emitting stream-json-shaped events; bounded
     CLI reader rendering turns/tool-calls; activity artifact reference.
   - Files: packages/core/src/semantic-trace*.ts consumers, trace store (new),
     agent-harness declaration on the fake harness, packages/cli, launch-plan seam
     (coordinate: avoid terminal-manager.ts edits this wave; if unavoidable, escalate).
   - Acceptance: fake session produces a well-formed .ndjson linked from session
     metadata; `exo traces read <sessionId>` renders it; schema round-trips.
   - Tests: per-event-kind mapping units; fixture e2e; retention.
   - Tier: stronger/mid. Parallel: yes, with the terminal-manager caveat above.

5. WP-T6: Input via control-client stdin + failure discipline
   - Goal: proposal §1.4 / preflight §4 unchanged: send-keys as control-mode stdin
     commands with hex literals; zero process spawns on the keystroke path;
     retry-then-degrade replaces detachAfterWriteFailure's bridge kill; input
     latency recorded in diagnostics vs the spike baseline (p50 ~25ms).
   - Files: apps/desktop/src/main/terminal-tmux.ts (only file this wave that
     touches it), terminal-health wiring for the degraded-input state.
   - Acceptance: keystroke path spawn-free (test double asserts); injected write
     failure degrades health while output stream continues; latency ≤ baseline.
   - Tests: command framing/hex encoding units; paste path unchanged; failure
     injection; latency probe.
   - Tier: mid. Parallel: yes (file-exclusive owner).
   - Mandatory comment: retry-then-degrade rationale (a keystroke must never take
     down a healthy output stream).

6. WP-D: Decision and docs closure
   - Goal: terminal-runtime-decision.md decision record per §4; ledger sync;
     V4 doc cross-reference check; terminal-stability skill gains the §2.3
     screen-reads-are-not-semantic-output note; plugin-development skill gains the
     §3.1 tripwire if not already landed via WP-C2.
   - Files: docs/terminal-runtime-decision.md, ledger.md, skills.
   - Acceptance: a future agent reading terminal-runtime-decision.md alone gets the
     decision, the evidence pointer, and the pty-distinction without ambiguity.
   - Tier: lighter. Parallel: fully.
```

### 5.2 Blocking rules and sequencing

- All six packages are file-disjoint (T6 is the sole `terminal-tmux.ts` owner; nothing touches `terminal-manager.ts` this wave) → **full parallel fan-out is safe**.
- Blocked behind WP-C1: profile-apply continuation, onboarding-apply, real-vault proposal use, project-knowledge-sync *implementation*, further plugin-UI work that stages/applies proposals.
- May start anytime: project-knowledge-sync *design* (as a proposal-emitting plugin — design doc only).
- Blocked behind WP-P4a: Claude/Codex/Pi trace adapter capture (needs the proven declaration shape); any consumer of `semantic-trace.ts` types.
- Blocked behind WP-078 report: any 078 fix work.

### 5.3 Fable touchpoints for this wave

1. **WP-C1 golden tests before merge** — the byte-identity invariant and the shared preview/apply serialization path are what I will check.
2. **WP-078 loss-layer report** — I'll rule on the resolution path from the decision tree.
3. **WP-P4a event mapping** — before any real harness adapter is cut against it.
4. Anything hitting an escalation condition, as always.

### 5.4 Risks I'm watching (no action required, awareness only)

- **Field-watch is the real gate.** `terminal:check` green is necessary, not sufficient; the two-week daily-use window on the installed app is what actually closes EXO-ISSUE-075's class. New corruption shape → fixture first, per protocol.
- **Schema-before-consumer drift.** The trace schema was written without a consumer; expect WP-P4a to force small revisions. That's healthy — revise the schema, don't contort the fixture.
- **Deviation accounting.** Codex self-reported its spec deviations accurately and flagged them for review — that loop worked and is worth preserving as the norm. The one thing it missed (T6 outstanding) argues for keeping a simple "planned vs landed" checklist against the original work-package list in future status entries.

-- Fable | 2026-07-03
