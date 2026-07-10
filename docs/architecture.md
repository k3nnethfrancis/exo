# Exo Architecture

Last updated: 2026-07-08

Exo is a local-first Exograph workspace for building a personal LM wiki over Markdown. The current system has two live control surfaces over the same workspace runtime:

- desktop app
- `bin/exo` CLI

The exograph is the core product object: a user-defined graph over Markdown notes, projects, files, terminals, invocation records, artifact references, and provenance references with growable relational ontologies. The current runtime work is about making Markdown notes, code files, terminals, search providers, and note-native agent-command invocation legible and controllable inside one local workspace.

## Package Boundaries

- `apps/desktop`
  - Electron main process, preload bridge, React renderer, terminal supervision, and the local command server.
- `packages/core`
  - Workspace config, note/project file discovery, markdown metadata, runtime launch plans, shared command protocol types, and retrieval/index adapters.
- `packages/cli`
  - CLI commands for runtime status, launch plans, app search/open/config, terminal operations against a running Exo app, and configured agent-command spawn.

Renderer code never touches the filesystem or processes directly. It goes through preload APIs backed by main-process services.

## Refactor Direction

The immediate architecture is current-package domain modules, not a new runtime package yet. The cleanup target is:

- keep `apps/desktop` as the Electron host while extracting main-process services from `src/main/index.ts`
- keep `packages/core` as portable models, pure transforms, runtime config, and shared protocols
- keep `packages/cli` as the command-server client
- move to a `packages/runtime` only after resident lifecycle and multi-agent coordination produce stable process-owned service contracts
- introduce plugin-shaped internal registries only where core runtime primitives are stable enough to expose

This staged approach lets Exo ship resident runtime features without prematurely freezing plugin or runtime APIs.

The first plugin architecture pass should not load arbitrary user code. It should define typed internal registries for official capabilities, then migrate hardwired behavior onto those contracts. The first two practical seams are search providers and agent harnesses because QMD and shell/Claude/Codex/Pi/Hermes are plugin-shaped. Vanilla Exo should be understood as core plus official/recommended plugins, not core plus permanent hardcoded defaults.

## Core Substrate And Official Plugins

Exo core owns the services that must be stable, permissioned, and coherent across the app:

- Markdown files, note roots, project roots, basic file/path/text search, and core graph primitives
- pane/grid layout, tab descriptors, persisted layout, and trusted web viewer host primitive
- terminal runtime, rendering surface, scrollback, transcripts, reconnect, diagnostics, and semantic message delivery
- command server, resident runtime, CLI base contracts, settings, permissions, and app lifecycle
- minimal feed/activity substrate, artifact references, provenance references, optional review hooks, and plugin registry/trust state

Official and local plugins provide replaceable capability variation:

- agent harness adapters such as shell, Claude Code, Codex, Pi, Hermes, Aider, OpenCode, and local agents
- advanced search/index providers such as QMD, graph search, vector search, rerankers, and remote retrieval
- dashboards, local web apps, and artifact producers that use the core web viewer endpoints
- exograph profiles, analyzers, trace collectors, eval runners, dataset exporters, training flows, and future extension-owned workflows

The terminal itself is not a plugin. Exo needs to own terminal reliability because scrollback, rendering, sleep/reconnect behavior, semantic sends, transcripts, and CLI control are central to daily use. Harnesses plug into that terminal service by declaring launch plans, availability, skill/config locations, message semantics, readiness hints, and optional provenance hooks.

See `extension-architecture.md` for the current core-versus-extension boundary. `plugin-system-architecture.md` is historical inventory for the prior plugin-platform model.

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

`packages/core/src/command-protocol.ts` owns the shared route constants and command payload shapes. The desktop command server and CLI app client consume that shared contract rather than duplicating routes.

## App Lifecycle Model

Exo has two separate lifecycle states:

- the Exo process is running
- the workspace window is visible

The command server, file watchers, transcript writers, and terminal sessions belong to the running process, not to the visible window. Closing the main window hides the workspace UI while leaving those runtime services alive. Explicit app quit is the operation that stops or detaches live terminal sessions according to the terminal runtime model.

This distinction is central to local-agent workflows: an external Codex or Claude agent can use the Exo CLI or configured `AgentCommand` surfaces while the user keeps the Exo window hidden, then the user can reopen the window to monitor or take over terminal sessions.

Exo now keeps the process resident when the workspace window closes. Live app commands require that resident desktop process to be running and available through `.exo/server.json`; they do not require the workspace window to be visible.

The macOS menu bar controller is the visible runtime control surface when the workspace window is hidden. It exposes Show Exo, Settings, command-server status and restart, live terminal count, and explicit Quit.

For Exo-on-Exo development, the installed app is the stable resident runtime. Source QA should use `pnpm dev:qa`, which sets separate `.exo-dev/` runtime and user-data paths so the dev process does not overwrite the stable app's `server.json`, settings, or command-server discovery.

## Activity Feed And Automation Substrate

Exo should eventually have a small core feed/event stream and activity substrate. It should not grow a large core automation product before plugins prove which primitives are universal.

The feed is the broader primitive behind an inbox. It is a stream of incoming or generated context items from quick capture, files, notes, terminal agents, CLI/app messages, RSS/bookmarks, voice transcripts, workflow results, git events, evals, and plugin-generated sessions. Feed items are not automatically durable graph facts. They are reviewable inputs that can be linked, archived, promoted into notes/entities/tasks, or used as trace/artifact evidence.

Core may own a scheduler hook or job registration mechanism because recurring local work should not require every plugin to invent process supervision. That substrate should stay small. A scheduled activity record should specify:

- selected harness or agent runtime
- prompt text and runtime/capability metadata
- scope such as note root, project root, profile, feed query, entity set, or saved search
- permissions for reads, writes, terminal access, network, model calls, and exports
- output policy: direct write, proposed changes, artifacts only, or review required
- status, timestamps, artifact references, transcript/log references, and recovery state

Routines, workflows, eval runs, graph-health jobs, training exports, and maintenance loops are plugin-level concepts by default. They can use the core activity substrate for permission checks, status, cancellation, artifact references, and optional review state, but their richer schemas belong to the plugin until they prove universal.

Skills should be redesigned from first principles under the Exograph/LM-wiki ontology frame or as explicit plugin capability metadata. The removed harness skill manager should not be treated as the default future shape. Harness plugins may provide headless execution and capability descriptions later; Exo core should own only the shared permission, activity, artifact-reference, and review hooks needed for those plugins to compose safely.

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

See `terminal-architecture-v4.md`, `terminal-runtime-decision.md`, and `terminal-quality-standard.md` for the tmux-backed runtime direction, current simplification target, and QA bar. `terminal-refactor-plan.md` is historical migration context.

The renderer should treat terminal sessions as live views over supervised processes, not as durable state by itself.

Stability constraints:

- do not reset xterm with full-output rewrites during normal streaming
- do not add secondary terminal transports or hidden process-survival fallbacks without a design decision
- only the active terminal should receive hot renderer append work
- strip mouse tracking modes from app output so wheel scroll remains local scroll in Exo
- terminal file drops should resolve to filesystem paths before being pasted into the active terminal session

Current terminal target: the embedded terminal remains the daily UX, with native tmux attach available as a recovery/debug escape hatch. Simplification work should narrow and harden Exo's tmux control-mode decoding, xterm rendering, hydration, and reconnect responsibilities without demoting embedded shell/agent use.

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

`exo terminals` is the low-level terminal debug surface. `exo agents` is the legacy human/operator session surface for already-running local agent sessions:

- `exo agents list`
- `exo agents create <shell|claude|codex|pi|hermes> [cwd]`
- `exo agents read <id> [--tail n] [--raw]`
- `exo agents send <id> <text>` sends the message and presses Enter by default; Codex startup sends may be queued until normal chat input is ready
- `exo agents send <id> <text> --raw` writes without pressing Enter
- `exo agents interrupt <id> [escape|ctrl-c]`
- `exo agents terminate <id>`

The CLI remains the canonical operator/admin/debug surface. It may grow broad note, graph, search-provider, maintenance, and developer commands because it is the place for humans, scripts, setup, diagnostics, and supervised administration.

Configured `AgentCommand` invocation is the active agent model. `exo spawn @handle <task>` launches trusted configured commands from the CLI; note mentions launch the same configured commands from the editor after human confirmation.

## Removed MCP Surface

The refactor removed `packages/mcp`, `exo integrations`, MCP capability surfaces, MCP profile config templates, MCP public-contract guard slices, and hidden Codex MCP launch injection. MCP can be reconsidered later as an adapter over the CLI or command server, but it is not a current architecture surface.

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

The current terminal rail should evolve into a tool/plugin dock. Terminal launch controls, future routine controls, graph analyzers, and other plugin surfaces should be contributed through typed surface descriptors. The web viewer remains a core endpoint surface rather than a special plugin API. That dock can host plugin surfaces, but it does not make the terminal runtime itself a plugin; terminal tabs remain live views over Exo-owned terminal sessions.

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
3. Introduce surface descriptors for tool/plugin dock actions without changing behavior.
4. Convert editor and terminal leaves to render through the shared tab descriptor without changing behavior.
5. Only then allow a single leaf to contain document, terminal, browser, or future plugin-surface descriptors.

## Search And Retrieval

Search currently returns:

- live Explore typing: local note filename/path matches
- optional Explore Enter: QMD lexical results when enabled
- CLI: QMD-backed search when enabled, with filesystem fallback

Search lives in the explorer search pane and keeps live typing fast. QMD-backed indexed search is explicit so heavy retrieval does not block the renderer.

QMD integration lives behind `packages/core/src/qmd.ts`. The desktop command server exposes status, search, read, sync, update, and embed routes. CLI can use the full notes-index route set. See `qmd-integration-notes.md` for the dependency boundary and upgrade checklist.

Longer term, QMD should be the default implementation of a search-provider contract, not the only possible retrieval architecture. The provider contract should cover capability discovery, status/health, search, read/resolve target, optional graph hints, sync/update, cancellation, and diagnostics. CLI/UI own provider setup, sync, repair, and diagnostics.

The next architecture step is to make that provider contract real internally before adding public plugin loading. QMD remains the only built-in provider until there is a real second provider to test the boundary against.

## Note Graph And Wiki Maintenance

Exo's note graph contract should support LM Wiki-style maintenance over Markdown on disk:

- selected note roots define the writable wiki boundary
- project roots remain explicit code/review context unless later added to memory intentionally
- file identity should support exact paths and friendly note/link resolution
- document context should combine metadata, headings, outgoing links, backlinks, unresolved links, tags/properties, and related search hits
- write operations should be scoped and reviewable: create, append, and guarded patch before broad overwrite
- maintenance reports should surface orphans, dead ends, unresolved links, stale pages, contradiction candidates, and missing cross-links

The CLI can mirror mature knowledge-app surfaces broadly. Agents invoked through Exo receive pointer prompts and can call the CLI when they need local graph/search/read context.

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
- activity logs and artifact references
- provenance and review references

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
- `.exo/` remains the place for derived indexes, traces, proposals, activity records, artifact references, provenance references, plugin state, and dataset artifacts that are not themselves concept documents.
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
