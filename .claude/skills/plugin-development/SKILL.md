# Plugin Development

Use this skill before changing Exo plugin architecture, capability registries, plugin manifests, plugin trust/permissions, search-provider adapters, agent-harness adapters, Routine templates, plugin-owned settings/surfaces, or plugin-related CLI/MCP behavior.

## Standard

Exo core is an extensible Markdown graph workstation. Vanilla Exo is core plus bundled recommended plugins. Plugin work should make Exo more composable without letting optional, local, or experimental behavior leak into core.

The target split is:

```text
Exo core
  -> workspace, Markdown files, graph primitives, pane layout
  -> terminal service, web viewer host, command server, settings
  -> plugin registry, trust state, permission metadata, minimal activity/artifact substrate

Plugins
  -> agent harness adapters, advanced search providers, profiles
  -> routines, analyzers, trace collectors, exporters, eval runners
  -> plugin-owned commands, settings, UI surfaces, dashboards
```

## Required Reading

Before editing plugin-system code, read:

- `docs/plugin-system-architecture.md`
- `docs/plugin-architecture-audit.md`
- `docs/plugins.md`
- `docs/plugin-implementation-plan.md`
- `packages/core/src/capabilities.ts`
- `packages/core/src/plugin.ts`

If touching search providers, also read:

- `packages/core/src/search-provider.ts`
- `packages/core/src/search-providers/qmd-provider.ts`
- `docs/qmd-integration-notes.md`

If touching harness adapters, also read:

- `packages/core/src/agent-harness.ts`
- `packages/core/src/agent-harness-registry.ts`
- `packages/core/src/agent-harnesses/builtins.ts`
- `docs/terminal-runtime-decision.md`

## Design Rules

- Core owns substrate and safety boundaries. Plugins own replaceable capability variation.
- Terminal rendering/runtime is core. Harnesses are plugins/adapters into the terminal service.
- Web viewer hosting is core. Plugins request open/focus/close; they do not own WebView security.
- QMD is a bundled advanced search provider, not the permanent search boundary.
- Plugin discovery is metadata-only until trust and permission execution gates exist.
- User/workspace plugins are untrusted by default. Do not make cloned workspace code executable by presence.
- Bundled capabilities should use the same contracts as future external plugins where practical.
- Local/private systems such as GA Pi, Shoshin profiles, or one user's paths belong in local config or plugins, not OSS defaults.

## Fallback Discipline

Before adding or preserving a fallback, document:

1. trigger: the exact failure or missing capability
2. preserved outcome: what user capability still works
3. hidden risk: what problem the fallback could mask
4. visibility: warning, diagnostics, UI state, or test coverage
5. alternative: why failing clearly is worse

Allowed fallback patterns:

- warning-bearing degraded read-only search, such as QMD semantic to lexical
- skipping missing plugin directories during manifest discovery
- keeping disabled plugins inspectable while suppressing capabilities
- explicit developer/operator overrides such as `EXO_PLUGIN_DIRS`

Forbidden fallback patterns:

- executing plugin code during discovery
- treating manifest surface metadata as runtime authorization
- exposing untrusted plugin commands/tools/panels by default
- hidden provider-specific branches in unrelated core services
- private path or project-specific defaults in OSS core
- silently hiding broken plugin configuration when a clear setup/status error is better

## Preferred Change Shape

- Add or deepen a contract before wiring a new product surface.
- Keep trust, permission, and surface decisions near the registry/policy code.
- Keep adapter-specific detection and launch behavior inside the adapter.
- Keep CLI/MCP surfaces narrow and policy-reviewed; MCP should stay an agent work plane.
- Add tests for duplicate ids, disabled state, untrusted state, and surface filtering when those behaviors change.
- Add concise inline comments only for non-obvious constraints, not for what the code plainly does.

## Required Checks

For core plugin/capability changes:

```bash
pnpm --filter @exo/core test
pnpm check:repo
```

For CLI/MCP behavior changes:

```bash
pnpm --filter @exo/cli test
pnpm --filter @exo/mcp test
```

For desktop plugin UI/surface changes:

```bash
pnpm --filter @exo/desktop exec vitest run src/renderer/src/App.test.tsx
pnpm --filter @exo/desktop build
```

## Red Flags

Stop and redesign if a change:

- grows core because a single plugin wants a shortcut
- makes trust implicit
- lets a plugin bypass preload/main-process boundaries
- adds a fallback without warning/diagnostics
- hardcodes Claude/Codex/Pi behavior outside harness adapters
- makes QMD assumptions leak into generic search APIs
- adds GA/Shoshin-specific behavior to public Exo defaults

-- Shoshin | 2026-06-24
