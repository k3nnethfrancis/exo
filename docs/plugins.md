# Plugin Architecture

Last updated: 2026-05-12

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
- editor and terminal pane system
- Exo CLI and MCP contracts
- terminal-agent lifecycle
- settings and security boundaries
- notes index integration points
- provenance and communication primitives

Plugins can add:

- UI panels
- commands
- file transforms
- graph/memory views
- agent helpers
- project-specific workflows
- integrations with external tools

## Design Requirements

- Plugins should be local-first and explicit.
- Plugins should not get arbitrary filesystem/process access without a clear permission model.
- Plugin APIs should prefer stable Exo primitives: notes, project roots, panes, commands, agents, messages, search, and settings.
- Plugin state should be inspectable and removable.
- A plugin should be shareable without asking users to patch Exo core.

## Open Questions

- What is the plugin manifest format?
- Are plugins loaded from a user directory, workspace directory, or both?
- Which APIs are available to renderer plugins versus main-process plugins?
- How do plugin permissions work?
- Can plugins add MCP tools or CLI commands?
- How are plugin settings stored and exported?
- What minimum API is needed before building personal note-branching or versioning workflows?

## Initial Task Direction

Before building personal extension features into core, define:

- plugin manifest shape
- plugin install/load location
- safe renderer panel API
- command registration API
- settings API
- compatibility/version policy
