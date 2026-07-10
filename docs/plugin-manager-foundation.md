# Plugin Manager Foundation

> Superseded as an active product path by `docs/exograph-refactor-completion-plan.md` on `refactor/note-native-exo`. The Plugin Manager UI/model/CSS/tests and mutable lifecycle APIs were deleted in the Exograph refactor. Keep this file only as historical implementation context.

Last updated: 2026-06-27

Status: completed as the foundation pass. Plugin Enablement v0 now extends this
surface with metadata-only trust/enable/disable actions for local/developer
plugin manifests. Official/core rows remain read-only, and Exo still does not
execute plugin code from manifests.

## Goal

Add the first visible Plugin Manager surface without changing runtime behavior. The manager is an inventory view: it helps users understand what is core Exo, what ships as official plugin-shaped capability metadata, and what local plugin manifests are present.

## Sources

- Core surfaces: markdown graph, terminal host, web preview, scheduler, settings.
- Official capabilities: QMD search plus reviewed harness adapters such as shell, Claude, Codex, Pi, and Hermes.
- Local plugins: metadata-only `exo.plugin.json` files discovered through user/workspace Exo plugin search paths.

## Non-Goals

- No arbitrary plugin code execution.
- No install, enable, disable, trust, or permission grant flows.
- No command-server or MCP exposure.
- No plugin-owned UI contribution system.
- No changes to QMD, terminal launch behavior, routine execution, or harness launching.

## Acceptance Criteria

- Desktop exposes one read-only `workspace:list-plugin-inventory` API.
- Plugin Manager opens from the right tool rail.
- Rows are grouped by category and distinguish Core, Official Plugin, Local Plugin, and Developer Manifest sources.
- Selecting a row shows a read-only detail panel with status, exposure, dependencies, and capability-specific metadata.
- Profile rows summarize recommended plugins, metadata schemas, skills, routine templates, graph views, analyzer settings, and review/output policies.
- Graph visualization rows summarize graph snapshot version, host surface, accepted node kinds, and accepted edge kinds.
- Harness rows include live readiness metadata so missing dependencies are visible but not launchable.
- Bad manifest directories appear as inventory errors without crashing the dialog.
- Settings remains focused on baseline workspace behavior; Agent Config Editor remains focused on instructions, skills, and harness configuration.

## Tests And QA

- `pnpm --filter @exo/core test`
- `pnpm --filter @exo/desktop typecheck`
- `pnpm --filter @exo/desktop exec vitest run src/renderer/src/App.test.tsx`
- App QA: launch Exo, open Plugin Manager from the right rail, confirm QMD, Claude/Codex/Pi/Hermes, core surfaces, graph-health, and Exograph Baseline appear with correct read-only status; select Exograph Baseline and confirm profile recommendations/policies render in the detail panel.

-- Shoshin | 2026-06-26
