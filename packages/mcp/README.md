# Exo MCP

Exposes the running Exo app as an MCP server.

## Configure

Recommended setup:

```bash
bin/exo integrations doctor
bin/exo integrations install all
```

This installs Exo MCP into supported local agent clients through their native CLIs:

- Codex: `codex mcp add ...`
- Claude Code: `claude mcp add --transport stdio --scope user ...`

Use `bin/exo integrations install --dry-run all` or `bin/exo integrations config codex|claude` to inspect the exact commands before changing local MCP config.

Manual config shape:

```json
{
  "mcpServers": {
    "exo": {
      "command": "pnpm",
      "args": [
        "--dir",
        "/path/to/exo",
        "--filter",
        "@exo/mcp",
        "start"
      ],
      "env": {
        "EXO_WORKSPACE_ROOT": "/path/to/workspace",
        "EXO_MCP_AUTOSTART": "1"
      }
    }
  }
}
```

With `EXO_MCP_AUTOSTART=1`, the MCP server starts Exo when the local command server is missing or stale, then waits for `.exo/server.json`.

Optional environment:

- `EXO_MCP_START_COMMAND` — shell command used to start Exo. Defaults to this repo's `bin/exo dev`.
- `EXO_MCP_CONNECT_TIMEOUT_MS` — startup/connect timeout. Defaults to `20000`.

Without autostart, Exo must already be running so the MCP server can discover `.exo/server.json` and talk to the local command server.

## Tools

- `list_agents` — list live Exo terminal agents.
- `create_agent` — create a new shell, Claude, or Codex terminal.
- `read_agent` — read buffered terminal output. ANSI cleanup is enabled by default.
- `send_agent_message` — send text to a live agent. `submit` defaults to `true`, so the message is submitted with Enter unless explicitly disabled.
- `interrupt_agent` — send Escape or Ctrl-C to a live agent.
- `terminate_agent` — terminate an Exo terminal. For terminal agents this also kills the backing tmux session.

## CLI Mirror

Already-running Codex/Claude sessions will not see newly configured MCP servers until they restart. Use the CLI mirror when MCP is unavailable:

```bash
bin/exo agents list
bin/exo agents create claude /path/to/workspace
bin/exo agents read term-4 --tail 20000
bin/exo agents send term-4 "message"
bin/exo agents send term-4 "raw input without Enter" --raw
bin/exo agents interrupt term-4 ctrl-c
bin/exo agents terminate term-4
```
