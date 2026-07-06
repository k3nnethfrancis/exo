# Onboarding, Settings, And Manager Boundaries

Last updated: 2026-07-06

This document defines where profile-era setup concepts belong after first-run onboarding.

## Boundary Model

| Surface | Owns | Does not own |
| --- | --- | --- |
| Onboarding | Guided first-run profile building: workspace paths, notes folder, recommended official plugin choices, detected harness choices, starter agent context, starter routine templates, and profile name/review before entering the workspace. | Long-term editing, plugin lifecycle administration, instruction-file editing, routine management, permission grants, or hidden file writes. |
| Settings | Ongoing baseline Exo behavior: workspace roots, appearance, editor, terminal defaults, core search behavior, active workspace profile state, and links into specialized managers. | Plugin install/trust/enablement, full instruction/skill editing, or routine creation. |
| Plugin Manager | Capability lifecycle: discovery, trust, enable/disable, dependency/setup state, permissions, plugin-owned settings, local plugin folder management, search providers such as QMD, harness adapters, profile packs, analyzers, dashboards, and routine-template plugins. | Active profile editing or agent instruction file content. |
| Agent Config | Harness-adjacent agent configuration: `AGENTS.md` / `CLAUDE.md` compatibility files, instruction layers, skill inventories, skill files, and provider-specific agent config that terminal agents actually read. | Workspace profile selection, plugin lifecycle, or routine scheduling. |
| Routine Manager | Concrete saved/manual/scheduled workflow definitions and run history built from plugin-declared routine templates. | First-run recommendations, plugin trust/enablement, or profile metadata editing. |
| Profile Manager / Settings Profile | Active workspace profile state: selected profile, scope, profile metadata, drift/review state, recommended components, copy/customize/review actions, and safe links to Plugin Manager, Agent Config, and Routine Manager. | Directly applying templates, installing skills, enabling plugins, granting permissions, or scheduling routines without explicit review/apply gates. |

## Post-Onboarding Recovery

Every onboarding choice needs a post-onboarding management surface:

| Onboarding choice | Post-onboarding surface |
| --- | --- |
| Notes folder, workspace root, default terminal path, project roots | Settings -> Workspace |
| Advanced search provider choice such as QMD | Settings -> Search for mode/sync behavior; Plugin Manager -> Search providers for lifecycle and plugin-owned setup |
| Harness choices | Settings -> Harnesses for current built-in configuration; Plugin Manager -> Harness adapters for lifecycle; Agent Config for instructions and skills |
| Managed Exograph agent context | Agent Config |
| Starter routine templates | Routine Manager when available; Plugin Manager lists routine-template plugins until that manager exists |
| Profile name, active profile, profile recommendations | Settings -> Profile |

If onboarding is incomplete, the app should route the user back to the guided setup flow. If onboarding is complete, Settings should show the active workspace profile and links to the owning management surfaces instead of replaying onboarding.

## Search Boundary

Core search is always available as fast filename/path/text behavior. QMD is the bundled advanced local search provider behind indexed lexical, semantic, and hybrid search. Settings may expose concise QMD provider mode, sync, and update controls because they affect day-to-day workspace behavior, but QMD install/enable/configuration belongs to Plugin Manager as the search-provider management surface.

-- Exo | 2026-07-06
