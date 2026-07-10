# Plugin Architecture Implementation Plan

> Superseded as an active implementation plan by `docs/exograph-refactor-completion-plan.md` and `docs/extension-architecture.md` on `refactor/note-native-exo`. Keep this document as historical implementation context. The current branch is deletion-first for stale plugin/routine/harness product surfaces.

Last updated: 2026-07-03

This plan turns Exo's plugin architecture into code without prematurely loading arbitrary user code. The first goal is internal extensibility: Exo core should use typed registries and contracts for the capabilities that are already plugin-shaped.

## Product Frame

Exo is a local-first AI workstation for building personal AI systems over a Markdown-first exograph. Core should stay boring substrate; plugins provide the interesting workflow, evaluation, training, and automation behavior.

Core owns the substrate:

- workspace, note roots, project roots, and Markdown files
- minimal feed/event and activity substrate: activity ids/status/timestamps, scopes, permission checks, artifact references, and provenance references
- terminal/session lifecycle, rendering surface, scrollback, transcripts, reconnect, diagnostics, semantic message delivery, and command-server protocol
- pane/grid layout, trusted web viewer host, and open/focus/close endpoints
- CLI surfaces
- security, permissions, settings, and app lifecycle

Plugins and profiles own variation. Vanilla Exo should be treated as core plus official/recommended plugins, not core plus hardcoded permanent defaults:

- agent harnesses such as shell, Claude Code, Codex, Pi-compatible, Hermes, Aider, Goose, OpenCode, or local/open-source agents
- advanced search providers such as QMD, graph search, local vector stores, rerankers, or remote retrieval
- dashboards, local web apps, and artifact producers that use Exo's core web viewer endpoints
- exograph/profile packs such as OKF, Shoshin, LM Wiki, domain-specific workbenches, or project-specific mappings
- automations, analyzers, trace collectors, dataset exporters, eval runners, dashboards, and Routine templates

## Current Code Seams

The current code already has good starting boundaries:

- `packages/core/src/qmd.ts` is the only QMD adapter and is the first search-provider migration target.
- `packages/core/src/runtime.ts` owns compatibility launch planning and remains the facade while shell/Claude/Codex/Pi/Hermes move behind harness adapters.
- `apps/desktop/src/main/indexing-service.ts` consumes QMD search/index functions and should keep doing so through a stable search-provider facade.
- `apps/desktop/src/main/terminal-manager.ts` consumes `resolveAgentLaunchPlan()` and should keep creating tmux-backed terminal sessions while harness planning moves behind a contract.
- Historical note: at the time of this plan, `apps/desktop/src/main/command-server.ts`, `packages/cli`, and `packages/mcp` were clients/surfaces over Exo-owned capabilities. On the Exograph refactor branch, `packages/mcp` has been removed and CLI is the active local integration surface.
- Renderer panes, settings, and web viewer endpoint usage come later; do not add plugin UI in the first implementation.
- The current terminal rail should evolve into a tool/plugin dock, but terminal rendering and session ownership stay in core.

## Design Rules

- Do not introduce arbitrary plugin code loading in Phase 1.
- Do not create `packages/runtime` yet.
- Keep `apps/desktop/src/main/index.ts` from growing.
- Keep command-server, CLI, and MCP behavior stable until a phase explicitly changes those contracts.
- Keep QMD as the only built-in search provider until a real second provider exists.
- Keep shell, Claude Code, Codex, Pi-compatible, and Hermes as official harness plugins/adapters. Only enabled and launchable configured instances should appear as launch controls; supported but missing harnesses belong in configuration/setup surfaces. Hermes is hidden from normal lists unless explicitly configured.
- Keep automation semantics plugin-owned. Core may expose an activity/job substrate, but concrete Routines, workflows, evals, and maintenance jobs should be plugins unless they prove universal.
- Preserve current terminal tmux behavior while refactoring harness planning. Do not make the terminal renderer/session service a plugin.
- Prefer focused modules and tests over broad rewrites.

## Phase 1: Core Capability Registry

Add a small internal registry in `packages/core`.

Suggested files:

- `packages/core/src/capabilities.ts`
- `packages/core/src/capability-registry.ts`
- `packages/core/src/__tests__/capability-registry.test.ts`

Initial capability metadata:

- `searchProvider`
- `agentHarness`
- `profile`
- `analyzer`
- `traceCollector`
- `datasetExporter`
- `evalRunner`
- `routineTemplate`

Each capability registration should include:

- stable `id`
- `kind`
- label and description
- lifecycle: `built-in`, `experimental`, `disabled`
- owner module/package
- public surfaces: `desktop`, `cli`, `mcp`, `internal`
- permissions requested
- optional compatibility metadata

Register metadata only:

- QMD as built-in `searchProvider`
- shell, Claude Code, and Codex as official `agentHarness` capabilities

Do not change runtime behavior in this phase.

Tests:

- registry rejects duplicate ids
- registry filters by kind and lifecycle
- registry exposes built-in QMD and shell/Claude/Codex metadata
- disabled capabilities do not appear in active lists unless requested

Gate:

```bash
pnpm --filter @exo/core test
pnpm check:repo
```

## Phase 2: SearchProvider Contract

Move QMD behind a typed `SearchProvider` contract while preserving current public functions.

Status: implemented. QMD is behind `QmdSearchProvider`, and the public QMD facade resolves the default provider through `SearchProviderRegistry`.

Suggested files:

- `packages/core/src/search-provider.ts`
- `packages/core/src/search-provider-registry.ts`
- `packages/core/src/search-providers/qmd-provider.ts`
- keep `packages/core/src/qmd.ts` as a compatibility facade during migration

Contract should cover:

- metadata/capabilities
- status
- search
- read/resolve target
- update
- embed
- sync
- optional diagnostics and cancellation/progress hooks later

Migration approach:

1. Extract the implementation body from `qmd.ts` into `QmdSearchProvider`.
2. Keep exported functions such as `getIndexStatus`, `searchIndex`, `readIndexDocument`, `syncIndex`, `updateIndex`, and `embedIndex` delegating to the default provider.
3. Keep `IndexingService`, CLI, MCP, and command server unchanged.
4. Add tests around the provider and keep current QMD tests passing.

Gate:

```bash
pnpm --filter @exo/core test
pnpm --filter @exo/desktop test -- indexing-service
pnpm check
```

## Phase 3: AgentHarness Contract

Move shell/Claude/Codex/Pi-compatible/Hermes launch planning behind a typed `AgentHarness` contract while preserving current launch plans.

Status: first-pass implementation exists. Official shell/Claude/Codex/Pi-compatible/Hermes harnesses implement `AgentHarness`, and runtime launcher resolution goes through `AgentHarnessRegistry`. Pi custom builds are local configuration of the Pi-compatible adapter; GA Pi must not become an OSS source default. Pi launchability now requires an explicit compatible inference backend config, and Hermes is hidden from normal lists unless explicitly configured.

The v1 adapter extension contract is now documented in `docs/agent-harness-plugin-contract.md` and represented in `packages/core/src/agent-harness.ts`. It covers official and local adapters for Claude Code, Codex, Pi-compatible builds, Aider, Goose, OpenCode, and local/open-source agents. The contract names adapter metadata, availability detection, launch planning, semantic messages, semantic trace declarations, skill/config inventory, dependency/setup guidance, and core terminal ownership.

Remaining cleanup: keep the terminal substrate core while removing the remaining compatibility official harness ids from renderer/API launch descriptors. Terminal sessions and diagnostics expose additive `terminalKind` plus `harnessId` fields while preserving legacy `kind`; `exo terminals` remains the low-level terminal/admin surface, while `exo agents create` and MCP `create_agent` now validate registered, enabled, surface-approved harness ids before terminal creation.

Suggested files:

- `packages/core/src/agent-harness.ts`
- `packages/core/src/agent-harness-registry.ts`
- `packages/core/src/agent-harnesses/builtins.ts`
- keep `packages/core/src/runtime.ts` as the compatibility facade during migration

Contract should cover:

- metadata/capabilities
- harness id/kind
- title/icon metadata
- command/args/env/cwd planning
- readiness hints
- instruction-overlay env contract
- message submission semantics
- optional skill inventory metadata
- required runtime dependency metadata, including inference backends

Contract note: the terminal/session metadata split has started. `TerminalSessionInfo`, diagnostics, persisted session records, and command-protocol terminal info can distinguish core substrate (`terminalKind: "shell" | "agent"`) from harness identity (`harnessId`). Public agent-create paths now route through registered, launchable `harnessId` values, but some renderer/API descriptors still carry built-in `ManagedAgentKind` compatibility fields for built-in terminal creation and persisted-session backfill.

Migration approach:

1. Extract shell, Claude, Codex, Pi-compatible, and Hermes launch config builders from `runtime.ts` into built-in harness modules.
2. Keep `ManagedAgentKind` and `resolveAgentLaunchPlan()` stable.
3. Keep `TerminalManager` Codex-specific startup behavior unchanged while sharing instruction overlays across agent harnesses.
4. Use harness detection/configuration/dependency status to decide which launchers appear in the UI; keep supported or missing harnesses visible in configuration surfaces, but do not render dead launcher buttons. Hide experimental adapters such as Hermes unless local configuration opts them in.
5. Treat trace/provenance hooks as harness-adapter responsibilities. Terminal transcripts are evidence, but xterm rendering must not be the trace system.

Tests:

- current runtime tests continue to pass
- built-in harness registry exposes shell/Claude/Codex/Pi-compatible/Hermes
- Codex reasoning-effort override behavior remains identical
- launch plans preserve env vars used by terminal manager and runtime overlays

Gate:

```bash
pnpm --filter @exo/core test
pnpm --filter @exo/desktop test -- terminal-manager
pnpm --filter @exo/cli test
pnpm check
```

## Phase 4: Activity Substrate And Plugin Routine Spec

Status: first-pass type contracts implemented in `packages/core/src/routine.ts` and `packages/core/src/run.ts`. Storage path helpers, a small JSON filesystem store, artifact writing, and trace JSONL append helpers are implemented in `packages/core/src/routine-run-store.ts`. A manual executor substrate with an injected host is implemented in `packages/core/src/routine-executor.ts`. Plugin-declared routine templates can be extracted from `routineTemplate` capabilities and instantiated as concrete user/workspace Routine definitions through `packages/core/src/routine-template.ts`. `RoutineService` and `exo routines` provide the first CLI MVP for listing templates, creating routines, listing routines, recording dry-run executions, inspecting run records/artifacts, and handing a routine prompt to an Exo-managed shell/Claude/Codex terminal through the running app. Proposal review now has a core JSON store, a base-hash-checked apply host for v1 file create/diff/frontmatter changes, `exo proposals` CLI/app-command review commands, and a native desktop review UI. Semantic trace now has a v1 envelope and harness declaration contract, but no provider capture pipeline yet. MCP remains read/propose-only and must not expose proposal accept/reject decisions.

Treat this implementation as provisional substrate, not a decision to keep growing automation as a core product domain. The durable target is smaller: core owns activity ids/status/timestamps, permission checks, artifact references, transcript references, minimal provenance links, and optional review state. Plugins own Routine/workflow/eval-specific schemas, detailed traces, review labels, dashboards, and export formats. Scheduler implementation, automatic completion tracking, and desktop Routine UI remain future work. Do not build scheduler UI yet.

Core substrate concepts:

- activity id
- status and timestamps
- actor, harness, and scope references
- `RoutinePermissionSet`
- output policy / review requirement
- `HarnessSkillRequirement`
- artifact reference
- transcript/log reference
- optional provenance/review reference

Plugin Routine:

- prompt
- selected harness
- optional required harness skills
- manual trigger or schedule
- scope
- permissions
- output policy

These fields may live in a first-party core type today, but new semantics should be designed as plugin-owned unless they are needed by several unrelated plugins.

Routine template:

- plugin-declared metadata attached to a `routineTemplate` capability
- prompt, default harness, optional required harness skills, default trigger, permissions, and output policy
- no execution by itself
- no implicit scope or write access
- becomes runnable only after Exo instantiates it into a concrete `RoutineDefinition` with a workspace scope

Activity/run record:

- one execution of a plugin routine, manual job, agent handoff, or future scheduled activity
- minimal status, timestamps, references, errors, and review state
- rich traces, evaluation results, labels, dashboards, and export schemas remain plugin-owned artifacts/provenance refs

Storage:

- definitions can live under `.exo/routines/`
- run records can live under `.exo/runs/`
- artifacts can live under `.exo/artifacts/`
- user-owned Markdown changes remain normal files and should be proposed/reviewed according to output policy
- canonical first-pass paths:
  - `.exo/routines/{routineId}.json`
  - `.exo/runs/{runId}/run.json`
  - `.exo/runs/{runId}/transcript.ansi.log`
  - `.exo/runs/{runId}/run.log`
  - `.exo/artifacts/{runId}/{artifactFileName}`

This phase should be kept narrow. Avoid adding a broad core automation UI until multiple plugins prove which scheduler/activity fields are actually universal.

The stable external workload contract lives in `activity-plugin-contract.md`: `RunRecord` is a compatibility projection over this substrate, not permission to add workflow-specific fields to core.

## Phase 4.5: Plugin Config V0

Status: core contract and desktop editor implemented. Plugin manifests can declare metadata-only
settings schemas with simple boolean, string, number, and select fields. Exo
persists local overrides in `.exo/plugin-settings.json`, validates effective
settings, preserves user configuration across manifest edits, and marks changed
manifest configuration for review. Plugin inventory exposes settings summaries.

This does not execute plugin code and does not add plugin-owned renderer
components. The desktop Plugin Manager renders the supported setting controls
itself for trusted/enabled local manifest plugins and keeps core/official,
untrusted, disabled, and schema-less plugins non-editable.

## Phase 4.6: Local Plugin Directory Management V0

Status: metadata-only local add/remove/swap implemented. Exo can copy a valid
plugin directory into an Exo-managed user plugin root or workspace plugin root,
remove managed local plugin copies, and replace a managed local plugin copy after
validating the replacement manifest. These actions refresh Plugin Manager
inventory and keep trust, enablement, settings, and permission state separate
from the plugin directory itself.

This is still not executable plugin loading. Add/swap validates
`exo.plugin.json` and copies files, but Exo does not run install scripts, import
entrypoints, register renderer panels, add MCP/CLI tools, launch terminals, open
web views, or grant permissions from the manifest. User/workspace plugin copies
remain untrusted until explicitly reviewed.

Safety rules:

- source plugin manifests cannot choose install destinations
- writes are constrained to `${EXO_USER_DATA_PATH}/plugins/{plugin}/` or
  `${workspaceRoot}/.exo/plugins/{plugin}/`
- official, source-tree, operator, and developer plugin directories are
  read-only from Plugin Manager
- replacement validates the new manifest before moving the existing managed
  plugin copy aside
- changed manifest hashes naturally require trust/settings/permission review
  through existing state stores

## Phase 5: External Reference Workload Contracts

Use downstream workloads to pressure-test the plugin boundary, but do not build workload-specific behavior into Exo core.

Status: generic Exo primitives exist for first-pass Routines, Run/activity records, artifact references, trace JSONL artifact helpers, injected execution hosts, provider registries, and harness registries. No workload-specific trace collector, exporter, eval runner, review UI, or schema should ship in core without explicit approval.

The generic plugin contracts must support downstream workloads that need:

- elicitation prompt runs
- operator or subject responses
- accept/reject/correct labels
- trace packets
- evidence/provenance links
- JSONL export artifacts
- optional OKF concept outputs for curated project/domain knowledge
- raw traces and labels as `.exo/` artifacts linked back to Markdown/OKF concepts

The contract is intentionally reference-based: core stores activity, artifact, provenance, and review references; plugins own trace/eval/export schemas.

This phase should produce:

- concrete generic Routine examples
- plugin-owned trace schema draft
- output policy examples
- permission examples
- guidance that domain-specific examples belong in plugin packages, private downstream repos, or clearly marked references, not `@exo/core`
- test fixture expectations for future implementation

## Phase 6: Permissioned Surface Contributions

Only after registry contracts survive built-in migrations, define how capabilities request exposure through:

- desktop UI
- CLI
- MCP
- command server
- core web viewer endpoint requests
- settings

MCP exposure must remain narrow and agent-safe. CLI remains the broad operator/admin/debug surface.

Status: policy-level contract plus first desktop tool descriptor slice implemented. Capabilities can describe intended surfaces and surface policies can validate desktop, CLI, MCP, command-server, and internal exposure. The desktop right rail/tool dock now has typed descriptors for current core/official actions, future routine-template/graph-visualization tool targets, metadata-only native plugin panels, and core web viewer endpoint requests. Descriptor metadata is still not authorization, renderer plugin loading, or public command/tool registration.

The safe surface contract is documented in `docs/plugin-surface-contract.md`. Plugin-produced local apps and artifacts should use the existing core preview routes (`/preview/open`, `/preview/focus`, `/preview/close`) as the web viewer API. Native plugin panels remain inert descriptors with renderer entrypoint loading disabled until a later permissioned renderer contract exists.

## Phase 7: Local Plugin Manifest V0

Status: implemented as metadata-only discovery in `packages/core/src/plugin.ts`.

The first manifest pass supports:

- `exo.plugin.json` manifests in plugin directories
- plugin id, name, version, Exo API version, optional description, optional entrypoints, settings schema, surfaces, permissions, and declared capabilities
- strict validation for lifecycle states, surfaces, and permission strings; bare legacy capability kinds are rejected, while future namespaced kinds are parsed as inert `unsupported-kind` metadata
- deterministic discovery from configured directories without loading or executing plugin code
- source/trust metadata for built-in, dev, user, and workspace plugins
- duplicate-safe plugin and capability registration
- conservative defaults: built-in/dev plugins are trusted, user/workspace plugins are discovered as untrusted, and disabled plugins are hidden from normal lists

This is intentionally not arbitrary plugin loading. A manifest can declare what a plugin would contribute, but Exo does not yet execute plugin entrypoints, grant permissions, add UI, add CLI commands, or add MCP tools from manifests.

Concrete manifest collection roots are now part of the core contract:

- `${EXO_RESOURCES_PATH}/plugins/` for packaged official plugin manifests
- `${EXO_PROJECT_ROOT}/plugins/` for source-tree official plugin manifests
- each `EXO_DEV_PLUGIN_DIRS` entry for trusted developer-session manifests
- each `EXO_PLUGIN_DIRS` entry for trusted operator override manifests
- `${EXO_USER_DATA_PATH}/plugins/` for untrusted user-installed manifests
- `${workspaceRoot}/.exo/plugins/` for untrusted workspace-local manifests

The runtime root stores local policy, not plugin code: `plugin-state.json` records trust/enablement decisions keyed by manifest identity and hash, and `plugin-settings.json` stores metadata-only configuration overrides. Trust records are intentionally local machine/runtime state so a workspace manifest cannot self-trust by being copied or cloned.

Lifecycle status is explicit in core types: `trusted + enabled` exposes metadata capabilities and settings only; `untrusted` or `disabled` keeps capabilities inactive; executable entrypoint loading remains `disabled` for every source. Capability permissions remain requested metadata, not grants.

### Metadata-Only Permission Grants

Status: core contract implemented in `packages/core/src/plugin-permissions.ts`.

Plugin manifests and capabilities still declare requested permissions only. Exo now has a separate local `plugin-permissions.json` policy store for grant and revoke decisions keyed by plugin id, source, root directory, manifest path, and manifest hash. Effective grants are computed from the decision log, but they are active only when the plugin is currently trusted and enabled and the specific capability is not disabled. A changed manifest hash does not inherit prior grants.

Inventory rows expose requested, granted, and missing permission summaries for local manifest capabilities. This is read-only metadata for Plugin Manager and onboarding review; it does not execute plugin entrypoints, register renderer panels, add CLI or MCP tools, open web-viewer targets, launch terminals/agents, or write files.

Tests prove:

- requested permissions are distinct from granted permissions
- grants can be revoked
- untrusted plugins, disabled plugins, disabled capabilities, and changed manifest hashes cannot be considered granted/active
- grant records cannot include permissions that the manifest did not request

### Profile Capability Payload

Status: first metadata contract implemented in `packages/core/src/profile.ts`.

Profiles are bundles of recommendations and conventions, not executable capabilities. A profile capability declares its payload under `capability.compatibility.profile`. It may describe:

- recommended plugin ids and whether each is required
- advisory metadata/frontmatter schemas and path scopes
- context, instruction, and MCP config template references
- skill references by harness id
- routine template ids
- project knowledge sync declarations for canonical project-local Markdown files, relationship mode, conflict policy, review policy, and optional remote metadata
- graph view references
- analyzer settings
- review and output policy defaults

The profile extractor validates shape and rejects unsafe absolute or traversal paths, but it does not install skills, enable plugins, schedule routines, change settings, grant permissions, or mutate user Markdown directly. Profile-owned context, instruction, and MCP config templates can now be staged as proposal batches for explicit Desktop/CLI review. Applying plugins, skills, routines, settings, permission grants, or AI-generated profile changes remains a future UX and permission flow.

Profile preview plans now also expose a metadata-only apply prompt checklist. The checklist names the disabled gates for plugin trust, plugin enable/install, requested permission grants, plugin settings review, file writes, skill install/enable, routine instantiation/scheduling, and MCP config mutation. These prompt steps are serialized as plan data for Settings/Profile and onboarding review; they do not grant authority, enable plugins, write files, install skills, schedule routines, or execute plugin code.

Official example: `plugins/exograph-baseline/exo.plugin.json` declares the first read-only baseline profile so Plugin Manager can display profile metadata during QA.

### Project Knowledge Sync Payload

Status: first metadata contract implemented in `packages/core/src/project-knowledge-sync.ts` and exposed through profile payload extraction in `packages/core/src/profile.ts`.

Project Knowledge Sync is profile/plugin-declared metadata for making relationships between project-local Markdown control files and a central exograph explicit. Status: unstable. A profile can declare:

- canonical file names and glob-like patterns such as `issues.md`, `tasks.md`, `roadmap.md`, `plans/**/*.md`, `specs/**/*.md`, `AGENTS.md`, and `CLAUDE.md`
- project and exograph root scopes plus optional path scopes
- relationship mode as inert metadata: `index`, `proposal`, `copy`, `symlink`, or `remote`
- conflict policy for divergence reporting, blocking, preference, or proposed merge handling
- review policy for human review, proposal requirement, and allowed target prefixes
- optional GitHub remote metadata for owner, repo, branch, issue labels, and pull request labels

This contract does not watch files, generate indexes, create proposals, copy files, create symlinks, call GitHub, or write to the workspace. Path and pattern fields are conservative: absolute paths, traversal, backslashes, and URL-like schemes are rejected. `index` and `proposal` are the modes core intends to implement first; `copy`, `symlink`, and `remote` are reserved words, not commitments, and may be removed without compatibility shims. Do not add new modes, conflict actions, or providers until the first acting implementation exists. The next implementation steps are to connect this metadata to read-only drift/index views, then use the existing proposal/review substrate for staged sync proposals before considering any copy or symlink apply path.

### Graph Snapshot And Visualization Payload

Status: first metadata contract implemented in `packages/core/src/graph.ts`, with build support in `packages/core/src/graph-snapshot.ts` and the plugin-facing contract documented in `docs/graph-visualization-plugin-contract.md`.

Graph data is core substrate. A `GraphSnapshot` is a read-only representation of notes, tags, unresolved references, and outgoing graph edges. It carries a deterministic `snapshotId`, explicit schema metadata, sorted nodes/edges/warnings, and scope metadata. Backlinks are a derived view over outgoing edges, not separately stored graph facts.

Graph visualization is plugin-shaped. A `graphVisualization` capability may declare accepted graph data version, node kinds, edge kinds, host surface, render mode, and preferred placement under `capability.compatibility.graphVisualization`. Tool surface descriptors carry the graph data and surface contribution metadata needed by future 2D/3D/domain graph views to consume the same core snapshot. When `hostSurface` is `webPreview`, descriptors also carry core web viewer endpoint metadata instead of granting plugin ownership of a WebView.

This pass does not implement graph extraction, graph rendering, renderer plugin loading, or default graph explorer UI.

## Phase 8: External Plugin Loading

Defer until the manifest model survives real use.

Future work:

- remote install/update flows and state cleanup beyond the implemented metadata-only local add/remove/swap path
- trust prompts and trust revocation UX for user/workspace roots
- permission prompt UX on top of the metadata-only grant/revocation records
- entrypoint loading, sandbox policy, process isolation, and lifecycle error handling
- command, settings, pane, web viewer request, CLI, and MCP registration APIs
- logs/errors
- uninstall and state cleanup

## Current Remaining Order

Foundation work has already landed for the capability registry, QMD search provider, built-in agent harnesses, minimal Routine/activity records, metadata-only manifests, metadata-only permissions/settings, local add/remove/swap, Plugin Manager, profile preview/copy state, safe surface descriptors, and graph snapshot metadata.

The remaining order is:

1. Finish staged profile apply prompts/grants beyond file-template proposals: plugin enable/install, permission grants, plugin settings, skills, routines, MCP config, and AI-generated profile changes.
2. Finish renderer/API launch descriptor cleanup so built-in `ManagedAgentKind` compatibility is only used for built-in creation and persisted-session backfill.
3. Define external plugin contracts for workload-specific trace collection, review labels, dataset export, eval packets, and instrumented agent runtimes.
4. Build Project Knowledge Sync read-only drift/index views from the metadata-only contract, then stage sync proposals through the existing review substrate.
5. Add scheduler/feed implementation only after the manual Routine/activity path proves which core fields are universal.
6. Add explicit policy, tests, and UX before any plugin contributes executable code, renderer panels, command-server routes, CLI commands, MCP tools, or direct web-viewer actions.

## QA Standard

Early phases are core/module refactors and need focused automated coverage. App QA becomes mandatory when a phase affects desktop behavior, terminal launches, settings, command-server routes, CLI/MCP behavior, or renderer UI.

Minimum gates by scope:

- registry/types only: `pnpm --filter @exo/core test`, `pnpm check:repo`
- search migration: core QMD tests, desktop indexing tests, CLI/MCP search tests, `pnpm check`
- harness migration: core runtime tests, desktop terminal-manager tests, CLI/MCP agent tests, focused app QA launching every enabled/available harness and verifying unsupported harnesses appear only in configuration/setup surfaces
- scheduler/feed/runtime changes: focused unit tests, e2e hidden-window CLI/MCP tests, installed-app app QA

-- Exo | 2026-06-15
