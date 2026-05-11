# Exo Resources

Last updated: 2026-05-02

## Local references

- Garden reference repo:
  - `/Users/kenneth/Desktop/lab/projects/garden`
- Master workspace task list:
  - `/Users/kenneth/Desktop/lab/notes/shoshin-codex/tasks.md`
- prior Garden project planning:
  - `/Users/kenneth/Desktop/lab/notes/shoshin-codex/projects/garden`

## Research harness references

- `autoresearch-macos`
  - `/Users/kenneth/Desktop/lab/projects/research/autoresearch-macos`
- `autoresearch-mlx`
  - `/Users/kenneth/Desktop/lab/projects/research/autoresearch-mlx`

## Memory references

Garden's learned memory architecture should carry forward conceptually:
- durable memory
- trace archive
- retrieval/index
- working-memory assembly

QMD remains a retrieval/index reference, not a hard dependency.

## Runtime references

- Exo command server discovery:
  - `${workspace_root}/.exo/server.json`
- Exo main-process log:
  - `$HOME/Library/Application Support/@exo/desktop/exo-main.log`
- macOS Electron crash reports:
  - `$HOME/Library/Logs/DiagnosticReports/Electron-*.ips`

## Runtime commands

- Start desktop dev app:
  - `bin/exo dev`
- CLI terminal control:
  - `bin/exo terminals list`
  - `bin/exo terminals create shell|claude|codex [cwd]`
  - `bin/exo terminals read <id>`
  - `bin/exo terminals send <id> <text>`
  - `bin/exo agents send <id> <text>`
  - `bin/exo agents send <id> <text> --raw`
  - `bin/exo terminals kill <id>`
- MCP server:
  - `pnpm --filter @exo/mcp start`
  - set `EXO_MCP_AUTOSTART=1` when the MCP server should start Exo if the command server is missing

## Carry-over references already used

- Garden branch-family semantics
  - file-family pattern: `note.md`, `note-looms/1.md`, `note-looms/1.1.md`
- Garden knowledge/editor parity targets
  - backlinks
  - tags
  - branches
  - workspace-aware navigation
