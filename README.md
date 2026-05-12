# Exo

Exo is a workspace-centric research IDE for autonomous intellectual work.

It is the Electron rebuild of Garden. The product direction stays intact, but the shell is now built around:
- `workspace_root` as the primary operating context
- attached `note_roots` and `project_roots`
- terminal agents as first-class operator surfaces
- CLI and MCP control paths into the running app
- notes, project files, terminals, workcells, memory, datasets, and evals sharing one eventual operator environment

## Current Status

The shell is usable and now covers more than notes:
- markdown notes with live-preview editing, properties/frontmatter, backlinks/tags/links, branch families, foldable lists, and table widgets
- project/code files with CodeMirror language support for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell files
- project folders are imported explicitly; Exo no longer attaches the whole workspace `projects/` directory by default
- JSON parse linting through the CodeMirror lint gutter
- live note search by filename/path
- recursive editor/terminal pane model with flat tabs and no-empty-leaves pruning
- xterm/node-pty terminals rooted in the workspace by default
- Claude and Codex launchers backed by Exo runtime launch plans

The runtime control layer is now active:
- Electron main-process command server writes `.exo/server.json`
- `bin/exo` can drive a running app through HTTP
- terminal sessions can be listed, created, read, written to, sent Enter-terminated messages, and killed from the CLI
- Claude/Codex agent terminals use tmux for restart persistence
- Exo MCP exposes agent tools for other local agents: list, create, read, send, interrupt, and terminate
- MCP can autostart Exo when configured with `EXO_MCP_AUTOSTART=1`

## Stack

- Electron
- React
- TypeScript
- Vite
- CodeMirror 6
- xterm.js
- node-pty
- tmux for durable Claude/Codex agent terminals
- Playwright
- MCP SDK

## Workspace Model

Exo settings are stored in one JSON file:

- macOS default: `$HOME/Library/Application Support/@exo/desktop/workspace-settings.json`
- override: `EXO_SETTINGS_PATH`

Portable source defaults use the current working directory as `workspace_root`, `workspace_root/notes` as the initial note root, and the Exo repo as the first project root. Kenneth's local lab paths should live in the settings file or environment, not in core source defaults.

Example local model:
- `workspace_root = /Users/kenneth/Desktop/lab`
- `note_roots = [/Users/kenneth/Desktop/lab/notes/shoshin-codex]`
- `project_roots = [/Users/kenneth/Desktop/lab/projects/exo]`, then any additional imported project folders
- `default_terminal_cwd = /Users/kenneth/Desktop/lab`

Runtime files live under `.exo/` inside the workspace root:
- `.exo/server.json` — command server discovery
- `.exo/instructions/AGENTS.md` — Exo-generated generic runtime contract
- `.exo/instructions/CLAUDE.md` — Exo-generated Claude overlay
- `.exo/terminal-state.json` — persisted tmux-backed agent terminal state
- `.exo/messages/` and `.exo/agent-communication.sqlite` — reserved communication transport paths

QMD remains an optional notes index / retrieval backend for future memory work. It is not the current top-bar search backend; app and CLI search currently return fast note filename/path matches only.

## Quick Start

```bash
pnpm install
pnpm dev
```

Run with remote debugging when inspecting the real Electron renderer:

```bash
pnpm --filter @exo/desktop dev -- --remote-debugging-port=9222
```

## CLI

Standalone workspace/search/runtime commands:

```bash
./bin/exo workspace status
./bin/exo search "query"
./bin/exo runtime status
./bin/exo runtime sync
./bin/exo launch claude
```

Commands that drive a running Exo app:

```bash
./bin/exo open /path/to/file
./bin/exo status
./bin/exo config get
./bin/exo terminals list
./bin/exo terminals create shell
./bin/exo terminals create claude /Users/kenneth/Desktop/lab
./bin/exo terminals create codex /Users/kenneth/Desktop/lab
./bin/exo terminals read term-4
./bin/exo terminals transcript term-4 --tail 200000
./bin/exo terminals write term-4 "raw input"
./bin/exo terminals send term-4 "message plus Enter"
./bin/exo terminals kill term-4
```

Agent-oriented aliases mirror the MCP tools and are easier for another running Codex/Claude session to use without restarting to load MCP:

```bash
./bin/exo agents list
./bin/exo agents create claude /Users/kenneth/Desktop/lab
./bin/exo agents read term-4 --tail 20000
./bin/exo agents read term-4 --raw
./bin/exo agents send term-4 "message plus Enter"
./bin/exo agents message term-4 "message plus Enter"
./bin/exo agents tell term-4 "message plus Enter"
./bin/exo agents send term-4 "raw input without Enter" --raw
./bin/exo agents interrupt term-4 ctrl-c
./bin/exo agents terminate term-4
```

Terminal transcripts are persisted under `.exo/terminal-transcripts/`. The live UI only renders a bounded tail for stability, while CLI/MCP reads can access the disk-backed transcript. Default retention:
- `14` days max age
- `500MB` max transcript directory size
- `50MB` max per transcript file, trimmed to its recent tail

Override with `EXO_TERMINAL_TRANSCRIPT_RETENTION_DAYS`, `EXO_TERMINAL_TRANSCRIPT_MAX_TOTAL_MB`, and `EXO_TERMINAL_TRANSCRIPT_MAX_FILE_MB`.

## MCP

`packages/mcp` exposes the running Exo app as an MCP server. Current tools:
- `list_agents`
- `create_agent`
- `read_agent`
- `send_agent_message`
- `interrupt_agent`
- `terminate_agent`

Configure with autostart when agents should be able to launch Exo themselves:

```json
{
  "mcpServers": {
    "exo": {
      "command": "pnpm",
      "args": ["--dir", "/Users/kenneth/Desktop/lab/projects/exo", "--filter", "@exo/mcp", "start"],
      "env": {
        "EXO_WORKSPACE_ROOT": "/Users/kenneth/Desktop/lab",
        "EXO_MCP_AUTOSTART": "1"
      }
    }
  }
}
```

## Validation

```bash
pnpm typecheck
pnpm test
pnpm test:e2e
pnpm test:visual
```

For focused work:

```bash
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
pnpm --filter @exo/cli typecheck
pnpm --filter @exo/mcp typecheck
pnpm --filter @exo/mcp test
```

## Logs

Main-process runtime log:

```bash
tail -f "$HOME/Library/Application Support/@exo/desktop/exo-main.log"
```

macOS crash reports:

```bash
ls "$HOME/Library/Logs/DiagnosticReports"/Electron-*.ips
```

## Docs Order

- `ledger.md`: fastest current-state handoff
- `plan.md`: canonical strategy and phased implementation plan
- `docs/tasks.md`: active execution tracker
- `docs/architecture.md`: system architecture
- `docs/roadmap.md`: feature roadmap by phase
- `docs/resources.md`: retained references and external substrates
