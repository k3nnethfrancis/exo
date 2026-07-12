---
name: terminal-stability
description: Use before changing Exo terminal runtime, rendering, settings, tests, or terminal-backed Command launch behavior. Keeps the current direct-PTY, xterm-owned, provider-neutral terminal aligned with byte fidelity, bounded replay, honest lifetime, and real Electron QA invariants.
---

# Terminal Stability

Use this skill before changing Exo terminal runtime, terminal rendering, terminal settings, terminal tests, or terminal-backed Command launch behavior.

## Required Orientation

Read these current sources first:

- `AGENTS.md`
- `tasks.md` and `issues.md` for active scope and terminal evidence
- `docs/terminal-runtime-decision.md`
- `apps/desktop/src/main/terminal-manager.ts`
- `apps/desktop/src/renderer/src/components/TerminalView.tsx`
- `apps/desktop/src/renderer/src/hooks/useTerminalSessions.ts`
- `packages/core/src/agent-invocation.ts` when Command launch is involved

Treat terminal-era restore, persistent-history, and built-in-agent documents as historical unless a current task explicitly reopens them.

## Current Decision

As of the 2026-07-09 Exograph refactor review, Exo's V1 terminal path is:

```text
xterm.js live surface
  -> Exo renderer terminal bridge
  -> Exo main TerminalManager facade
  -> direct node-pty runtime
  -> shell or configured Command
```

The previous tmux-control-mode architecture is superseded for this branch. Do not rebuild it, preserve it as a hidden fallback, or treat tmux durability, restore snapshots, or terminal transcripts as V1 product requirements.

Users who want tmux durability can run `tmux` inside a normal Exo terminal. Claude, Codex, Pi, Guardian, and similar tools should resume through their own session mechanisms. Exo records explicit invocations and reviewed file outcomes without interpreting provider semantics.

## Ownership Rules

- xterm owns the live terminal screen, scrollback viewport, alternate-screen behavior, selection, and visible terminal state.
- The direct pty runtime owns the child process, byte-for-byte input/output transport, resize, and process exit.
- `TerminalManager` owns app-facing metadata and lifecycle APIs only: create/list/write/send/resize/kill/read-live-tail/diagnostics.
- React state owns metadata only: sessions, active ids, health, and layout placement.
- Invocation provenance belongs to `InvocationRecord`, observed file changes, and review references, not terminal transcript mirroring.

## Hard Invariants

- Terminal input bytes must pass through without Exo re-encoding them into tmux commands or provider-specific key translations.
- Spaces, paste, Enter, Ctrl-C, Escape, arrows, and resize must have focused tests before this branch is called done.
- Mounted live terminals receive append events only.
- Do not call `terminal.reset()` or replay a full snapshot on normal tab switch, pane focus, pane move, preview focus, or metadata refresh.
- Direct pty output is streamed to xterm and to a byte- or character-bounded live tail only where current UI/CLI callers need a short readback, including output without newlines.
- No terminal transcript persistence, restore snapshot, or session-after-restart feature should be added without a new explicit architecture review.
- Fake local agent commands should be used for automated tests. Do not depend on live Claude/Codex/Fable inference in CI.
- Command launch must route through configured data-only Commands and InvocationRunner, not a built-in harness registry or readiness manager.
- Ordinary shell wheel, trackpad, and selection stay with xterm. A mouse-mode TUI may own wheel input only with a visible indicator and documented modifier escape to local scrollback.
- App exit ends the PTY. Renderer reload may replay bounded memory, but Exo must not imply durable process persistence.

## Before Editing

Before changing CLI commands/flags, command-server routes, or shared protocol types, stop unless the task includes the required lead/architect approval.

## Preferred Change Shape

- Delete tmux/session/transcript/recovery code when callers have moved; do not hide or freeze it.
- Keep `TerminalManager` as a small facade over a direct pty runtime and bounded live-tail/diagnostics helpers.
- Keep terminal launch command-oriented. Shell is a terminal substrate; Claude/Codex/Pi/Guardian-style launches are configured Commands.
- Avoid provider-specific readiness, prompt scanning, queued-send, or semantic-message logic in terminal core.
- Add regression tests for the exact input behavior that changed.

## Required Checks

For terminal runtime or renderer changes, run the focused terminal tests that remain after the direct-pty deletion pass. During the migration, update `pnpm terminal:check` to stop naming deleted tmux tests.

Before handoff of user-visible terminal work:

```bash
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
pnpm check:repo
pnpm --filter @exo/desktop build
```

Run focused Playwright coverage for terminal input and configured Command launch. Run `pnpm terminal:check` only after confirming it names live direct-PTY tests.

## Manual QA

After code changes, restart Exo and test in the real Electron app. Use the packaged app for installed-path or lifecycle claims:

1. Open a shell terminal.
2. Type words with spaces quickly.
3. Paste multi-line text.
4. Press Enter, Ctrl-C, Escape, arrows, and Backspace.
5. Resize terminal panes and verify the pty receives the new geometry.
6. Launch at least one configured Command and verify prompt delivery through the normal invocation path.
7. Open a preview/editor beside the terminal and verify first-click focus still types into xterm.
8. Exercise ordinary scrollback, a mouse-mode TUI, and its modifier escape.
9. Reload the renderer and verify bounded replay; exit the app and verify the UI does not promise process survival.

## Red Flags

Stop and redesign if a change adds:

- tmux control-mode, tmux `send-keys`, restore snapshots, or hidden runtime fallback
- transcript replay into a mounted live terminal
- provider-specific readiness or prompt scanning in low-level terminal code
- a second live terminal buffer that can beat xterm state
- a hidden cap or timing value that affects user capability
- broad refresh calls that mask layout/focus bugs
- tests that pass without asserting visible terminal input behavior

-- Shoshin | 2026-07-09
