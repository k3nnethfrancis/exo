# Terminal Quality Standard

Last updated: 2026-07-11

Exo terminals should behave like a normal local terminal. The operational source of truth is `skills/terminal-stability/SKILL.md`; the runtime decision is `terminal-runtime-decision.md`.

## Product standard

- Input is immediate and byte-faithful.
- Output remains intact through resize, tab changes, pane changes, theme changes, window hide/show, and renderer reload.
- xterm owns the live screen, selection, ordinary scrollback, and alternate-screen behavior.
- A bounded in-memory tail exists only for renderer reload and explicit reads.
- Quitting the desktop process ends its PTYs; no UI or documentation promises restore, transcripts, or app-exit persistence.
- Shell is the terminal substrate. External agents and tools launch through provider-neutral configured Commands and the normal invocation path.
- Focus returns to xterm on the first intentional click or keyboard action.
- Mouse-mode TUI scroll ownership is visible and has a documented modifier escape to local scrollback.

## Configuration discipline

Expose user outcomes, not implementation tuning. Font size and genuine user-facing scrollback choices may be settings. Delivery coalescing, replay bounds, geometry timing, health thresholds, and provider startup timing stay internal when they are implementation invariants rather than user capabilities.

Do not add:

- a tmux/direct-PTY selector;
- transcript retention or restore settings;
- provider-specific prompt scanning or readiness inside terminal core;
- a second live screen buffer;
- hidden fallbacks that change terminal semantics.

## Automated coverage

Use deterministic local processes and fake Commands, not live Claude, Codex, Fable, or other inference.

Required cases:

- fast words with spaces, multiline paste, Enter, Backspace, Escape, arrows, and Ctrl-C;
- resize propagation to the PTY;
- burst output, long wrapped lines, ANSI styles, carriage-return repaint, Unicode, and output without newlines;
- ordinary wheel/trackpad scrollback and selection;
- alternate-screen mouse-mode ownership plus modifier escape;
- tab/pane switching without reset or full-buffer replay;
- hidden-but-mounted terminal preservation;
- renderer reload with bounded replay;
- WebGL renderer loss with DOM/canvas fallback;
- configured Command launch through the visible terminal and invocation path;
- desktop-process exit with no persistence claim.

Mounted terminals receive append events only. Normal focus, tab switching, pane movement, and metadata refresh must not call `terminal.reset()` or replay a full snapshot.

## Validation

Before handing off terminal-visible work:

```bash
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
pnpm --filter @exo/desktop build
pnpm check:repo
```

Then run the focused Electron terminal and configured-Command journeys. Installed-path, lifecycle, and packaging claims require the packaged app. Manual QA must cover ordinary shell input, paste, control keys, resize, scrollback, one mouse-mode TUI, one configured Command, renderer reload, and explicit app quit.

Any field-reported corruption shape should first be classified and reproduced using `terminal-render-cleanup-protocol.md` before changing transport or rendering behavior.
