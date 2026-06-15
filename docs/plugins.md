# Plugin Architecture

Last updated: 2026-06-14

Exo should support a plugin path so users can extend their exograph without requiring every feature to land in core.

## Current Decision

Plugin architecture is now the next platform workstream after terminal/runtime usability. The immediate goal is not public third-party plugin loading. The immediate goal is to turn the extension seams Exo already needs into typed internal registries, then migrate hardwired behavior onto those registries.

The detailed implementation sequence lives in `plugin-implementation-plan.md`. This document names the product model and boundaries; the implementation plan is the source of truth for the next refactor phases.

That keeps Exo from overbuilding while still moving toward the long-term shape:

- QMD becomes the default search provider behind a search-provider registry.
- Claude, Codex, shell, and future agents become agent-harness adapters behind an agent-harness registry.
- MCP and CLI stay separate product surfaces, with plugin contributions admitted only through policy.
- WebView/browser panes stay core, while plugin-hosted apps can target that primitive later.
- Workload-specific harnesses, workcells, evals, graph analyzers, search optimization, LM Wiki/Shoshin profiles, and personal routines can become plugin-shaped without being forced into core.

Guardian Angel is an example downstream workload that can pressure-test this architecture outside core. Workflows like elicitation, trace capture, accept/reject/correction review, psychological-model hypotheses, dataset export, eval packets, and instrumented agent runtimes should use Exo's generic plugin primitives rather than becoming built-in Exo product code by default.

## Non-Goals For The First Pass

- Do not load arbitrary user JavaScript or native code.
- Do not allow plugins to bypass the existing main/preload/renderer security boundary.
- Do not let plugins add MCP tools by default.
- Do not add a plugin marketplace or package installer.
- Do not make QMD optional in the UI before there is a real second provider.
- Do not move unstable services into `packages/runtime` only to create a cleaner diagram.
- Do not use plugins as a dumping ground for behavior that should be a stable Exo primitive.

The first pass should produce the stable contracts that later plugin loading can use.

## Why Plugins Matter

Exo is open source and intentionally hackable, but not every workflow should become core product behavior. Some features are personal, experimental, or domain-specific. Plugins should let users add those capabilities while keeping the core app focused.

Examples that likely belong in plugins:

- personal note-branching or versioning workflows
- custom note transforms
- domain-specific graph panels
- local research/workcell surfaces
- extra agent harnesses
- custom memory/index visualizations
- project-specific panels or commands

## Core Versus Plugin

Core should own:

- workspace model
- note roots and project roots
- editor, terminal, and WebView/browser pane system
- Exo CLI and MCP contracts
- terminal-agent lifecycle
- command, settings, pane/view, agent harness, search provider, exograph analyzer, exporter, eval, and routine-template registries
- settings and security boundaries
- notes index integration points
- provenance and communication primitives
- run, artifact, trace, and evaluation primitives

Plugins can add:

- UI panels
- commands
- CLI commands and MCP tools where permissioned
- file transforms
- graph/memory views
- agent harnesses and helpers
- search/index providers
- trace collectors, eval runners, scorers, dashboards, and training/export flows
- web apps hosted in Exo WebView panes
- project-specific routines and routine templates
- integrations with external tools

## Plugin Depths

Not every plugin has the same relationship to Exo. The plugin model should support several depths without treating them as the same thing:

- App plugins: mostly run as an app inside an Exo WebView pane. Examples: local web-app previews, eval dashboards, graph dashboards, custom notebook tools.
- Surface plugins: add Exo-native UI surfaces. Examples: side panels, status widgets, editor decorations, command palette actions.
- Capability plugins: add backend abilities. Examples: agent harnesses, MCP tools, CLI commands, search providers, trace collectors, eval runners.
- Routine/template plugins: ship prompts, templates, default schedules, and review/output policies that Exo can run through a selected harness. Examples: run eval, collect traces, score results, produce a report, and prepare a PR.

The browser/WebView pane is a core primitive, not merely a plugin. Many unrelated workflows need a safe way to show local web apps, documentation previews, dashboards, and artifacts. Plugins can target that primitive with their own apps.

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

- `searchProvider`
- `agentHarness`
- `appCommand`
- `settingsSection`
- `paneKind`
- `exographAnalyzer`
- `traceCollector`
- `datasetExporter`
- `evalRunner`
- `routineTemplate`

Each registration should have:

- stable id
- human label and description
- owning package/module
- capability type
- lifecycle state: built-in, experimental, disabled
- required permissions
- exported public surfaces: desktop, CLI, MCP, or internal-only

Output: typed contracts and registry tests. No user-facing plugin UI yet.

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

Future Pi, Aider, Goose, OpenCode, and local/open-source agents should use this path instead of hardwired conditionals.

Output: existing shell/Claude/Codex launches behave identically; tests prove launcher discovery, env rendering, and MCP/CLI `create_agent` compatibility.

### Phase 3.5: Routine And Harness Skill Inventory Contract

Do not model workflow as an executable plugin kind. The product concept is a Routine.

A Routine is:

- prompt
- selected harness
- optional required harness skills
- manual trigger or schedule
- scope
- permissions
- output policy

Each execution is a Run with status, logs, transcripts, artifacts, proposed changes, errors, and review state.

Skills are capabilities available inside a harness. A prompt may ask the harness to use a skill, but Exo must be able to detect and warn when the selected harness does not expose that skill. Later, Exo should manage skills across harnesses in the same spirit as agent config management:

- which skills are installed
- which harnesses can use them
- where the skill/config files live
- compatibility warnings
- sync/copy/install actions across supported harnesses

The first implementation can be metadata-only. Full cross-provider skill management comes later.

### Phase 4: Permissioned Surface Contributions

Define how a registered capability may request exposure through each surface:

- Desktop UI: panes, settings sections, commands, status widgets, editor decorations.
- CLI: broad operator/admin/debug commands.
- MCP: narrow agent work-plane tools only.
- Command server: internal runtime routes, not direct public API by default.

MCP exposure should require an explicit permission entry and a reviewable tool contract. Plugin-added MCP tools should be rare and agent-safe.

Output: policy docs, tests for rejected/accepted surface registrations, and no arbitrary plugin loading yet.

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

Only after the internal registries are stable, add local plugin manifests.

Likely manifest fields:

- `id`, `name`, `version`, `exoApiVersion`
- `entrypoints`
- `capabilities`
- `permissions`
- `settingsSchema`
- `surfaces`
- `stateDirectory`
- `trustedBy`

Candidate locations:

- user-level: `~/Library/Application Support/Exo/plugins/`
- workspace-level: `${workspace_root}/.exo/plugins/`
- repo/dev-level: `plugins/` for first-party development

Workspace-level plugins should be disabled by default until trusted because they can arrive through cloned repos.

### Phase 6: Plugin Manager UI

Add a compact Settings surface after the manifest and permission model exist:

- installed plugins
- enabled/disabled state
- permissions
- state location
- logs/errors
- uninstall/remove state

This should be an operator/admin surface, not a new default workflow screen.

## First Work Chunks

1. Add core capability contract types and a built-in registry with tests.
2. Register built-in search provider metadata for QMD without changing behavior.
3. Extract the QMD implementation behind a `SearchProvider` interface.
4. Register built-in agent harness metadata for shell, Claude, and Codex without changing behavior.
5. Extract launch planning behind an `AgentHarness` interface.
6. Define Routine and harness skill inventory contracts.
7. Define generic Run, artifact, trace, review, and executor contracts that downstream workload plugins can use.
8. Add docs and harness checks so new hardwired provider/harness branches are rejected unless they go through the registry.
9. Only then design local plugin manifests and permissioned loading.

## Agent Plugins

Specific coding agents should be adapter-shaped where possible. Exo core defines the harness contract:

- launch command, cwd, environment, and arguments
- terminal/session adapters
- lifecycle status and cleanup
- MCP/CLI tools exposed to the agent
- optional metadata such as model, provider, objective, and capabilities
- optional hooks for provenance, code review, and PR workflows
- optional harness skill inventory

Claude, Codex, Pi, Aider, Goose, OpenCode, and local/open-source agents can then be first-party or community plugins. A custom Pi fork can be an official/reference plugin without requiring Pi-specific behavior to be hardwired into core.

## Tracing, Evals, And Training

Tracing and evaluation are the first serious test of the plugin boundary.

Core should own durable primitives:

- workcells/runs
- artifacts
- trace/event records
- agent/session/file provenance links
- evaluation result records
- CLI/MCP access to run and result state
- audit logs and permissions

Plugins can own concrete behavior:

- trace collectors
- eval runners
- scorers and graders
- provider integrations
- dashboards
- training-data exports
- routine templates and prompts

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

- What is the plugin manifest format?
- Are plugins loaded from a user directory, workspace directory, or both?
- Which APIs are available to renderer plugins versus main-process plugins?
- How do plugin permissions work?
- Can plugins add MCP tools or CLI commands?
- How are plugin settings stored and exported?
- How should WebView apps receive data from backend plugin capabilities?
- Which run/artifact/provenance primitives must exist before eval/tracing plugins are useful?
- What minimum API is needed before building personal note-branching, versioning, or scheduled Routine templates?

## Initial Task Direction

Before building personal extension features into core, define:

- plugin manifest shape
- plugin install/load location
- safe renderer panel and WebView app APIs
- command registration API
- settings API
- agent harness API
- Routine and harness skill inventory contracts
- MCP/CLI registration policy
- capability permission model
- compatibility/version policy
