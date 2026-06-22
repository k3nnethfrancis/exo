# Exo MCP

Exposes the running Exo app as an MCP server.

Stdio is the default transport for local MCP hosts such as Claude Code and Codex. Exo also supports an explicit Streamable HTTP transport for remote-only MCP hosts such as Glean that cannot launch local stdio servers. HTTP binds to `127.0.0.1` by default; use an internal authenticated proxy if you expose it beyond localhost.

The stdio launcher expects `packages/mcp/dist/index.cjs` to exist. Build the package before configuring or starting MCP:

```bash
pnpm --filter @exo/mcp build
```

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
      "command": "node",
      "args": [
        "/path/to/exo/packages/mcp/bin/exo-mcp.mjs"
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

Workspace resolution matches the CLI: explicit `EXO_RUNTIME_ROOT` or workspace env vars win; otherwise MCP reads Exo's active desktop workspace registry and uses that workspace's `.exo/server.json`.

Optional environment:

- `EXO_MCP_START_COMMAND` — shell command used to start Exo. Defaults to this repo's `bin/exo start`.
- `EXO_MCP_CONNECT_TIMEOUT_MS` — startup/connect timeout. Defaults to `20000`.
- `EXO_MCP_REQUEST_TIMEOUT_MS` — normal command-server request timeout. Defaults to `2000`.
- `EXO_MCP_SEARCH_TIMEOUT_MS` — search request timeout for QMD-backed retrieval. Defaults to `30000`.
- `EXO_MCP_MAINTENANCE_TIMEOUT_MS` — long-running index maintenance timeout. Defaults to `1800000`.

Without autostart, Exo must already be running so the MCP server can discover `.exo/server.json` and talk to the local command server.

## HTTP Transport

Run the same narrow MCP tool surface over Streamable HTTP:

```bash
node packages/mcp/bin/exo-mcp.mjs --transport http --host 127.0.0.1 --port 3333
```

The default endpoint is:

```text
http://127.0.0.1:3333/mcp
```

Options:

- `--transport http` or `--http` — start the Streamable HTTP server.
- `--host <host>` — bind host. Defaults to `127.0.0.1`.
- `--port <port>` — bind port. Defaults to `3333`; use `0` to choose a free port.
- `--path <path>` — MCP endpoint path. Defaults to `/mcp`.

Equivalent env vars are `EXO_MCP_HTTP_HOST`, `EXO_MCP_HTTP_PORT`, and `EXO_MCP_HTTP_PATH`.

## Tools

- `workspace_status` — inspect the active Exo workspace model, live agents, and notes-index summary.
- `search` — search notes through QMD when enabled, with filesystem fallback when indexing is off or unavailable.
- `read_document` — read an indexed or filesystem note/document target.
- `open_preview` — open an HTTP(S) URL or existing local `.html`/`.htm` artifact inside Exo's in-app browser preview. Local files must be inside the workspace, note roots, or project roots.
- `focus_preview` — focus Exo's in-app browser preview, creating an empty preview pane if none is open.
- `close_preview` — close the focused preview pane, or the first open preview pane when focus is elsewhere.
- `list_agents` — list live Exo terminal agents.
- `create_agent` — create a new terminal from a registered launchable harness: shell, Claude, Codex, Pi, or Hermes. Unavailable or unconfigured harnesses return a command-server error instead of launching a dead process.
- `read_agent` — read bounded live terminal tail output. ANSI cleanup is enabled by default.
- `send_agent_message` — send text to a live agent. `submit` defaults to `true`, so the message is submitted with Enter unless explicitly disabled. Codex startup sends may be queued until normal chat input is ready.
- `interrupt_agent` — send Escape or Ctrl-C to a live agent.
- `terminate_agent` — terminate an Exo terminal and its tmux-backed session.

MCP is intentionally narrower than the CLI. Use `bin/exo index ...`, `bin/exo project-roots ...`, and `bin/exo terminals ...` for operator/admin/debug workflows.

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
bin/exo preview open http://localhost:3000
bin/exo preview focus
bin/exo preview close
bin/exo search "query"
bin/exo read /path/or/qmd-target
```
