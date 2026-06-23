# Terminal Stability

Use this skill before changing Exo terminal runtime, terminal rendering, terminal settings, terminal tests, or agent terminal launch behavior.

## Standard

Terminal work is launch-blocking. Exo terminals must feel like a normal local terminal while preserving long-running shell and agent sessions across window close, app relaunch, renderer reload, and normal laptop use.

The current product decision is:

```text
xterm.js live surface
  -> Exo renderer terminal bridge
  -> Exo main TerminalManager facade
  -> tmux control-mode runtime
  -> tmux pane
  -> shell / Claude / Codex / Pi / future harness
```

Do not reintroduce direct `node-pty` as a fallback path or user-facing transport option without an explicit architecture decision update.

## Ownership Rules

- tmux owns durable process lifetime, pane identity, backend history, and external debugging.
- xterm owns live screen rendering, local scrollback, alternate-screen behavior, selection, and visual terminal state.
- Transcripts are append-only durable history. Do not use transcript contents as the normal live-render source.
- React state owns metadata only: session lists, active ids, health, hydration status, and layout placement.
- `TerminalManager` should be a facade over runtime/session/health/transcript services, not an ever-growing owner of every terminal concern.

## Hard Invariants

- Mounted live terminals receive append events only.
- Do not call `terminal.reset()` or replay a full snapshot on normal tab switch, pane focus, pane move, preview focus, or metadata refresh.
- `terminals.read()` is allowed for first mount, explicit reconnect snapshots, CLI/MCP reads, and transcript/tail commands. It must not be a routine active-terminal render path.
- Live scrollback, read tail sizes, transcript retention, timing values, and terminal geometry limits must be user-visible settings with concrete units. No hidden user-capability caps.
- Running-session live reads should prefer fresh tmux capture over stale renderer/main-process buffers.
- Reconnect is explicit recovery and may force a snapshot; ordinary focus is not recovery.
- Fake local agents should be used for automated tests. Do not depend on live Claude/Codex inference in CI.

## Before Editing

Read these first:

- `docs/terminal-quality-standard.md`
- `docs/terminal-architecture-v3.md`
- `docs/terminal-runtime-decision.md`
- `apps/desktop/src/main/terminal-manager.ts`
- `apps/desktop/src/renderer/src/components/TerminalView.tsx`
- `apps/desktop/src/renderer/src/hooks/useTerminalSessions.ts`

If your change touches harness launch behavior, also inspect:

- `packages/core/src/agent-harness-registry.ts`
- `packages/core/src/agent-harnesses/`
- `packages/core/src/runtime.ts`

## Preferred Change Shape

- Prefer small boundary extractions over more conditionals in `TerminalManager`.
- Put tmux command details in tmux runtime/helper modules.
- Put renderer hydration state in focused hooks/helpers, not scattered component effects.
- Keep terminal settings in `packages/core/src/terminal-settings.ts` and expose user-visible values in Settings.
- Add a regression test for the exact failure class before or with the fix.

## Refactor Order

When simplifying terminal code, prefer this order:

1. Extract renderer hydration into an explicit state machine.
2. Move harness-specific readiness and queued semantic-send behavior out of `TerminalManager`.
3. Split live-tail policy from session lifecycle.
4. Remove or migrate legacy history-mode settings to explicit scrollback/read-tail/transcript fields.
5. Replace broad preview-pane terminal refresh calls with a scoped `TerminalView` visibility/fit contract.

Do not optimize or add recovery behavior before the relevant owner boundary exists.

## Required Checks

For terminal runtime or renderer changes, run the smallest relevant set first:

```bash
pnpm --filter @exo/desktop exec vitest run src/main/terminal-manager.test.ts src/main/terminal-tmux.test.ts src/main/terminal-runtime-tmux.test.ts src/main/terminal-recovery-service.test.ts
pnpm --filter @exo/desktop exec vitest run src/renderer/src/App.test.tsx
```

For CLI/MCP terminal contract changes:

```bash
pnpm --filter @exo/cli test
pnpm --filter @exo/mcp test
```

Before handoff of any user-visible terminal work:

```bash
pnpm check:repo
pnpm stable:smoke
pnpm --filter @exo/desktop build
```

`pnpm stable:smoke` may require local process/localhost permissions.

## Manual QA

After code changes, restart Exo and test in the real Electron app:

1. Open shell, Claude, and Codex terminals.
2. Type quickly and verify first-click focus and no visible lag.
3. Generate large output and scroll top/middle/bottom.
4. Switch terminal tabs and move panes while output exists.
5. Open preview beside terminal and type while resizing.
6. Relaunch Exo and verify tmux-backed sessions reattach.
7. Confirm no blank viewport, stale pasted history, replacement glyph corruption, clipped bottom line, or scrollback loss.

## Red Flags

Stop and redesign if a fix adds:

- a second live terminal buffer that can beat tmux/xterm state
- a full xterm reset outside first mount or reconnect
- transcript replay into a mounted terminal
- provider-specific logic inside low-level terminal runtime
- a hidden cap or timing value
- broad refresh calls that mask layout/focus bugs
- tests that pass without asserting visible terminal behavior

-- Shoshin | 2026-06-23
