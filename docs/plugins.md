# Plugin Architecture

> Superseded as an active product path by `docs/exograph-refactor-completion-plan.md` and `docs/extension-architecture.md` on `refactor/note-native-exo`. Plugin internals may be reused for search providers or current app boot, but Plugin Manager and plugin setup are not the current product spine.

Last updated: 2026-06-28

Exo should support a plugin path so users can extend their local AI workstation without requiring every feature to land in core.

## Current Decision

Plugin architecture is now the next platform workstream after terminal/runtime usability. The immediate goal is not a public marketplace or arbitrary user-code loading. The immediate goal is to turn the extension seams Exo already needs into typed internal registries, then migrate hardwired behavior onto those registries.

The current core-versus-extension boundary lives in `extension-architecture.md`. This document is historical inventory for the prior plugin-platform model.

The safe renderer/web-viewer surface contract lives in `plugin-surface-contract.md`. It defines metadata-only native plugin panels and the current core web viewer endpoint usage for plugin-produced local apps and artifacts.

That keeps Exo from overbuilding while still moving toward the long-term shape:

- QMD becomes the official advanced search provider behind a search-provider registry.
- Shell, Claude Code, Codex, Pi-compatible, Hermes, Aider, Goose, OpenCode, and local/open-source agents become official or local agent-harness plugins behind an agent-harness registry.
- MCP and CLI stay separate product surfaces, with plugin contributions admitted only through policy.
- Terminal remains a core platform service; harnesses plug into it.
- The web viewer host and open/focus/close endpoints stay core; plugins can generate local content or services and ask Exo to open them.
- Workload-specific harnesses, workcells, evals, graph analyzers, search optimization, LM Wiki/Shoshin profiles, and personal workflows can become extension-shaped without being forced into core.
- Product framing stays layered: Exo is the workstation, the exograph is the user-owned graph it operates over, and plugins are how users swap or add harnesses, search providers, profiles, analyzers, eval runners, exporters, and dashboards.
- Local plugin manifests can now be discovered and validated as metadata. Exo can store metadata-only permission grant/revocation decisions for requested permissions, including scoped forms such as `notes:propose:root:shoshin-codex`, but those grants do not execute plugin code or authorize runtime file, terminal, CLI, MCP, command-server, renderer, or web-viewer behavior. Profile payloads and graph visualization declarations are also metadata-only in the current implementation.

Exo's distribution model is official versus local. Official plugins live under the repo `plugins/` tree or packaged app resources and go through the normal review process before they ship on `main`. Local plugins use the same manifest shape in user/workspace/plugin directories, but they remain user-owned and untrusted until the user explicitly reviews and enables them.

Profiles are curated bundles of plugin recommendations and configuration, not just agent config. A profile can package metadata/frontmatter conventions, context templates, AGENTS.md/CLAUDE.md templates, skills, graph views, analyzer settings, and review policies. Profiles may depend on plugins, but executable behavior should live in explicit plugin capabilities.

The first profile contract lives under `capability.compatibility.profile`. Exo can parse and show these bundles, but applying one is future work and must be explicit because it can eventually write files, install skills, or change plugin state. Project Knowledge Sync declarations now live in that profile payload as metadata-only configuration for project-local canonical Markdown files, relationship mode, conflict policy, review policy, and optional GitHub metadata; Exo does not yet watch, sync, copy, symlink, propose, or call remote services from those declarations. Status: unstable. `index` and `proposal` are the modes core intends to implement first; `copy`, `symlink`, and `remote` are reserved words, not commitments, and may be removed without compatibility shims.

Guardian Angel is an example downstream workload that can pressure-test this architecture outside core. Workflows like elicitation, trace capture, accept/reject/correction review, psychological-model hypotheses, dataset export, eval packets, and instrumented agent runtimes should use Exo's generic plugin primitives rather than becoming built-in Exo product code by default.

## Current Harness Configuration

Agent harness detection separates:

- enabled state: whether the harness is allowed to launch
- installation evidence: executable path and optional local repo path
- runtime dependencies: required backend or runtime services
- launchability: enabled plus installed plus all required dependencies satisfied
- visibility: whether the harness should appear in normal launcher/config lists

Pi is represented as a generic Pi-compatible harness instance. Local builds are configured with `EXO_PI_COMMAND`, `EXO_PI_REPO_PATH`, `EXO_PI_LABEL`, `EXO_PI_ARGS`, `EXO_PI_CHANNEL`, and `EXO_PI_BUILD`. A compatible inference backend is required before Pi is launchable; configure one with `EXO_PI_BACKEND_URL` or `EXO_PI_BACKEND_COMMAND` and optionally label it with `EXO_PI_BACKEND_LABEL` or `EXO_PI_BACKEND_KIND`.

Hermes remains a registered adapter, but it is hidden from normal harness lists by default so it does not appear as a dead launcher. It appears only when explicitly configured with `EXO_HERMES_COMMAND` or `EXO_HERMES_ENABLED`.

The full harness adapter extension contract is documented in `agent-harness-plugin-contract.md`. It defines the shared API for official and local harnesses: adapter metadata, availability detection, launch planning, semantic message behavior, skill and config inventory, dependency/setup guidance, and the rule that terminal rendering/session durability remain core.

## Non-Goals For The First Pass

- Do not load arbitrary user JavaScript or native code.
- Do not allow plugins to bypass the existing main/preload/renderer security boundary.
- Do not let plugins add MCP tools by default.
- Do not add a plugin marketplace or package installer.
- Do not execute `exo.plugin.json` entrypoints until the trust, permission, and API contracts are implemented.
- Do not expose QMD as a destructive toggle until Plugin Manager can explain the fallback to core search and the consequences for agent search quality.
- Do not move unstable services into `packages/runtime` only to create a cleaner diagram.
- Do not use plugins as a dumping ground for behavior that should be a stable Exo primitive.

The first pass should produce the stable contracts that later plugin loading can use. The activity workload contract is documented in `activity-plugin-contract.md`: core records minimal activity/artifact/provenance/review references, while plugins own trace, eval, dataset, dashboard, and export schemas.

## Why Plugins Matter

Exo is open source and intentionally hackable, but not every workflow should become core product behavior. Some features are personal, experimental, or domain-specific. Plugins should let users add those capabilities while keeping the core workstation focused.

Examples that likely belong in plugins:

- personal note-branching or versioning workflows
- custom note transforms
- domain-specific graph panels
- graph visualization surfaces such as a 3D graph explorer or metadata-specific relationship view
- metadata/frontmatter schema helpers
- profile packs that bundle recommended plugins, config, skills, and graph conventions
- project knowledge sync plugins that map project-local `issues.md`, `tasks.md`, `roadmap.md`, plans, specs, and context files into the central exograph with explicit conflict/review policy
- local research/workcell surfaces
- extra agent harnesses
- custom memory/index visualizations
- project-specific panels or commands

## Core Versus Plugin

Core should own:

- workspace model
- note roots and project roots
- Markdown editor, file explorer, basic file/path/text search, and core graph primitives
- pane/grid layout and trusted web viewer host primitive
- terminal runtime, rendering surface, scrollback, transcripts, reconnect, diagnostics, and semantic message delivery
- Exo CLI and MCP contracts
- command, settings, pane/view, agent harness, search provider, exograph analyzer, exporter, and eval registries
- settings and security boundaries
- notes index integration points
- minimal activity, artifact-reference, provenance-reference, and communication primitives

Plugins can add:

- UI panels
- commands
- CLI commands and MCP tools where permissioned
- file transforms
- graph/memory views
- agent harness adapters and helpers that run through Exo's terminal/session service
- advanced search/index providers
- trace collectors, eval runners, scorers, dashboards, and training/export flows
- dashboards, local web apps, and artifact producers that use Exo's web viewer endpoints
- project-specific workflow panels or commands
- integrations with external tools

## Plugin Depths

Not every plugin has the same relationship to Exo. The plugin model should support several depths without treating them as the same thing:

- App plugins: mostly produce local content or run a local app that Exo opens through the native web viewer. Examples: eval dashboards, graph dashboards, custom notebook tools.
- Surface plugins: add Exo-native UI surfaces. Examples: side panels, status widgets, editor decorations, command palette actions.
- Capability plugins: add backend abilities. Examples: agent harnesses, MCP tools, CLI commands, search providers, trace collectors, eval runners.
- Profile plugins: ship use-case conventions and default bundles. Examples: LM Wiki, Shoshin, Guardian Angel, OKF-compatible graph, or a project/domain-specific exograph profile.
- Sync/profile plugins: declare canonical file patterns, scope mappings, symlink/copy/index/proposal/remote relationship metadata, conflict policy, review policy, and optional remote metadata for keeping project-local Markdown and central exograph Markdown coherent.

The terminal and web viewer hosts are core primitives, not merely plugins. Many unrelated workflows need a safe terminal/session service and a safe way to show local web apps, documentation previews, dashboards, and artifacts. Plugins can target those primitives, but they do not own the underlying terminal or web viewer security boundary.

The preferred path for rich plugin UI today is an app plugin that emits a local HTML artifact or runs a local service and asks core to open it with `exo preview open <url-or-html-path>` or `POST /preview/open`. Native plugin panels are defined only as inert, core-hosted descriptors with renderer entrypoint loading disabled until a future permissioned renderer contract exists.

Graph data is core substrate. Graph visualization is plugin-shaped: Exo should ship a useful default graph explorer, but users should be able to swap in a 3D graph, metadata-focused graph, or domain-specific graph dashboard without changing the core graph model.

The first graph visualization contract is a manifest declaration. Exo has core graph snapshot types, but does not yet load renderer graph plugins or mount a default graph explorer from plugin metadata.

## Implementation Phases

### Phase 0: Contract Inventory

Document every place where Exo already has plugin-shaped behavior but no registry:

- `packages/core/src/qmd.ts` owns the only search/index provider implementation.
- `packages/core/src/runtime.ts` owns shell/Claude/Codex launcher resolution.
- `packages/mcp/src/index.ts` registers the current MCP tool surface directly.
- `packages/cli/src/index.ts` owns CLI command routing directly.
- `apps/desktop` owns pane kinds, settings sections, command-server routes, and renderer UI surfaces directly.

Output: this document, current architecture notes, and concrete tasks before code movement.

### Phase 1: Internal Capability Registry

Create an internal registry model in `packages/core` for Exo-owned capabilities. This is not external plugin loading; it is how first-party modules declare what they provide.

Initial registry kinds:

- `core:searchProvider`
- `core:agentHarness`
- `core:profile`
- `exo.graph:analyzer`
- `exo.graph:visualization`
- `exo.training:traceCollector`
- `exo.training:datasetExporter`
- `exo.training:evalRunner`

Each registration should have:

- stable id
- human label and description
- owning package/module
- capability type
- lifecycle state: built-in, experimental, disabled
- required permissions
- exported public surfaces: desktop, CLI, MCP, or internal-only

Output: typed contracts and registry tests. No user-facing plugin UI yet.

Status: implemented in `@exo/core`.

### Phase 2: Search Provider Boundary

Move QMD behind a `SearchProvider` interface while keeping QMD as the only built-in provider.

The provider contract should cover:

- capability discovery
- status/health
- search
- read/resolve target
- optional graph hints
- sync/update/embed where supported
- cancellation/progress hooks
- diagnostics

CLI/UI may expose provider administration. MCP receives stable search/read/document-context operations only.

Output: QMD adapter implements the interface, existing CLI/MCP/UI behavior preserved, tests prove no public behavior drift.

Status: implemented.

### Phase 3: Agent Harness Boundary

Move shell, Claude, and Codex launch plans behind an `AgentHarness` interface while preserving current defaults.

The launcher contract should cover:

- kind/id
- title/icon metadata
- command/args/env/cwd planning
- readiness hints
- instruction-overlay env contract
- supported message submission semantics
- provenance hooks

Pi-compatible harnesses, Hermes, Aider, Goose, OpenCode, and local/open-source agents should use this path instead of hardwired conditionals. Local forks such as GA Pi should be configured instances of a generic adapter unless their protocol diverges enough to require a separate plugin.

Output: enabled and launchable shell/Claude/Codex/Pi-compatible/Hermes instances appear in launcher surfaces; Pi-compatible instances expose required inference-backend status before launch; Hermes is hidden unless explicitly configured; supported but missing harnesses appear only in configuration/setup surfaces; tests prove launcher discovery, env rendering, and MCP/CLI `create_agent` compatibility.

Status: implemented.

### Phase 3.5: Activity Substrate And Harness Skill Inventory Contract

Do not model workflow as an executable core feature. Workflow, eval, and maintenance semantics should usually belong to plugins or future extensions. Core should provide only the minimal activity substrate those extensions need to compose safely.

The substrate should describe:

- activity id, status, timestamps, actor, selected harness, and scope
- permission and output-policy checks
- artifact references, transcript references, and optional provenance links
- cancellation/status hooks
- optional review state when Exo mediates proposed changes

Plugin-owned execution schemas can include detailed logs, traces, eval results, review labels, dashboards, and exports.

Harness skill file management is no longer part of the active V1 product. Future skill work should start from the Exograph/LM-wiki ontology problem or from explicit plugin capability metadata. A plugin may eventually describe capabilities that an agent runtime exposes, but Exo should not reintroduce a provider skill installer/sync manager without a fresh design pass.

Status: this historical section was superseded on `refactor/note-native-exo`. Routine/Run/template contracts were removed; the surviving substrate is neutral activity/artifact/provenance metadata.

Exo should turn that template into a concrete workspace activity only when a user/workspace supplies scope, ids, permissions, and any overrides. This keeps plugin-authored workflows reusable without giving a manifest implicit write access or scheduler authority.

### Phase 4: Permissioned Surface Contributions

Define how a registered capability may request exposure through each surface:

- Desktop UI: panes, settings sections, commands, status widgets, editor decorations.
- CLI: broad operator/admin/debug commands.
- MCP: narrow agent work-plane tools only.
- Command server: internal runtime routes, not direct public API by default.

MCP exposure should require an explicit permission entry and a reviewable tool contract. Plugin-added MCP tools should be rare and agent-safe.

Output: policy docs, tests for rejected/accepted surface registrations, and no arbitrary plugin loading yet.

Status: policy-level contract implemented.

### Phase 4.5: Reference Workload Contract

Before public plugin manifests, use one or more downstream workloads as reference plugin-shaped workloads without adding their schemas or product surfaces to core.

The contract should answer:

- Which Exo events are available to a harness: terminal session lifecycle, agent messages, transcript segments, file changes, user review labels, accepted/rejected/corrected outputs, and artifact creation.
- Which review states are first-class: proposed, accepted, rejected, corrected, superseded, exported.
- Where plugin-owned trace data lives under `.exo/`.
- How traces link back to notes, files, terminal sessions, agents, prompts, outputs, and user corrections.
- How a harness can export local JSONL without mixing private data into public artifacts.
- Which surfaces belong in Exo UI versus CLI/MCP.
- Which permissions are required for trace reads, note writes, project reads, terminal observation, model/API calls, network, and dataset export.

This does not require building a full downstream plugin first. It does require making sure the plugin contracts can support a smallest useful workload: run an elicitation or analysis session, capture responses and corrections, review examples, and export JSONL.

### Phase 5: Local Plugin Manifests

Local plugin manifests are implemented as metadata-only declarations. Exo can discover and validate `exo.plugin.json` files without loading arbitrary plugin code.

Manifest fields:

- `id`, `name`, `version`, `exoApiVersion`
- optional `description`
- optional `entrypoints`
- `capabilities`
- `permissions`
- `settingsSchema`
- `surfaces`

Discovery sources:

- built-in
- dev
- user
- workspace

Workspace-level plugins should be discovered as untrusted because they can arrive through cloned repos. Untrusted manifest metadata can be inspected, but future entrypoint execution or permission grants must require an explicit trust step.

Current trust defaults:

- built-in and dev manifests are trusted
- user and workspace manifests are untrusted
- disabled manifests are hidden from normal lists and do not reserve capability ids
- future namespaced capability kinds are inspectable as `unsupported-kind` but inert
- bare legacy or malformed capability kinds are rejected

Implemented management state:

- local plugin trust, enable, disable, metadata-only settings, and permission grant/revocation records
- Exo-managed user/workspace local plugin add/remove/swap by copying valid plugin directories
- Plugin Manager inspection and mutation for trusted local/developer metadata plugins while official/core rows stay read-only

Still non-goals:

- no entrypoint execution
- no plugin-owned CLI commands, MCP tools, desktop panes, or settings sections
- no permission grants that authorize runtime file, terminal, network, CLI, MCP, command-server, renderer, or web-viewer behavior

### Phase 6: Plugin Manager UI

Status: implemented as a Plugin Manager surface rather than a general Settings page. The current manager shows:

- installed plugins
- enabled/disabled state
- permissions
- state location
- setup/readiness state
- managed local add/remove/swap actions

This remains a lifecycle/configuration surface, not the profile editor and not a plugin execution host.

## Foundation Work Chunks

The foundation chunks have landed: core capability types and registry, QMD behind `SearchProvider`, built-in agent harnesses behind `AgentHarness`, neutral activity metadata, metadata-only local manifests, metadata-only permission/settings state, Plugin Manager, local add/remove/swap, safe surface descriptors, and graph snapshot metadata.

Current remaining work is tracked in `../tasks.md` under `Finish Plugin Architecture Completion`: staged profile apply prompts/grants, renderer/API harness descriptor cleanup, external workload plugin contracts, Project Knowledge Sync, and the explicit policy/test work required before executable loading or plugin-contributed CLI/MCP/renderer/command-server surfaces.

## Agent Plugins

Specific coding agents should be adapter-shaped where possible. Exo core defines the harness contract:

- launch command, cwd, environment, and arguments
- terminal/session adapters
- lifecycle status and cleanup
- MCP/CLI tools exposed to the agent
- optional metadata such as model, provider, objective, and capabilities
- optional hooks for provenance, code review, and PR workflows

Claude Code, Codex, Pi, Hermes, Aider, Goose, OpenCode, and local/open-source agents can then be official or local plugins. A custom Pi fork can be configured as a local Pi instance without requiring fork-specific behavior to be hardwired into core.

## Tracing, Evals, And Training

Tracing and evaluation are the first serious test of the plugin boundary.

Core should own only the durable substrate:

- activity records and status
- artifact references
- trace/provenance references
- agent/session/file links when Exo can observe them
- audit logs and permission checks
- CLI/MCP access to minimal activity and artifact-reference state

Plugins can own concrete behavior:

- workcell/run schemas
- trace collectors
- trace/event record schemas
- eval runners
- evaluation result schemas
- scorers and graders
- provider integrations
- dashboards
- training-data exports
- routine templates and prompts, which become runnable only after user/workspace instantiation

An eval system may include a web dashboard, but it should not be only a hosted web app. It needs privileged, permissioned access to Exo's agent sessions, terminal logs, files, search, git state, and artifacts through stable APIs.

## Design Requirements

- Plugins should be local-first and explicit.
- Plugins should not get arbitrary filesystem/process access without a clear permission model.
- Plugin APIs should prefer stable Exo primitives: notes, project roots, panes, commands, agents, messages, search, and settings.
- Plugin state should be inspectable and removable.
- A plugin should be shareable without asking users to patch Exo core.
- Plugins should compose through registries rather than monkey-patching renderer or main-process internals.
- Plugin permissions should cover filesystem scopes, process/terminal access, network access, git write or PR permissions, secrets, and MCP exposure.

## Open Questions

- What exact directories should desktop runtime scan for built-in, dev, user, and workspace plugins?
- Which APIs are available to renderer plugins versus main-process plugins?
- How are plugin permissions granted and revoked?
- Can plugins add MCP tools or CLI commands?
- How are plugin settings stored and exported?
- How should local web apps receive data from backend plugin capabilities through core web viewer endpoints?
- Which activity/artifact/provenance references must exist before eval/tracing plugins are useful?
- What minimum API is needed before building personal note-branching, versioning, or scheduled extension workflows?

## Initial Task Direction

Before building personal extension features into core, define:

- plugin install/load locations
- plugin trust prompts and permission grants
- safe renderer panel APIs and core web viewer open/focus/close endpoints
- command registration API
- settings API
- agent harness API
- activity substrate and extension workflow contracts
- MCP/CLI registration policy
- capability permission model
- compatibility/version policy
