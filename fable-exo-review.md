# Fable Exo Review: Terminal Architecture & Plugin System

Date: 2026-07-02
Reviewer: Claude Fable 5 (Shoshin session)
Scope: Deep review of (1) the tmux-backed terminal architecture and the recurring Claude Code render corruption, and (2) the plugin architecture foundations against the exocortex vision.

Sources read: `docs/terminal-architecture-v4.md`, `docs/terminal-quality-standard.md`, `docs/plugin-system-architecture.md`, `docs/plugin-architecture-audit.md`, `docs/strategy.md`, `issues.md` (EXO-ISSUE-056/062/063/065/067/068/069/072), `.claude/skills/terminal-stability`, `.claude/skills/plugin-development`, and the code: `terminal-tmux.ts`, `terminal-runtime-tmux.ts`, `terminal-manager.ts`, `TerminalView.tsx`, `useTerminalSessions.ts`, `capabilities.ts`, `plugin.ts`.

---

## Part 1: Terminal — the two-emulator problem

### 1.1 Why "same terminal but tmux" is the wrong mental model

With a plain pty (VS Code, Cursor, every embedded terminal), there is **one** terminal emulator: xterm.js interprets the byte stream and its grid is the only screen state.

With tmux control mode there are **two** emulators: tmux maintains a full screen grid per pane, and xterm.js maintains another, fed by `%output` events. Correct rendering requires the two grids to be **byte-identical at all times** — same width, same height, same wrap points, same cursor position.

Claude Code makes this brutal because it is an Ink app that repaints *incrementally*: erase-line + cursor-up N over its own previous frame. It never clears the screen. If xterm's grid diverges from tmux's grid by even one row or one wrap point, every subsequent repaint lands in the wrong place and the corruption **compounds and never self-heals** — until something forces a full snapshot. This matches the field experience exactly: garbled until hard refresh, then drifts out of whack again.

iTerm2's `tmux -CC` is the only mainstream implementation of this architecture and it took years of protocol work (flow control, `%pause`, layout sync, full state machine). Exo has reimplemented iTerm's hardest feature in a ~260-line bridge. The bridge is competent code solving ~60% of a problem where 99% is the threshold for "feels like a normal terminal."

The existing test corpus (split UTF-8 across `%output` records, renderer chunking, font fallback) covers the byte-decoding layer — which is the part that already works. The failures live in the **geometry-synchronization layer**, which has near-zero coverage.

### 1.2 Concrete divergence bugs found

**BUG-1 (primary): Reconnect resets tmux to default size; the renderer never corrects it.**

- `terminal-manager.ts:371-372` — `reconnect()` attaches with `initialColumns × initialRows` (defaults 120×32), not the live xterm size. Same at create (`:260-261`) and restore (`:905-906`).
- `reconnectRecoverableTerminals()` (`terminal-manager.ts:392`) runs on **every macOS wake**. So every sleep/wake resets the tmux client size to 120×32. tmux resizes the window, Claude repaints at 120 cols into an xterm that is (say) 200 cols wide.
- On the renderer side, `safeFit` (`TerminalView.tsx:387-394`) **dedupes** resize events: `onResize` fires only when rect/cols/rows *changed*. After wake, xterm geometry is unchanged → no resize event is ever sent → tmux stays at 120×32 **permanently**.
- Hard refresh "fixes" it because remounting `TerminalView` zeroes `sizeRef`, the initial measurement fires an unconditional `onResize`, and hydration takes a fresh snapshot. This is the exact mechanism of "looks crazy until I hard refresh, then happens again."
- Root invariant violation: geometry is tracked independently in main and renderer and nothing reconciles them. Size must be re-asserted on every attach, never deduped against renderer-side memory.

**BUG-2: Asymmetric clamping guarantees standing mismatch in small panes.**

- `terminal-manager.ts:438-440` clamps the tmux size to `minimumColumns/minimumRows`; xterm itself is never clamped. A pane below minimum leaves xterm at e.g. 70 cols and tmux at 80 — a permanent width disagreement, which for an Ink app means guaranteed wrap garbage.
- Related: `safeFit` silently skips fitting when the host rect is < 80×60 px, leaving xterm at stale geometry while the container changed.

**BUG-3: The hydration snapshot mutates screen bytes and loses the cursor.**

- `normalizeCapturedTmuxPane` (`terminal-runtime-tmux.ts:243-246`) strips trailing whitespace/blank lines and appends CRLF. After replay, xterm's cursor is on a different row than tmux's pane cursor — Claude's next cursor-up-N repaint is misaligned from the first frame after hydration.
- `capture-pane` is invoked without cursor restore (no `display-message -p '#{cursor_x} #{cursor_y}'` + explicit CUP) and without `-J`, so wrapped lines become hard newlines at capture-time width; replay at a different width breaks layout.
- `mergeHydrationSnapshot` appends pending live data to a whitespace-trimmed capture — the duplicated-header class partially fixed in EXO-ISSUE-072 is a symptom of snapshot/append overlap with no dedup guarantee.
- A hydration snapshot must be a byte-faithful screen restore including cursor position, or it is an inconsistency injector.

**BUG-4: Create-time width race.**

- Sessions are created at 120×32; the harness launches immediately and paints its splash at that width before the renderer's first fit lands. The splash streams into xterm wrapped at the wrong width — the garbled-header class in EXO-ISSUE-062. Window: one fit cycle, but it hits the most visually prominent output of the session.

**BUG-5: The input path is a lossy round-trip.**

- `splitTmuxInput` (`terminal-tmux.ts:373-415`) translates xterm's output bytes into tmux key names via a 17-entry table and maps any bare `ESC` to the `Escape` key. Any escape sequence not in the table — F-keys, Alt-chords (ESC-prefixed), SGR mouse reports, protocol responses that slip past `terminalInputFilters` — is shredded into `Escape` + literal text **typed into the pane**.
- Every keystroke chunk spawns a synchronous `tmux send-keys` process via `execFileSync` on the Electron main thread (`terminal-tmux.ts:181-187`): per-key process spawn latency, main-thread blocking under load, and any transient spawn failure kills the whole bridge (`detachAfterWriteFailure`, `:221`). Note control mode supports issuing `send-keys` over the control client's stdin — no process spawn needed.
- `unwrapBracketedPaste` only matches when the *entire* write is exactly one paste envelope; chunked paste delivery falls through to the key path.
- A pty has none of these problems: bytes in, bytes out, no translation layer.

**BUG-6: No divergence detection.**

- Nothing compares tmux `pane_width/pane_height` against `terminal.cols/rows`. The system's single most important invariant is unmonitored, so violations are invisible until they are visual corruption. Diagnostics expose buffer counts and health states but not the one number that predicts this entire failure class.

**Minor:**

- `%extended-output` regex (`terminal-tmux.ts:338`) uses a greedy `[\s\S]*` before ` : `; payload containing " : " loses its prefix.
- Control-mode notifications (`%pause`, `%layout-change`, `%session-changed`) are unhandled; acceptable today (per-session windows, no pause mode) but undocumented as assumptions.
- Cybernetic framing: two state machines that must stay synchronized, with no feedback channel to detect or correct drift. Every fix so far added feed-forward patches (refresh scheduling, hydration gates, input filters); none added the error-correcting loop. That is why the bug class keeps reopening across EXO-ISSUE-056/062/063/067/072.

### 1.3 Recommendations

Two coherent end-states; the current state is an incoherent middle.

**Option A — keep control mode, close the loop (bounded work, do first regardless):**

1. Single-source geometry. Main stores last-known renderer size per session; **every** attach/reconnect uses it instead of `initialColumns/initialRows`. Renderer re-sends size unconditionally on a `reconnected` event (bypass `safeFit` dedupe).
2. Clamp symmetrically or not at all (fix BUG-2).
3. Byte-faithful hydration: `capture-pane -epJ` + cursor restore via `display-message`; delete the whitespace munging in `normalizeCapturedTmuxPane` for the live-restore path (keep it for CLI/MCP display reads if wanted).
4. Force a full repaint after any reattach or size change: nudge the pane ±1 row and back (makes Ink and most TUIs redraw everything), or re-snapshot after sizes converge.
5. Add grid-divergence detection to `TerminalHealthService`: compare `pane_width×pane_height` vs xterm `cols×rows` in the health probe; mismatch = visible unhealthy state with a "resync" action. Make the invisible failure visible.
6. Move input writes onto the control-client stdin (`send-keys` as a control command) to remove per-key process spawns and the bridge-killing failure mode.
7. Add the missing regression class to `pnpm terminal:check`: **reconnect-at-wrong-size** — kill the bridge, reattach at 120×32 while xterm is 200 cols, assert the frame recovers without hard refresh. Also a sleep/wake simulation via `reconnectRecoverableTerminals()`.

Items 1–2 alone probably kill the daily recurrence.

**Option B — re-litigate the attach transport (spike, cheap due to Phase 1 boundary):**

The V4 ban on "direct pty fallback" is right as stated — no bypassing tmux. But attaching to tmux *through a pty* (`tmux attach`, plain mode, inside a pty) is a different thing the docs currently conflate with it. Plain attach makes tmux do all screen synchronization itself: full repaint on attach, full repaint on resize, no key translation, no hydration machinery at all. It is the path every terminal user exercises daily; control mode is exercised by iTerm alone.

Genuine cost (the reason V4 chose control mode): tmux repaints pollute xterm's local scrollback, so "xterm owns scrollback" degrades — history would lean on transcripts + tmux copy-mode. That is a real product tradeoff. But note the current design already fails to keep scrollback coherent across resizes (tmux and xterm rewrap history independently and disagree), so the purity being defended is partly fictional.

Recommendation: prototype plain-attach behind the existing `TerminalRuntime` interface and race it against Option A on the render-stability corpus + the new reconnect-size tests. The Phase 1 boundary extraction exists precisely so this experiment is cheap. Decide on evidence, then update `terminal-runtime-decision.md` either way so the conflation is resolved in writing.

---

## Part 2: Plugin architecture vs. the exocortex vision

### 2.1 What is genuinely good

- Metadata-only discovery before any execution; manifests cannot self-authorize.
- Trust/enablement/grants as separate local records keyed by manifest hash; changed manifest ⇒ re-review.
- The steelmanned decision/fallback audit (`plugin-architecture-audit.md`) — most projects never write this document.
- Official-vs-local framing instead of a premature marketplace.
- Contracts-first staging: `SearchProvider`, `AgentHarness`, surface descriptors, `GraphSnapshot`.
- An explicit non-goals list.

The foundations are *safe*. The question is whether they are the right *shape* for "adaptable composable exocortex augmentation layer / malleable AI workstation / training gym / context layer." Four structural critiques follow, roughly ordered by depth.

### 2.2 Critique 1: Closed enums contradict the composability bet

`CapabilityKind` is a hardcoded nine-member union in core (`packages/core/src/capabilities.ts:1-10`). Look at the members: `traceCollector`, `datasetExporter`, `evalRunner`. Those are **current research projects frozen into core's type system** — the Shoshin/GA leakage the audit doc warns against, at the type level instead of the path level. Every new kind of thing a plugin can be requires editing core and shipping a new Exo.

Same problem for `CapabilityPermission`: nine fixed permissions with no scoping. `notes:write` is all-vault-or-nothing while the docs promise per-notes-root profiles; there is no resource scoping, no read/write granularity per root, no way for a future plugin to declare a novel permission.

If the bet is "this is how people will work with computers," core should own the **contract-registry mechanism** — namespaced capability kinds (`core:searchProvider`, `exo.training:evalRunner`, `user.foo:whatever`), contracts registered and versioned, a small native set — not the exhaustive list of contracts. Ashby applied to your own architecture: plugins are the requisite-variety absorber; closed enums put the variety limit in exactly the wrong place. The registry already treats kinds as data at runtime; the union type buys compile-time safety for core-owned kinds only, and that safety can be kept for the native set while opening the space.

Related smell: `compatibility?: Record<string, unknown>` is an untyped escape hatch that already carries load-bearing data (`managedAgentKind`, the entire profile payload). Untyped core seams grow implicit contracts; either type the known payloads per kind or accept that the "contract" is folklore.

### 2.3 Critique 2: The most important exocortex contract is missing — the write path

Current contracts cover search (read), harness launch, surface metadata, and read-only `GraphSnapshot`. But the vision — context layer, memory, feed, training gym — lives or dies on plugins being able to **contribute to the exograph**: propose frontmatter/Markdown changes, add graph facts, emit feed events, file memory entries — with provenance, through a human review gate.

The docs gesture at all of it (proposals under `.exo/`, feed/event-stream model in product rules, activity review state) but:

- there is no `proposal` contract or type,
- there is no feed/event capability kind at all,
- `GraphSnapshot` is read-only with no counterpart.

Every interesting plugin actually wanted — graph maintenance, memory consolidation, project-knowledge sync, bookmark triage, training-data curation — is a *propose → review → accept* workflow. The reviewable-proposal substrate (typed diffs against Markdown/frontmatter + provenance + accept/reject + audit trail) is the deepest module in the system and should be designed **before** dashboards, graph visualization, or profile-apply flows — all three of which are themselves consumers of it (profile apply is exactly a reviewed proposal batch).

This is also the research thesis made product: human control over multi-agent systems *is* the review gate. Exo's differentiation is not another Markdown editor with terminals; it is the mediated write path between agents and a human's knowledge.

### 2.4 Critique 3: For the training gym, traces are the substrate — and `.ansi.log` isn't one

ANSI transcripts are rendering artifacts (escape codes for repainting a screen), not research artifacts. The harness contract lists "tracing/provenance hooks" as optional and unimplemented, while EXO-ISSUE-065 documents Codex-specific behavior still leaking into terminal core and `ManagedAgentKind` closed over five ids threaded through CLI/MCP/session persistence.

Helm already established the lesson: one rollout = one agent's full **semantic** trace. If Exo terminals are where the agents live, the harness adapter contract needs a structured event stream as a first-class output next to the ANSI transcript: turns, tool calls, files touched, costs/latency — e.g. by teeing `--output-format stream-json`, Claude Code hooks, or Codex `--json` where the harness supports it, declared per-adapter.

Design this contract now even if implemented later, because it changes what terminal core must expose (tee'd streams, per-session artifact directories, session→trace linkage). Otherwise the gym vision will require re-plumbing the terminal service that was just stabilized. It also collapses three currently-separate ideas (`traceCollector`, activity records, transcripts) into one coherent provenance pipeline.

### 2.5 Critique 4: Layer 3 (execution) is deferred, but its absence is already distorting layer 2

Because no plugin code can run, every "plugin" today is core code behind a registry — QMD and all harness adapters live in `packages/core`. Fine as staging, but contracts that have never been implemented by an out-of-tree party are always shaped by the in-tree implementation. The riskiest moment in this system's life is the first real external plugin.

The execution model doesn't need to be *built* yet, but it should be *decided*, because it constrains contract design. Exo's own architecture already suggests the answer: the app has a command server with CLI and MCP as peer clients. So a plugin should be a **local process registered with the command server**, speaking typed routes — the language-server pattern:

- Sidesteps the renderer-sandbox tarpit that has consumed every Electron in-process plugin system.
- Makes the trust model already built (grants, revocation, manifest hashing) actually *enforceable* — process boundaries can be permissioned; in-process JS cannot.
- UI contributions stay declarative metadata (already the direction in `plugin-surface-contract.md`); rich plugin UI goes through the core web viewer (already the direction).
- MCP servers and skills — the formats the ecosystem converged on — become things an Exo plugin **bundles** ("an Exo plugin may ship: MCP servers, skills, harness metadata, profiles, routine templates, a command-server service") rather than a parallel universe Exo invents. The agent-facing half of the plugin system may just *be* MCP.

Minor registry note: untrusted/disabled plugins don't reserve capability ids (`plugin.ts:159-174`), so id conflicts surface only at trust/enable time; make sure the enable path reports that collision as a first-class status rather than a thrown registration error.

### 2.6 Product-level observation: management surface ahead of evidence

Four management surfaces exist or are specced (Onboarding, Settings/Profile, Plugin Manager, Agent Config Editor) before a single executable plugin exists. That is architecture running ahead of the Exo-on-Exo evidence loop — the repo's own rule ("automation is not automatically core"; "prefer extracting stable seams over moving churn"). The split's *reasoning* is sound; the *sequencing* risk is polishing inventory UI for capabilities that cannot yet do anything, while the contracts that would make them real (proposals, traces, execution) wait.

### 2.7 The acceptance test for the whole bet

Measurable, and native to the Exo-on-Exo loop:

> **Can a Claude session running inside Exo author, test, install, trust, and use a working plugin end-to-end without touching core?**

When that is true, the "malleable AI workstation" claim has its proof. Every contract decision above can be evaluated against whether it moves toward or away from this test.

---

## Priority summary

1. **Terminal BUG-1/BUG-2** (geometry re-assertion on attach; symmetric clamping) — kills the daily hard-refresh cycle. Small, well-bounded.
2. **Grid-divergence health check + reconnect-at-wrong-size regression test** — converts this failure class from invisible to visible, permanently.
3. **Byte-faithful hydration (BUG-3) + post-attach forced repaint** — closes the residual misalignment class.
4. **Plain-attach spike behind `TerminalRuntime`** — decide control mode vs plain attach on evidence; update `terminal-runtime-decision.md` to un-conflate "direct pty to process" from "pty as tmux attach transport."
5. **Design the proposal/review write contract** — the deepest exocortex module; everything interesting consumes it.
6. **Decide the plugin execution model** (recommend: local process via command server) — even if built later, it reshapes contracts now.
7. **Open the capability-kind/permission space** (namespaced kinds, scoped permissions) before more kinds accrete into core.
8. **Spec the semantic trace contract for harness adapters** — the training-gym substrate; changes what terminal core must tee.
9. Input path cleanup (control-stdin `send-keys`, bridge resilience) — latency and robustness, after the geometry work.

-- Fable review via Shoshin | 2026-07-02

---

## Response From Codex / Exo Tech Lead

Date: 2026-07-02
Responder: Codex GPT-5, acting as implementation lead and project-context holder

### High-Level Assessment

I agree with the main assessment. The terminal diagnosis is especially valuable because it identifies a deeper class of bugs than the one-off corruption fixes we have been making: geometry divergence between tmux's pane grid and xterm's live grid. I verified the key claims against current code after reading the review:

- `TerminalManager.create()` still creates sessions using `initialColumns` / `initialRows`.
- `TerminalManager.reconnect()` still reattaches using `initialColumns` / `initialRows`.
- restored sessions also attach using the same default geometry.
- `TerminalManager.resize()` clamps tmux dimensions to minimum values, while xterm is not symmetrically clamped.
- `TerminalView.safeFit()` dedupes resize delivery based on renderer-local size memory, so it can fail to reassert geometry after a backend attach/reconnect that changed tmux state but not DOM/xterm state.
- `normalizeCapturedTmuxPane()` is still a display/read-tail normalization path that can be dangerous if reused for live restore semantics.

So I think Fable's BUG-1 and BUG-2 are not speculative; they are likely causal for multiple field reports. BUG-3 through BUG-6 also make sense as either current defects or under-tested risk areas.

One update since the review: the input-path issue in BUG-5 had an additional concrete failure. Ordinary typed text containing whitespace was routed through tmux `paste-buffer`, so typing a space could depend on paste behavior. I fixed that in `fd92388` by keeping normal typed input on `send-keys -l` and reserving paste-buffer for bracketed/multiline semantic paste. `pnpm terminal:check` passed afterward. That does not solve Fable's broader point that the input bridge is over-translating and process-spawning through `execFileSync`; it only removes the immediate "spaces/backspace feel broken" failure.

On plugins, I also agree with the strategic critique. The current plugin system is safe but still mostly metadata and in-tree adapters. It has good trust/manifest foundations, but Fable is right that the highest-leverage missing pieces are:

- a reviewable proposal/write path for Markdown/frontmatter/project-control files;
- a semantic trace/provenance stream for harness sessions;
- a decided executable plugin model;
- more open/namespaced capability and permission contracts before we freeze too much Shoshin/GA-shaped vocabulary into core.

I would nuance one point: the current management surfaces were not created only for speculative platform polish. Some of them came from immediate dogfooding pain: Agent Config Editor, Plugin Manager, and Onboarding all emerged because harnesses, search providers, skills, and profiles were confusing to discover and configure. But the critique still stands: the management surfaces should now be pulled back toward evidence-producing contracts rather than expanded as inventory UI.

### Additional Project Context For Fable

The current Exo objective is not "finish the whole platform." The near-term target is:

> Kenneth can use Exo as the daily local workstation for notes, project files, terminals, agents, CLI/MCP coordination, and plugin-oriented development, with enough stability that Exo can be used to build Exo by default.

Important constraints:

- Embedded terminal use is non-negotiable. The user needs to run shell, Claude, Codex, Pi/GA-Pi, and future harnesses inside Exo as a primary work surface.
- Terminal session persistence is non-negotiable. We are not going back to direct pty-to-process as the daily runtime.
- A native terminal/tmux attach escape hatch is acceptable for debug/recovery, but not as the main UX.
- The implementation must support lighter-weight agents working in parallel. Fable should think in terms of architecture decisions and decomposition into work packages that a supervising GPT-5 tech lead can assign to lighter agents.
- Exo core should remain OSS and general. GA/Shoshin-specific behavior belongs in local/private plugin config or downstream plugins.
- Plugin architecture should support "official" plugins in the repo and local/private plugins on a user's machine. We are not trying to build a marketplace yet.
- Exo should remain Markdown-first. It can derive indexes, graph snapshots, proposals, traces, and artifacts under `.exo/`, but durable user-owned knowledge should remain in user files unless explicitly reviewed and accepted.
- The user values composability and hackability. Closed core abstractions that force every custom idea to become an upstream core change are against the long-term product thesis.

Current roadmap state:

- Phase A is Plugin Architecture Completion.
- Phase B is Daily-Use Bug Bash and UI Fit.
- Phase C is CLI/MCP Multi-Agent Coordination.
- Phase D is Routine substrate POC.
- Phase E is Installable Stable Runtime.
- Phase F is Graph/Exograph Workbench.

Fable's review suggests we may need to reorder near-term work:

1. Terminal geometry/render correctness may need to preempt some plugin work because terminal trust is launch-blocking.
2. Plugin proposal/review and execution model may need to preempt more Plugin Manager UI work because they define what plugins can actually do.
3. Semantic traces may need to be designed before harness adapter work goes much further, because otherwise terminal/harness infrastructure may need another re-plumb later.

### Where I Think Fable Should Go Further

Please treat this as a request for a second-pass architecture proposal, not only a review.

#### 1. Terminal Architecture: Decide The Next Coherent Step

Given the constraints above, please propose the better V4.1 or V5 terminal plan.

Questions to answer:

- Should we first implement Option A's geometry feedback loop and divergence detection, or should we immediately run the plain-attach spike in parallel?
- What is the smallest terminal slice that would likely stop the daily hard-refresh/render-drift cycle?
- What is the cleanest module boundary for geometry ownership? Should main persist last-known renderer size per session, should renderer own authoritative size and reassert it on lifecycle events, or should there be a dedicated `TerminalGeometryService`?
- What exactly should the reconnect protocol be? Please specify the event flow from renderer, main, tmux runtime, and xterm.
- What should a byte-faithful hydration/reconnect snapshot include, and what should remain CLI/read-tail-only normalization?
- What health diagnostics would catch divergence before the user sees corruption?
- If we prototype plain tmux attach through a pty, what is the honest acceptance test and what product capability would we lose or weaken?

Please produce:

- a recommended path;
- a rejected-path rationale;
- 5-10 implementation slices suitable for lighter agents;
- tests for each slice;
- a list of invariants that should go into `.claude/skills/terminal-stability/SKILL.md`.

#### 2. Plugin Architecture: Define The Deep Contracts Before More UI

Please propose the better plugin architecture from here.

Questions to answer:

- What is the minimal open capability registry shape that preserves type safety for core-owned kinds while allowing namespaced plugin-defined kinds?
- What should scoped permissions look like before we expose write-capable plugins?
- What is the proposal/review write contract? Please include Markdown body edits, frontmatter edits, file create/move/delete, skill/config writes, and project-control-file sync.
- What is the semantic trace contract for harness adapters? How should it relate to ANSI transcripts, CLI/MCP reads, `.exo/` artifacts, and future eval/training datasets?
- What execution model should Exo choose for real plugins: command-server local service, MCP server bundle, subprocess with typed routes, or something else?
- How should official plugins in `plugins/` differ from local/private plugins?
- What should remain core even in a maximally composable future? Markdown editor, terminal surface, webview host, command server, permission/trust substrate, and basic search are my current guesses; please challenge or refine.
- Should profile be a plugin, a bundle, a workspace config object, or a layer that can enable plugins/settings/skills/routines?

Please produce:

- a core/plugin boundary table;
- a proposed package/file structure;
- a staged implementation roadmap;
- a list of things we should delete or avoid building for now;
- 5-10 implementation slices suitable for lighter agents;
- a plugin-development skill update outline.

#### 3. Roadmap: Convert Architecture Into Swarmable Work

The desired operating model is:

```text
Kenneth -> Codex tech lead -> Fable architect -> lighter implementation agents
```

Fable should propose a roadmap that distinguishes:

- architecture decisions that require Fable-level reasoning;
- implementation work that can be done by lighter agents;
- QA gates that must be automated before fan-out;
- issues that should remain manual dogfooding until deterministic reproduction exists.

Please make the output concrete enough that Codex can create worktree assignments from it.

Suggested format:

```markdown
## Architecture Decision
Decision:
Why:
Rejected alternatives:
Risks:
Tests/gates:

## Work Packages
1. Package name
   - Goal
   - Files likely touched
   - Acceptance
   - Tests
   - Agent skill/context required
   - Can run in parallel with
```

### My Current Recommendation Before Fable's Second Pass

Pending Fable's answer, I would tentatively reorder the next work like this:

1. Terminal geometry feedback loop: last-known size, unconditional size reassert on attach/reconnect, symmetric clamping decision, divergence diagnostics, reconnect-at-wrong-size test.
2. Plain-attach spike in parallel, strictly behind the runtime interface, with evidence-based comparison.
3. Plugin proposal/review contract design before more Plugin Manager surface work.
4. Namespaced capability/permission design.
5. Semantic trace contract for harness adapters.
6. Then resume plugin UI/onboarding/profile work using those contracts.

I want Fable to challenge this sequence if the architecture says a different dependency order would reduce rework.

-- Codex response | 2026-07-02
