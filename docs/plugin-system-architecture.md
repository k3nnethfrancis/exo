# Plugin System Architecture

Last updated: 2026-06-28

This document defines the target plugin boundary for Exo.

## Decision

Exo core is an extensible Markdown graph workstation. Vanilla Exo is core plus a set of official, reviewed plugins.

Core owns the substrate that must be coherent, reliable, and security-reviewed:

- workspace model, note roots, project roots, and Markdown files
- Markdown editor, file explorer, basic file/path/text search, and core graph primitives
- pane/grid layout, trusted web viewer host primitive, and app/window lifecycle
- terminal runtime, terminal rendering surface, scrollback, transcripts, reconnect, semantic message delivery, diagnostics, and terminal settings
- web viewer host and open/focus/close endpoints for local paths, artifacts, and trusted URLs
- command server, resident runtime, CLI/MCP base contracts, and app settings
- scheduler, minimal activity/job substrate, and plugin job coordination: what ran, who or what launched it, what scope it used, where outputs live, and optional review state
- plugin registry, manifest discovery, trust state, permission grants, and plugin settings/install surfaces

Plugins own replaceable capability variation:

- agent harness adapters for Claude Code, Codex, Pi, Hermes, Aider, Goose, OpenCode, local/open-source agents, and future harnesses
- advanced search/index providers such as QMD, graph search, vector search, rerankers, or remote retrieval
- graph visualization surfaces such as 2D/3D graph explorers, metadata lenses, relationship maps, and custom graph dashboards
- dashboards, local web apps, and artifact producers that use Exo's core web viewer endpoints
- exograph profile packs such as OKF, Shoshin, LM Wiki, Guardian Angel, or domain/project profiles
- metadata schema/profile capabilities that describe frontmatter, properties, paths, tags, relationship fields, and graph conventions without forcing those fields into raw Markdown files
- project knowledge sync/profile capabilities that map project-local canonical files such as `issues.md`, `tasks.md`, `roadmap.md`, plans, specs, `AGENTS.md`, and `CLAUDE.md` into a central exograph through explicit links, symlinks, copies, generated indexes, or reviewable sync proposals
- automations, Routines, analyzers, trace collectors, dataset exporters, eval runners, scorers, training/export flows, and Routine templates
- plugin-owned commands, settings panels, status widgets, editor decorations, and tool surfaces where explicitly permissioned

The terminal itself is not a plugin. Exo must own terminal behavior because terminal reliability is a daily-use requirement and a safety boundary. Harnesses plug into the terminal service by declaring how they launch, what skills/configs they expose, how semantic messages are submitted, and what lifecycle/provenance hooks they support.

The web viewer is also core. It should be a small native service with endpoints to open, focus, and close a local path, localhost URL, artifact, or trusted URL. Plugins do not need a special WebView contract at first; they can generate local content or run a local service and ask core Exo to open it.

The scheduler is core. Exo needs one reliable local scheduling service so plugin-defined routines, graph maintenance jobs, eval runs, artifact producers, and future background work do not each invent their own trigger, cancellation, status, and permission model. Specific automations, routines, evals, graph-health jobs, note-maintenance flows, and training/export workflows should still be plugins unless repeated product use proves a primitive is universal.

## Product Shape

The default app should feel like:

- Markdown graph/editor: always available.
- Basic local search: always available and fast.
- Terminal: always available when system dependencies are satisfied.
- Web viewer: always available through core open/focus/close endpoints.
- Plugin/tool dock: shows enabled plugin surfaces such as terminal launchers, search provider controls, routines, graph tools, and future dashboards.
- Plugin manager: shows installed, official, local, missing, disabled, and untrusted capabilities.

If a user disables every optional plugin, Exo should still open notes, edit Markdown, browse files, run basic search, and manage workspace settings. Optional plugins should enhance the workstation without making the core app ambiguous.

Official plugins may feel native during everyday use, but they should not be invisible. Onboarding, plugin management, settings, and diagnostics must make the plugin boundary clear: users should see which capabilities are core, which are official plugins, which are local plugins, which plugin category they belong to, whether they are enabled, and what configuration or dependency state controls them.

## Product Management Surfaces

Plugin management, profile management, and onboarding are related but separate product surfaces:

- **Onboarding** is the first-run selection and review flow. It helps the user pick notes, review the default Exograph Baseline or another profile, understand recommended official plugins, and enter the workspace. It should not become the long-term place for changing configuration.
- **Settings / Profile** is the workspace-level profile surface. It owns the active profile record, profile scope, auto-update preference, profile drift/review state, and profile component summaries such as schemas, recommended plugins, context templates, skills, routines, graph views, and review/output policy.
- **Plugin Manager** is the capability lifecycle surface. It owns plugin discovery, trust, enablement, dependency/setup state, requested versus granted permissions, plugin-owned configuration, managed local plugin add/remove/swap flows, and links into deeper plugin-specific settings. Developer/operator plugin directories remain explicit read-only source paths rather than Plugin Manager install targets.
- **Agent Config Editor** remains a specialized harness-adjacent editor for instruction files, skills, and provider config. Profile Settings can deep-link there, but it should not duplicate the full skill/instruction editing UI.

This split keeps each screen legible:

- Onboarding answers "What should this workspace start with?"
- Settings / Profile answers "What exograph profile is this workspace using, and what does that mean?"
- Plugin Manager answers "What capabilities are installed, trusted, enabled, configured, or blocked?"
- Agent Config Editor answers "What do my harnesses and terminal agents actually read?"

The active profile is workspace state, not just another plugin row. A profile may be supplied by a profile plugin, but once selected it should be visible from Settings, status-bar review affordances, and onboarding summaries. Selecting a profile must not silently apply templates, enable plugins, install skills, grant permissions, or schedule routines; those writes require an explicit future review/apply flow.

## Core Services

## Plugin Layers

"Plugin" has three separable meanings in Exo:

1. Capability metadata: identity, kind, lifecycle, owner, surfaces, permissions, compatibility, and configuration shape.
2. Bounded integration contract: the typed interface a capability implements, such as `SearchProvider`, `AgentHarness`, `RoutineTemplate`, analyzer, exporter, eval runner, or dashboard surface.
3. Executable distribution: how plugin code is shipped, trusted, installed, loaded, updated, and revoked.

Near-term Exo should prove the first two layers with official and local metadata plugins. Arbitrary executable plugin loading is a later security/product decision, not a prerequisite for making QMD, agent harnesses, routines, analyzers, and dashboards plugin-shaped.

Capability kinds are namespaced ids. Legacy bare manifest kinds are accepted only at parse time, normalized to the namespaced id, and surfaced with a deprecation status note for one release cycle.

| Legacy kind | Namespaced id | Status |
|---|---|---|
| `searchProvider` | `core:searchProvider` | hosted by core |
| `agentHarness` | `core:agentHarness` | hosted by core |
| `profile` | `core:profile` | hosted by core |
| `routineTemplate` | `core:routineTemplate` | hosted by core |
| `analyzer` | `exo.graph:analyzer` | inert (no host) |
| `graphVisualization` | `exo.graph:visualization` | inert |
| `traceCollector` | `exo.training:traceCollector` | inert |
| `datasetExporter` | `exo.training:datasetExporter` | inert |
| `evalRunner` | `exo.training:evalRunner` | inert |

Profiles are bundles, not individual runtime capabilities. A profile can declare recommended plugins, graph metadata conventions, AGENTS.md/CLAUDE.md templates, MCP config templates, skills to install or enable, routine templates, default graph views, analyzer settings, and output/review policies. A profile may depend on plugins, but it should not hide executable code inside configuration. If a profile needs executable behavior, it should depend on an explicit plugin capability.

Project knowledge sync belongs in this same family. Many projects have useful local Markdown control files while the user also has a central exograph. Exo should not assume one side always wins. A profile or sync plugin can declare which file names or regex patterns matter, what scopes they apply to, whether the relationship is symlink/copy/index/proposal/remote-sync, and what conflict policy applies. Core should provide roots, file observation, graph references, provenance, and review surfaces; the plugin/profile owns the convention.

The first implemented profile contract is metadata-only: `profile` capabilities store a typed payload under `capability.compatibility.profile`. Exo may list and inspect that payload, but it must not apply a profile, write instructions, install skills, enable plugins, or schedule routines without an explicit future permissioned flow.

### Markdown And Exograph Core

Core treats Markdown files as canonical user-owned state. Graph semantics come from links, tags, paths, properties/frontmatter, profile mappings, and explicit user choices. Core can store derived indexes, proposals, runs, traces, and plugin state under `.exo/`, but durable approved knowledge stays in the user's files.

Metadata schemas and profiles should be advisory and composable. Exo can use profile-declared frontmatter/property conventions to enrich search, graph views, validation, and maintenance routines, but users remain free to edit Markdown directly and to use different schemas in different scopes.

Project control files are also Markdown graph material. `issues.md`, `tasks.md`, `roadmap.md`, plans, specs, and context files may live in a project repo for portability and in the central exograph for personal continuity. Exo's job is to make that relationship visible, searchable, and reviewable; sync plugins decide whether to symlink, mirror, index, or propose changes.

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

Graph visualization plugins should use these surface contracts. Core should expose graph data and host the pane/web preview surface; a graph visualization plugin owns the layout, rendering strategy, and interaction model. This allows Exo to ship one useful default graph explorer while letting users replace it with a 3D graph, metadata-specific view, or domain-specific explorer.

The first graph contract is a read-only `GraphSnapshot` core type plus metadata-only `graphVisualization` capability declarations. The snapshot stores outgoing edges as canonical graph facts; backlinks are derived views over those edges so graph consumers do not double-count relationships. The concrete graph visualization plugin contract lives in `docs/graph-visualization-plugin-contract.md`.

The first safe renderer surface contract lives in `docs/plugin-surface-contract.md`. Native plugin panels are metadata-only descriptors hosted by core renderer panels with renderer entrypoint loading disabled. Plugin-produced local apps, dashboards, reports, and HTML artifacts should use the core web viewer endpoints (`/preview/open`, `/preview/focus`, `/preview/close`) rather than owning a WebView or mutating panes directly.

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

Harness plugins do not implement terminal rendering. They provide launch plans and harness semantics. The concrete adapter contract lives in `docs/agent-harness-plugin-contract.md` and covers Claude Code, Codex, Pi-compatible builds, Aider, Goose, OpenCode, and local/open-source agents.

- command, args, env, cwd, and readiness hints
- display metadata and availability checks
- skill inventory/config locations
- semantic message behavior
- optional tracing/provenance hooks
- setup/configuration help when missing

This split keeps terminal correctness centralized while allowing agent systems to be swapped.

### Search Core

Core owns basic file/path/text search and the search-provider contract. QMD is the official advanced provider, not an assumption baked into every surface. MCP should expose stable search/read operations; CLI/UI may expose provider setup, sync, diagnostics, and repair.

### Scheduler And Activity Substrate

Core should own only the scheduler and minimal automation substrate that multiple plugins need to compose safely:

- permission and scope checks before background work reads, writes, launches agents, or uses network/model access
- scheduling hooks and job registration
- activity records that say what ran, when, by whom, against what scope, and where outputs are
- artifact references that point to files, reports, transcripts, exports, or local web views
- optional review state for proposed changes when Exo mediates acceptance or rejection
- cancellation/status surfaces for running jobs

Core should not grow a large opinionated automation product by default. A graph-health routine, eval workflow, LM Wiki maintenance run, GA trace exporter, or Exo-on-Exo maintenance loop should be implemented as a plugin on top of this substrate.

The concrete workload contract is documented in `activity-plugin-contract.md`. Core records references; plugin-owned artifacts carry rich trace, eval, dataset, dashboard, export, and review schemas.

## Plugin Distribution

Exo's plugin model is official versus local, not marketplace versus first-party.

- Official plugins are reviewed plugins committed under `plugins/` or packaged into app resources. The GitHub `main` branch should only contain official plugins that passed normal code review and validation.
- Local plugins are user/workspace-owned plugin directories using the same `exo.plugin.json` manifest shape. Local plugins can live under user data, `.exo/plugins/`, or an explicit configured path. They are untrusted by default until the user reviews and enables them.
- Developer plugins are explicit development/operator paths such as `EXO_DEV_PLUGIN_DIRS` and `EXO_PLUGIN_DIRS`. They are trusted for the current developer/operator session, but they are not part of Exo's official distribution unless committed under `plugins/` and reviewed.

Official plugins are first-party capabilities shipped with Exo but still registered through plugin/capability contracts where practical.

Concrete manifest roots:

- Packaged official plugins: `${EXO_RESOURCES_PATH}/plugins/{plugin}/exo.plugin.json`.
- Source-tree official plugins during development: `${EXO_PROJECT_ROOT}/plugins/{plugin}/exo.plugin.json`.
- Developer session plugins: each `EXO_DEV_PLUGIN_DIRS` entry is a plugin collection root containing `{plugin}/exo.plugin.json`.
- Operator override plugins: each `EXO_PLUGIN_DIRS` entry is a trusted developer/operator collection root containing `{plugin}/exo.plugin.json`.
- User-installed local plugins: `${EXO_USER_DATA_PATH}/plugins/{plugin}/exo.plugin.json`.
- Workspace-local plugins: `${workspaceRoot}/.exo/plugins/{plugin}/exo.plugin.json`.

Runtime state is not stored in plugin directories. Trust and enablement live under the current Exo runtime root as `plugin-state.json`; metadata-only plugin settings live beside it as `plugin-settings.json`; metadata-only permission grant/revocation decisions live beside them as `plugin-permissions.json`. Workspace-local plugin manifests may be committed or copied with a workspace, but their trust and grant records are local runtime policy and do not self-authorize on another machine.

Lifecycle rules for the foundation slice:

- Discovery reads only `exo.plugin.json`; it does not import, spawn, bundle, or evaluate plugin code.
- `trusted + enabled` means Exo may expose non-disabled capability metadata and metadata-owned settings through core surfaces.
- `untrusted` or `disabled` means the manifest remains inspectable, but its capabilities are inactive.
- Manifest `entrypoints` are accepted only as inert future metadata. They must be relative, traversal-free paths, and Exo must report executable loading as disabled.
- Capability `permissions` are requested permissions, not grants. Local grant records are keyed by plugin id, source, root path, manifest path, and manifest hash; a changed manifest must be reviewed again before prior grants can apply.
- Permission strings serialize as `<resource>:<action>` or `<resource>:<action>:<scopeKind>:<scopeValue>`. Supported scopes are `root:<noteRootId>`, `path:<workspace-relative-prefix>`, and `harness:<harnessId>`; examples include `notes:propose:root:shoshin-codex`, `projects:read:path:projects/exo`, and `agents:launch:harness:core.claude`. Unscoped legacy/current strings such as `notes:write` remain valid compatibility forms, but unscoped write grants must be reviewed as broad direct-write access.
- `propose` and `write` are distinct permission actions. `propose` means "Suggest changes" where edits are drafted for user review; `write` means "Edit files directly" where changes apply immediately without review. The current implementation stores and resolves this metadata only; it does not add a proposal engine or direct-write plugin execution path.
- Granted permissions are considered active only when the plugin is trusted and enabled and the specific capability is not disabled. Untrusted or disabled plugins remain inspectable, but their requested permissions and stored grant records cannot make capabilities active.
- No plugin receives file, terminal, network, CLI, MCP, command-server, renderer, or web-viewer execution rights from a manifest or grant record in this slice.
- A future executable loader must add a separate sandbox, explicit permission grants, revocation, logging, lifecycle errors, and tests before any entrypoint can run.

Initial official plugin families:

- Terminal tool surfaces: shell launcher, terminal commands, terminal status widgets, and terminal debug surfaces.
- Agent harness adapters: shell, Claude Code, Codex, Pi, Hermes, Aider, Goose, OpenCode, and local/open-source agents.
- Advanced search provider: QMD.
- Routine templates and automations: graph-health and future first-party maintenance workflows, implemented as plugins.
- Graph/profile helpers: starter profiles and graph diagnostics once the exograph model lands.
- Graph visualization: one official default graph explorer should eventually exist as a plugin-shaped surface, while graph data extraction and host surfaces remain core.

Official does not mean always visible. Launch controls should appear only when the plugin is enabled and usable. Missing harnesses belong in Plugin Manager or Agent Config, where Exo can explain how to install or configure them.

## Onboarding

The target onboarding sequence is:

1. Select or create the notes folder.
2. Confirm workspace and default terminal path.
3. Choose a workspace profile.
4. Review the profile's recommended official/local plugins and capability settings.
5. Enter the workspace.

The capability screen should show:

- Core: enabled and not optional.
- Active workspace profile: official default, imported local profile, or no profile.
- Plugin categories: search providers, agent harness adapters, profiles, analyzers, routines/templates, exporters, eval runners, dashboards, and future contributed surfaces.
- Recommended official plugins: enabled by default only when ready.
- Detected but not configured capabilities.
- Missing optional capabilities with setup guidance.
- Disabled/untrusted plugins with explicit enable/trust actions.

Search-provider onboarding should be framed around optional plugins, not raw backend modes. The default path can recommend QMD as "Advanced local graph search for agents and command surfaces." Lexical/semantic/hybrid are QMD configuration details shown after QMD is enabled, not the first user-facing choice. Basic filename/path/text search remains core and available even if every advanced search plugin is disabled.

Plugin configuration should follow the same separation principle as agent configuration:

- Settings is for baseline Exo behavior: workspace paths, editor behavior, theme, preview behavior, terminal settings, and core search behavior.
- Plugin Manager is for plugin lifecycle/configuration: enable/disable, dependency detection, permissions, install/setup guidance, category-specific shared fields, and plugin-owned custom fields.
- Agent Config Editor remains a specialized harness-adjacent surface for instruction files, skills, and provider config because those workflows are complex enough to deserve their own interface.

A search provider and an agent harness may share lifecycle/permission concepts, but their practical setup flows should not be forced into the same settings form. Over time, QMD administration should move toward Plugin Manager under search providers while basic core search preferences remain in Settings. Profile changes after onboarding should use the same review/apply model: show what the new profile recommends, what differs from the current workspace, and which file/settings/plugin changes require explicit confirmation.

Examples:

- QMD search: "Advanced search provider, ready" or "Needs setup".
- Claude Code harness: "Installed, enabled" or "Not found".
- Codex harness: "Not found on this machine".
- Web viewer: "Core, enabled".
- Pi harness: "Custom local Pi instance configured" for GA Pi on Kenneth's machine, without committing the local fork path as an OSS default.
- Profile packs: "LM Wiki profile, disabled" or "Shoshin profile, enabled for this notes root".
- Graph visualization: "Default graph explorer, enabled" or "3D graph explorer, installed but disabled".

## Current Alignment

Already aligned:

- capability metadata registry exists in `@exo/core`
- QMD sits behind a search-provider contract
- shell/Claude/Codex/Pi/Hermes launch planning sits behind an agent-harness contract
- the agent-harness plugin contract now names availability detection, launch planning, semantic messages, skill/config inventory, dependency/setup guidance, and the terminal-core boundary
- the desktop right rail/tool dock has a first typed descriptor layer for core terminal actions, official harness launchers, Agent Config, Plugin Manager, side-pane controls, and future routine/graph plugin targets
- Plugin Manager distinguishes Exograph Baseline, official plugins, local plugins, and developer plugins before showing inventory rows, so users can see what is core versus optional and which rows are locally manageable.
- core surface descriptors now name metadata-only plugin panels and web viewer endpoint metadata for plugin-produced local apps/artifacts without renderer plugin loading
- first-pass Routine, Run, artifact, trace, and routine-template primitives exist in core, but the target boundary should keep rich automation semantics plugin-owned
- plugin manifests are metadata-only and non-executable
- command server, CLI, and MCP share core protocol types
- pane content already has typed document, terminal, and browser bodies

Not yet aligned:

- renderer still mounts a terminal-named rail/dock component, even though its actions now pass through typed tool surface descriptors
- settings use scalable vertical navigation and include a dedicated Profile page, but deeper profile editing remains read-only/preview-oriented
- terminal launch controls are partly hardwired UI even though harness metadata exists
- current Routine/Run naming is compatibility terminology for the first CLI/store MVP; the durable contract is the smaller activity/artifact/provenance/review substrate documented in `activity-plugin-contract.md`
- shared CLI/MCP/session types still expose fixed official harness ids in places where they should eventually derive policy-approved choices from the harness registry
- plugin manager exists and onboarding now has a first-pass read-only capability review, but onboarding does not yet apply profile/plugin recommendations or grant permissions
- Plugin Manager can add, remove, and swap metadata-only local plugins in managed user/workspace plugin roots without loading executable entrypoints
- active workspace profile state exists under Exo runtime metadata and is visible from Settings and the status bar when review is required
- plugin manager can inspect and mutate local/developer metadata plugins, but it still reads closer to inventory than a quick management surface for active, disabled, untrusted, missing, and misconfigured capabilities
- plugin manifests do not yet contribute UI, commands, settings, or MCP/CLI surfaces
- profile packs have a metadata shape for recommended plugins, schemas, context files, skills, routines, graph views, and policies, plus active-profile state and copy/customize metadata flows; the permissioned apply flow is not implemented
- graph visualization does not yet have a stable plugin surface or core graph-data API
- core versus official/local plugin language is still being normalized across docs and code names

## Implementation Path

1. Keep terminal reliability work in core. Do not push terminal rendering/hydration/reconnect into plugins.
2. Rename the current terminal rail conceptually to a tool/plugin dock in docs, then in code when the terminal refactor is stable.
3. Add a renderer surface descriptor model for core and official plugin actions.
4. Move harness launchers, agent config, routine/plugin actions, and graph tools onto surface descriptors.
5. Keep the web viewer as a core endpoint surface rather than a plugin API.
6. Reassess current Routine/Run core types and keep only the minimal activity/artifact/review substrate needed for plugins to compose.
7. Split terminal/session substrate types from harness-adapter ids so `exo terminals` remains a low-level terminal surface while `exo agents create` chooses policy-approved registered harnesses.
8. Add Plugin Manager and onboarding capability selection after manifests, trust, permissions, and official plugin metadata are stable.
9. Add settings section contributions for plugin-owned settings.
10. Add explicit policy and tests before any plugin can contribute MCP tools, CLI commands, or executable code.
11. Define a profile manifest extension for recommended plugins, metadata schemas, context templates, skills, routines, graph views, and review/output policies.
12. Define a graph-data API and graph visualization surface contract before building a replaceable graph explorer.

## Non-Goals

- No arbitrary plugin code execution before trust and permissions are implemented.
- No plugin bypass of preload/main-process security boundaries.
- No plugin-owned terminal rendering.
- No plugin-owned web viewer host.
- No plugin-owned renderer panel loading from manifest metadata.
- No hidden fallback terminal transports.
- No public plugin marketplace before official capabilities prove the contracts.
- No large core automation system until repeated product use proves which job/activity primitives are universal.
- No Guardian Angel, Shoshin, LM Wiki, or OKF-specific workflow hardcoded into core without an explicit product decision.
