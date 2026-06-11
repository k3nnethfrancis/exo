# Terminal Runtime Decision

Last updated: 2026-06-11

## Current Status

This decision is reopened.

On 2026-05-28, Exo simplified core terminals to direct `node-pty` only. That was the right cleanup move at the time: the previous tmux path was partially integrated, added hidden fallback behavior, and made terminal bugs harder to isolate.

Fresh setup and daily-use reports on 2026-06-02 changed the product evidence. Direct pty terminals can break after macOS sleep/wake, and long-running Claude/Codex sessions or builds cannot be trusted if sleep can kill or corrupt the live process. Transcript recovery is useful but is not equivalent to process survival.

The active question is no longer "keep stale tmux compatibility code or direct pty only." The active question is:

```text
What terminal runtime gives Exo real-terminal reliability for daily agent work while keeping the codebase understandable?
```

Tmux-backed terminals are now a serious candidate for core daily-use terminals, not merely a hypothetical plugin.

## Previous Decision

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

## Current Product Direction Until Reimplementation

Use direct pty for shell, Claude, and Codex terminals.

Use durable transcripts for history and recovery context. A terminal transcript is the durable record; live scrollback is a user-facing performance/history setting for the active UI.

Use provider-native resume flows or future Exo-native session persistence for agent recovery. Do not reintroduce tmux as an implicit hidden fallback.

This is not sufficient as a final daily-use terminal model if sleep/wake reliably breaks live sessions.

## New Evidence

The 2026-06-02 setup report found:

- Terminals became non-functional after macOS sleep/wake.
- The user saw a security/violation-style error on resume.
- The issue affects both source and packaged app paths because both use direct `node-pty`.
- Long-running builds and agent sessions need the process to keep running, not just the transcript to remain readable.

This matters because Exo is meant to replace or centralize real terminal-agent workflows. Users expect a terminal session running a build or agent task to survive ordinary laptop sleep. If Exo cannot provide that, terminal trust is compromised.

## Updated Tradeoff Assessment

Direct pty remains the simplest and lowest-latency path. It is still attractive for clean supervision, diagnostics, and code simplicity.

However, sleep resilience and process persistence are now higher-priority product requirements than marginal keystroke latency. If tmux adds a few milliseconds of input latency but preserves live builds and agent sessions across sleep, that may be the better default for Exo's actual use case.

Transcript-based restore is not enough for this class of failure. It preserves history, but it does not preserve a running build, a Claude/Codex task in progress, or an interactive process waiting for an answer.

## Revisit Criteria

The revisit criteria have been met for macOS sleep/wake and long-running agent sessions.

Before adding tmux back, write and review a short design that answers:

- Is this core behavior or a plugin/adapter?
- Should tmux be the default for all terminals, only agent terminals, or a workspace setting?
- Does it use tmux control mode or another explicit integration contract?
- How are panes, windows, tabs, and Exo terminal ids mapped?
- Who owns scrollback: Exo, tmux, or both?
- How does input delivery preserve exact whitespace and multiline prompts?
- How are resize events coalesced?
- What health states are exposed to users?
- What happens on Exo quit, crash, app restart, terminal close, process exit, and macOS sleep/wake?
- What automated and in-app QA proves it works?
- How does a packaged app find and manage the tmux binary on machines where tmux is absent?
- What is the user-facing recovery path when a tmux session is dead, detached, or out of sync with Exo metadata?

## Implementation Rule

Do not add a second terminal transport, hidden fallback, or compatibility branch to the core terminal manager as an unreviewed hedge.

If tmux comes back, it should replace the current default terminal runtime intentionally or live behind one explicit, tested runtime boundary. It should not be layered in as scattered fallback code.

Next implementation planning should compare these paths:

1. Tmux-backed core terminals for process persistence.
2. Direct pty plus explicit sleep/wake detection, unhealthy-state recovery, and provider resume.
3. A hybrid model only if the boundary is simple, visible, and tested.

Given current evidence, path 1 deserves first-class design consideration.
