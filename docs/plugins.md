# Plugin Architecture

Last updated: 2026-05-20

Exo should support a plugin path so users can extend the shared exocortex without requiring every feature to land in core.

## Why Plugins Matter

Exo is open source and intentionally hackable, but not every workflow should become core product behavior. Some features are personal, experimental, or domain-specific. Plugins should let users add those capabilities while keeping the core app focused.

Examples that likely belong in plugins:

- personal note-branching or versioning workflows
- custom note transforms
- domain-specific graph panels
- local research/workcell surfaces
- extra agent launchers
- custom memory/index visualizations
- project-specific panels or commands

## Core Versus Plugin

Core should own:

- workspace model
- note roots and project roots
- editor, terminal, and WebView/browser pane system
- Exo CLI and MCP contracts
- terminal-agent lifecycle
- command, settings, pane/view, agent launcher, search provider, and workflow registries
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
- agent launchers and helpers
- search/index providers
- trace collectors, eval runners, scorers, dashboards, and training/export flows
- web apps hosted in Exo WebView panes
- project-specific workflows
- integrations with external tools

## Plugin Depths

Not every plugin has the same relationship to Exo. The plugin model should support several depths without treating them as the same thing:

- App plugins: mostly run as an app inside an Exo WebView pane. Examples: local web-app previews, eval dashboards, graph dashboards, custom notebook tools.
- Surface plugins: add Exo-native UI surfaces. Examples: side panels, status widgets, editor decorations, command palette actions.
- Capability plugins: add backend abilities. Examples: agent launchers, MCP tools, CLI commands, search providers, trace collectors, eval runners.
- Workflow plugins: compose Exo primitives into a process. Examples: run eval, collect traces, score results, produce a report, and prepare a PR.

The browser/WebView pane is a core primitive, not merely a plugin. Many unrelated workflows need a safe way to show local web apps, documentation previews, dashboards, and artifacts. Plugins can target that primitive with their own apps.

## Agent Plugins

Specific coding agents should be adapter-shaped where possible. Exo core defines the contract:

- launch command, cwd, environment, and arguments
- terminal/tmux/pty transport
- lifecycle status and cleanup
- MCP/CLI tools exposed to the agent
- optional metadata such as model, provider, objective, and capabilities
- optional hooks for provenance, code review, and PR workflows

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
- workflow recipes

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
- What minimum API is needed before building personal note-branching or versioning workflows?

## Initial Task Direction

Before building personal extension features into core, define:

- plugin manifest shape
- plugin install/load location
- safe renderer panel and WebView app APIs
- command registration API
- settings API
- agent launcher API
- MCP/CLI registration policy
- capability permission model
- compatibility/version policy
