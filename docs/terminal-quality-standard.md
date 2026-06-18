# Terminal Quality Standard

Last updated: 2026-06-18

Terminals are a core Exo surface. They must feel like a normal local terminal, not like an embedded widget with special failure modes. If typing lags, output corrupts, scrollback behaves unpredictably, focus requires extra clicks, bottom status lines are clipped, or long-running agent sessions are lost during ordinary laptop use, the feature fails the useability standard.

## Product Standard

Exo terminals must meet these user-facing requirements:

- Typing feels immediate in shell, Claude, Codex, and future terminal agents.
- Terminal output never visually corrupts during scroll, resize, tab switch, pane movement, theme change, or window hide/show.
- Live scrollback behaves predictably and follows user settings.
- Full transcripts remain durable and are clearly separate from live scrollback.
- Long-running shell commands and agent sessions survive window close, app relaunch, and normal macOS sleep/wake when the runtime supports persistence.
- Health/recovery states are visible and actionable.
- Terminal focus works on the first click after using editor, explorer, browser preview, or settings.
- Alternate-screen programs, wrapped lines, ANSI color/style output, status bars, and interactive prompts render correctly.
- Values that affect user-visible terminal behavior are configurable in workspace settings and exposed in the Settings UI with concrete units.

## Configuration And Debuggability Standard

Terminal behavior must not depend on hidden hardcoded caps or tuning values. Defaults are allowed, but they must be defaults for visible settings, not private limits embedded in runtime code.

Any value that can change user-visible capability, reliability, latency, history, or recovery behavior must live in workspace settings and be visible/editable in Settings:

- live scrollback line count
- transcript retention
- terminal read/tail defaults and maximums used by CLI/MCP/app reads
- input coalescing delay
- agent startup/message-submit timing
- initial and minimum terminal geometry

Implementation constants are allowed only when they are protocol facts or internal invariants rather than user capability limits. Examples: ANSI/tmux key names, escape-sequence parsing tokens, fixed command protocol route names, and test fixture values.

Every new terminal value must be classified before merge:

- user setting exposed in Settings UI
- documented internal invariant with a clear reason it should not be user-tunable
- test-only fixture value

If a value would help a human debug lag, scrollback, rendering, focus, process survival, or agent-read behavior, it belongs in config and Settings.

## Pass/Fail Criteria

A terminal change is not ready unless all relevant criteria pass:

- Idle local shell input p50 echo latency is under 75 ms and p90 is under 150 ms in Electron QA.
- Output-streaming shell input should target p50 under 100 ms and p90 under 250 ms once the streaming latency suite lands.
- No single local keystroke takes longer than 300 ms unless the terminal process itself is intentionally blocked.
- No active terminal calls bounded-tail hydration while its xterm instance is mounted.
- Large output bursts preserve visible bottom output, expected scrollback markers, and transcript contents.
- Tab switching and pane resizing do not blank the viewport, show stale `[exited]`, or replay stale scrollback over current output.
- The terminal remains interactive after close-window/show-window and after app relaunch when a persistent runtime is enabled.
- Manual sleep/wake QA passes for at least shell and one fake agent session before any runtime persistence change is considered complete.

These thresholds are product targets, not hidden caps. If they are too strict or too loose, update this document and the tests together.

## Automated Test Strategy

Automated and routine QA must not depend on live Claude/Codex inference. Provider inference is slow, flaky, network/model dependent, and confounds terminal quality with provider behavior.

Use deterministic local stand-ins instead:

- `/bin/cat` for input echo and focus tests.
- Shell scripts for burst output, wrapped lines, and long scrollback.
- Fake Claude/Codex commands that emit realistic ANSI output, streaming paragraphs, status/footer lines, spinner/update sequences, prompt markers, and then wait for input.
- Local alternate-screen tools such as `less`, `vim`, or `top` where feasible.
- Controlled process kill, bridge detach, app relaunch, and tmux reattach scenarios.

Real Claude/Codex sessions belong in short manual smoke checks and dogfooding, not in CI gates.

## Required Automated Coverage

### Latency

- Type 100 characters into `/bin/cat` and measure input-to-visible-echo latency.
- Repeat while another terminal streams output.
- Repeat after switching from editor/explorer/browser panes back to terminal.
- Record p50/p90/max latency through test diagnostics.

### Rendering Integrity

- Emit 10k+ lines with top, middle, and bottom markers.
- Emit long wrapped lines wider than the terminal.
- Emit ANSI colors, bold, dim, inverse, carriage-return updates, and status/footer-like output.
- Resize panes while output is streaming.
- Switch terminal tabs while output is streaming.
- Scroll up while output is streaming, then return to bottom.
- Assert expected markers remain visible or reachable and no stale replay occurs.

### Scrollback

- Generate 5k, 50k, and stress-scale line bursts in focused suites.
- Verify live scrollback follows the configured line count.
- Verify transcript reads preserve full output independently from live scrollback.
- Verify scroll to top/middle/bottom after tab switches and pane resizes.

### Persistence And Recovery

For tmux-backed runtime work:

- Create shell/fake-agent sessions and verify tmux sessions/panes exist.
- Close Exo window and reopen; input continues.
- Quit/relaunch Exo and reattach; process continues.
- Kill the bridge pty/client while the tmux pane keeps running; Exo reattaches.
- Kill the tmux pane; Exo shows an exited/dead state and recovery actions.
- Verify transcripts continue across detach/reattach.

### Hydration Invariant

- Mounted/live terminals receive append events only.
- `terminals.read()` is allowed for initial mount, explicit transcript/tail commands, and reattach snapshots.
- `terminals.read()` must not be called by active-tab focus, routine session polling, or metadata refresh for an already mounted terminal.
- `TerminalView` must not `reset()` xterm during active focus or normal tab switching.

## Manual QA Script

Run this before marking terminal runtime work complete:

1. Launch installed Exo.
2. Open shell, fake Claude, and fake Codex terminals.
3. Type quickly for 30 seconds in each; verify no missed characters or visible lag.
4. Run:

   ```bash
   yes "exo terminal stress $(date)" | head -n 50000
   ```

5. Scroll to top, middle, and bottom.
6. Switch terminal tabs at least 20 times.
7. Resize editor/terminal/browser-preview panes while output streams.
8. Close the Exo window, reopen, and continue typing.
9. Relaunch Exo and verify persistent sessions reattach when tmux runtime is implemented.
10. Sleep and wake the Mac during a shell command and fake-agent wait loop.
11. Confirm no stale pasted history, blank viewport, clipped bottom line, focus miss, or scrollback loss.

## Instrumentation Needed

Terminal diagnostics should expose:

- runtime kind
- session id and backend id
- process/pane status
- bridge attached/detached status
- last input time
- last output time
- input echo latency
- pty/tmux write latency
- xterm write queue bytes
- xterm write drain latency
- live scrollback line count
- configured terminal runtime values
- transcript path and write status
- last resize dimensions and timestamp

The UI should surface unhealthy states without requiring users to inspect logs.

-- Shoshin | 2026-06-18
