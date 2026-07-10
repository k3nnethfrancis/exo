# Exo / Exograph

**Build your local exocortex from Markdown.**

Exograph is Exo's active product frame: an open-source, local-first Markdown exocortex for building and maintaining personal LM wikis.

It gives you a local Markdown editor, backlinks and graph properties, graph views, customizable search/indexing providers, terminals, split panes, web viewers, CLI tools, and review surfaces for managing your graph. Notes remain the durable source of truth. `.exo/` stores derived indexes, invocation records, transcripts, artifacts, and review/provenance state.

The current `refactor/note-native-exo` branch is intentionally cutting the old agent-cockpit direction. Agents become configured commands that the graph can call from Markdown. Exo records what changed.

## Why Exo Exists

Your useful context lives across notes, tasks, drafts, logs, projects, terminals, search indexes, and local artifacts. Exo brings that context into an owned Markdown-first exograph so you can build a personal LM wiki without handing the graph to a hosted service.

Agents still matter, but they are not the product spine. The graph can call configured agents from notes, those commands run in normal terminals, and Exo shows the resulting diffs and attribution.

Another way to say it: Exo is a workbench for building a custom LM wiki at home. Markdown stays yours, search and indexing providers are swappable, graph structure is inspectable, and agent output is reviewable.

## What Exo Is

- An open-source, local-first Markdown editor.
- A Markdown exograph with backlinks, graph properties, and graph-viewer direction.
- A CLI-first local integration surface.
- A provider-neutral search/read substrate with customizable search/indexing providers.
- A programmable workspace with terminals, split panes, and web viewers.
- Tools for managing a local LM wiki.
- A note-native invocation model: Markdown mentions can call configured agent commands, and Exo can show what changed.

## What Exo Is Not

The active refactor is not building:

- a universal agent cockpit;
- a deep Claude/Codex/Pi harness manager;
- a Routine platform as the default product spine;
- an MCP integration layer;
- a plugin marketplace as the near-term setup path;
- line-perfect authorship.

## What Works Today

- Markdown notes with live-preview editing, properties/frontmatter, backlinks/tags/links, branch families, foldable lists, and table widgets.
- Explicit note roots and project roots.
- Project files with CodeMirror modes for Python, JSON/JSONC, TOML, `.env`, YAML, JS/TS/TSX, HTML/CSS, and shell.
- Fast note filename/path search from the explorer search pane.
- Optional QMD-backed notes indexing with lexical, semantic, and hybrid modes.
- Index status, sync, and settings controls for selected note roots.
- Editor and terminal panes with flat tabs, split behavior, and no-empty-leaves pruning.
- tmux-backed terminals rooted in the workspace, attached through Exo's tmux control-mode bridge.
- Disk-backed terminal transcripts for recovery context.
- CLI control of the local workspace/runtime.

## Roadmap

Exo is early. The current branch is a heavy-handed Exograph refactor. Near-term priorities:

- Rewrite active docs and instructions around Exograph.
- Remove old Routine, deep harness-manager, profile-apply, skill-install, and Plugin Manager setup surfaces after caller audit.
- Build the graph read path: link extraction, backlinks, graph properties, and a basic graph/neighborhood viewer.
- Harden CLI search/read/status with QMD and fallback providers.
- Add note-native `AgentCommand` invocation from strict Markdown mentions.
- Persist invocation records under `.exo/invocations/`.
- Show direct-write diff/attribution without clobbering dirty editor buffers.

See `roadmap.md` and `tasks.md` for the active plan.

The canonical refactor plan is `docs/exograph-refactor-completion-plan.md`.

## Current Status

Exo is under active development and not yet a polished public binary release.

- Supported today: source development and unsigned macOS packaging.
- Coming later: first-class Windows and Linux support.
- License: Apache-2.0.
- Current alpha: `0.1.0-alpha.3`.
- Not ready yet: signed/notarized macOS releases, Windows/Linux installers, and cross-platform terminal persistence.

Before broad public binary release, Exo still needs signed/notarized macOS packaging and a clean release checklist from a fresh clone.

## Quick Start

There are two setup paths today:

- Daily/user runtime: build the unsigned macOS app locally, install it into your user Applications folder, launch it, then point Exo at your notes folder.
- Developer runtime: clone the repo, install dependencies, and run `pnpm dev` or `pnpm dev:qa` while changing source.

The polished end-user path should eventually be a signed download or package-manager install. Until then, the local app install is the closest path to "install an app and choose my notes folder."

Prerequisites:

- Node.js 22 or newer.
- pnpm 11.2.2. With Homebrew pnpm, run `pnpm --version` and upgrade if needed.
- `tmux` for terminal creation and Exo-managed shell/agent sessions. On macOS, install it with `brew install tmux` if Exo reports a missing terminal dependency.

If Corepack fails before install with a package-manager signature or key error, either update Node/Corepack or use your installed pnpm directly:

```bash
COREPACK_ENABLE_PROJECT_SPEC=0 pnpm install
COREPACK_ENABLE_PROJECT_SPEC=0 pnpm dev:qa
```

The repo-backed `exo` launcher and `scripts/install-local` set `COREPACK_ENABLE_PROJECT_SPEC=0` automatically so local CLI commands do not trip stale Corepack key metadata.

```bash
pnpm install
pnpm dev:qa
```

### Launch Modes

Use the launch mode that matches the evidence you need:

| Command | Use For | Not Evidence For |
| --- | --- | --- |
| `pnpm dev` | Active Electron/Vite development and fast main/renderer iteration. | Installed-app or packaged-app behavior. |
| `pnpm dev:qa` | Source QA with isolated `.exo-dev/` runtime and user-data paths while an installed Exo app remains usable. | Packaged resources, install paths, or first-run packaged app behavior. |
| `pnpm app` | Source-built smoke test. It builds production bundles and launches Electron from the source tree. | Onboarding, app-support/user-data paths, packaged resources, native-module packaging, or terminal cwd defaults. |
| `pnpm pack:mac` then `open release/mac-arm64/Exo.app` | Packaged-app QA for onboarding, first-run setup, app-support paths, packaged resources, native modules, and terminal cwd defaults. | Signed release artifact validation. |
| `pnpm dist:mac` | Unsigned DMG/ZIP release artifact validation. | Fast development iteration. |

For onboarding or first-run bugs, validate with a packaged app, not only `pnpm dev`, `pnpm dev:qa`, or `pnpm app`. Missing first-run workspace settings must show onboarding; Exo must not silently choose a notes root, project root, or default terminal cwd for the user.

Install a repo-backed local `exo` command:

```bash
./scripts/install-local
```

That script installs dependencies, builds Exo, and symlinks `bin/exo` into `~/.local/bin/exo` by default. Use `./scripts/install-local --dry-run` to preview actions.

Install the local macOS app bundle:

```bash
./scripts/install-mac-app
```

This builds the unsigned `Exo.app` bundle and copies it into `~/Applications` by default so install does not require admin permissions. Launch that installed app for the stable resident Exo runtime: it owns the menu bar icon, hidden-window command server, transcripts, watchers, and terminal sessions. Use `./scripts/install-mac-app --system-app-dir` to install into `/Applications`, or `./scripts/install-mac-app --with-cli` when you also want the repo-backed CLI installed.

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

## Agent Commands

The active refactor makes agents note-native and command-based. A Markdown document can tag a configured command such as `@claude`; Exo confirms the invocation, launches the command in a normal terminal with a pointer prompt, and then shows what changed.

MCP has been removed from this branch. CLI is the durable local integration surface.

## CLI

The CLI is the operator/admin/debug surface. It intentionally includes setup, workspace configuration, index maintenance, search/read/status, and low-level runtime controls.

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

The legacy `exo routines` CLI and Routine core/plugin substrate have been removed on this branch. The remaining activity/artifact primitives are provider-neutral helpers used by traces, proposals, and invocation records.

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
./bin/exo terminals reconnect term-4
./bin/exo terminals kill term-4
```

`exo terminals` is the lower-level debug/raw terminal surface. The older `exo agents` commands remain legacy harness wrappers until `AgentCommand` invocation replaces them:

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
- `terminalHistoryLines = 100000`
- `terminalTranscriptRetention = forever`

Runtime files live under `.exo/` inside the workspace root:

- `.exo/server.json` - command server discovery
- `.exo/instructions/AGENTS.md` - Exo-generated generic runtime contract
- `.exo/instructions/CLAUDE.md` - Exo-generated Claude overlay
- `.exo/terminal-transcripts/` - disk-backed terminal transcripts
- `.exo/qmd/index.sqlite` - Exo-managed QMD notes index when indexing is enabled
- `.exo/invocations/` - note-native agent-command invocation records and diff refs
- `.exo/artifacts/` - local generated artifacts when needed

QMD is the default indexing provider for optional Exo-managed notes search. Live Explore typing remains fast filename/path search; indexed search is explicit through Enter in Explore when enabled and through CLI index/search tools. See `docs/qmd-integration-notes.md` for the adapter contract and upgrade notes.

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
pnpm test:e2e
pnpm test:visual
```

See `docs/harness.md` for work-chunk rules, validation evidence, and agent-friendly development workflow.

## Stack

- Electron, React, TypeScript, Vite
- CodeMirror 6
- xterm.js and tmux-backed terminal persistence through Exo's tmux control-mode bridge
- pnpm workspaces
- Vitest and Playwright

## Repository Map

- `apps/desktop` - Electron main/preload/renderer, settings, terminal supervision, and the local command server.
- `packages/core` - workspace model, note/project discovery, runtime config, launch plans, QMD adapter, and shared command protocol.
- `packages/cli` - `bin/exo` command surface.
- `docs/architecture.md` - package and runtime architecture.
- `docs/strategy.md` - product direction and system model.
- `docs/extension-architecture.md` - current extension architecture and core-versus-extension boundary.
- `docs/terminal-architecture-v4.md` - current terminal architecture and module-boundary target.
- `docs/harness.md` - developer harness, gates, and agent workflow.
- `docs/usability-readiness.md` - near-term standard for installed daily use.
- `docs/plugins.md` - historical plugin model, superseded by `docs/extension-architecture.md`.
- `tasks.md` - active execution tracker.
- `roadmap.md` - future work and sequencing.
- `docs/qmd-integration-notes.md` - current QMD adapter contract and upgrade checklist.
- `ledger.md` - fastest current-state handoff.

## Packaging

Unsigned macOS app bundle:

```bash
pnpm pack:mac
```

This writes the installable local bundle to `release/mac-<arch>/Exo.app` after cleaning stale `release/mac*` app-output directories. If packaging fails, partial app bundles such as `release/mac-arm64/Electron.app` are removed before the command exits. Open this bundle directly when you need packaged-app evidence for onboarding, first-run setup, app-support/user-data paths, packaged resources, native modules, or terminal cwd defaults.

Install that local bundle into `~/Applications`:

```bash
./scripts/install-mac-app
```

Unsigned macOS DMG and ZIP:

```bash
pnpm dist:mac
```

Artifacts are written to `release/`. Public binary releases should be signed and notarized before being presented as stable. Use this for release-artifact validation, not for fast source iteration.

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
9. `tasks.md` - active execution tracker
10. `roadmap.md` - future plans
11. `docs/exograph-refactor-completion-plan.md` - active refactor plan
12. `docs/terminal-architecture-v4.md` - current terminal simplification proposal
13. `docs/extension-architecture.md` - current extension architecture
14. `docs/plugins.md` - historical plugin model
