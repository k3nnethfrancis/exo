# Plugin Architecture Implementation Plan

Last updated: 2026-06-22

This plan turns Exo's plugin architecture into code without prematurely loading arbitrary third-party code. The first goal is internal extensibility: Exo core should use typed registries and contracts for the capabilities that are already plugin-shaped.

## Product Frame

Exo is a local-first AI workstation for building personal AI systems over a Markdown-first exograph. Core should stay boring substrate; plugins provide the interesting workflow, evaluation, training, and automation behavior.

Core owns the substrate:

- workspace, note roots, project roots, and Markdown files
- minimal feed/event and activity substrate: activity ids/status/timestamps, scopes, permission checks, artifact references, and provenance references
- terminal/session lifecycle, rendering surface, scrollback, transcripts, reconnect, diagnostics, semantic message delivery, and command-server protocol
- pane/grid layout, trusted web viewer host, and open/focus/close endpoints
- CLI/MCP surfaces
- security, permissions, settings, and app lifecycle

Plugins and profiles own variation. Vanilla Exo should be treated as core plus bundled/recommended plugins, not core plus hardcoded permanent defaults:

- agent harnesses such as shell, Claude Code, Codex, Pi-compatible, Hermes, Aider, OpenCode, or local agents
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
- `apps/desktop/src/main/command-server.ts`, `packages/cli`, and `packages/mcp` should remain clients/surfaces over Exo-owned capabilities, not become the plugin system.
- Renderer panes, settings, and web viewer endpoint usage come later; do not add plugin UI in the first implementation.
- The current terminal rail should evolve into a tool/plugin dock, but terminal rendering and session ownership stay in core.

## Design Rules

- Do not introduce arbitrary plugin code loading in Phase 1.
- Do not create `packages/runtime` yet.
- Keep `apps/desktop/src/main/index.ts` from growing.
- Keep command-server, CLI, and MCP behavior stable until a phase explicitly changes those contracts.
- Keep QMD as the only built-in search provider until a real second provider exists.
- Keep shell, Claude Code, Codex, Pi-compatible, and Hermes as bundled harness plugins/adapters. Only enabled and launchable configured instances should appear as launch controls; supported but missing harnesses belong in configuration/setup surfaces. Hermes is hidden from normal lists unless explicitly configured.
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
- shell, Claude Code, and Codex as bundled `agentHarness` capabilities

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

Status: first-pass implementation exists. Bundled shell/Claude/Codex/Pi-compatible/Hermes harnesses implement `AgentHarness`, and runtime launcher resolution goes through `AgentHarnessRegistry`. Pi custom builds are local configuration of the Pi-compatible adapter; GA Pi must not become an OSS source default. Pi launchability now requires an explicit compatible inference backend config, and Hermes is hidden from normal lists unless explicitly configured.

Remaining cleanup: keep the terminal substrate core while reducing fixed bundled harness ids in CLI/MCP/session types. `exo terminals` should remain the low-level terminal/admin surface; `exo agents create` and MCP `create_agent` should choose from registered, enabled, policy-approved harnesses.

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

Status: first-pass type contracts implemented in `packages/core/src/routine.ts` and `packages/core/src/run.ts`. Storage path helpers, a small JSON filesystem store, artifact writing, and trace JSONL append helpers are implemented in `packages/core/src/routine-run-store.ts`. A manual executor substrate with an injected host is implemented in `packages/core/src/routine-executor.ts`. Plugin-declared routine templates can be extracted from `routineTemplate` capabilities and instantiated as concrete user/workspace Routine definitions through `packages/core/src/routine-template.ts`. `RoutineService` and `exo routines` provide the first CLI MVP for listing templates, creating routines, listing routines, recording dry-run executions, inspecting run records/artifacts, and handing a routine prompt to an Exo-managed shell/Claude/Codex terminal through the running app.

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
- rich traces, evaluation results, labels, dashboards, and export schemas remain plugin-owned

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

## Phase 5: External Reference Workload Contracts

Use downstream workloads to pressure-test the plugin boundary, but do not build workload-specific behavior into Exo core.

Status: generic Exo primitives exist for first-pass Routines, Run/activity records, artifacts, traces, injected execution hosts, provider registries, and harness registries. No workload-specific trace collector, exporter, eval runner, review UI, or schema should ship in core without explicit approval.

The generic plugin contracts must support downstream workloads that need:

- elicitation prompt runs
- operator or subject responses
- accept/reject/correct labels
- trace packets
- evidence/provenance links
- JSONL export artifacts
- optional OKF concept outputs for curated project/domain knowledge
- raw traces and labels as `.exo/` artifacts linked back to Markdown/OKF concepts

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

Status: implemented as a policy-level contract. Capabilities can describe intended surfaces and surface policies can validate desktop, CLI, MCP, command-server, and internal exposure. No public command/tool registration API exists yet.

## Phase 7: Local Plugin Manifest V0

Status: implemented as metadata-only discovery in `packages/core/src/plugin.ts`.

The first manifest pass supports:

- `exo.plugin.json` manifests in plugin directories
- plugin id, name, version, Exo API version, optional description, optional entrypoints, settings schema, surfaces, permissions, and declared capabilities
- strict validation for capability kinds, lifecycle states, surfaces, and permission strings
- deterministic discovery from configured directories without loading or executing plugin code
- source/trust metadata for built-in, dev, user, and workspace plugins
- duplicate-safe plugin and capability registration
- conservative defaults: built-in/dev plugins are trusted, user/workspace plugins are discovered as untrusted, and disabled plugins are hidden from normal lists

This is intentionally not arbitrary plugin loading. A manifest can declare what a plugin would contribute, but Exo does not yet execute plugin entrypoints, grant permissions, add UI, add CLI commands, or add MCP tools from manifests.

## Phase 8: External Plugin Loading

Defer until the manifest model survives real use.

Future work:

- user/workspace/repo plugin locations
- trust prompts
- permission grants
- entrypoint loading and sandbox policy
- command, settings, pane, web viewer request, CLI, and MCP registration APIs
- logs/errors
- Plugin Manager UI
- uninstall and state cleanup

## Implementation Order

1. Core capability registry and built-in metadata.
2. SearchProvider contract with QMD behind it.
3. AgentHarness contract with shell/Claude/Codex/Pi/Hermes behind it.
4. Minimal activity/artifact-reference substrate plus plugin Routine template spec.
5. External reference workload contract requirements.
6. Scheduler implementation.
7. Feed/event model.
8. Permissioned surface contributions.
9. Local plugin manifest discovery and validation.
10. External plugin loading.

## QA Standard

Early phases are core/module refactors and need focused automated coverage. App QA becomes mandatory when a phase affects desktop behavior, terminal launches, settings, command-server routes, CLI/MCP behavior, or renderer UI.

Minimum gates by scope:

- registry/types only: `pnpm --filter @exo/core test`, `pnpm check:repo`
- search migration: core QMD tests, desktop indexing tests, CLI/MCP search tests, `pnpm check`
- harness migration: core runtime tests, desktop terminal-manager tests, CLI/MCP agent tests, focused app QA launching every enabled/available harness and verifying unsupported harnesses appear only in configuration/setup surfaces
- scheduler/feed/runtime changes: focused unit tests, e2e hidden-window CLI/MCP tests, installed-app app QA

-- Exo | 2026-06-15
