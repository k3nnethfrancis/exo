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
8. `graph-system-report-and-plan.md` — graph-lab results, production knowledge model, quality framework, and gated integration plan.
9. `semantic-and-model-space-projections.md` — renderer-neutral embedding-index and open-model-internals projection contract.
10. `exograph-simplification-plan.md` — historical refactor/planning corpus; consult only with `tasks.md` for current status.
11. `extension-architecture.md` — Markdown/config/Command-first extension ladder.
12. `public-contract-reviews.md` — review ledger for protected CLI, command-server, and shared-protocol contracts.
13. `usability-readiness.md` — installed-app readiness requirements.
14. `harness.md` — development and validation workflow.

## Current product direction

> **Local Markdown exocortex + modular, tunable search + inline agent invocation + graph management skills.**

Folders provide the first custom-ontology substrate. A Folder path gives Notes a primary home; optional user-owned `index.md` and Folder Overview are shipped behavior. Tags and typed relationships preserve multiple membership.

The accepted graph direction is schema-agnostic: Markdown stays canonical,
optional Knowledge Profiles interpret open properties and relationships, and
Graph Views remain derived projections. Graph contract tests and the repo-local
rendering/layout performance suite remain separate. See
`graph-system-report-and-plan.md`.

Codex agents are actively completing trust, containment, editor/invocation, and repository-distillation work. Do not add automatic Folder Index creation or graph-management Skills without `tasks.md` evidence.

First-run can optionally install Exo's bounded, read-only MCP tools into the locally installed Claude and/or Codex CLI. It is not a generic MCP manager; see `provider-mcp-onboarding.md`.

## Durable decisions

- `adr/0001-plugins-and-profiles.md` — superseded historical ADR; never an active implementation guide.
- `adr/0002-folder-indexes-as-ontology.md` — accepted Folder Index ontology decision.
- `adr/0003-plugins-are-distribution-bundles.md` — accepted ruling that Plugins are future distribution bundles, not runtime seams.
- `adr/0004-workspace-is-the-scope-object.md` — accepted ruling that Workspace is the unit of Markdown scope; any future global view is a read-only projection, not a Workspace.
- `adr/0005-schema-agnostic-graph-and-knowledge-profiles.md` — accepted ruling that Exo preserves open graph facts and interprets them through optional user-owned profiles.
- `terminal-runtime-decision.md` — current direct-PTY decision.
- `extension-architecture.md` — current core-versus-extension boundary.

## Historical material

The pre-note-native plugin/profile, harness, MCP, tmux, transcript, completion-plan,
and pivot documents were retired in the P4 stale-document deletion pass. Use Git for
their exact historical text; use `../ledger.md` and `reviews/` for retained milestones
and dated review evidence. Do not recreate or refresh a retired plan as current product
guidance.
