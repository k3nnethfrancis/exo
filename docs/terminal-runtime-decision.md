# Terminal Runtime Decision

Last updated: 2026-05-28

## Decision

Exo's core terminal runtime should use direct `node-pty` sessions as the default and only built-in process path.

Tmux should not be kept as a hidden fallback, partial compatibility path, or mixed-in recovery mechanism inside the default terminal manager. If Exo supports tmux later, it should be a deliberate adapter or plugin with a clear user workflow, explicit UI, and tests that validate the full tmux integration model.

## Why

Exo needs terminal responsiveness, reliable input delivery, clear health diagnostics, and a codebase that future agents can modify safely. A direct pty path keeps the control loop simple:

```text
Exo app <-> node-pty <-> shell / Claude / Codex
```

The previous tmux path added another layer:

```text
Exo app <-> node-pty <-> tmux attach <-> tmux session <-> shell / Claude / Codex
```

That extra layer can provide process survival, but it also duplicates responsibilities that Exo already owns or should own directly: panes, tabs, scrollback, transcripts, health, resize, and session lifecycle. Keeping both paths in core makes bugs harder to isolate and encourages fallback code instead of a strong product model.

## Tradeoffs

Direct pty advantages:

- Lowest-latency input and output path.
- Fewer moving parts during resize, tab switching, and long output streams.
- Easier health model: Exo supervises the actual child process.
- Better fit for Exo-owned panes, tabs, transcripts, settings, and diagnostics.
- Smaller code surface for terminal management and future agent contributions.

Direct pty costs:

- Terminal processes normally do not survive an Exo app crash or full quit.
- Persistence needs to come from transcripts, provider resume commands, or a future Exo-native session model.
- Users cannot attach to the same live terminal from an external terminal window by default.

Tmux advantages:

- Processes can survive UI crashes, disconnects, and app restarts.
- Advanced users can attach from another terminal.
- Tmux has its own scrollback and session/window model.

Tmux costs:

- More latency and more failure modes in the default path.
- Input delivery becomes harder to reason about because Exo writes to a tmux attach process, not directly to the agent process.
- Diagnostics must account for attach process state, pane state, session state, dead panes, readonly clients, current commands, and detached clients.
- Exo and tmux both try to own panes, tabs, history, lifecycle, and persistence.
- Cross-platform behavior becomes harder to support.

## Current Product Direction

Use direct pty for shell, Claude, and Codex terminals.

Use durable transcripts for history and recovery context. A terminal transcript is the durable record; live scrollback is a user-facing performance/history setting for the active UI.

Use provider-native resume flows or future Exo-native session persistence for agent recovery. Do not use tmux as an implicit process survival layer.

## Revisit Criteria

Reconsider tmux only if a concrete product workflow requires live process survival across Exo restarts and direct pty plus transcripts/provider resume is insufficient.

Before adding tmux back, write a short design that answers:

- Is this core behavior or a plugin/adapter?
- Does it use tmux control mode or another explicit integration contract?
- How are panes, windows, tabs, and Exo terminal ids mapped?
- Who owns scrollback: Exo, tmux, or both?
- How does input delivery preserve exact whitespace and multiline prompts?
- How are resize events coalesced?
- What health states are exposed to users?
- What happens on Exo quit, crash, app restart, terminal close, and process exit?
- What automated and in-app QA proves it works?

## Implementation Rule

Do not add a second terminal transport, hidden fallback, or compatibility branch to the core terminal manager unless the PR also includes the product workflow, design decision, tests, and UI/diagnostic story that justify it.

If persistence becomes urgent, prefer this order:

1. Direct pty plus transcripts and provider resume commands.
2. Exo-native process reconnection/revive model.
3. Explicit tmux adapter/plugin.

