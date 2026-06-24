# Terminal Runtime Decision

Last updated: 2026-06-24

## Decision

Exo should move to a tmux-backed core terminal runtime.

The target architecture is:

```text
xterm.js renderer
  <-> Exo terminal renderer bridge
  <-> TerminalManager
  <-> tmux control-mode bridge (`tmux -C`)
  <-> tmux pane
  <-> shell / Claude / Codex / future terminal agent
```

`node-pty` is not part of the current terminal runtime. The durable user process lives inside tmux, and Exo attaches through a narrow tmux control-mode bridge that streams pane output/input without rendering a nested tmux client viewport.

There should be one standard terminal runtime path for daily Exo use. Do not expose a direct-pty versus tmux preference, do not keep direct pty as a hidden fallback, and do not reintroduce mixed terminal transports inside `TerminalManager`.

If tmux is unavailable, Exo should show a clear dependency/setup error and disable terminal creation until fixed.

## Current Reassessment

The tmux-backed persistence decision still stands: Exo needs durable sessions for long-running shell, Claude, Codex, Pi, and future harness work.

The current target is embedded-first, tmux-durable, and xterm-owned. The embedded path is:

```text
tmux pane
  <-> tmux control-mode bridge
  <-> Exo decoder / IPC
  <-> xterm.js
```

That path gives Exo an integrated terminal surface, but it also makes Exo responsible for terminal-emulator-grade behavior: Unicode decoding, control sequences, scrollback, resize, hydration, reconnect, and renderer lifecycle. Repeated field reports show this is the highest-risk part of the terminal system, so launch-readiness work must simplify and harden this bridge rather than demote embedded terminal use.

Native tmux attach remains a debug/recovery escape hatch, not the primary UX:

- Exo supervises durable tmux sessions.
- Exo can create, list, send semantic messages to, interrupt, terminate, and diagnose sessions.
- Exo keeps transcripts and configurable live tails.
- Exo can open a real external terminal attached to the tmux session for full-fidelity interaction.
- Embedded terminal surfaces must meet `terminal-quality-standard.md` before terminal launch-readiness is considered complete.

Do not use simplification as a feature cut. Any replacement for the current bridge must satisfy daily Exo-on-Exo useability, agent monitoring, persistence, and recovery requirements.

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
- user-visible terminal caps and tuning values must come from workspace settings and be exposed in Settings UI
- full transcripts must remain durable
- no automated test should depend on live Claude/Codex inference
- fake provider commands should cover agent-like terminal behavior deterministically

## Implementation Rule

Implement tmux behind one explicit terminal runtime boundary.

Allowed:

- `TerminalManager` delegates lifecycle to a tmux-backed runtime.
- tmux control mode attaches Exo to the tmux pane for live rendering/input.
- Exo persists its own session registry mapping Exo terminal ids to tmux sessions/panes.
- Exo exposes clear health and recovery actions.

Not allowed:

- direct pty as a hidden fallback
- `node-pty` as a stale attach bridge or hidden fallback
- user-facing runtime transport preference
- scattered tmux command construction inside unrelated code
- hidden hardcoded terminal caps or timing values that are not configurable in Settings
- using React state as the live terminal output source
- routine `terminals.read()` hydration for mounted/live terminals
- automated tests that call real Claude/Codex inference

## Detailed Plan

Use `docs/terminal-architecture-v4.md` for the current simplification and module-boundary proposal. `docs/terminal-refactor-plan.md` is retained as historical migration context and should not be treated as the current implementation plan.

-- Shoshin | 2026-06-18
