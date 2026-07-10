# Onboarding, Settings, And Manager Boundaries

Last updated: 2026-07-06

This document defines where setup concepts belong after first-run onboarding on the Exograph branch. The old Plugin Manager and Routine Manager product surfaces are removed from active V1; future extension/plugin management is deferred until that architecture is reopened explicitly.

## Boundary Model

| Surface | Owns | Does not own |
| --- | --- | --- |
| Onboarding | Guided first-run setup: workspace paths, notes folder, search defaults, starter agent context, and profile name/review before entering the workspace. | Long-term editing, plugin lifecycle administration, skill installation, routine management, permission grants, or hidden file writes. |
| Settings | Ongoing baseline Exo behavior: workspace roots, appearance, editor, terminal defaults, core search behavior, active workspace profile state, and current built-in harness configuration. | Plugin install/trust/enablement, skill editing, or routine creation. |
| Future Extension Settings | Deferred lifecycle surface for extension/plugin discovery, trust, enablement, dependency/setup state, permissions, plugin-owned settings, local plugin folder management, search providers, harness adapters, profile packs, analyzers, and dashboards. Not part of active V1. | Active profile editing, core substrate configuration, or agent instruction file content. |
| Agent Context | Agent instruction configuration: `AGENTS.md` / `CLAUDE.md` compatibility files and Exograph context templates that Exo and terminal agents actually read. | Workspace profile selection, plugin lifecycle, harness skill inventory, or provider-specific skill file management. |
| Routine Manager | Removed from the active V1 product. Future workflow surfaces should be plugin-led and justified by repeated use. | First-run recommendations, plugin trust/enablement, or profile metadata editing. |
| Profile Manager / Settings Profile | Active workspace profile state: selected profile, scope, profile metadata, drift/review state, recommended components, copy/customize/review actions, and safe links to current owning surfaces. | Directly applying templates, installing skills, enabling plugins, granting permissions, or scheduling routines without explicit review/apply gates. |

## Post-Onboarding Recovery

Every onboarding choice needs a post-onboarding management surface:

| Onboarding choice | Post-onboarding surface |
| --- | --- |
| Notes folder, workspace root, default terminal path, project roots | Settings -> Workspace |
| Advanced search provider choice such as QMD | Settings -> Search for mode/sync behavior. Future extension/provider lifecycle belongs to a reopened extension settings surface, not the removed Plugin Manager. |
| Harness choices | Settings -> Harnesses for current built-in configuration. Future harness adapter lifecycle belongs to a reopened extension settings surface. |
| Managed Exograph agent context | Agent Context. The generated context should summarize stable active roots, search mode/backend, and CLI surface intent. It should not embed generated file or folder tree snapshots; live directory and index navigation belongs in future explicit scoped tools because global instruction rewrites are user-visible provider-file changes. |
| Profile name, active profile, profile recommendations | Settings -> Profile |

If onboarding is incomplete, the app should route the user back to the guided setup flow. If onboarding is complete, Settings should show the active workspace profile and links to the owning management surfaces instead of replaying onboarding.

## Search Boundary

Core search is always available as fast filename/path/text behavior. QMD is the bundled advanced local search provider behind indexed lexical, semantic, and hybrid search. Settings may expose concise QMD provider mode, sync, and update controls because they affect day-to-day workspace behavior. Future install/enable/configuration lifecycle belongs to a reopened extension settings surface, not the removed Plugin Manager.

-- Exo | 2026-07-06
