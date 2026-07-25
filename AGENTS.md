# Exo Agent Map

Exo is the open-source, local-first Markdown exograph workstation. It owns the
workspace, graph projection, retrieval, canvas, configured Commands, direct
terminals, invocation observation, and review. It is not the In Common Labs
umbrella or the Guardian research program. Do not restore retired architecture
without an explicit product decision.

## Start here

1. [`README.md`](README.md) — supported product surface and commands.
2. [`CONTEXT.md`](CONTEXT.md) — product vocabulary.
3. [`docs/README.md`](docs/README.md) — current source/test owner map.
4. [`docs/architecture.md`](docs/architecture.md) — shipped module boundaries.
5. [`docs/launch-surface-ledger.md`](docs/launch-surface-ledger.md) — public surface evidence.
6. [`tasks.md`](tasks.md), [`issues.md`](issues.md), [`roadmap.md`](roadmap.md),
   and [`ledger.md`](ledger.md) — active work, bugs, future work, and history.

Dated plans and reviews are historical evidence unless their own status says
otherwise; they do not override these current maps.

## Repository and local maps

- `apps/desktop` — Electron main, preload, renderer, and shared API.
- `packages/core` — portable Workspace, Markdown graph, search, invocations,
  and shared command protocol.
- `packages/cli` — local operator CLI and MCP presentation.
- `scripts` and `.github/workflows` — build, installation, and CI.
- [`apps/desktop/src/main/AGENTS.md`](apps/desktop/src/main/AGENTS.md) — main
  lifecycle, Workspace activation, watchers/indexing, command server,
  invocations, and PTYs.
- [`apps/desktop/src/renderer/src/AGENTS.md`](apps/desktop/src/renderer/src/AGENTS.md)
  — canvas/editor state, review, preview, panes, and graph presentation.
- [`packages/core/AGENTS.md`](packages/core/AGENTS.md) — domain model,
  containment, graph/ontology, search, and protocol.
- [`packages/cli/AGENTS.md`](packages/cli/AGENTS.md) — discovery, transport,
  app-off behavior, and MCP.

`CLAUDE.md` is a compatibility symlink to `AGENTS.md`; do not create
provider-specific repository guidance.

## Skills

Scan `skills/` before editing. Use the narrowest applicable skill:

- `terminal-stability` for terminal, terminal settings/tests, or command launch.
- `graph-system-stability` for graph types, formats/ontology, graph UI, or benchmarks.
- `deslopify-frontend` for setup, settings, onboarding, or configuration UI.
- `submit-exo-issue` for contributor/intake bug or QA reports; root `issues.md`
  remains canonical.

## Global contracts

- A Workspace contains explicit Note Roots. No read, mutation, search, preview,
  watcher, Command, or convenience path may silently widen filesystem authority.
- Markdown/frontmatter is canonical. Accepted facts live in user files; indexes,
  proposals, inference, activity, and provenance artifacts stay under `.exo/`
  until accepted. See [`docs/durable-state.md`](docs/durable-state.md).
- Renderer code never accesses filesystem/processes directly; cross-process
  types meet at `apps/desktop/src/shared/api.ts` and preload APIs.
- Format projects Markdown; optional ontology interprets it afterward; graph
  views only change layout/encoding. See the graph skill and
  [`docs/workspace-ontology.md`](docs/workspace-ontology.md).
- Commands are provider-neutral data, not a second harness identity. CLI flags,
  command-server routes, and shared protocol types are protected public
  contracts: stop for lead approval before changing them.
- The CLI is the local operator surface; do not create an unreviewed parallel
  integration runtime. Filesystem changes flow from the watcher service, not
  renderer polling.
- Terminal remains one direct, byte-faithful `node-pty` lifecycle. Extension or
  Plugin machinery is earned only by concrete implementations; see
  [`docs/terminal-runtime-decision.md`](docs/terminal-runtime-decision.md) and
  [`docs/extension-architecture.md`](docs/extension-architecture.md).

## Validation and handoff

```bash
pnpm ci:check       # broad local gate
pnpm check          # typecheck, unused, tests, build subset
pnpm check:repo     # structural/documentation contract checks
```

Use `pnpm dev` for active source work, `pnpm dev:qa` for isolated source-build
QA, and a packaged `Exo.app` for first-run/onboarding/installed-app evidence.
Browser-only UI checks cannot prove Electron IPC. Full launch-mode and release
rules live in [`docs/harness.md`](docs/harness.md) and
[`docs/usability-readiness.md`](docs/usability-readiness.md).

Keep changes narrow; preserve unrelated edits; run focused owner tests before
the broad gate. Update docs with surface or architecture changes, record bugs
in `issues.md`, future work in `tasks.md`/`roadmap.md`, and shipped state in
`ledger.md`. Review tests for behavioral signal rather than implementation
snapshots. User-visible changes update `CHANGELOG.md` before push.
