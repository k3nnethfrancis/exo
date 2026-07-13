# Exo MCP onboarding

Exo can install its own small, read-only MCP server into the locally installed Claude and/or Codex CLI during first-run setup.

## What agents receive

The installed `exo` server gives an agent three tools for the active Workspace:

- `workspace_status` — current Workspace roots, app availability, and retrieval health.
- `search_notes` — scoped search across the Workspace's Note Roots. It uses the running app's configured retrieval when available and filesystem retrieval otherwise.
- `read_note` — reads a Note Root path, normally one returned by `search_notes`.

The server has no write, terminal, agent-launch, configuration, or arbitrary-path tool. MCP access does not bypass ordinary inline-invocation confirmation or diff review.

## Installation contract

The person selects Claude and/or Codex, then explicitly chooses **Install Exo tools**. Exo delegates to the provider's native configuration CLI:

```text
claude mcp add --scope user exo -- exo mcp serve
codex mcp add exo -- exo mcp serve
```

The provider owns its config and authentication. Exo owns the `exo mcp serve` process only. The local `exo` command must be installed and on `PATH` (or `EXO_CLI_PATH` can point at it); `scripts/install-mac-app --with-cli` provides the supported macOS setup.

## Boundary

This does not restore a generic MCP manager, arbitrary server form, plugin runtime, or authority layer. Exo exposes only its own bounded retrieval context so configured agents can orient and research within the same Workspace a person selected.

-- Shoshin | 2026-07-13
