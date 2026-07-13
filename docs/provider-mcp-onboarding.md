# Provider MCP onboarding

Exo's first-run flow can optionally add one MCP server to locally installed Claude and/or Codex. This is a provider-owned configuration handoff, not an Exo MCP product surface.

## Contract

- The person selects the providers, connection type, and server details, then explicitly chooses **Add MCP server**.
- For a local server, Exo passes the executable and one argument per line directly to the selected provider CLI without a shell.
- For an HTTP server, Exo accepts only `http` or `https` URLs.
- Exo does not store the MCP definition, secret, environment variables, tokens, or authentication state.
- Exo does not host an MCP server, inject MCP tools into invocations, expose a general integration manager, or synchronize MCP configuration between machines.
- Failure is provider-specific and visible. The user can continue onboarding without MCP configuration.

## Native commands

The desktop process delegates to the installed CLIs:

```text
claude mcp add --scope user <name> -- <executable> <args…>
claude mcp add --scope user --transport http <name> <url>
codex mcp add <name> -- <executable> <args…>
codex mcp add <name> --url <url>
```

Provider login and server-specific authorization remain outside Exo. The configuration belongs to the local machine, just like the configured invocation commands and command trust.

## Why this boundary exists

An MCP server can be useful to a chosen agent, but it does not need to become a second Exo data model, provider runtime, extension registry, or authority layer. The workspace remains a single main Markdown wiki with local search and explicit configured-Command invocation.

-- Shoshin | 2026-07-13
