# Terminal Architecture V4

Last updated: 2026-06-23

This is the current Exo terminal architecture target: embedded-first, tmux-durable, and xterm-owned. It applies the simplification algorithm to the tmux-backed terminal stack and supersedes the V3 planning snapshot.

## Executive Summary

Exo should keep the hard product decision that terminal processes live in tmux. That is a real requirement because Exo-on-Exo depends on long-running shell and agent sessions surviving window close, renderer reload, app relaunch, and normal laptop lifecycle events.

The part to simplify is not tmux persistence. The part to simplify is Exo's ownership boundaries around terminal state. `TerminalManager` should be an app-facing facade; named modules own tmux runtime, session registry, transcript persistence, health classification, bounded API tail reads, diagnostics, and render-stability checks. The renderer owns xterm, layout, focus, fit/resize, append-only delivery, and explicitly gated hydration.

Hard decisions:

- Keep one daily runtime: tmux-backed sessions attached through tmux control mode.
- Do not restore direct pty as a fallback or product setting.
- Make xterm the only live interactive screen owner.
- Make tmux the only durable process/session/history owner.
- Make transcripts append-only durable records, never a source for live screen replay except explicit transcript viewing.
- Remove routine active-terminal hydration and any focus path that can reset a mounted xterm.
- Keep splitting `TerminalManager` behind named runtime/service boundaries before adding more recovery behavior.

## Simplification Algorithm

### 1. Question The Requirements

Real product requirements:

- Normal terminal feel: fast typing, correct focus, alternate-screen/TUI support, wrapped lines, colors, status bars, and copy/scroll behavior.
- No visible corruption: Unicode, ANSI, OSC/device responses, resize, tab switch, pane moves, preview-pane focus, renderer reload, and relaunch must not produce stale or replacement-glyph output.
- Process persistence: shell and agent sessions must survive window close, renderer reload, app relaunch, and sleep/wake when tmux is alive.
- Full useful scrollback: live scrollback should be configured and predictable; durable transcript should preserve full session output subject to retention.
- Agent usability: CLI/MCP/app can create, list, send semantic messages, interrupt/write raw input, reconnect, terminate, diagnose, and read bounded transcript tails without live Claude/Codex inference in tests.
- No hidden caps: user-visible terminal caps/timing values belong in settings and UI.

Assumed implementation choices:

- React hydration snapshots as the recovery mechanism for mounted terminals.
- A main-process text `TerminalLineBuffer` as a second live history source.
- One setting named "live terminal scrollback lines" driving xterm scrollback, tmux history, and main-process buffer.
- Polling `terminals.list()` every 1.5s as the primary renderer metadata sync.
- `TerminalManager` directly constructing tmux commands, managing transcripts, and running readiness state machines.
- Preview panes explicitly calling global terminal refreshes instead of terminal layout state driving fit/refresh.

### 2. Delete The Part Or Process

Delete or retire now:

- `terminalHistoryMode`; normalization forces `"custom"` and the mode no longer expresses product behavior.
- Any active mounted-terminal path where `terminals.read()` triggers `terminal.reset()`.
- Any use of transcript contents to seed live xterm state during normal operation. Use transcript only for explicit transcript reads.
- Main-process buffer as a competing live-render source. Keep only a bounded API tail cache if needed for `/terminals/:id/tail`; prefer tmux `capture-pane` for live session tails and transcript reads for durable history.
- Duplicate lifecycle ownership in `TerminalManager`: move tmux runtime, registry, transcript store, readiness gates, and health probes behind named services.
- Renderer global refresh hacks as the long-term preview-pane fix. Keep as a temporary mitigation only until layout/focus tests cover preview interactions.

Do not delete:

- tmux persistence.
- tmux control-mode attach path.
- xterm live rendering.
- deterministic fake-agent terminal tests.
- bounded CLI/MCP transcript read limits exposed through settings.

### 3. Simplify Then Optimize

Smallest correct runtime boundary:

```text
Renderer TerminalSurface
  owns xterm instance, fit, focus, local scrollback, live append only
  receives:
    terminal:data append events
    terminal:snapshot only before first mount or explicit reconnect

TerminalSessionController
  renderer hook/component owner for session metadata, active id, mounted state
  never owns live screen contents

TerminalManager
  app-facing API only: create/list/diagnostics/write/send/reconnect/resize/kill/readTail/readTranscript
  delegates runtime work

TerminalRuntime
  create, attach, detach, reconnect, resize, writeRaw, sendSemantic, terminate, captureTail, inspect

TmuxTerminalRuntime
  owns tmux commands, session options, pane ids, control-mode bridge, tmux history

TerminalSessionRegistry
  owns `.exo/terminal-sessions.json`, ids, Exo-to-tmux mapping, startup reconciliation

TerminalTranscriptStore
  owns append-only disk transcripts and retention

TerminalHealthService
  owns pane/bridge/input-output health, sleep/wake reconciliation, diagnostics shape
```

Optimization comes after this boundary exists. Until then, more retries, refreshes, and hydration patches add timing states faster than tests can bound them.

### 4. Accelerate Cycle Time

Create a named focused terminal gate:

```bash
pnpm --filter @exo/desktop exec vitest run src/main/terminal-manager.test.ts src/main/terminal-tmux.test.ts src/main/terminal-recovery-service.test.ts
pnpm --filter @exo/desktop test -- src/renderer/src/App.test.tsx
pnpm exec playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/shell.spec.ts -g "terminal|tmux|fake agent|latency|relaunch|reload|reconnect|preview"
```

Keep the full `pnpm ci:check` gate for broad handoff, but terminal work needs a fast, named subset that catches the known failure classes in minutes.

### 5. Automate

Automation must cover:

- `/bin/cat` input echo latency p50/p90.
- `/bin/sh` burst output, wrapped lines, ANSI, carriage returns, and status-like lines.
- fake Claude/Codex agents using local scripts only.
- renderer reload before input.
- app relaunch reattach before input.
- tmux attach bridge kill and reconnect.
- preview pane open/focus/resize while typing in terminal.
- Unicode split across tmux control-mode records and browser/xterm write chunks.
- generated xterm device/OSC responses not reaching tmux.
- no `terminals.read()` hydration for mounted active terminals.

## Current Architecture Inventory

- `apps/desktop/src/main/terminal-manager.ts`: app-facing terminal service plus tmux session creation, attach/reconnect, read tail, transcript append, line buffer, readiness queues, health, diagnostics, registry persistence, and Codex MCP launch overrides.
- `apps/desktop/src/main/terminal-tmux.ts`: tmux detection, command runner, Exo session naming, pane parsing, control-mode process, control-output decoding, tmux key/input mapping, bracketed paste handling.
- `apps/desktop/src/main/terminal-transcripts.ts`: append-buffered `.ansi.log` transcript store, retention cleanup, tail reads, transcript filename sanitization.
- `apps/desktop/src/main/terminal-ipc.ts`: preload IPC handlers mapped to `TerminalManager`.
- `apps/desktop/src/main/terminal-recovery-service.ts`: power resume hook that calls `reconnectRecoverableTerminals()`.
- `apps/desktop/src/renderer/src/components/TerminalView.tsx`: xterm instance, fit addon, focus, input filtering, drag/drop path paste, resize reporting, hydration reset/replay, write chunk queue.
- `apps/desktop/src/renderer/src/hooks/useTerminalSessions.ts`: session list state, active id, hydration snapshots/versions, pending live data while unmounted/hydrating, 1.5s list polling, create/activate/reconnect/kill actions.
- `apps/desktop/src/renderer/src/components/TerminalDock.tsx`: terminal tabs, active session rendering, forced hydration on active session or pane change, health overlay, reconnect action.
- `apps/desktop/src/renderer/src/components/terminalRegistry.ts`: global imperative registry from session id to xterm write/focus/refresh.
- `apps/desktop/src/renderer/src/components/terminalOutputChunks.ts`: xterm write chunking and surrogate-pair preservation.
- `apps/desktop/src/renderer/src/components/terminalInputFilters.ts`: xterm-generated CSI/OSC response filter.
- `apps/desktop/src/renderer/src/components/BrowserPane.tsx`: preview webview and temporary terminal refresh calls around preview layout/focus.
- Settings: `packages/core/src/terminal-settings.ts`, `packages/core/src/workspace-settings.ts`, `apps/desktop/src/main/settings-store.ts`, `WorkspaceSettingsDialog.tsx`, and `workspaceSettingsModel.ts` expose most terminal caps/timing values.
- CLI/MCP: `packages/cli/src/index.ts`, `packages/cli/src/app-client.ts`, `packages/mcp/src/index.ts`, and `packages/core/src/command-protocol.ts` expose terminal create/read/send/reconnect/diagnostics contracts.
- Tests: `terminal-manager.test.ts`, `terminal-tmux.test.ts`, renderer `App.test.tsx`, and `apps/desktop/tests/e2e/shell.spec.ts` already cover many known regressions.

## Ownership Model

- tmux owns durable process lifetime, pane identity, backend history for reattach snapshots, environment at launch, and external attach/debuggability.
- xterm owns the live interactive screen, local scrollback viewport, alternate-screen rendering, ANSI interpretation, selection, and user scroll behavior.
- Exo main owns product lifecycle APIs, runtime orchestration, persisted Exo session ids, diagnostics, settings application, and transcript persistence.
- Exo renderer owns visible layout, active session selection, xterm mount lifecycle, focus, fit/resize measurement, and live append delivery.
- Transcripts own durable append-only session history and agent-readable bounded transcript tails.
- React state owns metadata only: sessions, active ids, health, hydration status, and layout placement. It must not own live terminal output.

## What To Delete Or Simplify Now

1. Remove `terminalHistoryMode` from product thinking and migrate settings/tests toward explicit fields:
   - `terminalLiveScrollbackLines`
   - `terminalReadTailChars`
   - `terminalMaxReadTailChars`
   - transcript retention fields
2. Replace `TerminalLineBuffer` with a narrower `TerminalTailCache` or remove it if tmux `capture-pane` plus transcript tails satisfy API reads.
3. Move tmux command construction out of `TerminalManager` into `TmuxTerminalRuntime`.
4. Move `.exo/terminal-sessions.json` logic into `TerminalSessionRegistry`.
5. Move Codex readiness/startup queuing out of `TerminalManager` into a harness readiness gate.
6. Change renderer hydration semantics:
   - allowed: first mount, explicit reconnect, renderer reload before xterm is mounted
   - forbidden: active focus, tab click, pane focus, metadata poll, preview-pane refresh
7. Keep `BrowserPane` terminal refresh calls only as a temporary mitigation. Replace with terminal layout lifecycle tests and a direct `TerminalView` visibility/fit contract.

## V4 Module Boundary Target

Main process:

```text
terminal-manager.ts
  TerminalManager facade; no direct tmux command strings.

terminal-runtime.ts
  TerminalRuntime interface and shared runtime event types.

terminal-runtime-tmux.ts
  TmuxTerminalRuntime implementation.

terminal-tmux.ts
  Low-level tmux runner/control-mode parser only.

terminal-session-registry.ts
  Persistent session registry, id allocation, startup reconciliation input/output.

terminal-tail-cache.ts
  Optional bounded API tail cache, not renderer hydration source.

terminal-health.ts
  Health classification and diagnostics shape.

terminal-readiness.ts
  Harness readiness gates for Codex/Claude/future agents.

terminal-transcripts.ts
  Append-only transcript store.
```

Renderer:

```text
TerminalDock.tsx
  tabs, health overlay, active session container.

TerminalView.tsx
  xterm lifecycle, fit/focus/resize, append-only writes.

useTerminalSessions.ts
  session metadata and active id; no live output ownership.

useTerminalHydration.ts
  first-mount/reconnect snapshot state machine with explicit mounted/consumed states.

terminalRegistry.ts
  temporary imperative adapter; eventual owner can be a TerminalView ref map.
```

Unknown: whether `terminalRegistry.ts` should remain as a stable imperative bridge or be replaced by scoped refs from `TerminalDock`. Keep it until v3 boundaries are in place.

## Migration Phases

Phase 1: low-conflict boundary extraction.

- Add `TerminalRuntime` interface.
- Extract tmux create/attach/reconnect/resize/write/capture/kill into `TmuxTerminalRuntime`.
- Keep public `TerminalManager` methods and IPC/CLI/MCP contracts unchanged.
- Move no product behavior in this slice.
- Add unit tests that `TerminalManager` delegates and does not assemble tmux command strings.

Phase 2: registry and transcript separation.

- Extract `TerminalSessionRegistry`.
- Keep id allocation and persisted mapping behavior byte-compatible.
- Ensure exited agent sessions and non-reused display ids stay covered.
- Keep transcript store append-only and verify tmux capture hydration is not appended to transcripts.

Phase 3: renderer hydration contract.

- Introduce explicit hydration states: `unmounted`, `snapshotPending`, `snapshotApplied`, `live`.
- For mounted `live` terminals, ignore focus/tab/pane metadata events as hydration triggers.
- Add a regression asserting active `TerminalDock` pane changes do not call `terminals.read()` when the xterm is mounted and registered.

Phase 4: preview/focus reliability.

- Add deterministic e2e: open browser preview beside `/bin/cat`, type continuously, resize panes, focus preview, return to terminal, assert visible echo without refresh.
- Replace broad `refreshAllTerminals()` preview calls with terminal visibility/fit handling once the test is red/green.

Phase 5: tail and scrollback cleanup.

- Rename settings away from `terminalHistoryMode`.
- Decide whether API live tail comes from tmux capture, tail cache, or transcript tail by session state:
  - running: tmux capture-pane bounded by live scrollback setting
  - exited/missing: transcript tail
  - detached but pane alive: tmux capture-pane
- Remove redundant main-process buffer if tests pass.

Phase 6: lifecycle hardening.

- Add renderer-gone and command-server lifecycle tests that assert terminal tabs enter reconnect/degraded state instead of showing stale live UI.
- Add sleep/wake manual QA evidence path until macOS sleep can be automated reliably.

## Test Plan

No automated test should call real Claude/Codex inference.

Unit tests:

- `terminal-tmux.test.ts`: tmux detection, command errors, pane parsing, UTF-8 decoder, control-mode parsing, key mapping, bracketed paste.
- `terminal-manager.test.ts`: facade behavior, no direct tmux command assembly after extraction, missing tmux error, registry restore, reconnect, diagnostics, readiness queues, transcript separation.
- New `terminal-session-registry.test.ts`: id allocation, stale/missing pane reconciliation, exited-session persistence, corrupt registry recovery.
- New `terminal-health.test.ts`: pane dead/missing, bridge detached, idle/unresponsive thresholds.
- Renderer tests: xterm registry/focus refresh, output chunking, generated response filter, hydration state machine, no active mounted read.

E2E tests:

- `/bin/cat` input latency p50/p90.
- streaming output in one terminal while typing in another.
- fake Claude/Codex deterministic startup/output/input.
- large output and scrollback markers.
- renderer reload and app relaunch with visible history before new input.
- tmux attach client kill and reconnect.
- preview-pane focus/resize while typing.
- Terminal Render Stability fixture through tmux decoding, renderer write chunking, and fake-agent e2e: Claude-like header/status/footer, box drawing, braille spinners, emoji, private-use/Nerd Font glyphs, ANSI styles, carriage returns, and wrapped prompt lines, with no replacement characters, `???`, or literal tofu placeholders.
- settings UI exposes terminal caps/timing values.

Manual QA:

- installed app close-window/show-window.
- quit warning semantics with running terminals.
- macOS sleep/wake with shell and fake agent.
- short real Claude/Codex dogfood only after deterministic gates pass.

## Risks And Regression Detection

- Risk: moving tmux code changes launch quoting or environment propagation.
  Detection: unit tests for `shellCommand`, env args, launch command, and fake-agent e2e.
- Risk: removing main buffer breaks CLI/MCP tails.
  Detection: command-server `/tail`, CLI `terminals read`, MCP `read_agent`, and transcript tests.
- Risk: stricter hydration leaves blank xterm after reload.
  Detection: reload/relaunch e2e must assert history visible before input.
- Risk: preview webview steals focus or leaves stale geometry.
  Detection: new preview terminal typing/resize e2e.
- Risk: Unicode or terminal-agent TUI corruption returns at either tmux or browser boundary.
  Detection: shared Terminal Render Stability corpus in tmux split-byte tests, renderer chunking tests, and fake-agent e2e; emoji-heavy e2e remains a burst-size check.
- Risk: hidden caps reappear during refactor.
  Detection: settings tests assert all user-visible terminal caps are present in settings/UI; docs classify any internal constants.
- Risk: Exo-on-Exo diagnostics are blocked by sandbox.
  Detection: CLI/MCP stale-runtime diagnostics should distinguish blocked process/network checks from dead runtime. This review saw sandboxed `exo status` fail with `fetch failed` and `kill EPERM`.

## Non-Negotiables

- Normal terminal feel: typing, focus, scroll, alternate-screen, resize, tab switch, and pane movement must behave like a local terminal.
- No corruption: no stale replay, blank active terminal, OSC leakage, replacement glyph corruption, clipped prompt/status line, or history pasted over live output.
- Full useful scrollback: live scrollback follows visible settings; full durable history lives in transcripts with configured retention.
- No hidden caps outside UI/config: read tails, max reads, scrollback, transcript retention, input coalescing, startup/submit delays, initial/minimum geometry, idle/unresponsive thresholds must be visible settings or documented protocol invariants.
- App restart/window lifecycle reliability: close-window, show-window, renderer reload, app relaunch, command-server restart, and sleep/wake must leave terminals either live/reconnected or honestly degraded with actions.
- Exo-on-Exo agent usability: agents can create, read, send, interrupt, reconnect, diagnose, and terminate Exo-managed terminals without relying on real provider inference in tests.

## First Implementation Slice

Start with Phase 1: extract `TerminalRuntime` and `TmuxTerminalRuntime` while keeping `TerminalManager`'s public API unchanged.

Why this slice first:

- It is low conflict because IPC, CLI, MCP, renderer, settings, and tests can remain behavior-compatible.
- It removes the biggest ownership knot without changing product behavior.
- It creates a place for later registry, health, and hydration fixes to land without making `TerminalManager` larger.
- It gives a second agent a concrete contract: move code, preserve behavior, run focused main-process terminal tests.

Exit criteria:

- `TerminalManager` has no direct `tmux` command construction.
- Existing terminal manager/tmux tests pass.
- No public terminal API or persisted registry behavior changes.
- The doc remains accurate enough for Phase 2.

## Pre-Implementation Critique

Phase 1 is necessary but not sufficient. Extracting a runtime boundary reduces future risk, but it will not by itself fix the current visible corruption, blank terminal, or scrollback bugs. Those symptoms likely live in the interaction between tmux control-mode output, xterm hydration/reset behavior, renderer mount state, and tab/pane visibility. Treat Phase 1 as an enabling slice, not a user-visible reliability win.

Implementation guardrails:

- Do not move behavior and fix behavior in the same first slice. The first worker should extract the runtime boundary and preserve behavior.
- Do not remove `TerminalLineBuffer`, hydration snapshots, readiness gates, or transcript paths during Phase 1 unless a test proves the move is behavior-preserving. Those deletions belong to later slices.
- Keep `TerminalManager` as the compatibility facade for IPC, command server, CLI, MCP, and renderer code.
- Keep the persisted `.exo/terminal-sessions.json` shape compatible in Phase 1.
- Add tests that fail if new tmux command construction is added back to `TerminalManager`.
- After Phase 1, run a separate targeted slice on the renderer hydration invariant: mounted/live xterm instances must not reset from focus, tab switch, metadata polling, or preview-pane refresh.

If Phase 1 grows beyond a mostly mechanical extraction, stop and split it. Terminal reliability has suffered from broad patches that change too many ownership boundaries at once.

## Implementation Note: Phase 2A Simplification

This worktree now pushes beyond Phase 1 with a conservative Phase 2A slice:

- Extracted `TerminalSessionRegistry` into `apps/desktop/src/main/terminal-session-registry.ts`.
  It owns `.exo/terminal-sessions.json` parsing, compatibility filtering, next-id recovery, and byte-compatible persistence.
- Extracted terminal health classification into `apps/desktop/src/main/terminal-health.ts`.
  `TerminalManager` now passes a narrow health input instead of keeping health policy inline.
- Deleted proactive create/restore tmux history hydration from `TerminalManager`.
  `readTail()` now captures tmux history on demand and falls back to a bounded recent-output string for fake runtimes, readiness scanning, diagnostics counts, and capture failures.
- Deleted the `TerminalLineBuffer` class.
  This removes a second main-process live-history object from normal tmux hydration; tmux remains the live durable history owner and transcripts remain the durable append-only record.

Measured LOC from the Phase 1 baseline in this worktree:

- `terminal-manager.ts`: 1356 -> 1185, delta -171.
- `terminal-runtime.ts`: 76 -> 76, delta 0.
- `terminal-runtime-tmux.ts`: 196 -> 196, delta 0.
- `terminal-transcripts.ts`: 150 -> 150, delta 0.
- new `terminal-health.ts`: +58.
- new `terminal-session-registry.ts`: +104.
- Main-process terminal runtime subtotal for these files: 1778 -> 1769, net delta -9.

The important result is that `TerminalManager` lost direct registry persistence, health policy, create-time tmux capture hydration, and the `TerminalLineBuffer` class. The total runtime LOC only drops slightly because two explicit boundary modules now carry the remaining registry and health behavior. A much larger total LOC deletion is not safe yet without tackling renderer hydration and tail semantics, because CLI/MCP/app reads still require a bounded live tail, Codex readiness still needs recent output text, and diagnostics still expose buffered line/char fields.

Next deletion candidates:

- Replace routine renderer hydration with an explicit first-mount/reconnect state machine, then remove more `terminals.read()` reset/replay paths.
- Decide whether diagnostics should keep `bufferedLines`/`bufferedChars`; removing or renaming them is a public command-server/API compatibility decision.
- Move Codex readiness and queued semantic message delivery behind a readiness gate so `TerminalManager` can stop owning harness-specific startup text scanning.

-- Shoshin | 2026-06-21
