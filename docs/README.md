# Exo Docs

This directory contains public project context for humans and coding agents.

## Read first

1. `../AGENTS.md` — current contributor rules, active Codex execution context, and architecture invariants.
2. `../CONTEXT.md` — canonical product vocabulary, including Folder, Folder Index, Folder Overview, Primary Home, Ontology, Command, Skill, and Invocation.
3. `../tasks.md` — active implementation work and ownership-sensitive sequencing.
4. `../issues.md` — canonical bugs, QA findings, and release blockers.
5. `../README.md` — current product and setup surface.
6. `architecture.md` — current package/domain architecture and retained feature/data-model index.
7. `../roadmap.md` — next-slice and longer-term direction.
8. `exograph-simplification-plan.md` — historical refactor/planning corpus; consult only with `tasks.md` for current status.
9. `extension-architecture.md` — Markdown/config/Command-first extension ladder.
10. `public-contract-reviews.md` — review ledger for protected CLI, command-server, and shared-protocol contracts.
11. `usability-readiness.md` — installed-app readiness requirements.
12. `harness.md` — development and validation workflow.

## Current product direction

> **Local Markdown exocortex + modular, tunable search + inline agent invocation + graph management skills.**

Folders provide the intended first custom-ontology substrate. A Folder path gives Notes a primary home; optional user-owned `index.md` and Folder Overview are the **next vertical slice**, not shipped behavior. Tags and typed relationships preserve multiple membership today.

Codex agents are actively completing trust, containment, editor/invocation, and repository-distillation work. Do not implement Folder Overview, automatic index creation, or graph-management Skills before `tasks.md` promotes that vertical slice.

## Durable decisions

- `adr/0001-plugins-and-profiles.md` — superseded historical ADR; never an active implementation guide.
- `adr/0002-folder-indexes-as-ontology.md` — accepted Folder Index ontology decision.
- `adr/0003-plugins-are-distribution-bundles.md` — accepted ruling that Plugins are future distribution bundles, not runtime seams.
- `terminal-runtime-decision.md` — current direct-PTY decision.
- `extension-architecture.md` — current core-versus-extension boundary.

## Historical material

Completion/master/orchestration plans, plugin/profile/harness contracts, terminal-era plans, and dated audits remain only for archaeology until a separate deletion pass removes them. They are not active instructions.

Examples include:

- `plugin-system-architecture.md`
- `plugin-implementation-plan.md`
- `plugins.md`
- `activity-plugin-contract.md`
- `agent-harness-plugin-contract.md`
- `plugin-surface-contract.md`
- `graph-visualization-plugin-contract.md`
- `profile-plugin-management-plan.md`
- `terminal-architecture-v4.md`
- `terminal-refactor-plan.md`
- older Exograph completion/orchestration/detailed agent plans

Use Git and `../ledger.md` for implementation history. Do not refresh superseded plans with new product work.
