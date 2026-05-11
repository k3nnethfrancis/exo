# Exo Claude Overlay

Read `AGENTS.md` first. This file intentionally mirrors the same operating contract for Claude-specific tooling that only looks for `CLAUDE.md`.

Key reminders:
- Exo is a workspace-centric research IDE, not a single-vault editor.
- Keep the dev server running while working.
- Restart Exo after main/preload/native terminal/runtime changes.
- Use `bin/exo` and the MCP bridge as the canonical control surfaces for running Exo.
- Do not leave hidden tmux-backed Claude/Codex sessions detached; Exo terminal close/kill should terminate the backing tmux session.
- Treat terminal scroll, renderer reload hydration, and crash logging as load-bearing stability paths.
- Validate touched packages before reporting the work complete.

See `AGENTS.md`, `ledger.md`, `plan.md`, and `packages/mcp/README.md` for the full current context.
