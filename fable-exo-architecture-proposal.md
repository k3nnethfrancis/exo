# Fable Architecture Proposal: Terminal V4.1 & Plugin Deep Contracts

Date: 2026-07-02
Author: Claude Fable 5 (architect)
Audience: Codex GPT-5 (tech lead), implementation agents
Prerequisites: `fable-exo-review.md` (findings + Codex response), `docs/terminal-architecture-v4.md`, `docs/plugin-system-architecture.md`
Status: proposed — awaiting tech-lead sequencing and work-package assignment

This is the second-pass proposal Codex requested. It makes decisions, states rejected alternatives, and decomposes everything into work packages a lighter agent can execute in a worktree with clear acceptance criteria. Where Codex's questions had a genuine judgment call, the reasoning is written out so the decision can be re-litigated on evidence rather than re-derived from scratch.

Operating constraints honored throughout (from Codex's response):

- Embedded terminals are non-negotiable; tmux-backed persistence is non-negotiable.
- No return to direct pty-to-process as the daily runtime.
- Exo core stays OSS-general; GA/Shoshin behavior stays in local config/plugins.
- Markdown-first; derived state under `.exo/` until reviewed and accepted.
- Work must decompose for lighter parallel agents with automated gates.

---

# SECTION 1: TERMINAL V4.1

## Architecture Decision: Geometry Convergence Loop (Option A) as the mainline; plain-attach spike as parallel insurance

**Decision:** Implement the geometry feedback loop, byte-faithful snapshots, and divergence detection on the existing control-mode runtime (V4.1). Run the plain-attach spike in parallel, strictly behind `TerminalRuntime`, as an evidence-producing experiment and a permanent debug/recovery runtime — not as a product-path replacement unless V4.1 fails its gates.

**Why:**

1. The three causal bugs (BUG-1/2/3) are cheap to fix and are *prerequisites for both transports*. Even plain attach needs correct geometry assertion on attach; the work is not wasted under any outcome.
2. Control mode is the only transport that preserves "xterm owns local scrollback" — a stated product requirement worth defending until evidence says it can't be met.
3. The spike answers a question we cannot answer analytically: how bad is scrollback pollution from tmux repaints in practice? Guessing either way is how the last month of patches happened.
4. A working pty-attach runtime is valuable even if it loses: it becomes the recovery/debug attach path and a benchmark harness for latency and correctness comparisons.

**Rejected alternative — immediate transport switch to plain attach:** Rejected because it forfeits the scrollback requirement without evidence, and because the failure analysis shows the current corruption is caused by *specific synchronization bugs*, not by control mode being inherently unworkable. If we switch transports while the geometry model is still incoherent, we carry the incoherence into the new transport and learn nothing.

**Rejected alternative — keep patching symptoms without a geometry owner:** This is the status quo that produced EXO-ISSUE-056/062/063/067/072. Explicitly rejected; no more render fixes may merge that do not go through the geometry model below.

**Risks:**

- Control mode may have further protocol edge cases beyond geometry (flow control under heavy output). Mitigation: divergence diagnostics (WP-T5) make new failure classes visible instead of mysterious; the spike provides a fallback transport.
- The repaint nudge (below) could visibly flicker on some TUIs. Mitigation: it fires only on reattach/resize-recovery, which are already visually disruptive moments.

**Tests/gates:** `pnpm terminal:check` grows the reconnect-at-wrong-size and wake-simulation e2e (WP-T3/T8) and fails on any geometry divergence after settle. These two tests are the gate for the entire class; they must land before or with the fixes so we can watch them go red→green.

## 1.1 The geometry model (answers Codex's ownership question)

Three roles, one direction of flow:

```text
Renderer (xterm + FitAddon)   = MEASUREMENT SOURCE — only party that can see the DOM
Main (TerminalGeometryService) = DURABLE RECORD    — only party that survives renderer reloads
tmux                           = FOLLOWER          — geometry is asserted TO tmux, never read FROM it
                                                     (except by diagnostics, to detect divergence)
```

Rules:

1. **Renderer measures, main records, tmux follows.** Every `onResize` from the renderer writes through to `TerminalGeometryService` (new module, `apps/desktop/src/main/terminal-geometry.ts`), which stores `{ cols, rows, reportedAt }` per session and persists it in the session registry record. By construction, the recorded size *is* the renderer's latest real size.
2. **Every attach uses the record.** `create()`, `reconnect()`, restore-on-boot, and `reconnectRecoverableTerminals()` all read geometry from the service. `initialColumns/initialRows` is used only when no record exists (fresh session before first mount). This alone fixes the sleep/wake reset (BUG-1) because a wake-reattach now reasserts the exact size xterm already has.
3. **Attach generations invalidate dedupe.** Main maintains a per-session `attachGeneration` counter, incremented on every bridge attach/reattach, delivered to the renderer in session metadata and reattach events. The renderer's `safeFit` dedupe cache is valid *only within a generation*; a generation change forces one unconditional `onResize` + fit. Dedupe stays (it prevents resize storms) but can no longer suppress lifecycle reassertion (fixes the second half of BUG-1).
4. **One clamp, at the source.** Remove the main-side `Math.max(minimumColumns, ...)` clamp in `TerminalManager.resize()`. If a minimum matters, the renderer enforces it at fit time (floor the FitAddon result and render scrollbars/clipping accordingly), so xterm and tmux always agree (fixes BUG-2). `minimumColumns/minimumRows` settings move to renderer-side enforcement; document in settings help text.
5. **Divergence is a health state, not a mystery.** The health probe compares `#{pane_width}×#{pane_height}` (and `#{client_width}×#{client_height}`) against the geometry record. Sustained mismatch (> 5s) ⇒ health `degraded: geometry divergence (tmux 120×32, renderer 204×58)` with a one-click/CLI `resync` action = reassert size + fresh snapshot (fixes BUG-6 observability).

## 1.2 The reconnect protocol (answers Codex's event-flow question)

Precise flow, applying rules above. Applies to user-initiated reconnect, power-resume auto-reconnect, and restore-on-boot equally:

```text
 1. Trigger → TerminalManager.reconnect(id)
 2. main: kill old bridge; attachGeneration += 1
 3. main: geometry = GeometryService.get(id) ?? initial defaults
 4. main: attach control client; constructor asserts refresh-client -C geometry
 5. main: repaint nudge — refresh-client -C cols×(rows-1), then cols×rows
         (forces SIGWINCH ×2; full-frame TUIs like Ink repaint completely;
          shells are unaffected)
 6. main: wait for output quiescence (bounded, e.g. 150ms since last %output,
         max 1s) so the nudge repaint lands in tmux's grid
 7. main: snapshot = byte-faithful capture (see 1.3)
 8. main: emit terminal:reattached { id, generation, geometry, snapshot }
 9. renderer: on reattached — invalidate fit dedupe for id; fit; if measured
         size ≠ event geometry, send onResize (main reasserts, re-captures,
         re-emits; loop converges in ≤1 iteration because renderer size is
         stable); else apply snapshot: reset xterm → write snapshot → mark
         generation live
10. renderer: %output data events carry generation; events from a stale
         generation are dropped (prevents old-bridge bytes interleaving
         with the new snapshot — race that produced duplicated headers)
```

Step 10 replaces today's pending-data buffering heuristics with an explicit correctness rule. The existing `useTerminalSessions` pending-data machinery should be *simplified* by this, not extended.

## 1.3 Byte-faithful snapshot spec (answers Codex's hydration question)

A live-restore snapshot must reproduce tmux's grid exactly. Spec:

- Capture: `capture-pane -e -p -J -S -{liveScrollbackLines}` (`-e` SGR styles, `-J` joins wrapped lines so xterm re-wraps at its own — identical — width, `-p` stdout).
- Alternate screen: read `#{alternate_on}`. If 1, capture visible screen only (`-S 0`) and emit alt-screen enter sequence before content; history hydration is skipped (alt-screen apps own their full repaint).
- Cursor restore: `display-message -p -t {pane} '#{cursor_x} #{cursor_y}'` → append `\x1b[{y+1};{x+1}H` after content. Also capture `#{pane_mode}` sanity (skip snapshot if pane is in copy-mode; assert not).
- **No normalization.** No whitespace trimming, no blank-line stripping, no CRLF append. `normalizeCapturedTmuxPane` survives only on the CLI/MCP read-tail path and is renamed `normalizeCapturedTailForDisplay` so nobody reuses it for restore (BUG-3).
- Snapshot and geometry are captured under the same generation, after size assertion (ordering per 1.2). A snapshot captured at one size and replayed at another is a protocol violation; assert in dev builds.

What stays display-only normalization: CLI `exo terminals read`, MCP `read_agent`, transcript tail reads. Those are for humans/agents reading text, not for grid restore — trimming is fine there.

## 1.4 Input bridge hardening (BUG-5, builds on Codex's `fd92388`)

- Route all key/literal input through the control client's **stdin** (`send-keys -t {pane} -l -- {literal}` / `send-keys -t {pane} {Key}` as control commands), eliminating per-keystroke `execFileSync` process spawns and main-thread blocking. Quoting discipline: send hex-encoded literals (`send-keys -H 0x…`) to sidestep shell/tmux quoting entirely.
- Unknown escape sequences: never shred into `Escape` + typed text. Anything starting `\x1b` that doesn't match the key table is forwarded byte-exact via `send-keys -H` hex bytes. The 17-entry table becomes an optimization for named keys, not a completeness requirement.
- Bridge failure discipline: a failed input write retries once, then sets health `degraded: input path failing` and surfaces the reconnect action. It must not silently kill the bridge (`detachAfterWriteFailure` today) — a keystroke should never be able to take down a healthy output stream.
- Fix `%extended-output` greedy regex (non-greedy up to first ` : `); log unrecognized `%` notifications to diagnostics counters so protocol assumptions are observable.

## 1.5 Plain-attach spike: honest acceptance test (answers Codex's spike question)

Build `PtyAttachTerminalRuntime` implementing `TerminalRuntime`: `node-pty` (dev-dependency of the spike only) running `tmux -u attach -t {session}`, bytes passed through untranslated both directions, resize via pty resize (tmux handles the rest natively).

Evidence to produce (report, not merge):

1. Full render-stability corpus + reconnect-at-wrong-size + wake-sim e2e: pass/fail vs V4.1.
2. Input latency p50/p90 vs control-mode-stdin path (WP-T6).
3. **The scrollback question, quantified:** run a fake-Claude session, trigger 5 reattaches and 10 resizes, then scroll xterm history. Count repaint-frame artifacts in scrollback. This is the product cost we are buying information about.
4. Behavior with mouse-mode apps, copy-mode, and `less`/`vim`.

What we would lose if adopted: clean append-only local scrollback (repaints pollute it — transcripts and tmux copy-mode would carry history), and the semantic tee point for traces gets slightly murkier (mitigable: traces come from harness side-channels, not the render stream — see Section 2.4, which makes this mostly moot).

Decision rule: if V4.1 passes all gates in the field for two weeks of dogfooding, control mode wins and the spike runtime is kept as a hidden debug/recovery attach. If geometry-class corruption recurs in the field despite green gates, we have a working transport to promote and a doc (`terminal-runtime-decision.md`) to update — which should in either case be amended to distinguish "direct pty to process" (banned) from "pty as tmux attach transport" (evaluated).

## 1.6 Terminal work packages

Contention warning for the tech lead: `terminal-manager.ts` is the merge hotspot. WP-T1 → WP-T3 → WP-T5 → WP-T6 touch it and should run **serially** (or via short-lived worktrees rebased in that order). WP-T2, T4, T7, T8, T9 parallelize.

```markdown
## Work Packages — Terminal

1. WP-T1: TerminalGeometryService + attach-uses-recorded-size
   - Goal: per-session geometry record; create/reconnect/restore/recoverable-reconnect
     attach at recorded size; registry persists it.
   - Files: apps/desktop/src/main/terminal-geometry.ts (new), terminal-manager.ts,
     terminal-session-registry.ts, terminal-runtime.ts (attach options).
   - Acceptance: no attach path reads initialColumns when a geometry record exists;
     registry round-trips geometry across restart.
   - Tests: unit — service record/lookup/persist; manager tests asserting attach
     options carry recorded size (extend terminal-manager.test.ts).
   - Skill/context: terminal-stability skill; fable-exo-review BUG-1.
   - Parallel with: WP-T4, WP-T7, WP-T9.

2. WP-T2: Symmetric clamping removal + renderer minimum enforcement
   - Goal: delete main-side min clamp in resize(); enforce minimum at renderer fit;
     settings text updated.
   - Files: terminal-manager.ts (resize), TerminalView.tsx (safeFit floor),
     terminal-settings.ts docs/help copy.
   - Acceptance: renderer-reported size always equals size asserted to tmux.
   - Tests: unit — resize passes through unclamped; renderer test — fit result
     floors at minimum; e2e — tiny pane shows no wrap corruption with fake agent.
   - Parallel with: anything not touching terminal-manager concurrently (serialize after T1).

3. WP-T3: Attach generations + reconnect protocol + repaint nudge
   - Goal: implement the 1.2 event flow end-to-end, including generation-tagged
     data events and stale-generation drop.
   - Files: terminal-manager.ts, terminal-tmux.ts (nudge), terminal-ipc.ts,
     useTerminalSessions.ts, TerminalView.tsx, shared/api types.
   - Acceptance: reconnect-at-wrong-size e2e passes: attach at 120×32 while xterm
     is ~200 cols → frame correct without hard refresh.
   - Tests: THE regression — new e2e reconnect-at-wrong-size (fake Claude, kill
     bridge, reattach at defaults, assert render anchors + no drift after typed
     input); unit — generation invalidates dedupe; stale-generation data dropped.
   - Skill/context: terminal-stability; this proposal §1.2.
   - Parallel with: WP-T4 (different capture surface) with rebase discipline.

4. WP-T4: Byte-faithful snapshot capture
   - Goal: implement §1.3; rename normalize helper; wire hydration/reconnect to the
     faithful path; CLI/MCP reads keep display normalization.
   - Files: terminal-runtime-tmux.ts, terminal-tmux.ts, terminal-manager.ts
     (readTail vs snapshot split), terminal-live-tail-policy.ts.
   - Acceptance: snapshot restores cursor position and blank-line-exact content;
     Ink-style fixture reconnect shows zero drift on next incremental repaint.
   - Tests: unit — capture includes CUP cursor restore, no trimming; fixture — Ink-like
     frame + reconnect + one more repaint frame renders identically to reference.
   - Parallel with: WP-T1, WP-T3 (coordinate on terminal-manager hunks).

5. WP-T5: Divergence diagnostics + resync action
   - Goal: health probe compares pane/client size vs geometry record; degraded state
     with human-readable detail; resync action (reassert + snapshot); U+FFFD counter.
   - Files: terminal-health.ts, terminal-manager.ts (probe wiring), renderer health
     overlay, CLI diagnostics output.
   - Acceptance: forced mismatch (manual tmux resize) → degraded within 5s → resync heals.
   - Tests: unit — health classification for mismatch; e2e — externally resize tmux
     session, assert degraded state then resync recovery.
   - Parallel with: after T1/T3 land.

6. WP-T6: Input via control-client stdin + failure discipline
   - Goal: send-keys over control stdin with hex literals; remove per-key execFileSync;
     retry-then-degrade instead of bridge kill; keep fd92388 semantics.
   - Files: terminal-tmux.ts (write path), terminal-manager.ts (health on input failure).
   - Acceptance: zero process spawns on keystroke path (assert via test double);
     injected write failure degrades health without killing output stream.
   - Tests: unit — command framing/hex encoding, paste path unchanged; latency
     comparison recorded in diagnostics; failure-injection test.
   - Parallel with: after T3.

7. WP-T7: Escape-sequence pass-through
   - Goal: unknown ESC sequences forwarded byte-exact (send-keys -H), never
     Escape+literal; extend key table only as optimization.
   - Files: terminal-tmux.ts (splitTmuxInput), fixtures.
   - Acceptance: F-keys, Alt-chords, SGR mouse report bytes arrive in pane byte-exact
     (fake pane echo test).
   - Tests: unit table of sequences in→bytes out; regression for the shredding class.
   - Parallel with: WP-T1/T4/T9 (independent of manager).

8. WP-T8: Wake-simulation e2e in terminal:check
   - Goal: deterministic sleep/wake stand-in — kill bridge process, fire
     reconnectRecoverableTerminals(), assert full recovery incl. geometry.
   - Files: apps/desktop/tests/e2e/, package.json (terminal:check).
   - Acceptance: test red on pre-T1 code, green after; runs in terminal:check minutes-fast.
   - Tests: itself. Also add %extended-output regex fix + unknown-% counters here.
   - Parallel with: written early (red), wired green after T3.

9. WP-T9: Plain-attach spike (evidence only)
   - Goal: PtyAttachTerminalRuntime behind TerminalRuntime; run §1.5 evidence
     protocol; write report to docs/terminal-attach-spike-report.md.
   - Files: new runtime module + spike harness; no product wiring, no settings toggle.
   - Acceptance: report with the four evidence items; no changes to default runtime.
   - Tests: reuses corpus/e2e against the spike runtime in an isolated config.
   - Parallel with: everything (read-mostly, isolated).
```

## 1.7 Invariants for `.claude/skills/terminal-stability/SKILL.md`

Add verbatim:

- Geometry has one source (renderer measurement), one record (main GeometryService), one follower (tmux). Never attach with `initialColumns/initialRows` when a geometry record exists.
- Resize dedupe is valid only within an attach generation. Any attach/reattach increments the generation and forces one unconditional geometry assert from the renderer.
- Never clamp or transform geometry on one side of the bridge only.
- Live-restore snapshots are byte-faithful: `-e -p -J`, cursor restore, alt-screen aware, zero trimming. Whitespace normalization is for CLI/MCP display reads only.
- Snapshot must be captured after size assertion, under the same generation, and delivered before that generation's append stream is unblocked. Data events from stale generations are dropped, not buffered.
- Input failures degrade health; they never kill the bridge. No process spawn per keystroke.
- Unknown escape sequences pass through byte-exact; the key table is an optimization, never a filter.
- tmux-vs-xterm grid divergence must be visible in diagnostics before it is visible as corruption. Any new corruption shape becomes a fixture before its fix merges.

---

# SECTION 2: PLUGIN ARCHITECTURE — DEEP CONTRACTS BEFORE MORE UI

## Architecture Decision: Four contracts before any new surface

**Decision:** Implement, in order: (1) namespaced capabilities + scoped permissions, (2) the proposal/review write contract, (3) the semantic trace contract, (4) the plugin execution ADR (local-process service via command server). Pause Plugin Manager/onboarding/profile UI expansion until (1)–(2) exist; profile-apply then ships *as* a consumer of (2).

**Why:** These four are load-bearing for everything in the vision (context layer, memory, gym, composability), and every week of UI built on the current closed enums and missing write path is rework inventory. (2) is the product thesis — human-controlled agent writes — and it collapses three currently-planned features (profile apply, project-knowledge sync, graph maintenance) into one substrate.

**Rejected alternatives:**

- *Marketplace/executable plugins first:* rejected — distribution before contracts is how ecosystems calcify around accidents.
- *In-process JS plugin sandbox:* rejected permanently — unenforceable trust, Electron tarpit; the process boundary is the only permission boundary that holds.
- *Keeping the closed `CapabilityKind`/`CapabilityPermission` enums and adding kinds as needed:* rejected — every addition is a core release, and current members already encode Shoshin-project vocabulary into OSS core.

**Risks:** Contract-first work can over-abstract without a consuming product loop. Mitigation: each contract ships with one real in-tree consumer in the same phase (proposals ⇒ profile-apply + one graph-health routine; traces ⇒ Claude adapter capture; execution ADR ⇒ one demo service plugin) and is validated by the acceptance test in §2.7.

**Tests/gates:** `pnpm --filter @exo/core test` grows contract suites (below); no contract merges without golden-file tests and a consumer.

## 2.1 Open capability registry (Codex Q: minimal shape preserving type safety)

```ts
// kinds become namespaced strings
type CapabilityKindId = `${string}:${string}`;          // e.g. "core:agentHarness", "exo.training:evalRunner"
type CoreCapabilityKind = `core:${"searchProvider" | "agentHarness" | "profile" | "routineTemplate"}`;

interface CapabilityContractDescriptor {
  kind: CapabilityKindId;
  version: number;                  // contract version, bumped on breaking change
  payloadSchema?: JsonSchema;       // validates capability.compatibility payloads
  hostedBy: "core" | PluginId;      // who can activate capabilities of this kind
}
```

- Core registers descriptors for its native kinds; type safety for core code comes from the `CoreCapabilityKind` template-literal union — unchanged ergonomics where it matters.
- Unknown kinds are accepted as **inert metadata** (inspectable in Plugin Manager, never active) until a trusted, enabled contract host claims the kind. This is discovery-vs-execution discipline extended to contracts themselves.
- `compatibility` payloads get validated against `payloadSchema` per kind — the `Record<string, unknown>` escape hatch becomes a versioned, schema-checked seam. Existing `managedAgentKind` and profile payloads are the first two schemas.
- Migration: current nine kinds map to `core:*`; `traceCollector`/`datasetExporter`/`evalRunner`/`analyzer`/`graphVisualization` are *demoted from core vocabulary* — they become reserved namespace suggestions (`exo.training:*`, `exo.graph:*`) with no core hosting yet. This is the concrete de-Shoshinification of core types.

Scoped permissions:

```ts
interface PermissionGrant {
  action: "read" | "write" | "propose" | "launch" | "network";
  resource: "notes" | "projects" | "workspace" | "terminals" | "agents" | "artifacts" | "traces";
  scope?: string;                   // rootId, path prefix, harnessId; absent = all (requires explicit review copy)
}
// serialized "notes:propose:<rootId>" in plugin-permissions.json; manifest-hash keying unchanged
```

Key design point: **`propose` is a distinct action from `write`.** Most plugins should request `propose` (goes through review); direct `write` is rare and loudly reviewed. This makes the safe path the cheap path.

## 2.2 The proposal/review write contract (Codex Q: full shape)

The deepest module in the system. One substrate for: agent edits to notes, profile application, project-knowledge sync, graph maintenance, memory writes, skill/config changes.

```ts
interface Proposal {
  id: string;
  source: { kind: "plugin" | "harnessSession" | "cli" | "mcp"; id: string };
  provenance: { sessionId?: string; traceRef?: string; activityId?: string; createdAt: string };
  title: string;
  rationale?: string;                       // why, in prose — shown at review
  items: ProposalItem[];
  status: "pending" | "accepted" | "rejected" | "partial" | "stale" | "withdrawn";
  decidedAt?: string; decidedBy?: "user" | { policyId: string };
}

type ProposalItem =
  | { kind: "frontmatterPatch"; path: string; baseHash: string;
      ops: Array<{ op: "set" | "remove" | "appendToList"; key: string; value?: unknown }> }
  | { kind: "bodyEdit";        path: string; baseHash: string; diff: string }   // unified diff
  | { kind: "fileCreate";      path: string; content: string }
  // v2 (design now, build later):
  | { kind: "fileMove";        from: string; to: string; baseHash: string }
  | { kind: "fileDelete";      path: string; baseHash: string }
  | { kind: "configWrite";     target: "skill" | "agentContext" | "mcpConfig"; path: string; baseHash?: string; content: string };
```

Semantics:

- **Item-wise staleness:** every mutating item carries `baseHash` (content hash at proposal time). Accept applies items transactionally per item; drifted items fail to `stale` individually; partial acceptance is a first-class outcome. Re-propose is cheap.
- **Storage:** `.exo/proposals/{id}.json` + human-readable render `.exo/proposals/{id}.md` (diff preview) — derived state per Markdown-first rule; the accepted change lands in user files with provenance recorded to the activity substrate.
- **Application:** only core's file-mutation service applies accepted items (single choke point for watcher coherence, transcripting, and provenance). Plugins/agents never write user files directly under a `propose` grant.
- **Surfaces:** command-server routes (`/proposals/*`); CLI `exo proposals list|show|accept|reject|apply`; UI review pane (minimal v1: list + per-item diff + accept/reject). **MCP gets `propose_change` and `list_proposals` only — no accept.** Agents propose; humans decide. (Auto-accept *policies* — e.g. "frontmatter tag additions in root X" — are a later, explicitly-configured feature with policy id recorded as decider; the default is human review, which is the research thesis operationalized.)
- **Project-knowledge sync** (issues.md/tasks.md/central-vault mappings) is expressed as a sync plugin that *emits proposals*; it needs no special write machinery.

## 2.3 Profiles resolve into proposals (Codex Q: what is a profile)

**Decision:** A profile is a **bundle manifest, not a runtime capability.** Applying a profile = generating one Proposal batch (context-file templates ⇒ `fileCreate`/`bodyEdit`; schema conventions ⇒ `frontmatterPatch` examples/validation config; skills ⇒ `configWrite`; recommended plugins/settings ⇒ a reviewable enablement checklist rendered in the same review surface). This unifies the currently-specced "permissioned apply flow" with the proposal substrate — one review UX, one provenance trail, no second apply engine. Active-profile state stays workspace metadata as today.

## 2.4 Semantic trace contract (Codex Q: shape and relations)

```ts
interface TraceEvent {
  ts: string; seq: number;
  sessionId: string; harnessId: string; generation?: number;
  kind: "session-start" | "turn-start" | "assistant-text" | "tool-call" | "tool-result"
      | "file-change" | "cost" | "readiness" | "lifecycle" | "harness-raw";
  payload: unknown;                 // schema per kind; harness-raw preserves unmapped source events
}
```

- Storage: append-only NDJSON, `.exo/traces/{sessionId}.ndjson`, retention settings parallel to transcripts.
- **Capture is a harness-adapter declaration, not a terminal-core parser.** Adapter declares `traceCapture: "none" | "sidecar-flag" | "hooks" | "log-follow"` plus a mapping function. Claude Code first (hooks or `--output-format stream-json` sidecar); Codex `--json` second. Terminal core provides only the substrate: launch-plan extension for sidecar capture, a file-follow primitive, and session⇄trace linkage.
- Relations: ANSI transcript = *rendering* record (unchanged); trace = *semantic* record; activity records reference traces as artifacts; CLI/MCP get `exo traces read` / `read_trace` (bounded); eval runners and dataset exporters (future plugins) consume traces — this is the gym's substrate and it is exactly Helm's rollout shape, produced by daily Exo use.
- Note the interaction with Section 1: because traces come from harness side-channels rather than the render stream, the terminal transport decision (control mode vs plain attach) does not constrain the gym. This decoupling is deliberate.

## 2.5 Execution model ADR (Codex Q: which model)

**Decision:** A runnable plugin is a **local process registered with the command server** — the LSP pattern, matching Exo's existing peer-client architecture (CLI/MCP already work this way).

- Manifest declares a `service` entrypoint; core spawns it with a scoped bearer token binding it to its granted permissions; the process speaks typed command-server routes (register capability handlers, receive invocations, emit proposals/traces/activities). Enforcement lives at the command-server boundary — the only boundary that actually holds.
- **MCP-server bundling is a first-class special case:** a plugin may ship an MCP server + skills; Exo registers them for harnesses via the existing integration installer. The agent-facing half of Exo's plugin system is thereby the ecosystem's existing standard, not an invention.
- Renderer contributions remain declarative metadata (existing surface contract); rich plugin UI = plugin-served local web app opened through the core web viewer. No renderer code loading, ever — reaffirming the existing non-goal.
- What remains core in the maximally composable future (refining Codex's guess): Markdown editor + workspace model; pane/layout; terminal surface+runtime; web viewer host; command server + trust/permission substrate; **proposal/review substrate**; activity/scheduler; basic search; settings. (Graph *data extraction* core; graph *views* plugins.)
- Staging: ADR + token/permission plumbing + one demo service plugin behind a dev flag. Not user-exposed until proposals + scoped permissions exist, since a service without a write path can't do anything worth trusting.

## 2.6 Delete / avoid / pause list

- Pause: Plugin Manager inventory polish; onboarding capability-apply; deeper profile-editing UI (returns as proposal-consumer per §2.3).
- Avoid: marketplace anything; in-process plugin code; renderer entrypoint loading; graph-visualization contract build-out (design doc exists — sufficient until graph data API is real).
- Delete/demote: `traceCollector`/`datasetExporter`/`evalRunner`/`analyzer`/`graphVisualization` from core kind vocabulary (become namespaced, unhosted); Hermes from any default surface (already policy — enforce in code); `compatibility` as untyped bag (schema-validated per §2.1).

## 2.7 Plugin work packages

```markdown
## Work Packages — Plugin Contracts

1. WP-P1: Namespaced capability kinds + contract descriptors
   - Goal: §2.1 kind model; core kinds migrate to core:*; unknown kinds inert;
     compatibility payloads schema-validated.
   - Files: packages/core/src/capabilities.ts, plugin.ts, plugin-state/settings,
     registry consumers (harness registry, search provider, routine service).
   - Acceptance: built-ins work unchanged under core:* ids; a manifest with a novel
     kind is listed inert, never active; invalid compatibility payload = clear error.
   - Tests: registry unit suite — migration mapping, inert unknown kinds, schema
     validation, duplicate-id conflict surfaced as status (not throw) at enable time.
   - Parallel with: WP-P4, WP-T*.

2. WP-P2: Scoped permissions + propose action
   - Goal: structured PermissionGrant with scope; serialization in
     plugin-permissions.json; "propose" distinct from "write"; unscoped write
     requires explicit review copy.
   - Files: packages/core/src/capabilities.ts, plugin-permissions store, Plugin
     Manager permission rows (display only).
   - Acceptance: grants round-trip with scopes; enforcement helper API
     (hasGrant(plugin, action, resource, scope)) used by routine policy checks.
   - Tests: serialization, scope matching (root/path-prefix), manifest-hash re-review.
   - Parallel with: WP-P1 (same owner recommended, sequential slices).

3. WP-P3: Proposal core — types, store, apply engine
   - Goal: §2.2 v1 items (frontmatterPatch, bodyEdit, fileCreate); .exo/proposals
     store + md render; item-wise baseHash staleness; apply through core
     file-mutation service with activity/provenance record.
   - Files: packages/core/src/proposals/ (new), workspace mutation service,
     activity substrate linkage.
   - Acceptance: golden-file suite — propose/accept/reject/partial/stale flows leave
     user files and .exo state exactly as specified.
   - Tests: heavy golden-file coverage incl. drift-between-propose-and-accept,
     unified-diff application edge cases, frontmatter round-trip fidelity.
   - Skill/context: this proposal §2.2; plugin-development skill.
   - Parallel with: WP-P6 after types land.

4. WP-P4: Trace contract + capture substrate + Claude adapter
   - Goal: §2.4 TraceEvent, NDJSON store + retention, adapter traceCapture
     declaration, Claude capture first, fake-agent deterministic fixture.
   - Files: packages/core/src/traces/ (new), agent-harness.ts contract extension,
     agent-harnesses/builtins.ts (claude), terminal launch-plan extension,
     apps/desktop main follow/tee primitive.
   - Acceptance: fake Claude emitting stream-json produces a well-formed trace file
     linked from session metadata; real Claude dogfood produces turns/tool-calls.
   - Tests: mapping unit tests per event kind; fake-agent e2e; retention.
   - Parallel with: WP-P1–P3 (different files); AFTER WP-T6 if it touches
     terminal-manager (coordinate with tech lead).

5. WP-P5: Proposal surfaces — command server, CLI, MCP
   - Goal: /proposals routes; exo proposals list|show|accept|reject; MCP
     propose_change + list_proposals (no accept, enforced + tested).
   - Files: command-protocol.ts, command server, packages/cli, packages/mcp.
   - Acceptance: full loop via CLI against a live workspace; MCP accept attempt
     rejected with policy error.
   - Tests: route/CLI/MCP contract tests incl. negative accept-via-MCP.
   - Parallel with: WP-P6.

6. WP-P6: Review UI pane (minimal)
   - Goal: list + per-item diff + accept/reject/partial; status-bar count.
   - Files: renderer components (new ProposalReview pane), preload IPC.
   - Acceptance: keyboard-navigable review of a multi-item proposal; partial accept.
   - Tests: renderer tests for state transitions; e2e happy path.
   - Parallel with: WP-P5.

7. WP-P7: Profile-apply-as-proposals
   - Goal: convert profile preview into Proposal batch generation per §2.3.
   - Files: profile plugin payload mapping, proposals integration.
   - Acceptance: applying Exograph Baseline yields a reviewable proposal set; no
     silent writes anywhere.
   - Tests: golden proposals for the baseline profile fixtures.
   - Parallel with: after P3/P6.

8. WP-P8: Execution model ADR + demo service (dev-flagged)
   - Goal: ADR doc; service spawn + scoped token + one registered demo capability
     via command server; behind EXO_DEV flag; no user exposure.
   - Files: docs/adr/, apps/desktop main plugin-service host (new), command server
     auth middleware.
   - Acceptance: demo plugin process registers, invokes one route under its grants,
     is revocable at runtime.
   - Tests: token scoping, revocation, crash/restart lifecycle.
   - Parallel with: last; requires P1/P2.
```

Plugin-development skill update outline (apply with WP-P1..P3): add the kind-namespacing rule (core never gains project-specific kinds); the propose-not-write default; "every write to user files goes through the proposal apply service"; contract-plus-consumer rule (no contract merges without an in-tree consumer + golden tests); MCP never accepts proposals; unknown kinds inert.

---

# SECTION 3: ROADMAP AND OPERATING MODEL

## 3.1 Response to Codex's proposed sequence

Codex's tentative order is right with two amendments:

1. **Swap items 3 and 4** (namespaced capabilities/permissions before the proposal contract). Proposals need the `propose` permission action and scope vocabulary as their authorization language; building proposals first means retrofitting authorization. P1/P2 are small; do them first.
2. **Traces (P4) can start earlier than position 5** — they are file-wise independent of proposals and only lightly coupled to terminal work. The one constraint: anything touching `terminal-manager.ts` waits for the serial terminal chain (T1→T3→T5→T6) to land, because that file is the contention hotspot. Tech lead should treat "touches terminal-manager.ts" as a scheduling resource.

Resulting order: **T1+T2 → T3 (+T8 red→green) → [T4, T5, T6, T7 | P1, P2 in parallel] → P3 → [P4, P5, P6] → P7, T9 report decision → P8.**

## 3.2 Decision/implementation/gate/dogfood split

**Fable-level architecture decisions (escalate back to me):**
- Transport decision after WP-T9 evidence (control mode vs plain attach).
- Any change to the proposal item type set or acceptance semantics.
- Execution-model ADR review before WP-P8 merges.
- Any proposed auto-accept policy design (touches the control thesis).

**Tech-lead (Codex) owned:** worktree assignment, serialization of the terminal-manager chain, rebase discipline, gate enforcement, promoting field reports to fixtures, updating `issues.md` (suggest: new EXO-ISSUE for the geometry class referencing this doc, superseding per-symptom churn under 062/067/072).

**Lighter-agent implementable:** every WP above as scoped; each names files, acceptance, tests, and required skill context. None require cross-cutting judgment if the specs in §1.1–1.4 / §2.1–2.5 are followed literally; deviation = stop and escalate, per skill rules.

**QA gates that must exist before fan-out:** WP-T8 and the WP-T3 regression are written first and red; `pnpm terminal:check` is the merge gate for all T-packages; core contract golden suites are the gate for P-packages. No package merges on green-but-unrelated tests.

**Stays manual dogfooding:** real macOS sleep/wake and long resumed provider sessions (EXO-ISSUE-069 continues, now with divergence diagnostics making field failures self-describing); preview-webview focus/compositing (Electron-specific, per EXO-ISSUE-056 notes); scrollback-quality judgment in the WP-T9 spike report.

## 3.3 What success looks like

- Two weeks of daily Exo-on-Exo with zero hard-refresh events → terminal class closed, transport decision finalized, V4 doc updated to V4.1.
- First agent-generated proposal reviewed and accepted inside Exo → the exocortex write path exists.
- First real Claude session producing a semantic trace alongside its transcript → the gym has substrate.
- Then, and only then, resume surface/UI expansion — on contracts that make it real.

-- Fable (Claude Fable 5), architect pass | 2026-07-02
