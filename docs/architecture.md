# Exo Architecture

Last updated: 2026-05-11

Exo is a workspace-centric research IDE. The current system is still a shell-first product, but the shell now has three live control surfaces over the same workspace runtime:

- desktop app
- `bin/exo` CLI
- `@exo/mcp` bridge

Memory, workcells, datasets, evals, and training are still future layers. The current runtime work is about making notes, code files, terminals, and terminal agents legible and controllable.

## Package Boundaries

- `apps/desktop`
  - Electron main process, preload bridge, React renderer, terminal supervision, and the local command server.
- `packages/core`
  - Workspace config, note/project file discovery, markdown metadata, runtime launch plans, shared command protocol types, and retrieval/index adapters.
- `packages/cli`
  - CLI commands for runtime status, launch plans, app search/open/config, and terminal operations against a running Exo app.
- `packages/mcp`
  - MCP server that exposes the running Exo app to external agents. It speaks to the same command server as the CLI.

Renderer code never touches the filesystem or processes directly. It goes through preload APIs backed by main-process services.

## Runtime Command Server

The desktop main process starts a local HTTP command server and writes its discovery file to:

- `${workspace_root}/.exo/server.json`

Current endpoints in `apps/desktop/src/main/command-server.ts`:

- `GET /status`
- `GET /config`
- `GET /search`
- `POST /show`
- `POST /open`
- `GET /terminals`
- `POST /terminals`
- `GET /terminals/:id/buffer`
- `GET /terminals/:id/transcript`
- `POST /terminals/:id/write`
- `DELETE /terminals/:id`

`packages/core/src/command-protocol.ts` owns the shared route constants and command payload shapes. The desktop command server, CLI app client, and MCP client should consume that shared contract rather than duplicating routes.

## Terminal And Agent Model

Terminals are the first agent interface.

- plain shell terminals use `node-pty`
- Claude and Codex terminal agents run in Exo-managed tmux sessions
- Exo session ids are local app ids such as `term-13`
- tmux sessions are named `exo-agent-*`
- terminal buffers are capped in main process memory
- full terminal transcripts are persisted under `.exo/terminal-transcripts/`
- transcript retention defaults to 14 days, 500MB total, and 50MB per file
- renderer reload hydrates terminal output from `terminals:read`
- closing or killing an agent terminal should terminate the backing tmux session

The renderer should treat terminal sessions as live views over supervised processes, not as durable state by itself.

Stability constraints:

- do not reset xterm with full-buffer rewrites during normal streaming
- only the active terminal should receive hot React buffer updates
- strip mouse tracking modes from app output so wheel scroll remains local scroll in Exo
- terminal file drops should resolve to filesystem paths before being pasted into the pty

## CLI Contract

The `bin/exo` CLI has two modes:

- static workspace/runtime commands that read local config
- live app commands that require a running Exo command server

Current live terminal commands:

- `exo terminals list`
- `exo terminals create <shell|claude|codex> [cwd]`
- `exo terminals read <id>`
- `exo terminals transcript <id> [--tail n] [--full]`
- `exo terminals write <id> <text>`
- `exo terminals send <id> <text>`
- `exo terminals kill <id>`

Agent-oriented aliases mirror the MCP tools for already-running local agent sessions:

- `exo agents list`
- `exo agents create <shell|claude|codex> [cwd]`
- `exo agents read <id> [--tail n] [--raw]`
- `exo agents send <id> <text>` sends the message and presses Enter by default
- `exo agents message <id> <text>` / `exo agents tell <id> <text>` alias `agents send`
- `exo agents send <id> <text> --raw` writes without pressing Enter
- `exo agents interrupt <id> [escape|ctrl-c]`
- `exo agents terminate <id>`

The CLI remains the canonical operator surface. MCP wraps Exo capabilities for agent access; it should not become a separate runtime model.

## MCP Contract

`packages/mcp` exposes Exo terminal agents as MCP tools:

- `list_agents`
- `create_agent`
- `read_agent`
- `send_agent_message`
- `interrupt_agent`
- `terminate_agent`

By default, the MCP server needs Exo already running so it can read `.exo/server.json`. With `EXO_MCP_AUTOSTART=1`, it can start Exo through `EXO_MCP_START_COMMAND` and wait for the command server.

## Editor Model

Exo has two editor paths:

- markdown notebook mode for notes
- code/plain-file mode for project files

Markdown-on-disk is canonical. Notebook/live-preview mode is a projection.

Project-file editing currently supports CodeMirror language modes for:

- Python
- JSON / JSONC, including JSON linting
- TOML
- `.env`
- YAML
- JavaScript / TypeScript / TSX
- HTML / CSS
- shell scripts

Future linter work should plug external tools into this path instead of replacing CodeMirror.

Project roots are explicit imported folders. First-run source builds attach the Exo repo as the first project root so the app can inspect and edit itself; Exo does not attach the workspace-level `projects/` directory by default.

## Search And Retrieval

Search currently returns:

- local note filename/path matches only

Search runs on explicit submit from the top bar. QMD is not part of desktop or CLI search; broad retrieval should return only as an explicit, isolated future tool after the fast search path is stable.

QMD remains in core as optional notes index / retrieval infrastructure for future agent memory. The eventual unified search design should use the same index agents use, but only with explicit tiers, cancellation, result caps, and renderer safety checks.

## Refactor Boundaries

Current stabilization work has started splitting broad files into services:

- settings persistence lives in `settings-store`
- workspace file watching lives in `workspace-watchers`
- terminal transcript retention lives in `terminal-transcripts`
- terminal IPC registration lives in `terminal-ipc`

Keep new main-process behavior behind small services instead of adding more responsibility to `index.ts`.

## Logs

Primary runtime log:

- `$HOME/Library/Application Support/@exo/desktop/exo-main.log`

macOS crash reports:

- `$HOME/Library/Logs/DiagnosticReports/Electron-*.ips`

Use the logs when diagnosing blank windows, renderer crashes, and command-server startup issues.
