# Terminal Refactor Plan

Last updated: 2026-06-18

Status note: this plan is historical for the tmux migration. The current implementation uses tmux control mode as Exo's live bridge and does not use `node-pty`. For current requirements and implementation rules, use `docs/terminal-runtime-decision.md` and `docs/terminal-quality-standard.md`.

## Goal

Bring Exo terminals up to the standard of a real daily-use terminal while supporting long-running terminal agents. The terminal system should feel immediate, preserve running processes through normal workspace lifecycle events, avoid visual corruption, provide reliable scrollback and transcripts, and expose clear recovery actions.

## Decision

Exo should move to a tmux-backed core terminal runtime.

This does not mean maintaining two competing terminal paths. The target architecture is:

```text
xterm.js renderer
  <-> Exo terminal renderer bridge
  <-> node-pty attach process
  <-> tmux session/window/pane
  <-> shell / Claude / Codex / future terminal agent
```

`node-pty` remains necessary as the local bridge between Exo and an attached tmux client. It should not own the durable user process. The process that matters to the user should live inside tmux.

There should be no hidden direct-pty fallback in core terminal runtime. If tmux is unavailable, Exo should show a clear setup/dependency error and disable terminal creation until fixed. A future plugin or developer diagnostic mode can revisit direct pty separately, but daily Exo terminals should have one product path.

## Why

Direct pty can be fast and simple, but it cannot preserve the running process through app crashes, relaunches, or ordinary laptop sleep/wake failures. Transcripts and provider resume flows help recovery, but they do not preserve a running build or an agent waiting for input.

Exo terminals are not disposable console widgets. They are the primary interface for shell work and terminal agents. Process persistence is part of the product.

The useability standard is:

- no meaningful typing lag
- no rendering corruption
- predictable scrollback
- durable transcripts
- long-running sessions survive normal Exo lifecycle events
- obvious health and recovery UI

See `docs/terminal-quality-standard.md`.

## Architecture

### Main Process

Introduce a terminal runtime boundary in `apps/desktop/src/main`:

```text
TerminalManager
  -> TerminalRuntime
     -> TmuxTerminalRuntime
        -> TmuxSessionStore
        -> TmuxBridge
        -> TerminalTranscriptStore
```

`TerminalManager` remains the app-facing service used by IPC, command server, CLI, and MCP. It should not contain scattered tmux command construction. It owns Exo-level terminal ids, user-facing metadata, diagnostics, and app events.

`TmuxTerminalRuntime` owns tmux session/window/pane lifecycle and attach/reattach.

`TmuxBridge` owns the node-pty process that attaches Exo to a tmux session for live streaming.

`TmuxSessionStore` persists Exo-to-tmux mappings under `.exo/terminal-sessions.json`.

### Renderer

Keep the current renderer invariant:

- live output streams imperatively into xterm
- React stores session metadata and hydration versions only
- mounted terminals receive append events only
- tail hydration is used for initial mount/reattach, not routine focus or metadata polling
- `TerminalView` must not reset/replay xterm during normal tab switching

### Runtime Data Model

Persist terminal sessions as:

```ts
interface PersistedTerminalSession {
  id: string;
  kind: "shell" | "claude" | "codex";
  title: string;
  cwd: string;
  command: string;
  args: string[];
  envSummary: Record<string, string>;
  tmuxSessionName: string;
  tmuxWindowId: string | null;
  tmuxPaneId: string;
  transcriptPath: string;
  createdAt: string;
  lastAttachedAt: string | null;
  lastSeenAt: string | null;
  status: "running" | "detached" | "exited" | "missing" | "unhealthy";
}
```

The persisted file is not the source of truth for process aliveness. It is a registry. On startup, Exo must verify tmux state and mark stale entries accurately.

## Lifecycle Semantics

### Create Terminal

1. Resolve launch plan.
2. Create tmux session/window/pane with stable Exo-owned names.
3. Start shell/agent command inside the tmux pane.
4. Persist Exo session metadata.
5. Attach Exo through node-pty to the tmux pane.
6. Start transcript capture.
7. Emit terminal-created event.

### Close Terminal Tab

Closing a terminal tab should ask whether to detach or terminate only if the action is ambiguous. For the first implementation, keep current behavior clear:

- close/kill terminal = terminate tmux session/pane
- close Exo window = detach UI, keep tmux session alive
- quit Exo app = warn that live terminals may continue or offer explicit terminate/detach choice

The exact Quit semantics should be decided during UI implementation. It must be impossible to accidentally kill long-running sessions without clear warning.

### App Relaunch

1. Read `.exo/terminal-sessions.json`.
2. List tmux sessions/panes.
3. Reconcile persisted sessions with actual tmux state.
4. Show live/detached sessions in terminal UI.
5. Attach when the user opens or focuses a terminal.
6. Hydrate xterm from tmux capture-pane tail plus Exo transcript tail if needed.
7. Resume live streaming from the attach bridge.

### Sleep/Wake

On wake:

- inspect bridge pty status
- inspect tmux session/pane status
- reattach if bridge is stale but tmux pane is alive
- mark unhealthy if tmux is gone or pane is dead
- leave transcript available
- surface recovery actions in UI

## Scrollback And Transcript Ownership

Use all three layers intentionally:

- xterm scrollback: current interactive UI history, follows user setting
- tmux history: backend session history used for reattach snapshots
- Exo transcript: durable full record, independent of live scrollback

Rules:

- The active xterm viewport should be append-only during live streaming.
- Reattach snapshots can come from `tmux capture-pane` bounded to the configured live scrollback.
- Full history belongs in transcripts, not xterm or React state.
- User-facing settings should explain live scrollback versus transcripts.

## Input Semantics

Raw interactive keystrokes and semantic agent messages must stay distinct:

- raw writes: direct interactive input/control characters
- semantic messages: preserve exact whitespace/newlines through bracketed paste or tmux-safe equivalent, then submit only when requested

Tests must cover:

- long prompts
- leading/trailing spaces
- punctuation
- multiline text
- submit false
- delayed submit
- Codex startup queueing

## Health And Recovery UI

Terminal diagnostics should distinguish:

- tmux binary missing
- tmux server unavailable
- session exists
- pane alive/dead
- bridge attached/detached
- pty bridge stalled
- transcript writable/unwritable
- last input/output times
- echo/write latency
- current pane command/cwd

UI states:

- Live
- Detached
- Reattaching
- Exited
- Missing
- Needs attention

Actions:

- Reattach
- Restart
- Terminate
- Detach
- Open transcript
- Copy diagnostics

## Dependency And Install Plan

Short term:

- Detect `tmux` on app startup and terminal creation.
- Add installer/readme checks.
- On macOS, recommend `brew install tmux` when missing.
- Fail terminal creation clearly if tmux is missing.

Medium term:

- Decide whether packaged Exo bundles tmux or uses a guided dependency install.
- Ensure installed app, dev app, and CLI resolve the same tmux dependency behavior.

## Implementation Phases

Each phase should land as a reviewable work chunk. Do not merge a later phase by hiding incomplete behavior behind a fallback path. If the tmux path is not ready, the phase remains incomplete rather than silently dropping to direct pty.

### Phase 0: Plan And Standards

- Add `docs/terminal-quality-standard.md`.
- Update `docs/terminal-runtime-decision.md` with the tmux-backed direction.
- Add this refactor plan.
- Update `docs/tasks.md`, `docs/issues.md`, `AGENTS.md`, README, architecture, and roadmap references away from direct-pty as the future standard.

Exit gate:

- The docs explain the single-runtime decision, the no-live-inference test rule, latency targets, scrollback/transcript ownership, and the app QA checklist.

### Phase 1: Deterministic Terminal Test Harness

- Add fake Claude/Codex scripts for local deterministic terminal behavior.
- Add latency measurement helpers.
- Add xterm rendering corruption tests.
- Add scrollback stress tests.
- Add no-live-hydration invariant tests.
- Add transcript-versus-live-scrollback tests.

No automated test should call live Claude/Codex inference.

Exit gate:

- Focused Electron tests can exercise shell and fake-agent terminals without network/model dependency.
- Input latency reports p50 and p90, not only max.
- Tests cover wrapped lines, ANSI output, carriage-return updates, long scrollback, tab switching, and pane resize.

### Phase 2: Tmux Runtime Boundary

- Add tmux command wrapper with structured errors and timeouts.
- Add tmux session naming/sanitization helpers.
- Add tmux session registry.
- Add unit tests for command construction, parsing, and missing-binary behavior.
- Keep current public TerminalManager API stable while replacing internals behind a runtime boundary.

Exit gate:

- No tmux command strings are assembled ad hoc outside the runtime boundary.
- Missing tmux produces a clear structured error, not a silent direct-pty fallback.
- Unit tests verify tmux detection, session naming, pane parsing, and command failure reporting.

### Phase 3: Create/Attach/Terminate

- Create shell/fake-agent tmux sessions.
- Attach xterm via node-pty to tmux.
- Stream output to renderer and transcript.
- Terminate tmux sessions explicitly.
- Preserve current CLI/MCP terminal/agent APIs.

Exit gate:

- New shell, fake Claude, and fake Codex sessions run inside tmux.
- `node-pty` only attaches to tmux; it does not own the durable shell or agent process.
- Terminal close/kill terminates the tmux session intentionally.
- CLI, MCP, renderer IPC, and app UI can create/read/send/terminate sessions through the same public contracts as before.

### Phase 4: Relaunch/Reattach

- Persist session registry.
- Restore session list on app startup.
- Reconcile registry with tmux state.
- Reattach to live sessions.
- Hydrate from bounded tmux pane capture without resetting mounted xterm instances.
- Verify app relaunch preserves live processes.

Exit gate:

- Closing the window detaches the UI while tmux processes continue.
- Relaunching Exo reconciles persisted session metadata with actual tmux pane state.
- Reattached terminals accept input and continue producing output.
- Dead/missing tmux panes show an honest state instead of stale live output.

### Phase 5: Sleep/Wake Recovery

- Add app lifecycle wake detection.
- Detect stale bridge pty.
- Reattach bridge to live tmux pane.
- Surface health state and recovery actions.
- Manual sleep/wake QA with shell and fake-agent sessions.

Exit gate:

- After macOS sleep/wake, Exo detects stale attach bridges and reattaches to live tmux panes.
- If the pane died, Exo shows recovery actions and keeps the transcript available.
- Manual sleep/wake QA passes for shell and fake-agent sessions before using real Claude/Codex dogfooding as evidence.

### Phase 6: UX Polish And Docs

- Update terminal settings copy.
- Add dependency diagnostics to settings or app diagnostics.
- Add terminal health affordance in tab/header tooltip.
- Update install docs and setup QA.
- Run full terminal quality checklist.

Exit gate:

- The UI exposes terminal health without requiring log inspection.
- Settings distinguish live scrollback from durable transcripts.
- Install/setup docs explain tmux dependency behavior for both developer and installed-app paths.
- No direct-pty/tmux product toggle appears in settings.

## Work Breakdown

Recommended implementation chunks:

1. Harness first: fake agents, latency helper, no-live-hydration regression, and scrollback/render fixtures.
2. Runtime primitives: tmux detection, command runner, session naming, pane parsing, and structured errors.
3. Runtime swap: create tmux sessions and attach through node-pty while keeping current IPC/CLI/MCP contracts stable.
4. Registry and reattach: persist Exo-to-tmux mappings, reconcile on startup, and hydrate from bounded tmux capture.
5. Health and recovery: bridge health, stale bridge reattach, dead pane handling, transcript diagnostics, and UI actions.
6. Install/docs polish: dependency checks, setup messaging, QA docs, and stale direct-pty references.

Each chunk should include focused tests and one short app QA note before commit.

## Risk Register

- Tmux adds latency or redraw artifacts.
  - Mitigation: keep strict p50/p90 latency gates and rendering-corruption tests; optimize the attach path before adding UI options.
- Attach bridge exit is confused with user process exit.
  - Mitigation: model bridge status separately from tmux pane status in diagnostics and UI.
- Exo accidentally duplicates tmux's pane model.
  - Mitigation: Exo owns app layout; tmux owns only durable process/session state.
- Reattach hydrates stale history over live output.
  - Mitigation: only hydrate on initial attach or explicit reattach; never reset mounted xterm during normal focus/tab changes.
- Missing tmux breaks first-run experience.
  - Mitigation: detect early, explain the dependency, and keep non-terminal notes/editor surfaces usable.
- Tests become flaky by depending on real agent inference.
  - Mitigation: automated tests use fake agents only; live Claude/Codex remains manual dogfooding.

## Definition Of Done

The terminal refactor is complete only when:

- Current direct-pty-owned durable sessions are replaced by tmux-backed durable sessions.
- No hidden direct-pty fallback or runtime preference remains in core product code.
- Shell, Claude, Codex, CLI, MCP, and renderer workflows use the same TerminalManager-facing contracts.
- Mounted terminals stream append-only output and are not reset during normal tab/focus changes.
- Live scrollback is bounded by user-visible configuration; full history is available through transcripts.
- App relaunch and sleep/wake preserve or honestly recover long-running sessions.
- Missing tmux, dead panes, stale bridges, and transcript errors show actionable diagnostics.
- The automated terminal suite passes without live inference.
- Manual app QA covers shell, fake agent, tab switching, pane resize, window hide/show, relaunch, sleep/wake, and transcript recovery.

## Rollout Order

1. Land harness and runtime-boundary commits on `main`.
2. Land tmux create/attach/terminate behind the existing terminal APIs.
3. Dogfood with fake agents and shell sessions before real Claude/Codex.
4. Add reattach and sleep/wake recovery.
5. Use Exo for a bounded Exo-on-Exo task and record every terminal friction point in `docs/issues.md`.
6. Only then treat the terminal runtime as ready for the broader installed-app QA pass.

## Test Plan

Required before merge:

- `pnpm check:repo`
- `pnpm --filter @exo/desktop typecheck`
- `pnpm --filter @exo/desktop build`
- terminal manager unit tests
- command-server terminal contract tests
- CLI terminal/agent tests
- MCP agent tests
- focused Electron terminal e2e tests
- deterministic fake-agent e2e tests

Required manual app QA:

- shell typing latency
- fake Claude/Codex prompt input
- long output scrollback
- tab switching
- pane resizing
- window close/show
- app relaunch reattach
- macOS sleep/wake reattach
- transcript availability
- missing tmux dependency behavior

## Non-Goals

- Do not add a user-facing direct-pty/tmux preference.
- Do not keep direct pty as a hidden fallback.
- Do not rely on live Claude/Codex inference for automated tests.
- Do not use React state as the live terminal rendering source.
- Do not pretend transcripts are equivalent to process persistence.
- Do not mix Exo pane layout persistence with tmux pane/window layout ownership.

## Open Questions

- Should explicit app Quit detach all tmux sessions by default, or ask whether to terminate them?
- Should close terminal tab terminate immediately or offer detach once persistence is familiar?
- Should packaged Exo bundle tmux or require a system install?
- How much tmux history should Exo capture during reattach relative to configured live scrollback?
- Should advanced external attach instructions be surfaced in diagnostics?

-- Shoshin | 2026-06-13
