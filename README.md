# Exo

**A Local Exograph Workspace for Humans and Agents.**

Exo is a local-first workspace for building and maintaining an exograph: a user-defined knowledge/work graph shared by you and your terminal agents.

It gives agents a common graph they can read from, write to, and coordinate through, while giving you one surface for keeping their work aligned. That graph is grounded in your Markdown notes, project context, terminals, sessions, artifacts, and review history. You can take notes, run agents, and inspect the code they write without bouncing between editors.

## Why Exo Exists

AI agents are most useful when they can work from the same context you use: your notes, tasks, drafts, logs, code, and project history. Today that context is usually split across a notes app, terminals, editor windows, chat transcripts, and ad hoc files. Exo brings those pieces into one local-first workspace so humans and agents can share context instead of constantly reassembling it.

Exo is for people who want terminal agents to participate in their actual working environment: reading and writing notes, searching project context, changing code, communicating with other agents, and leaving an inspectable trail of what happened.

## What Exo Is

- An exograph workspace over notes, tasks, drafts, logs, projects, agents, sessions, and artifacts.
- A Markdown knowledge environment where files remain the durable source of truth.
- A terminal-agent workspace for running Claude, Codex, shell sessions, and future local agents.
- A project/code viewer for inspecting what agents are changing.
- A shared command surface through the Exo CLI and MCP server.
- A foundation for note indexing, memory, multi-agent communication, attribution, graph views, workcells, evals, and training loops.

## What Works Today

- Markdown notes with live-preview editing, properties/frontmatter, backlinks/tags/links, branch families, foldable lists, and table widgets.
- Explicit note roots and project roots.
- Project files with CodeMirror modes for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell.
- Fast note filename/path search from the explorer search pane.
- Optional QMD-backed notes indexing with lexical, semantic, and hybrid modes.
- Index status, sync, and settings controls for selected note roots.
- Editor and terminal panes with flat tabs, split behavior, and no-empty-leaves pruning.
- xterm/node-pty terminals rooted in the workspace by default.
- Claude and Codex terminal launchers backed by Exo runtime launch plans.
- Direct pty terminal supervision with disk-backed transcripts for recovery context.
- CLI and MCP control of live Exo terminal agents.
- Integration helpers for installing Exo MCP into Codex and Claude Code.

## Roadmap

Exo is early. The immediate product test is whether Kenneth can use Exo to build Exo by default. Near-term priorities:

- Keep the current app stable enough for daily notes, terminals, agent sessions, code review, and Exo-on-Exo development.
- Use Exo-managed agents for bounded Exo implementation/review tasks, then treat every friction point in that loop as product input.
- Make the multi-agent development loop legible: agent roster, objectives, messages, transcripts, changed files, and review links.
- Define the exograph model: user-owned Markdown/frontmatter/links as approved graph facts; Exo profile/config as interpretation rules; `.exo/` as derived indexes, proposals, runs, and provenance.
- Add read-only exograph inspection before adding new writes: document context, headings, links, backlinks, tags/properties, orphan/unresolved-link diagnostics, and graph health.
- Improve the default QMD search provider with true file-level incremental updates when upstream APIs support it.
- Detect existing QMD setups, refine Exo-owned QMD setup, configure richer reindex triggers, and keep search provider-neutral at Exo's product boundary.
- Let humans and agents search the same exograph with explicit tiers, cancellation, progress, and result caps.
- Add note traversal, graph context, and LM Wiki-style maintenance reports for headings, backlinks, unresolved links, orphans, stale pages, and missing cross-links.
- Manage global and project-local `AGENTS.md` / `CLAUDE.md` files from Exo.
- Compare global and local agent context files, surface conflicts, and install Exo-recommended snippets.
- Track authorship and provenance so human-written and agent-written changes are distinguishable by source, session, and task.
- Link agent sessions and messages to the files they changed so code review stays inside the workspace.
- Add graph and memory views that combine backlinks, notes, project context, and indexed relationships.
- Let agents inspect attached project roots through Exo workspace status while humans and supervised scripts add/remove roots through CLI/UI.
- Add multi-agent communication protocols over files, SQLite, MCP, and later richer local transports.
- Add an agent roster with names, roles, objectives, message routing, and communication logs.
- Add a plugin architecture for optional workflows, search providers, graph analyzers, eval/training harnesses, and shareable extensions without bloating core.

See `docs/roadmap.md` and `docs/tasks.md` for the active plan.

The immediate readiness gate is captured in `docs/usability-readiness.md`: finish the daily-use and harness standard, clean up the commit stack, push, install the packaged macOS app as the stable runtime, then bug bash from real use before starting larger roadmap phases.

## Current Status

Exo is under active development and not yet a polished public binary release.

- Supported today: source development and unsigned macOS packaging.
- Coming later: first-class Windows and Linux support.
- License: Apache-2.0.
- Current alpha: `0.1.0-alpha.2`.
- Not ready yet: signed/notarized macOS releases, Windows/Linux installers, and cross-platform terminal persistence.

Before broad public binary release, Exo still needs signed/notarized macOS packaging and a clean release checklist from a fresh clone.

## Quick Start

Prerequisites:

- Node.js 22 or newer.
- pnpm 11.2.2. With Homebrew pnpm, run `pnpm --version` and upgrade if needed.

If Corepack fails before install with a package-manager signature or key error, either update Node/Corepack or use your installed pnpm directly:

```bash
COREPACK_ENABLE_PROJECT_SPEC=0 pnpm install
COREPACK_ENABLE_PROJECT_SPEC=0 pnpm dev
```

The repo-backed `exo` launcher and `scripts/install-local` set `COREPACK_ENABLE_PROJECT_SPEC=0` automatically so `exo dev` does not trip stale Corepack key metadata.

```bash
pnpm install
pnpm dev
```

Install a repo-backed local `exo` command:

```bash
./scripts/install-local
```

That script installs dependencies, builds Exo, and symlinks `bin/exo` into `~/.local/bin/exo` by default. Use `./scripts/install-local --with-mcp` to also configure supported MCP clients, or `./scripts/install-local --dry-run` to preview actions.

Install the local macOS app bundle:

```bash
./scripts/install-mac-app
```

This builds the unsigned `Exo.app` bundle and copies it into `/Applications` by default. Launch that installed app for the stable resident Exo runtime: it owns the menu bar icon, hidden-window command server, MCP bridge, transcripts, watchers, and supervised agent terminals. Use `./scripts/install-mac-app --with-cli --with-mcp` when you also want the repo-backed CLI and MCP integrations installed.

When developing Exo while the installed app remains your daily workspace, use the isolated QA profile:

```bash
pnpm dev:qa
```

`pnpm dev:qa` runs the source app with `.exo-dev/` runtime and user-data paths so it does not overwrite the installed runtime's command-server discovery or settings.

Run with remote debugging when inspecting the real Electron renderer:

```bash
pnpm --filter @exo/desktop dev -- --remote-debugging-port=9222
```

The browser at `localhost:5173` is not equivalent to the Electron app; it does not have the preload `window.exo` bridge.

### Secured Networks And Native Builds

Exo allows the native dependency build scripts it needs through `allowBuilds` in `pnpm-workspace.yaml`. If pnpm reports blocked builds after a dependency change, run `pnpm approve-builds` and commit the resulting `allowBuilds` updates instead of bypassing all scripts.

Electron downloads its app binary during install, and `@electron/rebuild` may download headers while rebuilding native modules. On corporate networks with TLS inspection or download allow-lists, configure the trusted CA or Electron mirror explicitly before running install, for example:

```bash
export NODE_EXTRA_CA_CERTS=/path/to/corporate-ca.pem
export ELECTRON_GET_USE_PROXY=1
export ELECTRON_MIRROR=https://your-approved-electron-mirror/
pnpm install
pnpm rebuild:native
```

Avoid `NODE_TLS_REJECT_UNAUTHORIZED=0` except as a temporary local diagnostic; it disables TLS verification for the Node process.

## Agent Integrations

Exo exposes a narrow MCP work plane for agents and a broader CLI control plane for humans, scripts, setup, diagnostics, and debugging. The MCP server currently supports:

- `workspace_status`
- `search`
- `read_document`
- `list_agents`
- `create_agent`
- `read_agent`
- `send_agent_message`
- `interrupt_agent`
- `terminate_agent`

Install Exo MCP into supported local agent clients:

```bash
./bin/exo integrations doctor
./bin/exo integrations install all
```

Preview without modifying local agent config:

```bash
./bin/exo integrations install --dry-run all
./bin/exo integrations config codex
./bin/exo integrations config claude
```

Already-running agent sessions may need restart or MCP refresh before they see newly installed tools. The CLI mirror remains available when MCP is unavailable.

## CLI

The CLI is the operator/admin/debug surface. It intentionally includes setup, workspace configuration, index maintenance, and low-level terminal controls that are not exposed as MCP tools.

Standalone workspace/runtime commands:

```bash
./bin/exo workspace status
./bin/exo search "query"
./bin/exo index status
./bin/exo index sync
./bin/exo runtime status
./bin/exo runtime sync
./bin/exo launch claude
```

Commands that drive a running Exo app:

```bash
./bin/exo open /path/to/file
./bin/exo status
./bin/exo config get
./bin/exo project-roots list
./bin/exo project-roots add /path/to/project
./bin/exo project-roots remove /path/to/project
./bin/exo terminals list
./bin/exo terminals create shell
./bin/exo terminals read term-4
./bin/exo terminals transcript term-4 --tail 200000
./bin/exo terminals send term-4 "message plus Enter"
./bin/exo terminals kill term-4
```

`exo terminals` is the lower-level debug/raw terminal surface. Prefer `exo agents` for normal agent sessions:

```bash
./bin/exo agents list
./bin/exo agents create claude /path/to/workspace
./bin/exo agents read term-4 --tail 20000
./bin/exo agents send term-4 "message plus Enter"
./bin/exo agents send term-4 "raw input without Enter" --raw
./bin/exo agents interrupt term-4 ctrl-c
./bin/exo agents terminate term-4
```

## Workspace Model

Exo settings are stored in one JSON file:

- macOS default: `$HOME/Library/Application Support/@exo/desktop/workspace-settings.json`
- override: `EXO_SETTINGS_PATH`

Portable source defaults:

- `workspace_root = process.cwd()`
- `note_roots = [workspace_root/notes]`
- `project_roots = [exo repo root]`
- `default_terminal_cwd = workspace_root`
- `terminalHistoryMode = full`
- `terminalHistoryLines = 1000000`
- `terminalTranscriptRetention = forever`

Runtime files live under `.exo/` inside the workspace root:

- `.exo/server.json` - command server discovery
- `.exo/instructions/AGENTS.md` - Exo-generated generic runtime contract
- `.exo/instructions/CLAUDE.md` - Exo-generated Claude overlay
- `.exo/terminal-transcripts/` - disk-backed terminal transcripts
- `.exo/qmd/index.sqlite` - Exo-managed QMD notes index when indexing is enabled

QMD is the default indexing provider for optional Exo-managed notes search. Live Explore typing remains fast filename/path search; indexed search is explicit through Enter in Explore when enabled, through CLI index/search tools, and through the MCP `search` work-plane tool. See `docs/qmd-integration-notes.md` for the adapter contract and upgrade notes.

## Development Harness

The canonical local/CI gate is:

```bash
pnpm ci:check
```

It runs:

```bash
pnpm check:repo
pnpm typecheck
pnpm test
pnpm build
./scripts/install-local --dry-run --skip-install --skip-build
```

Focused checks:

```bash
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
pnpm --filter @exo/cli typecheck
pnpm --filter @exo/cli test
pnpm --filter @exo/core test
pnpm --filter @exo/mcp typecheck
pnpm --filter @exo/mcp test
pnpm test:e2e
pnpm test:visual
```

See `docs/harness.md` for work-chunk rules, validation evidence, and agent-friendly development workflow.

## Stack

- Electron, React, TypeScript, Vite
- CodeMirror 6
- xterm.js, node-pty
- pnpm workspaces
- Vitest and Playwright
- Model Context Protocol SDK

## Repository Map

- `apps/desktop` - Electron main/preload/renderer, settings, terminal supervision, and the local command server.
- `packages/core` - workspace model, note/project discovery, runtime config, launch plans, QMD adapter, shared command protocol, integration helpers.
- `packages/cli` - `bin/exo` command surface.
- `packages/mcp` - stdio MCP server that wraps the running Exo app for local agents.
- `docs/architecture.md` - package and runtime architecture.
- `docs/strategy.md` - product direction and system model.
- `docs/harness.md` - developer harness, gates, and agent workflow.
- `docs/usability-readiness.md` - near-term standard for installed daily use.
- `docs/plugins.md` - future extension model.
- `docs/tasks.md` - active execution tracker.
- `docs/roadmap.md` - future work and sequencing.
- `docs/qmd-integration-notes.md` - current QMD adapter contract and upgrade checklist.
- `ledger.md` - fastest current-state handoff.

## Packaging

Unsigned macOS app bundle:

```bash
pnpm pack:mac
```

Install that local bundle into `/Applications`:

```bash
./scripts/install-mac-app
```

Unsigned macOS DMG and ZIP:

```bash
pnpm dist:mac
```

Artifacts are written to `release/`. Public binary releases should be signed and notarized before being presented as stable.

## Logs

Main-process log:

```bash
tail -f "$HOME/Library/Application Support/@exo/desktop/exo-main.log"
```

macOS Electron crash reports:

```bash
ls "$HOME/Library/Logs/DiagnosticReports"/Electron-*.ips
```

## Docs Order

1. `AGENTS.md` - concise agent map
2. `README.md` - product overview and onboarding
3. `docs/README.md` - committed docs map
4. `docs/strategy.md` - product direction and system model
5. `ledger.md` - current state and recent completed slices
6. `docs/architecture.md` - runtime and package architecture
7. `docs/harness.md` - contribution harness and validation gates
8. `docs/usability-readiness.md` - installed-app readiness standard
9. `docs/tasks.md` - active execution tracker
10. `docs/roadmap.md` - future plans
11. `docs/plugins.md` - future extension model
12. `packages/mcp/README.md` - MCP setup and tools
