# Exo Claude Overlay

Read `AGENTS.md` first. This file exists for Claude tooling that discovers `CLAUDE.md` but not `AGENTS.md`.

Claude-specific reminders:

- Use `bin/exo agents ...` or the Exo MCP tools to manage Exo-hosted Claude/Codex sessions.
- `exo agents send <id> <message>` submits with Enter by default; use `--raw` only when you intentionally do not want submission.
- Existing Claude sessions may need restart or MCP refresh after `exo integrations install claude`.
- Do not leave tmux-backed agent sessions detached; Exo close/kill should terminate the backing tmux session.
- Validate with the focused gates in `AGENTS.md`, or `pnpm check` for broad changes.

Current context lives in `AGENTS.md`, `README.md`, `docs/README.md`, `docs/strategy.md`, `ledger.md`, `docs/harness.md`, and `packages/mcp/README.md`.
