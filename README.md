# Exo / Exograph

**Build your local exocortex from Markdown.**

Exograph is Exo's active product frame: an open-source, local-first Markdown exocortex.

The launch product is:

> **Local Markdown exocortex + modular, tunable search + inline agent invocation + graph management skills.**

Notes remain the durable source of truth. `.exo/` stores derived indexes, invocation records, artifacts, and review/provenance state.

The current `refactor/note-native-exo` branch is intentionally cutting the old agent-cockpit direction. Agents become configured commands that the graph can call from Markdown. Exo records what changed.

## Why Exo Exists

Your thinking, knowledge, projects, and context exceed what you can actively hold. Exo provides a durable external mind for capturing and resuming thought without handing the graph to a hosted service.

Search helps recover context, but it is not the whole problem. Exo makes relationships among notes visible and useful through links, backlinks, tags, properties, relevant-context discovery, and a focused graph.

Agents help maintain the exocortex without becoming the product spine. A user explicitly invokes a configured Command inline; Exo shows observed Markdown changes for review. The first editable graph-management Skill is the next vertical slice.

Folders are meaningful graph structure. Double-click a Folder to open its Overview: optional user-owned `index.md` metadata, direct children, and local graph context. Viewing never creates an index; creation is explicit. The raw `index.md` remains ordinary Markdown and is hidden only as a duplicate Explorer row. Paths provide a primary home while tags and relationships preserve multiple membership.

Plugins are a later distribution concern, not the launch architecture. Skills author behavior, Commands/providers execute capabilities, and a future Plugin may package proven combinations for installation, versioning, updates, and sharing.

## What Exo Is

- A trustworthy, open-source, local-first Markdown workspace.
- Modular Search with filesystem and QMD as the first two concrete implementations.
- An actionable exograph with links, backlinks, tags, properties, relevant context, and focused graph views.
- Provider-neutral configured Commands with explicit inline invocation and reviewable observed changes.
- Review surfaces for accepting, editing, or rejecting proposed Markdown changes.
- A mixed-pane workspace and CLI over the same deep modules.

## What Exo Is Not

The active refactor is not building:

- a universal agent cockpit;
- provider-specific agent management;
- a Routine platform as the default product spine;
- a general integration runtime;
- a plugin marketplace as the near-term setup path;
- a native Feed, trainer, model manager, or Ashby Gym in the launch product;
- automatic graph writing or automatic agent chaining;
- line-perfect authorship.

## What Works Today

- Markdown notes with live-preview editing, properties/frontmatter, backlinks/tags/links, foldable lists, and table widgets.
- Explicit Note Roots for all Exo-owned filesystem access.
- Fast note filename/path search from the explorer search pane.
- Optional QMD-backed notes indexing with lexical, semantic, and hybrid modes.
- Index status, sync, and settings controls for selected note roots.
- Editor and terminal panes with flat tabs, split behavior, and no-empty-leaves pruning.
- Direct `node-pty` terminals rendered by xterm, with bounded in-memory replay for renderer reload and operator reads.
- CLI control of the local workspace/runtime.

## Roadmap

Exo is early. The current branch is a heavy-handed Exograph refactor. Near-term priorities follow the four launch primitives:

- Finish the trustworthy Markdown workspace and packaged-app proof.
- Make filesystem/QMD Search reliable, fast, and explicit about provider health.
- Turn Connections into actionable context through links, tags, properties, neighborhoods, and explained suggestions.
- Ship one **Find and connect relevant context** graph/wiki skill through configured Command invocation and diff review.
- Continue removing retired architecture that does not serve this loop.

See `roadmap.md` and `tasks.md` for the active plan.

The canonical refactor plan is `docs/exograph-simplification-plan.md`.

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

For onboarding or first-run bugs, validate with a packaged app, not only `pnpm dev`, `pnpm dev:qa`, or `pnpm app`. Missing first-run workspace settings must show onboarding; Exo must not silently choose a Note Root or default terminal cwd for the user.

Install a repo-backed local `exo` command:

```bash
./scripts/install-local
```

That script installs dependencies, builds Exo, and symlinks `bin/exo` into `~/.local/bin/exo` by default. Use `./scripts/install-local --dry-run` to preview actions.

Install the local macOS app bundle:

```bash
./scripts/install-mac-app
```

This builds the unsigned `Exo.app` bundle and copies it into `~/Applications` by default so install does not require admin permissions. Launch that installed app for the stable resident Exo runtime: it owns the menu bar icon, hidden-window command server, watchers, and live terminal sessions. App exit ends terminal processes; Exo does not retain durable terminal transcripts. Use `./scripts/install-mac-app --system-app-dir` to install into `/Applications`, or `./scripts/install-mac-app --with-cli` when you also want the repo-backed CLI installed.

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

The active refactor makes agents note-native and command-based. Type `@` in a Markdown editor, select a configured Command such as `@claude`, then write the transient multiline request. Shift+Enter sends only after explicit confirmation; Exo launches the Command in a normal terminal and shows observed changes for review. Saving a note never invokes a Command.

CLI is the durable local integration surface.

## CLI

The CLI is the operator/admin/debug surface. It intentionally includes setup, workspace configuration, index maintenance, search/read/status, and low-level runtime controls.

Standalone workspace/runtime commands:

```bash
./bin/exo workspace status
./bin/exo search "query"
./bin/exo index status
./bin/exo index sync
```

The legacy `exo routines` CLI and Routine core/plugin substrate have been removed on this branch. The remaining activity/artifact primitives are provider-neutral helpers used by traces, proposals, and invocation records.

Commands that drive a running Exo app:

```bash
./bin/exo open /path/to/file
./bin/exo status
./bin/exo config get
./bin/exo terminals list
./bin/exo terminals create shell
./bin/exo terminals read term-4
./bin/exo terminals send term-4 "message plus Enter"
./bin/exo terminals kill term-4
```

`exo terminals` is the lower-level debug/raw terminal surface. Configured Commands are the provider-neutral agent/tool identity; legacy built-in agent lifecycle commands are being removed by the simplification plan.

## Workspace Model

Exo settings are stored in one JSON file:

- macOS default: `$HOME/Library/Application Support/@exo/desktop/workspace-settings.json`
- override: `EXO_SETTINGS_PATH`

First-run setup requires the user to choose a Workspace and its Note Roots. Exo does not silently persist a notes root or default Command cwd.

Runtime files live under `.exo/` inside the workspace root:

- `.exo/server.json` - command server discovery
- `.exo/qmd/index.sqlite` - Exo-managed QMD notes index when indexing is enabled
- `.exo/invocations/` - note-native agent-command invocation records and diff refs
- `.exo/artifacts/` - local generated artifacts when needed

`.exo/` is derived local state, never canonical notes. Add `.exo/` to `.gitignore` when the Workspace root is in a Git repository; Exo warns about an unignored runtime directory rather than modifying your repository. Moving or copying a Workspace intentionally requires re-authorizing configured Commands.

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
- xterm.js with direct `node-pty`; app exit ends the PTY, while renderer reload may replay only a bounded in-memory tail
- pnpm workspaces
- Vitest and Playwright

## Repository Map

- `apps/desktop` - Electron main/preload/renderer, settings, terminal supervision, and the local command server.
- `packages/core` - Note Root workspace model, Markdown files, configured Commands, QMD adapter, and shared command protocol.
- `packages/cli` - `bin/exo` command surface.
- `docs/architecture.md` - package and runtime architecture.
- `docs/extension-architecture.md` - current extension architecture and core-versus-extension boundary.
- `docs/terminal-runtime-decision.md` - current direct-PTY terminal decision.
- `docs/harness.md` - developer harness, gates, and agent workflow.
- `docs/usability-readiness.md` - near-term standard for installed daily use.
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

1. `AGENTS.md` - contributor invariants and active Codex execution context
2. `CONTEXT.md` - canonical Exo vocabulary and domain boundaries
3. `docs/exograph-simplification-plan.md` - active execution plan and ship gates
4. `tasks.md` - active work and sequencing
5. `issues.md` - bugs, QA findings, and release blockers
6. `README.md` - product overview and onboarding
7. `roadmap.md` - short-term direction and long-term Ashby ladder
8. `docs/architecture.md` - current architecture and Folder Index ontology model
9. `docs/extension-architecture.md` - current extension ladder
10. `docs/README.md` - current/historical documentation map
11. `docs/harness.md` - contribution harness and validation gates
12. `docs/usability-readiness.md` - installed-app readiness standard
13. `ledger.md` - completed implementation history
