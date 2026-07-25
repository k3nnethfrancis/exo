# Contributing

Exo is a macOS-first Electron application. Keep changes small, typed, and
covered by the narrowest test that proves the behavior.

## Start locally

```bash
pnpm install
pnpm dev
```

Use `pnpm dev:qa` when an installed Exo app is running for normal work. It uses
isolated runtime and user-data paths. Use `pnpm pack:mac` for onboarding,
first-run, native-module, or packaged-app verification.

## Before a pull request

```bash
pnpm ci:check
```

Run the relevant Electron journey for desktop-visible changes. Browser-only
tests cannot verify Electron IPC.

## Project shape

- `apps/desktop` — Electron main process, preload, and renderer.
- `packages/core` — Workspace, Markdown graph, search, invocation records, and shared protocol types.
- `packages/cli` — the `exo` CLI and MCP presentation.
- `docs` — current product and architecture contracts.

Read [docs/architecture.md](docs/architecture.md) before changing a cross-cutting
boundary. [AGENTS.md](AGENTS.md) provides the same map in an agent-friendly form.

## Pull-request standard

- One behavior or refactor per change set.
- Do not widen Note Root authority or add a hidden filesystem/process path.
- Keep Markdown canonical; derived state belongs under `.exo/`.
- Update public docs and [CHANGELOG.md](CHANGELOG.md) for user-visible changes.
- File bugs and feature requests in GitHub Issues. Do not add a local issue or task ledger to the repository.
- Follow the [Code of Conduct](CODE_OF_CONDUCT.md).

`docs/internal/` is an ignored local workspace for maintainer plans, ledgers,
roadmaps, and scratch notes. It is intentionally absent from clones and must
never be committed.

## Support scope

macOS is the supported development and packaging target today. Windows and
Linux compatibility is welcome where it falls out naturally, but do not make
platform-specific promises without tests and documentation.
