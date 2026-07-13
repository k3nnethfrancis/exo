# Exo MCP onboarding

Exo can install its own small, read-only MCP server into the locally installed Claude and/or Codex CLI during first-run setup.

## What agents receive

The installed `exo` server gives an agent exactly two discovery tools:

- `workspace_status` — resolved Workspace identity and roots, app availability, and retrieval health.
- `search_notes` — scoped search across the resolved Workspace's Note Roots. It returns absolute file paths plus title, snippet, score, and source metadata. It uses the running app's configured retrieval only when that app Workspace is the same resolved scope; otherwise it uses bounded filesystem retrieval.

The server has no note-reading, write, terminal, agent-launch, configuration, or arbitrary-path tool. An agent with native shell authority can read a discovered path under its own provider permission model; Exo does not grant that authority. MCP access does not bypass ordinary inline-invocation confirmation or diff review.

## Scope contract

The provider process resolves Exo by its caller cwd, never by whichever
Workspace happens to be open in the app. A cwd inside exactly one configured
Note Root selects that Workspace. If no root contains the cwd, Exo may use the
only configured Workspace. If there is no unique answer, `workspace_status`
reports the condition and retrieval refuses rather than guessing.

When a running desktop app belongs to that same resolved Workspace, Exo reuses
its configured retrieval. If the app is unavailable, stale, or belongs to a
different Workspace, Exo safely uses bounded filesystem retrieval instead.

## Installation contract

The person selects Claude and/or Codex, then explicitly chooses **Install Exo tools**. Exo delegates to the provider's native configuration CLI:

```text
claude mcp add --scope user exo -- exo mcp serve
codex mcp add exo -- exo mcp serve
```

The provider owns its config and authentication. Exo owns the `exo mcp serve` process only. The local `exo` command must be installed and on `PATH` (or `EXO_CLI_PATH` can point at it); `scripts/install-mac-app --with-cli` provides the supported macOS setup.

Exo does not install or maintain provider instruction files or Skills. Tool
descriptions provide the local search-then-read rule. A future instruction
template, if real dogfood earns it, will be copy-out only and remain user-owned.

## Boundary

This does not restore a generic MCP manager, arbitrary server form, plugin runtime, or authority layer. Exo exposes only its own bounded retrieval context so configured agents can orient and research within the same Workspace a person selected.

## Stabilization gate

Caller-cwd resolution, singleton fallback, ambiguity refusal, app-scope parity,
and the frozen two-tool list are automated. Before the contract is promoted
from alpha, finish protocol/output/setup coverage and dogfood 10–20
context-seeking sessions across Claude and Codex. Record whether agents
discover Exo retrieval, search before reading, and remain inside resolved
roots. A failure to discover tools may earn a user-managed copy-out instruction
template; it does not earn an automatic host-file writer.

-- Shoshin | 2026-07-13
