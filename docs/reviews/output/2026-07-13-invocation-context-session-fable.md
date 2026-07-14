I read the actual implementation before ruling — `agent-invocation.ts` (prompt, `AgentCommand`, record schema), `document-agent-protocol.ts`, and `invocation-runner.ts` (snapshots, review, drift checks, session provenance). The packet is accurate to the code, with one exception noted under WP4. Ruling follows.

## Ruling summary

All four recommendations are approved with conditions: base prompt **A**, response-envelope semantics as proposed, inline review **A** (proxy filesystem explicitly not authorized), continuity **A** with a changed default-visibility requirement. Sequencing: WP1+WP2 together, then WP3, then WP4. Details and the conditions below.

## 1. Base prompt — Option A approved

The current prompt (`formatNoteInvocationPrompt`, `packages/core/src/agent-invocation.ts:261`) gives document path, mention, message, and snapshot, but no Workspace root, no Note Root scope, no wikilink semantics. Option A is right. Conditions:

- **State the write boundary, not just the read affordance.** Tell the Command that note mutation is Note-Root-scoped and edits outside Note Roots won't be observed or reviewable. Today the prompt says "edit other Workspace files only when the request genuinely needs them" without saying what Exo can actually see; that's how you get invisible side effects.
- **Wikilink semantics must cover both forms**: aliased durable links `[[garden/blog/example|Example]]` and legacy bare stems, with the rule "resolve relative to Note Roots, prefer the durable path form when writing new links."
- **Bound the snapshot.** `body` is currently unbounded. Cap it (with an explicit "truncated — read the file from disk" marker) so a huge note doesn't blow the provider's context before the instructions even land. The `(body was not supplied; read from disk)` fallback already exists — reuse that pattern for truncation.
- Keep it provider-neutral prose. No mention of specific tools beyond "your native filesystem tools or the Exo CLI/Search." Option B (generated AGENTS block) is rejected — it duplicates ambient provider instructions and creates a second instruction surface to keep honest.

One vocabulary correction: don't call this a "contract" in user-facing copy. It's a prompt; the actual contracts are the envelope protocol and the observation model. Overloading "contract" here will bite when WP4 touches the real persisted contract.

## 2. Response vs. edit semantics — approved, with a prompt contradiction to fix

Yes: the `<exo-agent-response>` envelope is the durable answer/receipt; everything else is observed diff attribution. This matches what the code already does — the envelope grants nothing (`document-agent-protocol.ts` header comment) and the diff pipeline is attribution-only.

But note the current prompt contradicts itself: it says "Do not return a chat-only answer… write the useful result into the working document," and then the protocol instructions say to put the durable result in the envelope. WP2 should resolve this explicitly: **answer-shaped requests → the envelope *is* the deliverable; edit-shaped requests → the envelope is a receipt describing what changed.** Test both shapes. UI copy: "colored = the Command's answer/receipt; everything else = observed edits pending your review" — one sentence, per deslopify rules.

## 3. Inline review — Option A approved; proxy filesystem denied for this slice

The snapshots and drift protection already exist (`rejectReview` refuses when the file no longer matches `afterSha256`, `invocation-runner.ts:329-352`). Decorating the live editor against the retained before snapshot is the right V1. Conditions:

- **Compute a real diff.** `wholeFileDiff` (`invocation-runner.ts:430`) is a whole-file replace patch — all lines minus, all lines plus. It's fine as a stored artifact but useless for decoration. Diff the before snapshot against the current buffer in the renderer (before/after strings are already exposed via the review payload); don't try to render the stored patch.
- **Define the drift state visibly.** If the buffer no longer matches `afterSha256` (user kept typing), show decorations against *current* content with a "document has changed since this invocation" notice, and disable Reject exactly as the backend already does. Keep should remain available — keeping is just acknowledging.
- **Reject remains whole-invocation restore of `before.md`.** No per-hunk apply in this slice; per-hunk is where the proxy-document pressure will return, and it is not authorized here.
- **Named known gap, not a blocker:** between invocation end and review, the canonical file is already changed — search index, other panes, and git all see the un-reviewed content. Inline review doesn't worsen this, but document it in the review UI copy ("this file is already saved; Reject restores the snapshot") so users aren't surprised. A proxy filesystem to close this gap is a trust/execution boundary change and stays out of scope until the review loop itself proves insufficient.

## 4. Session continuity — Option A approved with three conditions and one code-level finding

Vocabulary is right: invocation UUID = event identity; provider session id = provider conversation identity; the Workspace-local **session head** under `.exo` is derived state, never configuration. Options B and C are correctly rejected.

Conditions:

1. **Default `continue` is approved only with visible provenance.** A continued run carries invisible context from prior invocations — possibly from a different note. Silent continuation violates your own provenance-honesty rule. The invocation record needs something like `resumedFromInvocationId` / `continuity: "resumed" | "fresh" | "resume-failed-fresh"`, and the status surface must show it. If that provenance can't ship in WP4, default flips to `new`.
2. **Resume failure degrades to fresh, visibly.** Providers GC sessions; a stale head must not fail the invocation. Adapter tries resume, falls back to a new session, records `resume-failed-fresh`, and updates the head. Reset clears only the head — already correct in the packet.
3. **Concurrency: fail visibly, don't queue.** The packet offers "serialized or fail visibly" — pick fail-visible for V1. A queue is a new subsystem with its own failure modes; a clear "an invocation with @claude is already continuing this session" error is honest and cheap. Note `observe()` already tracks per-document overlap for attribution; this check is per-Command and separate.
4. **Never cross Workspaces** — enforced structurally by storing the head under the Workspace's `.exo`, agreed.

Code-level finding the packet misses: the existing provenance path keys provider behavior off the *handle string* — `record.command.handle !== "claude"` in `resumeInTerminal` and `applyProviderSessionProvenance`. A handle is user-editable identity; a Command with handle `claude` pointed at any executable gets Claude JSON parsing and resume flags. Today the blast radius is small (bad parse → no provenance), but WP4 builds resume launch on top of it. WP4's normalized Command contract should carry an explicit provider/adapter discriminant (or at minimum key off the built-in default command identity, as `migrateLegacyDefaultClaudeCommand` already does) rather than the handle. This is part of the `AgentCommand` contract change already flagged as protected, so it belongs in the same architect-approved brief.

## Sequencing and ship criteria

- **WP1 + WP2 together, first.** They're one coherent change to the prompt and its documentation; splitting them re-litigates the same file twice. Ship when: unit tests cover referenced-note resolution phrasing, both request shapes, aliased+legacy wikilinks, and snapshot bounding; one dogfood invocation each for an answer-shaped and edit-shaped request in the packaged app.
- **WP3 second.** Independent of WP1/2 (uses existing snapshots). Ship when: decorations render against before snapshot, drift state is exercised (edit after invocation → Reject disabled, notice shown), Reject restores byte-identical `before.md`, raw Markdown mode unaffected, and real-Electron QA per the UI rule — unit tests alone don't count here.
- **WP4 last, and this packet plus the conditions above constitutes the architecture approval it was waiting on** — the contract change brief must include the provider-discriminant fix. Ship when: migration of existing persisted Commands is proven (old records normalize, `hasUnsupportedAgentCommandV1Fields` doesn't reject the new field), continuity provenance visible in UI, resume-failure fallback exercised end-to-end, concurrent-continue rejection tested, reset works, and cross-Workspace isolation has a test.

WP3 and WP1/2 can run in parallel worktrees if you want; WP4 must not start until the contract brief reflecting the discriminant condition is written.
