# Terminal Runtime Decision

Last updated: 2026-07-03

## Decision

Exo's terminal runtime is tmux control-mode plus the V4.1 geometry-convergence loop. This is the final product architecture after the 2026-07-03 plain-attach spike.

The target architecture is:

```text
xterm.js renderer
  <-> Exo terminal renderer bridge
  <-> TerminalManager
  <-> tmux control-mode bridge (`tmux -C`) with renderer-recorded geometry convergence
  <-> tmux pane
  <-> shell / Claude / Codex / future terminal agent
```

`node-pty` is not part of the current product terminal runtime. The durable user process lives inside tmux, and Exo attaches through a narrow tmux control-mode bridge that streams pane output/input without rendering a nested tmux client viewport.

There is one standard terminal runtime path for daily Exo use. Do not expose a direct-pty versus tmux preference, do not keep direct pty as a hidden fallback, do not keep plain tmux attach as a hidden product fallback, and do not reintroduce mixed terminal transports inside `TerminalManager`.

If tmux is unavailable, Exo should show a clear dependency/setup error and disable terminal creation until fixed.

## Final Transport Closure

On 2026-07-03, `docs/terminal-attach-spike-report.md` closed the remaining transport question. The spike evaluated `node-pty` running `tmux -u attach -t {session}` as an Exo live attach transport. It was spike-only, selected by `EXO_TERMINAL_RUNTIME=pty-attach-spike`, and no spike runtime code or `node-pty` dependency was added to this checkout.

Decision: keep tmux control mode and the geometry-convergence loop. Kill plain attach as a product runtime path. The spike branch remains reference evidence only.

Kill-threshold summary:

- Scrollback/reconnect: control mode preserved all 220 generated scrollback markers exactly once across resize and explicit reconnect; pty attach lost useful xterm live scrollback.
- Render stability: the selected fake-Claude render-stability e2e passed 5/5 under control mode and failed under pty attach.
- Latency: pty attach was not meaningfully faster. The spike measured p50 25.31 ms for control mode and p50 26.74 ms for pty attach.
- Packaging cost: pty attach required `node-pty` native build approval, Electron ABI rebuild, and bundler externalization before behavior could even be compared.

## Pty Terminology

There are two different pty ideas. Do not conflate them:

- Direct pty to the harness process means Exo starts the shell/Claude/Codex/Pi process directly under a pty owned by Exo. This was banned by the tmux durability decision and remains banned because it cannot provide tmux process persistence, external attachability, or durable session recovery.
- Pty attach to tmux means Exo keeps the durable user process inside tmux, but attaches to that tmux session by running a nested tmux client under `node-pty`. This was a distinct transport option. It was evaluated in the 2026-07-03 spike and rejected on evidence.

The surviving architecture is neither of those pty paths. It is tmux control mode into Exo's decoder/IPC/xterm surface, with renderer geometry recorded and reasserted on create, attach, reconnect, and restore.

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

Native tmux attach from an external terminal remains an operator debug/recovery escape hatch, not an Exo product runtime path:

- Exo supervises durable tmux sessions.
- Exo can create, list, send semantic messages to, interrupt, terminate, and diagnose sessions.
- Exo keeps transcripts and configurable live tails.
- Exo can help an operator open a real external terminal attached to the tmux session for full-fidelity debugging.
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

Tmux control-mode advantages:

- Preserves running processes across UI disconnects and app relaunch.
- Provides a durable session primitive that fits long-running terminal agents.
- Supports external attach for advanced debugging.
- Gives Exo a concrete reattach target after renderer/main-process recovery.

Tmux control-mode costs:

- Adds a layer that can introduce latency or failure modes if poorly integrated.
- Requires explicit diagnostics for tmux session, pane, attach bridge, and transcript state.
- Requires dependency handling in install and packaged app flows.
- Exo must avoid duplicating tmux's pane/window model in the UI; Exo owns UI layout, tmux owns process/session persistence.

Given Exo's intended use, process persistence and sleep/relaunch resilience are higher-priority than the marginal latency advantage of direct pty. The 2026-07-03 spike also showed plain pty attach to tmux did not buy a latency or correctness win. The implementation must still meet strict latency and rendering standards; tmux control mode is only acceptable because the V4.1 geometry-convergence evidence shows it can preserve scrollback and reconnect behavior.

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
- renderer-recorded geometry is asserted on create, attach, reconnect, and restore.
- Exo persists its own session registry mapping Exo terminal ids to tmux sessions/panes.
- Exo exposes clear health and recovery actions.

Not allowed:

- direct pty as a hidden fallback
- `node-pty` as a direct harness runtime, stale attach bridge, plain tmux attach product runtime, or hidden fallback
- user-facing runtime transport preference
- scattered tmux command construction inside unrelated code
- hidden hardcoded terminal caps or timing values that are not configurable in Settings
- using React state as the live terminal output source
- routine `terminals.read()` hydration for mounted/live terminals
- automated tests that call real Claude/Codex inference

## Detailed Plan

Use `docs/terminal-architecture-v4.md` for the current simplification and module-boundary proposal. `docs/terminal-refactor-plan.md` is retained as historical migration context and should not be treated as the current implementation plan.

-- Shoshin | 2026-06-18
