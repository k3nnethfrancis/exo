# Plugin Architecture Audit

Last updated: 2026-06-24

This document applies the same discipline used for terminal architecture to Exo's plugin architecture: steelman the decisions, keep only fallbacks that preserve a real user capability, and document the reasoning before the system grows.

## Purpose

Exo is an extensible Markdown graph workstation. Core should stay coherent and reliable; plugins should provide replaceable capability variation. The risk is not only code bloat. The bigger risk is letting optional, user-specific, or experimental behavior leak into core until the app becomes hard to reason about.

The plugin architecture should make these questions mechanical:

- Is this a core substrate primitive or a replaceable capability?
- Does a fallback preserve a user outcome or hide a broken plugin?
- Is this trusted metadata, trusted code, or untrusted workspace/user input?
- Which surface owns enforcement: core service, plugin adapter, UI, CLI, MCP, or routine runner?

## Current Decisions

### Core Owns Substrate; Plugins Own Variation

Decision: Core owns Markdown files, workspace roots, pane layout, terminal service, web viewer host, command server, settings, plugin metadata/trust, and the minimal activity/artifact substrate. Plugins own harness adapters, advanced search providers, profiles, analyzers, routines, dashboards, exporters, evals, and plugin-owned settings/surfaces.

Steelmanned reason: These core pieces are safety and coherence boundaries. If every plugin can implement its own terminal renderer, root model, command-server route, or web host, Exo loses predictable behavior and users cannot debug failures. Plugin variation belongs where multiple valid implementations can exist without changing what Exo fundamentally is.

Counterargument: In open source, everything can be modified, so plugin boundaries may look artificial.

Answer: The boundary is for composability, review, and AI-agent contribution. Users can fork anything, but a plugin contract lets them stack capabilities without breaking the base app or requiring every contributor to understand the entire desktop/runtime system.

### Terminal Runtime Is Core, Harnesses Are Plugins

Decision: The terminal itself is core. Shell, Claude, Codex, Pi, and future harnesses are adapters plugged into the terminal service.

Steelmanned reason: Terminal reliability is launch-blocking. Exo must own session durability, rendering, scrollback, transcripts, focus, resize, and diagnostics in one place. Harness plugins can declare launch plans, detection, readiness, skills/config locations, semantic send behavior, and provenance hooks without owning rendering.

Rejected fallback: A hidden direct-pty transport or per-harness terminal runtime. It would multiply failure modes and reintroduce the same live-screen ownership confusion the terminal refactor is removing.

### Web Viewer Host Is Core

Decision: The trusted web viewer host is core; plugins can ask it to open local files, localhost URLs, artifacts, or trusted URLs.

Steelmanned reason: The web viewer is a general host primitive like panes and settings. Plugins should not need their own WebView contract to show an HTML artifact or dashboard. Core can centralize navigation validation and focus behavior.

Fallback policy: If a preview target cannot be validated, fail clearly. Do not silently open arbitrary filesystem paths outside configured roots.

### QMD Is A Bundled Search Provider

Decision: QMD is the bundled advanced search provider behind the search-provider contract. Basic filesystem/path/text search remains core.

Steelmanned reason: Search needs a stable product surface even as indexing strategies change. QMD provides the current high-quality provider, but Exo should later support graph search, remote retrieval, rerankers, or other local indexers without rewriting MCP/CLI/UI search semantics.

Allowed fallback: QMD search may degrade to lexical or filesystem search with warnings. This preserves orientation when embeddings, native modules, or sqlite extensions are temporarily unavailable.

Risk: Degraded search can hide index corruption if callers ignore warnings.

Hardening rule: Admin/status/repair surfaces must expose QMD problems directly. Search fallback is acceptable for user orientation, not as a way to declare the index healthy.

### Plugin Discovery Is Metadata-Only

Decision: Plugin discovery reads `exo.plugin.json` manifests only. It does not execute plugin code.

Steelmanned reason: Exo needs to show installed, missing, disabled, untrusted, and bundled capabilities before it has a full permission system. Metadata-only discovery gives UI/onboarding visibility without granting execution.

Rejected fallback: Auto-load plugin entrypoints because a manifest exists. That would turn discovery into execution and collapse the trust boundary.

### Trust Defaults Are Conservative

Decision: Built-in and dev plugin sources default trusted. User and workspace plugin sources default untrusted. `EXO_PLUGIN_DIRS` is a developer/operator override and is treated as trusted.

Steelmanned reason: Workspace folders are user-editable and can come from cloned repos, so they should not gain execution rights by presence. Dev overrides exist to keep local plugin development fast, but they are an explicit environment opt-in.

Risk: `EXO_PLUGIN_DIRS` can load surprising local state if set globally.

Hardening rule: Keep this as a dev/operator path. Do not use it as the future user plugin install mechanism.

### Surface Policy Is Descriptive First

Decision: Capability surfaces (`desktop`, `cli`, `mcp`, `commandServer`, `internal`) describe where a capability may appear. They are not a complete authorization system.

Steelmanned reason: Discovery and UI placement need a lightweight filter before the permission model is complete. Actual runtime actions still require owner-specific checks: command server routes, routine policy, file writes, terminal launches, and MCP exposure must enforce permissions at execution time.

Rejected fallback: Treating surface presence as permission to execute. That would make manifest metadata a privilege escalation path.

## Fallback Matrix

| Area | Fallback | Keep? | Reason | Required visibility |
| --- | --- | --- | --- | --- |
| QMD semantic/hybrid search | fall back to lexical search | Yes | Preserves search when embeddings are stale or vector path is unavailable | warning in search response and status/repair surfaces |
| QMD provider open failure | fall back to filesystem search | Yes, for search only | Preserves basic orientation when native QMD fails | warning naming ABI/vec0/general failure |
| Plugin manifest ENOENT | skip directory entry | Yes | Empty plugin dirs are normal | no warning needed |
| Disabled plugin | keep plugin inspectable but ignore capabilities | Yes | Management UI needs to show disabled state without activating ids | Plugin Manager state |
| User/workspace plugin trust | untrusted by default | Yes | Prevents cloned workspace code from becoming executable | Plugin Manager trust action |
| Dev plugin dirs | trusted by env override | Yes, scoped | Local development needs a fast path | docs and explicit env name |
| Missing harness detection implementation | assume launchable | Temporary only | Built-in compatibility while adapters converge | inline comment and future issue |
| Pi backend URL/command | configured means dependency satisfied unless readiness env says otherwise | Temporary | Lets local forks declare a backend contract before live probes exist | harness detail/status |
| MCP/admin plugin surface | expose because manifest lists `mcp` | No | Agent-facing tools need explicit review | future policy gate |
| Plugin entrypoint execution on discovery | execute immediately | No | Breaks trust boundary | forbidden |
| Core-specific fallback for GA/Shoshin paths | use private defaults | No | OSS Exo must remain general | local config/plugin only |

## Inline Comment Targets

The current code now documents the highest-risk non-obvious decisions:

- `packages/core/src/plugin.ts`: metadata-only discovery and disabled capability id handling.
- `packages/core/src/routine-service.ts`: `EXO_PLUGIN_DIRS` as a trusted developer override.
- `packages/core/src/surface-policy.ts`: surface filtering is not authorization.
- `packages/core/src/search-providers/qmd-provider.ts`: QMD degraded search fallbacks.
- `packages/core/src/agent-harness-registry.ts`: missing detection fallback is compatibility, not the future third-party path.
- `packages/core/src/agent-harnesses/builtins.ts`: Pi backend configured versus live-ready distinction.

## Hardening Backlog

1. Remove or narrow the agent-harness "missing detection means launchable" compatibility fallback before third-party harness plugins ship.
2. Replace Pi backend configured-as-detected with a real probe contract once inference-backend plugins exist.
3. Add Plugin Manager trust UI before any user/workspace plugin can contribute executable code.
4. Add policy gates before plugins contribute MCP tools, command-server routes, CLI commands, or renderer panels.
5. Split "activity substrate" naming from richer Routine product behavior if Routine templates become clearly plugin-owned.
6. Add plugin-surface tests that prove untrusted and disabled plugins cannot expose executable surfaces.

## Rules For Future Plugin Work

- Start from the smallest core primitive that lets multiple plugins compose.
- Keep bundled capabilities on the same contract path as external ones where practical.
- Do not hardcode local/private paths, Guardian Angel behavior, Shoshin schemas, or one user's plugin inventory into OSS defaults.
- Do not add a fallback without documenting trigger, preserved outcome, hidden risk, visibility, and why failing clearly is worse.
- Prefer fail-clear over fail-open for trust, permissions, file writes, terminal launches, and MCP tool exposure.
- Prefer warning-bearing degradation for read-only orientation surfaces such as search.
- Add tests to prove disabled/untrusted behavior stays inert before expanding plugin execution.

-- Shoshin | 2026-06-24
