# Exo

Exo is a workspace-centric research IDE, not a single-vault editor.

## Read Order

1. `ledger.md`
2. `plan.md`
3. `docs/tasks.md`
4. `docs/architecture.md`
5. `docs/roadmap.md`
6. `docs/resources.md`
7. `packages/mcp/README.md` when touching agent/MCP control

## Dev Loop

- Keep the Exo dev server running while working on the app.
- Start it with `pnpm dev`; use `pnpm --filter @exo/desktop dev -- --remote-debugging-port=9222` when renderer inspection is needed.
- Kenneth often reports bugs live while using the app. Treat those as immediate priority.
- Restart Exo after changes that touch Electron main, preload, native terminal handling, runtime config, or package dependencies. HMR is only enough for pure renderer changes.
- The real Electron renderer must be inspected through CDP on port `9222`; a normal browser at `localhost:5173` does not have `window.exo`.

## Commands

- Start server: `pnpm dev`
- Typecheck all: `pnpm typecheck`
- Test all: `pnpm test`
- Desktop typecheck: `pnpm --filter @exo/desktop typecheck`
- Desktop unit test: `pnpm --filter @exo/desktop test`
- CLI typecheck: `pnpm --filter @exo/cli typecheck`
- MCP typecheck/test: `pnpm --filter @exo/mcp typecheck && pnpm --filter @exo/mcp test`
- E2E: `npx playwright test -c apps/desktop/playwright.config.ts apps/desktop/tests/e2e/shell.spec.ts`
- Build: `pnpm build`
- Run built app: `node scripts/run-built-app.mjs`

## Current Architecture

- Renderer never touches filesystem or processes directly. It uses `window.exo` from preload.
- Electron main owns workspace filesystem operations, note parsing/saving, terminal lifecycle, tmux persistence, and the command server.
- `packages/core` owns workspace/runtime models, search, notes, branch families, QMD adapters, and launch plans.
- `packages/cli` owns the `bin/exo` command surface.
- `packages/mcp` wraps the running Exo command server as MCP tools for local agents.
- The main-process command server writes `.exo/server.json`; CLI/MCP discover the running app from that file.

## Terminal And Agent Model

- Shell, Claude, and Codex terminals are Exo-managed `node-pty` sessions.
- Claude/Codex agent terminals are launched inside tmux sessions named `exo-agent-*` so they can survive Exo restarts.
- Closing/killing a terminal through Exo now terminates the backing tmux session for agent terminals; do not reintroduce detached zombie agent sessions.
- The terminal manager stores a bounded output buffer (`80_000` chars) for renderer reload hydration.
- Full terminal history is persisted under `.exo/terminal-transcripts/`; the live buffer is only the renderer/reload tail.
- Transcript retention defaults: 14 days, 500MB total, 50MB per file. Override with `EXO_TERMINAL_TRANSCRIPT_RETENTION_DAYS`, `EXO_TERMINAL_TRANSCRIPT_MAX_TOTAL_MB`, and `EXO_TERMINAL_TRANSCRIPT_MAX_FILE_MB`.
- The renderer only keeps active terminal buffers hot; hidden sessions should not force React updates on every chunk.
- Terminal wheel events must never reach Claude/Codex as mouse/history input. `TerminalView` captures wheel events, and the main terminal manager strips mouse-tracking escape modes before xterm sees them.
- File/image drops into terminals are resolved in preload with Electron `webUtils.getPathForFile`.

## CLI / MCP Contract

The CLI and MCP are peer clients into Exo's local command server.

CLI app commands:
- `exo open <path>`
- `exo status`
- `exo config get [key]`
- `exo terminals list`
- `exo terminals create <shell|claude|codex> [cwd]`
- `exo terminals read <id>`
- `exo terminals transcript <id> [--tail n] [--full]`
- `exo terminals write <id> <text>`
- `exo terminals send <id> <text>`
- `exo terminals kill <id>`
- `exo agents list`
- `exo agents create <shell|claude|codex> [cwd]`
- `exo agents read <id> [--tail n] [--raw]`
- `exo agents send <id> <text>` sends the message and presses Enter by default
- `exo agents message <id> <text>` / `exo agents tell <id> <text>` alias `agents send`
- `exo agents send <id> <text> --raw` writes without pressing Enter
- `exo agents interrupt <id> [escape|ctrl-c]`
- `exo agents terminate <id>`

MCP tools:
- `list_agents`
- `create_agent`
- `read_agent`
- `send_agent_message`
- `interrupt_agent`
- `terminate_agent`

MCP autostart is supported with `EXO_MCP_AUTOSTART=1`. It starts Exo with `EXO_MCP_START_COMMAND` or defaults to this repo's `bin/exo dev`.

## Editor Model

- Markdown files use CodeMirror plus `markdownLivePreview.ts`.
- Project/code files use the non-markdown editor mode in `NoteEditor.tsx`.
- Code language support lives in `components/codeLanguages.ts`.
- Current language support includes Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell.
- JSON parse linting is wired through CodeMirror's lint gutter; broader project-local linters should be added through adapters later, not hardcoded into the editor.
- Project roots are explicit imported folders. Do not assume the whole workspace `projects/` directory is attached.
- Dotfiles like `.env` are visible under imported project roots; dot directories such as `.git` remain hidden.

## Stability Notes

- Search is live note filename/path search only. QMD, project files, tags, and broad retrieval are intentionally not part of app or CLI search.
- Renderer crash logs are written by main to `$HOME/Library/Application Support/@exo/desktop/exo-main.log`.
- Native Electron crash reports are under `$HOME/Library/Logs/DiagnosticReports/Electron-*.ips`.
- Do not auto-reload on `render-process-gone`; a prior reload attempt hit an Electron native assertion. Log the crash and restart deliberately.

## Product Rules

- `workspace_root` is primary.
- `note_roots` and `project_roots` are separate attachments.
- Markdown-on-disk stays canonical.
- Notebook mode is a projection.
- Terminals are plain by default, with Claude/Codex as launcher commands.
- CLI-first operator surfaces come before deep UI.
- MCP is now the structured agent bridge into Exo, but should stay focused on Exo-native runtime/workcell capabilities.
- Memory, workcells, datasets, and evals are separate system layers.
- Every fragile UI behavior needs an automated harness.

## Validation Rule

UI/runtime work is not complete until the relevant checks pass. For most recent Exo changes this means at least:
- `pnpm --filter @exo/desktop typecheck`
- `pnpm --filter @exo/desktop test`
- plus CLI/MCP/core checks for touched packages
