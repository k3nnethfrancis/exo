# Stem contributor map

This file is provider-neutral guidance for coding agents. `CLAUDE.md` is a compatibility symlink to `AGENTS.md`; do not add provider-specific instructions.

## Start here

1. [README.md](README.md) — supported product surface and setup.
2. [CONTRIBUTING.md](CONTRIBUTING.md) — development and validation workflow.
3. [docs/glossary.md](docs/glossary.md) — product vocabulary.
4. [docs/architecture.md](docs/architecture.md) — package boundaries and runtime ownership.
5. [docs/README.md](docs/README.md) — current product and maintainer contracts.

If `docs/internal/` exists locally, read the relevant task, plan, roadmap, or
ledger before planning work. It is an ignored maintainer workspace: use it for
private operational context, but never commit it or cite it as public product
documentation.

## Repository map

- `apps/desktop` — Electron main process, preload, renderer, and shared API.
- `packages/core` — Workspace, Markdown graph, search, invocations, and shared protocol types.
- `packages/cli` — local CLI and MCP presentation.
- `evals/graph` — Stem's internal graph-rendering regression suite.
- `skills` — reusable provider-neutral instructions for contributors and coding agents.
- `scripts` and `.github/workflows` — build, installation, and CI.

Subdirectory `AGENTS.md` files identify the closest source and test owner.

## Progressive disclosure

Read only the contract that owns the change, then its focused tests:

- Markdown, filesystem authority, graph, search, ontology, or invocation data:
  [`packages/core/AGENTS.md`](packages/core/AGENTS.md).
- Electron lifecycle, watcher/index services, command server, invocation
  execution, or terminals:
  [`apps/desktop/src/main/AGENTS.md`](apps/desktop/src/main/AGENTS.md).
- Editor, pane layout, graph interaction, or review presentation:
  [`apps/desktop/src/renderer/src/AGENTS.md`](apps/desktop/src/renderer/src/AGENTS.md).
- CLI, MCP, app-off fallback, or transport:
  [`packages/cli/AGENTS.md`](packages/cli/AGENTS.md).

For a cross-cutting proposal, read `docs/architecture.md` and the two relevant
owners before adding a new seam. Do not use a broad `App.tsx` change to bypass
an existing domain owner.

## Invariants

- A Workspace has explicit Note Roots. No convenience path may widen filesystem authority.
- Markdown and frontmatter are canonical. Derived indexes, proposals, inference, activity, and provenance remain under `.stem/` until accepted.
- Renderer code never touches filesystem or processes directly; use typed preload APIs.
- A Format projects Markdown, an optional Ontology interprets it afterward, and graph views only affect presentation.
- Commands are provider-neutral executable configurations. Invocation is explicit and reviewable.
- The terminal is one direct, byte-faithful `node-pty` lifecycle; do not restore tmux or durable transcript ownership.
- Public CLI flags, command-server routes, and shared protocol types require focused tests and review.

## Validation

```bash
pnpm ci:check
pnpm check
```

Use `pnpm dev` for source iteration, `pnpm dev:qa` for isolated source QA, and
a packaged `Stem.app` for first-run or installed-app evidence. Run focused owner
tests before the broad gate and update public documentation for user-visible
changes.

File bugs and feature requests in GitHub Issues. Keep plans, review packets,
agent logs, and private operational notes outside this repository.
