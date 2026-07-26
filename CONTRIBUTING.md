# Contributing

Exo is a macOS-first Electron application. Keep changes small, typed, and
covered by the narrowest test that proves the behavior. Read the ownership
guide before changing a cross-process boundary.

## Start locally

```bash
pnpm install
pnpm dev
```

Use `pnpm dev:qa` when an installed Exo app is running for normal work. It uses
isolated runtime and user-data paths. Use `pnpm pack:mac` for onboarding,
first-run, native-module, or packaged-app verification.

## Find the right owner

Start from the smallest relevant guide rather than treating `App.tsx` as the
architecture:

- **Markdown, files, graph, search, ontology, or invocation records:**
  [`packages/core/AGENTS.md`](packages/core/AGENTS.md)
- **Electron authority, watchers, command server, invocations, or terminals:**
  [`apps/desktop/src/main/AGENTS.md`](apps/desktop/src/main/AGENTS.md)
- **Editor, panes, graph interaction, or review UI:**
  [`apps/desktop/src/renderer/src/AGENTS.md`](apps/desktop/src/renderer/src/AGENTS.md)
- **CLI, app-off retrieval, MCP, or command transport:**
  [`packages/cli/AGENTS.md`](packages/cli/AGENTS.md)

[`docs/architecture.md`](docs/architecture.md) explains how those owners fit
together. [`docs/glossary.md`](docs/glossary.md) is the product-language
contract; update it when a durable concept changes.

## Before a pull request

```bash
pnpm ci:check
```

Run the relevant Electron journey for desktop-visible changes. Browser-only
tests cannot verify Electron IPC.

## Choose proof by the change

| Change | Minimum evidence |
| --- | --- |
| Pure Core behavior | Focused Core test plus `pnpm --filter @exo/core typecheck` |
| CLI/MCP behavior | Focused CLI tests plus `pnpm --filter @exo/cli build` |
| Main/preload/renderer behavior | Focused unit tests and the relevant Electron journey |
| Editor latency, navigation, or search | The focused latency journey described in [`docs/performance-contracts.md`](docs/performance-contracts.md) |
| Terminal runtime | Focused terminal tests and a real Electron terminal journey |
| Graph model or presentation | Owner tests plus the applicable [`evals/graph`](evals/graph/README.md) track |
| Packaging, first-run, or native modules | `pnpm pack:mac` and installed-app evidence |

Do not report a browser-only test as proof of a desktop IPC or packaged-app
behavior. Do not broaden a change's test scope merely to mask a missing focused
test.

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
