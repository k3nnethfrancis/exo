# Exo Architecture

Last updated: 2026-05-12

Exo is a local-first agentic development environment built around a shared exocortex for humans and terminal agents. The current system is still shell-first, but it now has three live control surfaces over the same workspace runtime:

- desktop app
- `bin/exo` CLI
- `@exo/mcp` bridge

Memory, workcells, datasets, evals, and training are still future layers. The current runtime work is about making Markdown notes, code files, terminals, and terminal agents legible and controllable inside one local workspace.

## Package Boundaries

- `apps/desktop`
  - Electron main process, preload bridge, React renderer, terminal supervision, and the local command server.
- `packages/core`
  - Workspace config, note/project file discovery, markdown metadata, runtime launch plans, shared command protocol types, and retrieval/index adapters.
- `packages/cli`
  - CLI commands for runtime status, launch plans, app search/open/config, terminal operations against a running Exo app, and local MCP client integration setup.
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
- terminal history policy is configured through workspace settings
- `full` terminal history keeps Exo's in-memory buffers untrimmed and uses the configured tmux/xterm line window
- `custom` terminal history trims Exo's in-memory buffers by the configured line count
- terminal transcripts are persisted under `.exo/terminal-transcripts/`
- transcript retention defaults to `forever`; optional day-based retention is explicit in settings
- restored tmux-backed agent terminals seed xterm once from tmux history, then render only the live PTY/tmux attach stream
- closing or killing an agent terminal should terminate the backing tmux session

The renderer should treat terminal sessions as live views over supervised processes, not as durable state by itself.

Stability constraints:

- do not reset xterm with full-buffer rewrites during normal streaming
- do not replay recurring `tmux capture-pane` snapshots into visible xterm surfaces
- only the active terminal should receive hot React buffer updates
- strip mouse tracking modes from app output so wheel scroll remains local scroll in Exo
- terminal file drops should resolve to filesystem paths before being pasted into the pty

## CLI Contract

The `bin/exo` CLI has two modes:

- static workspace/runtime commands that read local config
- live app commands that require a running Exo command server

Workspace resolution is shared with the desktop app. Explicit workspace env vars still win; otherwise the CLI reads the active desktop workspace registry and falls back to cwd/dev defaults. The workspace registry surface is:

- `exo workspace current`
- `exo workspace list`
- `exo workspace use <workspace-id-or-notes-path>`

Current live terminal commands:

- `exo project-roots list`
- `exo project-roots add <path>`
- `exo project-roots remove <path>`
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

Integration setup commands:

- `exo integrations doctor`
- `exo integrations config <codex|claude|all>`
- `exo integrations install <codex|claude|all> [--dry-run]`
- `exo integrations test <codex|claude|all>`

## MCP Contract

`packages/mcp` exposes Exo terminal agents as MCP tools:

- `list_agents`
- `create_agent`
- `read_agent`
- `send_agent_message`
- `interrupt_agent`
- `terminate_agent`

By default, the MCP server needs Exo already running so it can read `.exo/server.json`. With `EXO_MCP_AUTOSTART=1`, it can start Exo through `EXO_MCP_START_COMMAND` and wait for the command server. If `EXO_RUNTIME_ROOT` or explicit workspace env vars are not set, MCP uses the same active desktop workspace registry as the CLI to find the runtime root.

`bin/exo integrations doctor|config|install|test` is the setup surface for external agent clients. It installs the same stdio MCP server into Codex and Claude Code through their native MCP CLIs, while the MCP server itself continues to speak to Exo through the shared command-server contract.

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

## Pane Model

The current workspace pane graph is a split tree whose leaves are typed as either editor leaves or terminal leaves. Editor leaves own document tabs; terminal leaves own terminal session tabs. This supports arbitrary file/terminal split layouts without mixing live process state into document state.

Mixed file/terminal tab groups should be a deliberate next model, not a visual shortcut. The target shape is one pane leaf with typed tabs:

- document tabs point at open file paths
- terminal tabs point at supervised terminal session ids
- the active tab chooses which body renderer mounts
- tab drag/drop moves a typed tab between compatible pane leaves
- closing a terminal tab kills or detaches the supervised process through the terminal service, while closing a document tab only mutates editor state

Avoid nesting a full `TerminalDock` inside editor chrome for mixed groups. Shared tab chrome should sit above typed tab bodies, with terminals remaining live views over main-process sessions. Persistence should store pane/tab layout separately from terminal process lifecycle; restored layouts must prune stale terminal ids rather than recreating processes implicitly.

Migration path:

1. Keep the current split-tree leaf model stable for separate editor and terminal leaves.
2. Introduce a normalized tab descriptor type that can represent documents and terminals.
3. Convert editor and terminal leaves to render through the shared tab descriptor without changing behavior.
4. Only then allow a single leaf to contain both document and terminal descriptors.

## Search And Retrieval

Search currently returns:

- live Explore typing: local note filename/path matches
- optional Explore Enter: QMD lexical results when enabled
- CLI/MCP: QMD-backed search when enabled, with filesystem fallback

Search lives in the explorer search pane and keeps live typing fast. QMD-backed indexed search is explicit so heavy retrieval does not block the renderer.

QMD integration lives behind `packages/core/src/qmd.ts`. The desktop command server exposes status, search, read, sync, update, and embed routes; CLI and MCP call those routes rather than instantiating their own QMD stores. See `qmd-integration-notes.md` for the dependency boundary and upgrade checklist.

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
