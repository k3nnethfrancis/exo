# Exo contributor map

This file is provider-neutral guidance for coding agents. `CLAUDE.md` is a compatibility symlink to `AGENTS.md`; do not add provider-specific instructions.

## Start here

1. [README.md](README.md) — supported product surface and setup.
2. [CONTRIBUTING.md](CONTRIBUTING.md) — development and validation workflow.
3. [CONTEXT.md](CONTEXT.md) — product vocabulary.
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
- `benchmarks/graphbench` — Exo's internal graph-rendering regression harness.
- `skills` — reusable provider-neutral instructions for contributors and coding agents.
- `scripts` and `.github/workflows` — build, installation, and CI.

Subdirectory `AGENTS.md` files identify the closest source and test owner.

## Invariants

- A Workspace has explicit Note Roots. No convenience path may widen filesystem authority.
- Markdown and frontmatter are canonical. Derived indexes, proposals, inference, activity, and provenance remain under `.exo/` until accepted.
- Renderer code never touches filesystem or processes directly; use typed preload APIs.
- A Format projects Markdown, an optional Ontology interprets it afterward, and graph views only affect presentation.
- Commands are provider-neutral executable configurations. Invocation is explicit and reviewable.
- The terminal is one direct, byte-faithful `node-pty` lifecycle; do not restore tmux or durable transcript ownership.
- Public CLI flags, command-server routes, and shared protocol types require focused tests and review.

## Validation

```bash
pnpm ci:check
pnpm check
pnpm check:repo
```

Use `pnpm dev` for source iteration, `pnpm dev:qa` for isolated source QA, and
a packaged `Exo.app` for first-run or installed-app evidence. Run focused owner
tests before the broad gate and update public documentation for user-visible
changes.

File bugs and feature requests in GitHub Issues. Keep plans, review packets,
agent logs, and private operational notes outside this repository.
