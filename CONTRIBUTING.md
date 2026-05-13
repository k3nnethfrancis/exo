# Contributing

Exo is currently macOS-first and moving quickly. Keep changes small, typed, and covered by focused tests where behavior can regress.

## Development

```bash
pnpm install
pnpm dev
```

Before opening a pull request:

```bash
pnpm check
```

For desktop-specific changes, also run the relevant Playwright slice:

```bash
pnpm test:e2e
```

## Project Shape

- `apps/desktop` owns the Electron app.
- `packages/core` owns workspace, search, runtime, and shared protocol logic.
- `packages/cli` owns the `bin/exo` command surface.
- `packages/mcp` owns the MCP server for local agents.
- `docs/README.md`, `docs/strategy.md`, `docs/architecture.md`, `docs/harness.md`, `docs/tasks.md`, `docs/roadmap.md`, and `ledger.md` are part of the source of truth for agent/human handoff.

## Work Chunks

Keep changes small, evidence-backed, and easy to review:

- one behavior or refactor per chunk
- update docs when public commands, settings, runtime behavior, or agent workflow changes
- run focused gates while iterating
- run `pnpm check` for broad or release-facing changes

## Scope

macOS is the supported development and packaging target today. Windows and Linux compatibility is welcome where it falls out naturally, but please do not add platform-specific promises without tests and docs.
