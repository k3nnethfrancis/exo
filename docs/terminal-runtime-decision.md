# Terminal Runtime Decision

Last updated: 2026-06-13

## Decision

Exo should move to a tmux-backed core terminal runtime.

The target architecture is:

```text
xterm.js renderer
  <-> Exo terminal renderer bridge
  <-> node-pty attach process
  <-> tmux session/window/pane
  <-> shell / Claude / Codex / future terminal agent
```

`node-pty` remains part of the implementation, but only as the local bridge that attaches Exo to tmux. The durable user process should live inside tmux.

There should be one standard terminal runtime path for daily Exo use. Do not expose a direct-pty versus tmux preference, do not keep direct pty as a hidden fallback, and do not reintroduce mixed terminal transports inside `TerminalManager`.

If tmux is unavailable, Exo should show a clear dependency/setup error and disable terminal creation until fixed.

## Why This Changed

On 2026-05-28, Exo simplified core terminals to direct `node-pty` only. That was the right cleanup at the time because the previous tmux path was partially integrated, stale, and made terminal bugs harder to isolate.

Fresh setup and daily-use reports changed the product evidence:

- Direct pty terminals can break after macOS sleep/wake.
- Long-running shell commands, builds, Claude sessions, and Codex sessions need process survival.
- Transcript recovery is useful but is not equivalent to preserving a running process.
- Exo terminals are central to the product, second only to the editor.

The current product priority is useability and trust. If Exo terminals lag, corrupt output, lose scrollback, or kill long-running sessions in situations where a user expects a normal terminal to survive, the terminal system fails.

## Tradeoff Assessment

Direct pty advantages:

- Lowest-latency and simplest direct process path.
- Fewer layers during write, resize, and output streaming.
- Simpler child-process diagnostics.
- Smaller implementation surface.

Direct pty costs:

- Does not preserve the running process across app crash/relaunch.
- Has shown real-world sleep/wake reliability risk.
- Cannot be externally attached by advanced users.
- Requires provider resume or transcript reconstruction instead of true process persistence.

Tmux advantages:

- Preserves running processes across UI disconnects and app relaunch.
- Provides a durable session primitive that fits long-running terminal agents.
- Supports external attach for advanced debugging.
- Gives Exo a concrete reattach target after renderer/main-process recovery.

Tmux costs:

- Adds a layer that can introduce latency or failure modes if poorly integrated.
- Requires explicit diagnostics for tmux session, pane, attach bridge, and transcript state.
- Requires dependency handling in install and packaged app flows.
- Exo must avoid duplicating tmux's pane/window model in the UI; Exo owns UI layout, tmux owns process/session persistence.

Given Exo's intended use, process persistence and sleep/relaunch resilience are higher-priority than the marginal latency advantage of direct pty. The implementation must still meet strict latency and rendering standards; tmux is not acceptable if it creates user-visible lag or corruption.

## Required Standards

The terminal refactor must satisfy `docs/terminal-quality-standard.md`.

In particular:

- typing must feel immediate
- mounted terminals must receive live append events only
- xterm must not reset/replay during normal focus or tab switching
- scrollback must be predictable and configurable
- full transcripts must remain durable
- no automated test should depend on live Claude/Codex inference
- fake provider commands should cover agent-like terminal behavior deterministically

## Implementation Rule

Implement tmux behind one explicit terminal runtime boundary.

Allowed:

- `TerminalManager` delegates lifecycle to a tmux-backed runtime.
- `node-pty` attaches Exo to tmux for live rendering/input.
- Exo persists its own session registry mapping Exo terminal ids to tmux sessions/panes.
- Exo exposes clear health and recovery actions.

Not allowed:

- direct pty as a hidden fallback
- user-facing runtime transport preference
- scattered tmux command construction inside unrelated code
- using React state as the live terminal output source
- routine `terminals.read()` hydration for mounted/live terminals
- automated tests that call real Claude/Codex inference

## Detailed Plan

See `docs/terminal-refactor-plan.md`.

-- Shoshin | 2026-06-13
