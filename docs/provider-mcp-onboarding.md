# Stem MCP onboarding

Stem can install its own small, read-only MCP server into the locally installed Claude and/or Codex CLI during first-run setup.

## MCP and CLI

Stem supports both local access paths. MCP is for clients that can call tools;
the Stem CLI is for shell-capable clients. MCP is optional and does not replace
the CLI. The onboarding screen installs MCP explicitly, then configures local
CLI Commands for inline invocation.

Shell-capable clients can use `stem workspaces`, `stem status`, and `stem search`
directly. `status` and `search` accept an explicit `--workspace
<id|label|path>` selector. Search returns a bounded page of ranked paths and
metadata; callers inspect a returned path with their own native filesystem
tools. MCP
clients receive the two read-only discovery tools below.

## What agents receive

The installed `stem` server gives an agent exactly two discovery tools:

- `workspace_status` — resolved Workspace identity and roots, app availability, and retrieval health.
- `search_notes` — scoped search across the resolved Workspace's Note Roots. It returns a bounded ranked page with absolute and root-relative paths, title, snippet, score, source metadata, and an optional opaque cursor. It uses the running app's configured retrieval only when that app Workspace is the same resolved scope; otherwise it uses bounded filesystem retrieval.

The server has no note-reading, write, terminal, agent-launch, configuration, or arbitrary-path tool. An agent with native shell authority can read a discovered path under its own provider permission model; Stem does not grant that authority. MCP access does not bypass ordinary inline-invocation confirmation or diff review.

## Scope contract

The provider process resolves Stem by its caller cwd, never by whichever
Workspace happens to be open in the app. A cwd inside exactly one configured
Note Root selects that Workspace. If no root contains the cwd, Stem may use the
only configured Workspace. If there is no unique answer, `workspace_status`
reports the condition and retrieval refuses rather than guessing.

When a running desktop app belongs to that same resolved Workspace, Stem reuses
its configured retrieval. If the app is unavailable, stale, or belongs to a
different Workspace, Stem safely uses bounded filesystem retrieval instead.

## Installation contract

The person selects Claude and/or Codex, then explicitly chooses **Install MCP**. Stem delegates to the provider's native configuration CLI:

```text
claude mcp add --scope user stem -- stem mcp serve
codex mcp add stem -- stem mcp serve
```

The provider owns its config and authentication. Stem owns the `stem mcp serve` process only. The local `stem` command must be installed and on `PATH` (or `STEM_CLI_PATH` can point at it); run `scripts/install-local` from the intended checkout to install or update its repo-backed shim. MCP setup never installs or replaces that CLI command.

Stem does not install or maintain provider instruction files or Skills. Tool
descriptions establish the local search-then-read rule; any provider-specific
instructions remain the user's configuration.

## Boundary

This does not restore a generic MCP manager, arbitrary server form, plugin runtime, or authority layer. Stem exposes only its own bounded retrieval context so configured agents can orient and research within the same Workspace a person selected.
