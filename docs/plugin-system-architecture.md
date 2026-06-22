# Plugin System Architecture

Last updated: 2026-06-21

This document defines the target plugin boundary for Exo.

## Decision

Exo core is an extensible Markdown graph workstation. Vanilla Exo is core plus a set of bundled, recommended plugins.

Core owns the substrate that must be coherent, reliable, and security-reviewed:

- workspace model, note roots, project roots, and Markdown files
- Markdown editor, file explorer, basic file/path/text search, and core graph primitives
- pane/grid layout, trusted web viewer host primitive, and app/window lifecycle
- terminal runtime, terminal rendering surface, scrollback, transcripts, reconnect, semantic message delivery, diagnostics, and terminal settings
- web viewer host and open/focus/close endpoints for local paths, artifacts, and trusted URLs
- command server, resident runtime, CLI/MCP base contracts, and app settings
- minimal activity/job substrate: what ran, who or what launched it, what scope it used, where outputs live, and optional review state
- plugin registry, manifest discovery, trust state, permission grants, and plugin settings/install surfaces

Plugins own replaceable capability variation:

- agent harness adapters for Claude Code, Codex, Pi, Hermes, Aider, OpenCode, local agents, and future harnesses
- advanced search/index providers such as QMD, graph search, vector search, rerankers, or remote retrieval
- dashboards, local web apps, and artifact producers that use Exo's core web viewer endpoints
- exograph profile packs such as OKF, Shoshin, LM Wiki, or domain/project profiles
- automations, Routines, analyzers, trace collectors, dataset exporters, eval runners, scorers, training/export flows, and Routine templates
- plugin-owned commands, settings panels, status widgets, editor decorations, and tool surfaces where explicitly permissioned

The terminal itself is not a plugin. Exo must own terminal behavior because terminal reliability is a daily-use requirement and a safety boundary. Harnesses plug into the terminal service by declaring how they launch, what skills/configs they expose, how semantic messages are submitted, and what lifecycle/provenance hooks they support.

The web viewer is also core. It should be a small native service with endpoints to open, focus, and close a local path, localhost URL, artifact, or trusted URL. Plugins do not need a special WebView contract at first; they can generate local content or run a local service and ask core Exo to open it.

Automation is not automatically core. Core may own the small substrate needed for safe composition, such as scheduling hooks, permission checks, activity records, artifact references, and cancellation/status. Specific automations, routines, evals, graph-health jobs, note-maintenance flows, and training/export workflows should be plugins unless repeated product use proves a primitive is universal.

## Product Shape

The default app should feel like:

- Markdown graph/editor: always available.
- Basic local search: always available and fast.
- Terminal: always available when system dependencies are satisfied.
- Web viewer: always available through core open/focus/close endpoints.
- Plugin/tool dock: shows enabled plugin surfaces such as terminal launchers, search provider controls, routines, graph tools, and future dashboards.
- Plugin manager: shows installed, bundled, missing, disabled, and untrusted capabilities.

If a user disables every optional plugin, Exo should still open notes, edit Markdown, browse files, run basic search, and manage workspace settings. Optional plugins should enhance the workstation without making the core app ambiguous.

## Core Services

### Markdown And Exograph Core

Core treats Markdown files as canonical user-owned state. Graph semantics come from links, tags, paths, properties/frontmatter, profile mappings, and explicit user choices. Core can store derived indexes, proposals, runs, traces, and plugin state under `.exo/`, but durable approved knowledge stays in the user's files.

### Pane And Surface Core

Core owns the pane tree, tab descriptors, drag/drop, persisted layout, and trusted host primitives. Plugins may contribute surfaces to these hosts, but they should not mutate pane state by reaching around the registry.

Surface contribution types should include:

- rail action
- tool dock pane
- editor/grid pane
- modal/dialog
- settings section
- status bar item
- command palette command
- editor decoration
- web viewer open/focus/close request

### Terminal Core

Core owns:

- terminal process/session supervision
- tmux-backed durability policy
- xterm rendering and scrollback
- pane resize, focus, reconnect, and hydration
- transcripts and bounded live tails
- semantic message delivery versus raw terminal writes
- session diagnostics and health states
- terminal CLI/MCP/app APIs

Harness plugins do not implement terminal rendering. They provide launch plans and harness semantics:

- command, args, env, cwd, and readiness hints
- display metadata and availability checks
- skill inventory/config locations
- semantic message behavior
- optional tracing/provenance hooks
- setup/configuration help when missing

This split keeps terminal correctness centralized while allowing agent systems to be swapped.

### Search Core

Core owns basic file/path/text search and the search-provider contract. QMD is the bundled advanced provider, not an assumption baked into every surface. MCP should expose stable search/read operations; CLI/UI may expose provider setup, sync, diagnostics, and repair.

### Activity And Automation Substrate

Core should own only the minimal automation substrate that multiple plugins need to compose safely:

- permission and scope checks before background work reads, writes, launches agents, or uses network/model access
- optional scheduling hooks or job registration once the runtime has a real scheduler
- activity records that say what ran, when, by whom, against what scope, and where outputs are
- artifact references that point to files, reports, transcripts, exports, or local web views
- optional review state for proposed changes when Exo mediates acceptance or rejection
- cancellation/status surfaces for running jobs

Core should not grow a large opinionated automation product by default. A graph-health routine, eval workflow, LM Wiki maintenance run, GA trace exporter, or Exo-on-Exo maintenance loop should be implemented as a plugin on top of this substrate.

## Bundled Plugins

Bundled plugins are first-party capabilities shipped with Exo but still registered through plugin/capability contracts where practical.

Initial bundled plugin families:

- Terminal tool surfaces: shell launcher, terminal commands, terminal status widgets, and terminal debug surfaces.
- Agent harness adapters: shell, Claude Code, Codex, Pi, Hermes.
- Advanced search provider: QMD.
- Routine templates and automations: dev graph-health and future first-party maintenance workflows, implemented as plugins.
- Graph/profile helpers: starter profiles and graph diagnostics once the exograph model lands.

Bundled does not mean always visible. Launch controls should appear only when the plugin is enabled and usable. Missing harnesses belong in Plugin Manager or Agent Config, where Exo can explain how to install or configure them.

## Onboarding

The target onboarding sequence is:

1. Select or create the notes folder.
2. Confirm workspace and default terminal path.
3. Configure capabilities.
4. Enter the workspace.

The capability screen should show:

- Core: enabled and not optional.
- Recommended bundled plugins: enabled by default only when ready.
- Detected but not configured capabilities.
- Missing optional capabilities with setup guidance.
- Disabled/untrusted plugins with explicit enable/trust actions.

Examples:

- QMD search: "Advanced search provider, ready" or "Needs setup".
- Claude Code harness: "Installed, enabled" or "Not found".
- Codex harness: "Not found on this machine".
- Web viewer: "Core, enabled".
- Pi harness: "Custom local Pi instance configured" for GA Pi on Kenneth's machine, without committing the local fork path as an OSS default.

## Current Alignment

Already aligned:

- capability metadata registry exists in `@exo/core`
- QMD sits behind a search-provider contract
- shell/Claude/Codex/Pi/Hermes launch planning sits behind an agent-harness contract
- first-pass Routine, Run, artifact, trace, and routine-template primitives exist in core, but the target boundary should keep rich automation semantics plugin-owned
- plugin manifests are metadata-only and non-executable
- command server, CLI, and MCP share core protocol types
- pane content already has typed document, terminal, and browser bodies

Not yet aligned:

- renderer still has a hardwired terminal rail instead of a plugin/tool dock
- settings are organized as fixed product tabs rather than core plus plugin-owned settings sections
- terminal launch controls are partly hardwired UI even though harness metadata exists
- current Routine/Run naming risks implying a larger core automation product than the target substrate requires
- shared CLI/MCP/session types still expose fixed bundled harness ids in places where they should eventually derive policy-approved choices from the harness registry
- plugin manager/onboarding capability selection does not exist
- plugin manifests do not yet contribute UI, commands, settings, or MCP/CLI surfaces
- core versus bundled plugin language is still being normalized across docs and code names

## Implementation Path

1. Keep terminal reliability work in core. Do not push terminal rendering/hydration/reconnect into plugins.
2. Rename the current terminal rail conceptually to a tool/plugin dock in docs, then in code when the terminal refactor is stable.
3. Add a renderer surface descriptor model for core and bundled plugin actions.
4. Move harness launchers, agent config, routine/plugin actions, and graph tools onto surface descriptors.
5. Keep the web viewer as a core endpoint surface rather than a plugin API.
6. Reassess current Routine/Run core types and keep only the minimal activity/artifact/review substrate needed for plugins to compose.
7. Split terminal/session substrate types from harness-adapter ids so `exo terminals` remains a low-level terminal surface while `exo agents create` chooses policy-approved registered harnesses.
8. Add Plugin Manager and onboarding capability selection after manifests, trust, permissions, and bundled plugin metadata are stable.
9. Add settings section contributions for plugin-owned settings.
10. Add explicit policy and tests before any plugin can contribute MCP tools, CLI commands, or executable code.

## Non-Goals

- No arbitrary plugin code execution before trust and permissions are implemented.
- No plugin bypass of preload/main-process security boundaries.
- No plugin-owned terminal rendering.
- No plugin-owned web viewer host.
- No hidden fallback terminal transports.
- No public plugin marketplace before bundled capabilities prove the contracts.
- No large core automation system until repeated product use proves which job/activity primitives are universal.
- No Guardian Angel, Shoshin, LM Wiki, or OKF-specific workflow hardcoded into core without an explicit product decision.
