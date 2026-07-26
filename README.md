# Exo

> A local-first Markdown workspace that keeps your notes, graph, search, and agent-assisted changes in files you own.

Exo is an open-source desktop application for working with a Markdown wiki. It reads ordinary folders, maintains a live graph over their notes, searches them locally, and lets you explicitly ask configured local agents to make changes you can review.

Markdown and frontmatter stay canonical. Exo's indexes, layouts, invocation records, and review state live under `.exo/` as rebuildable local state.

## What it does

- **Write and navigate** Markdown notes with folders, backlinks, tags, properties, daily notes, live preview, terminals, and web previews.
- **Search and see connections** through immediate filename/path search or optional local lexical, semantic, and hybrid retrieval; inspect the same knowledge as a graph.
- **Work with agents deliberately** through inline `@` invocations, local CLI commands, and an optional two-tool read-only MCP server. Agent changes are captured as a reviewable Changeset; saving a note never runs an agent.

Exo is macOS-first and currently an unsigned alpha. The product and CLI are still named `exo` while a permanent public name is chosen.

## Start here

### Use Exo

Build and install the local unsigned app:

```sh
pnpm install
./scripts/install-mac-app --with-cli
```

Launch Exo from `~/Applications`, choose a main Markdown wiki, decide what Markdown becomes Notes, optionally install the MCP server, then configure the local agent commands you want available through `@`.

For the full workflow, read [Using Exo](docs/using-exo.md). For command-line and MCP access, read [CLI and MCP](docs/cli.md).

### Develop Exo

Prerequisites: Node.js 22+ and pnpm 11.2.2.

```sh
pnpm install
pnpm dev
```

Use `pnpm dev:qa` when an installed app is also running: it isolates the development app's settings and runtime. Use `pnpm pack:mac` when validating packaged-app or first-run behavior.

See [Contributing](CONTRIBUTING.md) for validation and [Architecture](docs/architecture.md) for package boundaries.

## Core workflows

| Need | Start here |
| --- | --- |
| Open a folder, write notes, use links/tags/properties | [Using Exo](docs/using-exo.md) |
| Understand Notes, Concepts, Relations, Evidence, and graph origins | [Knowledge graph](docs/knowledge-graph.md) |
| Configure local search and understand index status | [Search](docs/search.md) |
| Use `@claude`/`@codex`, review changes, or resume a session | [Agent invocations](docs/document-agent-protocol.md) |
| Use Exo from a shell or tool-capable client | [CLI and MCP](docs/cli.md) |
| Define or switch a workspace ontology | [Workspace ontology](docs/workspace-ontology.md) |
| Recover from a setup, search, invocation, MCP, or CLI problem | [Troubleshooting](docs/troubleshooting.md) |

## Repository map

- `apps/desktop` — Electron main process, preload bridge, and React renderer.
- `packages/core` — Markdown, workspace, graph, search, invocation, and shared protocol models.
- `packages/cli` — the `exo` CLI and read-only MCP server.
- `evals/graph` — internal graph-rendering regression evaluation.
- `docs` — user guides and current technical contracts.

## Validate a change

```sh
pnpm ci:check
```

That runs unused-code checks, typechecks, tests, builds, and an install dry run. Graph changes also require the focused commands documented in [`evals/graph/README.md`](evals/graph/README.md).

## Status

Exo is early software, not a signed public binary release. The current alpha supports source development and unsigned macOS packaging; Windows and Linux are not yet supported release targets. See [CHANGELOG.md](CHANGELOG.md) for the current public change record and [SECURITY.md](SECURITY.md) for reporting.
