# Exograph

> An open-source knowledge-graph interface and Markdown editor for working
> alongside terminal agents.

Exograph is a user-owned exocortex built from ordinary Markdown, an explorable
knowledge graph, local search, and reviewable work from terminal agents. Any
agent that can run as a headless Command can participate; Claude Code, Codex,
Pi, and Hermes are examples rather than privileged integrations.

Markdown and frontmatter stay canonical. Exograph's indexes, layouts, invocation records, and review state live under `.exograph/` as rebuildable local state.

## What it does

- **Write and navigate** Markdown notes with folders, backlinks, tags, properties, daily notes, live preview, terminals, and web previews.
- **Search and see connections** through immediate filename/path search or optional local lexical, semantic, and hybrid retrieval; inspect the same knowledge as a graph.
- **Work with agents deliberately** through inline `@` invocations, local CLI commands, and an optional two-tool read-only MCP server. Agent changes are captured as a reviewable Changeset; saving a note never runs an agent.

Exograph is macOS-first and currently an unsigned alpha.

## Start here

### Use Exograph

Build and install the local unsigned app:

```sh
pnpm install
./scripts/install-mac-app --with-cli
```

Launch Exograph from `~/Applications`, choose a main Markdown wiki, decide what Markdown becomes Notes, optionally install the MCP server, then configure the local agent commands you want available through `@`.

For the full workflow, read [Using Exograph](docs/using-exograph.md). For command-line and MCP access, read [CLI and MCP](docs/cli.md).

### Develop Exograph

Prerequisites: Node.js 24 and pnpm 11.2.2.

```sh
pnpm install
pnpm dev
```

Use `pnpm dev:qa` when an installed app is also running: it isolates the development app's settings and runtime. Use `pnpm pack:mac` when validating packaged-app or first-run behavior.

Read [AGENTS.md](AGENTS.md) for ownership and validation guidance and
[Architecture](docs/architecture.md) for package boundaries.

## Core workflows

| Need | Start here |
| --- | --- |
| Open a folder, write notes, use links/tags/properties | [Using Exograph](docs/using-exograph.md) |
| Understand Notes, Concepts, Relations, Evidence, and graph origins | [Knowledge graph](docs/knowledge-graph.md) |
| Configure local search and understand index status | [Search](docs/search.md) |
| Use `@claude`/`@codex`, review changes, or resume a session | [Agent invocations](docs/document-agent-protocol.md) |
| Use Exograph from a shell or tool-capable client | [CLI and MCP](docs/cli.md) |
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

Before changing a cross-process boundary, find its owner in
[AGENTS.md](AGENTS.md). Desktop-visible behavior requires the relevant Electron
journey; browser-only tests do not prove Electron IPC or packaged-app behavior.
Packaging, first-run, and native-module changes require an unsigned Mac package
and installed-app evidence.

Keep changes focused, update public documentation when behavior changes, and
use GitHub Issues rather than committing task ledgers, review packets, or
working notes.

## Local trust boundary

Exograph can launch explicitly configured native commands. It is a trusted
local tool, not a sandbox. Note Roots bound the files Exograph reads, reviews,
and presents; they do not restrict what an authorized command can do as the
current operating-system user.

Do not publish a workspace's `.exograph/` directory. It is rebuildable local
state and may contain paths, note content, prompts, invocation evidence, or
command metadata.

## Status

Exograph is early software, not a signed public binary release. The current
alpha supports source development and unsigned macOS packaging; Windows and
Linux are not yet supported release targets. Published versions and downloads
live in GitHub Releases.
