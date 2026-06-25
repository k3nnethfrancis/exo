# Exo

Exo is a local-first AI workstation built around a user-owned Markdown exograph. This glossary defines product-domain terms used by the codebase and architecture docs.

## Language

**Exograph**:
A user-owned Markdown graph made from files, links, paths, tags, properties, and derived indexes. Exo operates over the exograph but approved durable knowledge remains in the user's Markdown files.
_Avoid_: vault, second brain

**Baseline Core**:
The part of Exo that must work with all optional plugins disabled: workspace opening, file browsing, Markdown editing, basic search, terminal, preview, settings, and the resident command server.
_Avoid_: vanilla app, minimum app

**Plugin**:
A replaceable capability that attaches to Exo through a declared contract, surface, configuration model, and permission boundary. Plugins may be bundled or external, but they should not own core host surfaces.
_Avoid_: extension, add-on

**Plugin Layer**:
One of the separable meanings of "plugin": capability metadata, bounded integration contract, or executable distribution. Exo should prove metadata and contracts with bundled/internal plugins before allowing arbitrary executable plugin loading.
_Avoid_: marketplace package

**Profile**:
An opinionated bundle of plugin recommendations, configuration defaults, graph metadata conventions, context templates, skills, routine templates, and review/output policies for a use case. A profile may depend on plugins, but it should not secretly contain arbitrary executable code.
_Avoid_: theme, preset, agent config

**Metadata Schema**:
A profile- or plugin-declared convention for frontmatter, properties, paths, tags, and relationship fields that Exo can use when reading, validating, visualizing, or maintaining an exograph.
_Avoid_: database schema, required file format

**Graph Visualization**:
A plugin-contributed graph exploration surface that renders Exo's core graph data through a specific layout, interaction model, or analysis lens. Core owns the graph substrate and host surface; graph visualization plugins own the view.
_Avoid_: core graph, graph engine

**Bundled Plugin**:
A first-party plugin shipped with Exo and allowed to feel native in day-to-day use while remaining visible as a plugin in onboarding, plugin management, settings, and diagnostics.
_Avoid_: built-in feature, default feature

**Host Surface**:
A core Exo surface that plugins can target but do not own, such as the terminal, web preview, editor grid, settings shell, status bar, command palette, or tool dock.
_Avoid_: plugin UI

**Scheduler**:
The core Exo service for registering, triggering, observing, and cancelling scheduled local work. Plugins may contribute scheduled routines or jobs, but the scheduling substrate is core.
_Avoid_: automation plugin, cron plugin

**Plugin Manager**:
The core configuration surface for plugin lifecycle, plugin permissions, dependency status, install detection, category-specific setup, and plugin-owned custom settings.
_Avoid_: settings tab

**Settings**:
The core configuration surface for baseline Exo behavior such as workspace paths, editor behavior, theme, preview behavior, terminal settings, and core search behavior.
_Avoid_: plugin manager

**Harness Adapter**:
A plugin capability that describes how an agent harness is discovered, launched, configured, messaged, interrupted, and diagnosed through Exo's core terminal/session service.
_Avoid_: terminal plugin, provider runtime
