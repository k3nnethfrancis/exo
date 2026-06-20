# Exo Architecture

Last updated: 2026-05-31

Exo is a local-first exograph workspace for humans and terminal agents. The current system is still shell-first, but it now has three live control surfaces over the same workspace runtime:

- desktop app
- `bin/exo` CLI
- `@exo/mcp` bridge

The exograph is the product object: a user-defined graph over notes, projects, agents, sessions, files, artifacts, and workflow runs with growable relational ontologies. Memory, workcells, datasets, evals, and training are still future layers. The current runtime work is about making Markdown notes, code files, terminals, and terminal agents legible and controllable inside one local workspace.

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

## Refactor Direction

The immediate architecture is current-package domain modules, not a new runtime package yet. The cleanup target is:

- keep `apps/desktop` as the Electron host while extracting main-process services from `src/main/index.ts`
- keep `packages/core` as portable models, pure transforms, runtime config, and shared protocols
- keep `packages/cli` and `packages/mcp` as command-server clients
- move to a `packages/runtime` only after resident lifecycle and multi-agent coordination produce stable process-owned service contracts
- introduce plugin-shaped internal registries only where core runtime primitives are stable enough to expose

This staged approach lets Exo ship resident runtime features without prematurely freezing plugin or runtime APIs.

The first plugin architecture pass should not load arbitrary third-party code. It should define typed internal registries for bundled capabilities, then migrate hardwired behavior onto those contracts. The first two practical seams are search providers and agent harnesses because QMD and shell/Claude/Codex/Pi/Hermes are plugin-shaped. Vanilla Exo should be understood as core plus bundled/recommended plugins, not core plus permanent hardcoded defaults.

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
- `GET /terminals/:id/tail`
- `GET /terminals/:id/transcript`
- `POST /terminals/:id/write`
- `POST /terminals/:id/message`
- `POST /terminals/:id/reconnect`
- `DELETE /terminals/:id`

`packages/core/src/command-protocol.ts` owns the shared route constants and command payload shapes. The desktop command server, CLI app client, and MCP client should consume that shared contract rather than duplicating routes.

## App Lifecycle Model

Exo has two separate lifecycle states:

- the Exo process is running
- the workspace window is visible

The command server, MCP bridge, file watchers, transcript writers, and terminal-agent sessions belong to the running process, not to the visible window. Closing the main window hides the workspace UI while leaving those runtime services alive. Explicit app quit is the operation that stops or detaches live terminal agents according to the terminal runtime model.

This distinction is central to multi-agent workflows: an external Codex or Claude agent can use Exo MCP to create, read, and message Exo-managed agents while the user keeps the Exo window hidden, then the user can reopen the window to monitor or take over those sessions.

Exo now keeps the process resident when the workspace window closes. Live app commands require that resident desktop process to be running and available through `.exo/server.json`; they do not require the workspace window to be visible.

The macOS menu bar controller is the visible runtime control surface when the workspace window is hidden. It exposes Show Exo, Settings, command-server status and restart, live terminal count, and explicit Quit.

For Exo-on-Exo development, the installed app is the stable resident runtime. Source QA should use `pnpm dev:qa`, which sets separate `.exo-dev/` runtime and user-data paths so the dev process does not overwrite the stable app's `server.json`, settings, or command-server discovery.

## Feed, Scheduler, And Routine Model

Exo should eventually have a core feed/event stream and scheduler for local AI workbench routines.

The feed is the broader primitive behind an inbox. It is a stream of incoming or generated context items from quick capture, files, notes, terminal agents, MCP messages, RSS/bookmarks, voice transcripts, workflow results, git events, evals, and plugin-generated sessions. Feed items are not automatically durable graph facts. They are reviewable inputs that can be linked, archived, promoted into notes/entities/tasks, or used as trace/artifact evidence.

The scheduler is core because recurring local AI work should not depend on each plugin inventing cron. A scheduled run should specify:

- selected harness or agent runtime
- prompt text and optional required harness skills
- scope such as note root, project root, profile, feed query, entity set, or saved search
- permissions for reads, writes, terminal access, network, model calls, and exports
- output policy: direct write, proposed changes, artifacts only, or review required
- logs, traces, artifacts, and recovery state

A Routine is the product-level run definition: prompt, selected harness, optional required harness skills, manual or scheduled trigger, scope, permissions, and output policy. Each execution of a Routine is a Run with logs, traces, artifacts, proposed changes, and review state.

Skills are harness-visible capabilities referenced by prompts, not Exo worker runtimes. A harness may expose a skill inventory, and a future Exo config surface should help users see which skills are connected to which harnesses. Harness plugins provide headless execution. Profile/plugin packages may ship prompts, templates, default Routines, schedules, and UI surfaces, but Exo core owns scheduling, permission checks, Run records, artifacts, provenance, and review state.

## Terminal And Agent Model

Terminals are the first agent interface.

- shell, Claude Code, Codex, Pi, Hermes, and future harness terminals use tmux-backed sessions for durable processes, with Exo's current embedded terminal path using tmux control mode for live rendering and input
- Exo session ids are local app ids such as `term-13`
- terminal history policy is configured through workspace settings
- `full` terminal history keeps Exo's live terminal tail at the configured full xterm line window
- `custom` terminal history trims Exo's in-memory tail by the configured line count
- terminal transcripts are persisted under `.exo/terminal-transcripts/`
- transcript retention defaults to `forever`; optional day-based retention is explicit in settings
- closing or killing a terminal intentionally terminates the tmux-backed session; window close/hide detaches the UI while the runtime remains available

See `terminal-runtime-decision.md`, `terminal-refactor-plan.md`, and `terminal-quality-standard.md` for the tmux-backed runtime direction and QA bar.

The renderer should treat terminal sessions as live views over supervised processes, not as durable state by itself.

Stability constraints:

- do not reset xterm with full-output rewrites during normal streaming
- do not add secondary terminal transports or hidden process-survival fallbacks without a design decision
- only the active terminal should receive hot renderer append work
- strip mouse tracking modes from app output so wheel scroll remains local scroll in Exo
- terminal file drops should resolve to filesystem paths before being pasted into the active terminal session

Open architecture question: the current embedded terminal path still makes Exo responsible for tmux control-mode decoding, xterm rendering, hydration, and reconnect behavior. Any simplification must preserve the product requirements in `terminal-quality-standard.md`, but proposals may demote embedded interactive terminals if Exo can still reliably supervise durable tmux sessions, expose transcripts/tails, send semantic agent messages, and open a real external terminal attached to the tmux session.

## CLI Contract

The `bin/exo` CLI has two modes:

- static workspace/runtime commands that read local config
- live app commands that require a running Exo command server

Workspace resolution is shared with the desktop app. Explicit workspace env vars still win; otherwise the CLI reads the active desktop workspace registry and falls back to cwd/dev defaults. The workspace registry surface is:

- `exo workspace current`
- `exo workspace list`
- `exo workspace use <workspace-id-or-notes-path>`

Current live app operator/debug commands:

- `exo project-roots list`
- `exo project-roots add <path>`
- `exo project-roots remove <path>`
- `exo terminals list`
- `exo terminals create <shell|claude|codex|pi|hermes> [cwd]`
- `exo terminals read <id>`
- `exo terminals transcript <id> [--tail n] [--full]`
- `exo terminals write <id> <text>`
- `exo terminals send <id> <text>`
- `exo terminals reconnect <id>`
- `exo terminals kill <id>`

`exo terminals` is the low-level terminal debug surface. `exo agents` is the primary human/agent session surface and mirrors the MCP work-plane tools for already-running local agent sessions:

- `exo agents list`
- `exo agents create <shell|claude|codex|pi|hermes> [cwd]`
- `exo agents read <id> [--tail n] [--raw]`
- `exo agents send <id> <text>` sends the message and presses Enter by default; Codex startup sends may be queued until normal chat input is ready
- `exo agents send <id> <text> --raw` writes without pressing Enter
- `exo agents interrupt <id> [escape|ctrl-c]`
- `exo agents terminate <id>`

The CLI remains the canonical operator/admin/debug surface. It may grow broad note, graph, search-provider, maintenance, and developer commands because it is the place for humans, scripts, setup, diagnostics, and supervised administration.

MCP is the narrower agent work plane. It should expose enough for agents to orient, search, read, maintain allowed notes, and communicate, but it should not expose every setup, repair, index-maintenance, raw terminal, provider-admin, or workspace-mutation control.

Integration setup commands:

- `exo integrations doctor`
- `exo integrations config <codex|claude|all>`
- `exo integrations install <codex|claude|all> [--dry-run]`
- `exo integrations test <codex|claude|all>`

## MCP Contract

`packages/mcp` exposes a narrow Exo agent work plane:

- `workspace_status`
- `search`
- `read_document`
- `open_preview`
- `list_agents`
- `create_agent`
- `read_agent`
- `send_agent_message`
- `interrupt_agent`
- `terminate_agent`

Future MCP additions should be tested against this rule: can an agent use this tool to do useful work in the current workspace without gaining broad admin/debug power? Good candidates are scoped document graph/context inspection, allowed note creation/append/guarded patch, browser preview of agent-produced artifacts, and agent communication. Bad candidates are provider installation, index maintenance, project-root mutation, raw terminal writes, and app repair.

By default, the MCP server needs Exo already running so it can read `.exo/server.json`. With `EXO_MCP_AUTOSTART=1`, it can start Exo through `EXO_MCP_START_COMMAND` and wait for the command server. If `EXO_RUNTIME_ROOT` or explicit workspace env vars are not set, MCP uses the same active desktop workspace registry as the CLI to find the runtime root.

`bin/exo integrations doctor|config|install|test` is the setup surface for external agent clients. It installs the default stdio MCP server into Codex and Claude Code through their native MCP CLIs, while the MCP server itself continues to speak to Exo through the shared command-server contract.

Remote-only MCP hosts such as Glean can use the opt-in Streamable HTTP transport: `exo-mcp --transport http --host 127.0.0.1 --port 3333`. It is not a replacement for stdio. HTTP binds to localhost by default, should sit behind internal proxy/auth before wider exposure, and reuses the exact same narrow MCP tool registration so the transport does not create a second product surface.

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

QMD integration lives behind `packages/core/src/qmd.ts`. The desktop command server exposes status, search, read, sync, update, and embed routes. CLI can use the full notes-index route set; MCP uses search/read and summarizes index status through `workspace_status` rather than instantiating its own QMD store. See `qmd-integration-notes.md` for the dependency boundary and upgrade checklist.

Longer term, QMD should be the default implementation of a search-provider contract, not the only possible retrieval architecture. The provider contract should cover capability discovery, status/health, search, read/resolve target, optional graph hints, sync/update, cancellation, and diagnostics. MCP should receive the stable search/document operations; CLI/UI should own provider setup, sync, repair, and diagnostics.

The next architecture step is to make that provider contract real internally before adding public plugin loading. QMD remains the only built-in provider until there is a real second provider to test the boundary against.

## Note Graph And Wiki Maintenance

Exo's note graph contract should support LM Wiki-style maintenance over Markdown on disk:

- selected note roots define the writable wiki boundary
- project roots remain explicit code/review context unless later added to memory intentionally
- file identity should support exact paths and friendly note/link resolution
- document context should combine metadata, headings, outgoing links, backlinks, unresolved links, tags/properties, and related search hits
- write operations should be scoped and reviewable: create, append, and guarded patch before broad overwrite
- maintenance reports should surface orphans, dead ends, unresolved links, stale pages, contradiction candidates, and missing cross-links

This is also the practical split between CLI and MCP for notes. CLI can mirror mature knowledge-app surfaces broadly. MCP should expose a compact set of agent-safe wiki operations so agents can maintain the knowledge graph without becoming a full filesystem/admin client.

## Exograph Model

Exo should treat Markdown/files as the canonical user-owned substrate and `.exo/` as derived runtime state.

Canonical user-owned data:

- Markdown body content, headings, links, tags, and citations
- frontmatter/properties for approved durable node and relation facts
- folders and path conventions selected by the user
- project files, code diffs, and artifacts when explicitly attached

Exo-owned derived data:

- graph/search indexes and caches
- inferred candidate nodes/edges
- schema/profile proposals
- workflow run logs
- provenance and review metadata

The initial exograph profile should be configuration, not code: node types, edge types, path/property mappings, conventions, templates, maintenance rules, and review policy. Exo may ship starter profiles such as a minimal flat-notes profile, Shoshin, and LM Wiki, but no starter profile should be mandatory.

### OKF Compatibility

Exo's exograph model should be compatible with the Open Knowledge Format (OKF) v0.1 draft without enforcing OKF on arbitrary user Markdown. OKF represents knowledge as a directory of UTF-8 Markdown concept documents with YAML frontmatter, where every non-reserved `.md` concept has a required `type` field, optional fields such as `title`, `description`, `resource`, `tags`, and `timestamp`, normal Markdown links for relationships, optional `index.md` files for progressive disclosure, and optional `log.md` files for update history.

This matches Exo's direction and should become the default interoperability affordance:

- Exo should inspect attached note roots for OKF-compatible structure and use it when present without forcing the user to restructure files.
- Exo commands such as create note, create project, create concept, or future profile setup may offer OKF-compatible templates as options.
- Exo starter profiles should be able to produce OKF-compatible bundles.
- Exo should treat missing `type`, unknown frontmatter fields, unknown `type` values, missing optional fields, missing indexes, and broken links as normal Markdown states unless the user explicitly asks for OKF conformance checks.
- Exo should preserve unknown frontmatter when editing or round-tripping documents.
- User-approved durable graph facts should live in Markdown/frontmatter/links in a way that can be exported as OKF.
- `.exo/` remains the place for derived indexes, traces, proposals, workflow runs, provenance, plugin state, and dataset artifacts that are not themselves concept documents.
- Plugin artifacts should reference OKF concepts where possible, and may emit OKF concept documents for curated knowledge plus JSONL or other artifacts for raw traces/training data.

OKF is a document/bundle exchange standard, not Exo's runtime or plugin API. Exo can support richer local state and workflows, and it should never make OKF conformance a prerequisite for using normal Markdown notes. The portable knowledge layer should speak OKF when the user opts into structure or imports an OKF-compatible graph.

The two user-facing exograph modes are:

- Analyze Exograph: read-only discovery, schema suggestions, and health diagnostics.
- Maintain Exograph: reviewable file/profile changes after user approval.

Do not add write-capable maintainer workflows before read-only graph extraction, proposal storage, and review semantics are defined.

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
