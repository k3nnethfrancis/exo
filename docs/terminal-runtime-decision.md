# Terminal Runtime Decision

Last reviewed: 2026-07-25

## Decision

Exograph has one production terminal runtime: a direct `node-pty` process rendered by xterm.js.

```text
xterm.js
  <-> renderer terminal bridge
  <-> TerminalManager
  <-> direct node-pty process
  <-> shell or configured Command
```

This supersedes the tmux control-mode, restore, transcript, built-in harness, and provider-specific terminal architecture. Those systems are not fallbacks and must not shape new code.

## Ownership

- xterm owns the live screen, viewport, selection, alternate-screen behavior, and ordinary scrollback.
- The direct PTY owns process lifetime, byte-faithful input/output, resize, and exit.
- `TerminalManager` owns app-facing session metadata and lifecycle operations.
- A bounded in-memory tail supports renderer reload and explicit operator reads. It is not a transcript or a second screen.
- Configured Commands and `InvocationRunner` own agent/tool launch and review. Terminal core does not identify providers or interpret prompts.

## Lifetime

Closing and reopening the Exograph window does not end a PTY while the desktop process remains alive. Quitting the Exograph process ends its PTYs. Renderer reload may replay bounded memory, but Exograph does not promise process persistence across app exit.

Users who need durable shell sessions may run tmux themselves inside a normal Exograph terminal. Provider-native resume remains provider-owned.

## Input and scroll

Input passes through byte-for-byte. Spaces, paste, Enter, Ctrl-C, Escape, arrows, mouse reports, and resize are not translated into tmux or provider-specific commands.

Ordinary shell wheel, trackpad, and selection stay with xterm. A full-screen TUI may own wheel input only while mouse mode is active; Exograph must make that ownership visible and provide a documented modifier escape to local scrollback.

## Testing boundary

The production factory is direct `node-pty`; a deterministic fake exists only for tests. Automated coverage uses local shells and fake Commands, never live model inference.

Required proof covers input fidelity, resize, ordinary and mouse-mode
scrolling, mounted-tab preservation, bounded reload replay, renderer fallback,
Command launch, and honest app-exit behavior. Run the focused terminal Electron
journey as part of any terminal-runtime change.
