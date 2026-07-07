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

`bin/exo integrations doctor` verifies the configured launcher path for each supported client. If it reports a stale Exo MCP config after moving checkouts, reinstalling, or switching worktrees, run `bin/exo integrations install codex|claude|all`; Exo will replace the stale MCP entry. Already-running Codex or Claude sessions still need to restart or refresh MCP tools before they use the new launcher.

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
- `EXO_MCP_SEARCH_TIMEOUT_MS` — search request timeout for QMD advanced retrieval. Defaults to `30000`.
- `EXO_MCP_MAINTENANCE_TIMEOUT_MS` — long-running index maintenance timeout. Defaults to `1800000`.
- `EXO_MCP_EXPOSURE_PROFILE` — MCP tool exposure profile. Defaults to `dev` to preserve Exo-on-Exo orchestration. Use `everyday` for orientation/search/read/preview only, `off` for no registered tools, or `custom` with `EXO_MCP_TOOLS`.
- `EXO_MCP_TOOLS` — comma-separated MCP tool allow-list used only when `EXO_MCP_EXPOSURE_PROFILE=custom`.

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

MCP tool registration is filtered through the control-plane catalog in `@exo/core`.
The default `dev` profile exposes the full current Exo-on-Exo surface:

- `workspace_status` — inspect the active Exo workspace model, note/project/indexed roots, live agents and terminal diagnostics, QMD/search-provider readiness, index summary, and command-server degraded-state messages when available.
- `search` — search notes through the bundled QMD advanced provider when enabled, with core filesystem fallback when QMD is off or unavailable.
- `read_document` — read an indexed or filesystem note/document target.
- `open_preview` — open an HTTP(S) URL or existing local `.html`/`.htm` artifact inside Exo's in-app browser preview. Local files must be inside the workspace, note roots, or project roots.
- `focus_preview` — focus Exo's in-app browser preview, creating an empty preview pane if none is open.
- `close_preview` — close the focused preview pane, or the first open preview pane when focus is elsewhere.
- `list_agents` — list live Exo terminal agents.
- `create_agent` — create a new terminal from a registered MCP-exposed harness. The default visible built-ins are shell, Claude, Codex, and Pi; Hermes appears when explicitly configured. Unavailable or unconfigured harnesses return a clear error instead of launching a dead process.
- `read_agent` — read bounded terminal evidence by default, not semantic answers. Prefer `maxLines` for line-bounded live tails; `tailChars` reads disk transcript tails. ANSI cleanup is enabled by default. Use `source: "trace"` to read persisted semantic agent answer text from `.exo/traces/{agentId}.ndjson`; this is the durable path for TUI harnesses whose displayed answer can be repainted away. If no trace events exist, Exo reports no trace-backed semantic answer output instead of inferring one from terminal text.
- `send_agent_message` — send text to a live agent. `submit` defaults to `true`, so the message is submitted with Enter unless explicitly disabled. Codex startup sends may be queued until normal chat input is ready.
- `interrupt_agent` — send Escape or Ctrl-C to a live agent.
- `terminate_agent` — terminate an Exo terminal and its tmux-backed session.

The `everyday` profile exposes only `workspace_status`, `search`, `read_document`, `open_preview`, `focus_preview`, and `close_preview`. It is not strictly read-only because preview tools can change the visible app preview pane, but it intentionally excludes live agent lifecycle, input, destructive, and admin controls. The `custom` profile registers only tools named in `EXO_MCP_TOOLS`; unknown names are ignored with a startup warning. Invalid explicit profile names fail closed by registering no tools.

MCP is intentionally narrower than the CLI. Use `bin/exo index ...`, `bin/exo project-roots ...`, and `bin/exo terminals ...` for operator/admin/debug workflows.

`workspace_status` is the recommended first orientation call for agents. Its structured response preserves the command-server `/status` payload and adds read-only orientation sections: `workspaceModel`, `workspaceRoots`, `noteRoots`, `projectRoots`, `indexedRoots`, `indexSummary`, `searchProviderReadiness`, `pluginReadiness`, `liveAgents`, `terminalSessions`, `commandServer`, and `diagnostics`. Optional diagnostics may be marked unavailable when the running app lacks that data, but MCP does not expose index sync, recovery, accept/reject, or other mutation tools through this status response.

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
