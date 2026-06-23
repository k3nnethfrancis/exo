# Terminal Fallback Audit

Last updated: 2026-06-23

This audit documents terminal fallback and recovery behavior that is intentionally present in Exo. The goal is to keep useful degradation paths while deleting hedging branches that hide failures, add latency, or create competing terminal state.

## Fallback Policy

Fallbacks are allowed only when they preserve a user outcome without changing the terminal architecture.

Allowed:

- fail clearly when tmux is unavailable for terminal creation
- keep transcript-backed records visible when a persisted tmux session is gone
- keep the app open when diagnostics, pane listing, or tail capture fails
- merge output that arrives before xterm is mounted
- defer Codex semantic sends while startup prompts are settling

Not allowed:

- silently switching to another runtime or transport
- replaying transcripts into live terminals
- resetting mounted xterm on focus, tab switch, pane move, or preview focus
- converting missing terminals into apparent send success
- hiding user-visible caps, delays, or geometry limits outside settings
- adding provider-specific branches inside low-level terminal runtime

Every new fallback must answer:

1. What exact failure mode triggers it?
2. What user outcome does it preserve?
3. What bug could this fallback hide?
4. How is the fallback surfaced in diagnostics, UI, logs, or tests?
5. Why is this better than failing clearly?

## Current Fallbacks

| Area | Behavior | Reason | Steelman Against | Decision |
| --- | --- | --- | --- | --- |
| tmux discovery | Try `EXO_TMUX_PATH`, then common install paths. | Homebrew/system installs differ across machines. | Path probing can feel like hidden magic. | Keep. This is install-location discovery, not runtime fallback. Creation fails clearly if none work. |
| tmux unavailable during creation | Throw setup error. | Exo has one supported terminal runtime. | A direct pty fallback could keep shells usable. | Keep fail-clear. Avoid split runtime bugs. |
| tmux unavailable during diagnostics/restore | Mark sessions unhealthy/unknown instead of blocking app startup. | Users should still open Exo and access transcripts/settings. | Could make terminal state look recoverable when tmux is missing. | Keep with health details. |
| persisted exited sessions | Restore as transcript-backed no-op records. | Preserves transcript and exit diagnostics after relaunch. | Dead tabs can clutter UI. | Keep until there is a better transcript/recent-runs surface. |
| persisted running session missing from tmux | Restore as unhealthy transcript-backed record. | Avoids silently disappearing terminals after tmux cleanup/crash. | A stale record may imply the process is recoverable. | Keep, with `paneStatus: missing` and not-found writes. |
| bridge exits while pane is alive | Mark bridge detached and require reconnect. | The user process may still be alive in tmux. | Misclassification can leave a broken tab. | Keep; this is core persistence recovery. |
| bridge exits while pane is dead/missing | Mark shell exited or retire agent terminal. | Avoids stale writable-looking agent tabs after harness exit. | Some users may want the tab shell to return. | Keep current product behavior; revisit if harness lifecycle changes. |
| old bridge kill fails during reconnect | Ignore and continue attaching a new bridge. | The durable process is the tmux pane, not the old control bridge. | Could hide leaked child processes. | Keep; diagnostics should reveal repeated detached bridges. |
| tmux tail capture fails | Return bounded append cache for reads. | CLI/MCP/UI reads should not become blank during transient capture failure. | Cache can be stale and shorter than tmux truth. | Keep for now; harden diagnostics with capture-failure status later. |
| transcript reads of missing files | Return empty transcript. | Retention cleanup or missing logs should not crash callers. | Empty output hides data loss. | Harden later with transcript status in diagnostics. |
| raw printable input coalescing | Batch short printable writes. | Reduces tmux command overhead for typing. | Adds latency or ordering risk if it crosses semantic sends. | Keep because timing is configurable and raw buffer flushes before semantic sends. |
| Codex startup readiness queue | Queue submitted Codex messages until ready/block/grace. | Prevents prompts landing in trust/update interstitials. | Codex heuristics do not belong in `TerminalManager`. | Keep short-term; move to harness readiness service. |
| delayed semantic submit | Paste exact agent prompt, then send Enter after configured delay. | Preserves multiline/whitespace prompt input for harness UIs. | Delay can feel sluggish or race under load. | Keep because delay is configurable and semantic sends differ from raw keystrokes. |
| pending renderer output before xterm mount | Buffer bounded data and merge with first hydration snapshot. | Prevents blank terminals when output arrives before the terminal registers. | Bounded buffer can drop early output. | Keep; durable output remains in tmux/transcript. |
| hydration skip for already-mounted terminals | Do not call `terminals.read()` again unless forced. | Prevents reset/replay over live xterm. | Pending output edge cases can be missed. | Keep; flush pending data without full read. |
| focus double-pass | Focus/refresh after animation frame and zero-delay timeout. | xterm may not have measurable dimensions immediately after React layout commits. | Looks like a layout hack and may hide preview bugs. | Keep short-term; replace with explicit visibility/fit ownership. |
| xterm write failure | Log and stop the failed write chunk. | Avoids crashing renderer. | Causes visual truncation without user-facing unhealthy state. | Harden later: mark render unhealthy or retry once. |
| xterm generated-response filter | Drop device/OSC responses before they reach tmux. | Prevents query responses from appearing as typed input. | Regex could suppress legitimate user input. | Keep with tests for every added response form. |

## Removed In This Pass

- Removed the unused `programmaticInputGuardUntilRef` and `PROGRAMMATIC_INPUT_GUARD_MS` path from `TerminalView`. It looked like a protection against xterm-generated input but was never read, so it only added false confidence and cognitive load.

## Hardened In This Pass

- Persisted running sessions whose tmux pane is missing now restore as unhealthy transcript-backed records instead of disappearing.
- MCP `send_agent_message` now returns an error result for `not-found` delivery instead of reporting a sent message.
- Inline comments now explain the tmux discovery, transcript-backed restore, bridge-detach recovery, hydration merge, focus double-pass, semantic submit delay, and capture-failure fallback decisions.

## Remaining Hardening

- Add diagnostics for latest tmux capture failure time/message.
- Add transcript read/write status to terminal diagnostics.
- Return structured kill results so a failed tmux kill cannot look identical to a clean termination.
- Replace preview/focus refresh mitigation with a scoped `TerminalView` visibility and fit contract.
- Move Codex readiness/queued sends out of `TerminalManager` into harness readiness ownership.

-- Shoshin | 2026-06-23
