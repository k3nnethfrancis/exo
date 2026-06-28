# Exo Docs

This directory contains committed, public-facing project context. It should be useful to human contributors and to coding agents working in the repo.

## Canonical Current Docs

- `../README.md` - product overview, setup, commands, build/install caveats, and repository map.
- `../AGENTS.md` - concise coding-agent map and runtime rules.
- `strategy.md` - product direction and system model.
- `architecture.md` - current package, runtime, terminal, CLI/MCP, pane, search, and plugin boundaries.
- `plugin-system-architecture.md` - canonical core-versus-plugin target architecture.
- `activity-plugin-contract.md` - minimal activity/artifact/provenance/review substrate boundary for plugin workloads.
- `agent-harness-plugin-contract.md` - harness adapter contract for Claude, Codex, Pi-compatible, and future local/open-source agents.
- `plugin-surface-contract.md` - safe plugin surface and core web viewer endpoint contribution contract.
- `graph-visualization-plugin-contract.md` - core graph snapshot and future graph visualization plugin contract.
- `terminal-architecture-v4.md` - current terminal architecture and module-boundary target.
- `terminal-runtime-decision.md` - current tmux-backed terminal runtime decision and constraints.
- `terminal-quality-standard.md` - terminal useability, configuration, and QA standard.
- `terminal-fallback-audit.md` - current terminal fallback/recovery decisions, steelman objections, and hardening backlog.
- `tasks.md` - active execution tracker.
- `roadmap.md` - future product systems and sequencing.
- `harness.md` - validation gates and agent-friendly development workflow.
- `github-issue-fix-loop.md` - scheduled Codex loop rules for turning labeled GitHub issues into tested draft PRs.
- `qmd-integration-notes.md` - live QMD adapter contract and upgrade checklist.
- `packages/mcp/README.md` - MCP setup and tool contract.

## Historical And Reference Docs

These remain in place for traceability but should not be treated as the latest architecture source:

- `terminal-refactor-plan.md` - historical tmux migration plan; superseded for current design work by `terminal-architecture-v4.md`, `terminal-runtime-decision.md`, and `terminal-quality-standard.md`.
- `qmd-integration-plan.md` - longer-term QMD product plan; live adapter details are in `qmd-integration-notes.md`.
- `staff-code-review-2026-05-27.md` - dated code review; terminal guidance inside it has been superseded.
- `mcp-nde-test-2026-06-20.md` - dated MCP non-destructive QA audit.
- `exo-themes-plan.md` - planning document for the named theme system, not a shipped feature contract.

## Read Order

1. `../README.md` - product overview, setup, current capabilities
2. `../AGENTS.md` - concise map for coding agents
3. `../CHANGELOG.md` - release notes
4. `strategy.md` - product/system direction
5. `usability-readiness.md` - near-term standard for installed daily use
6. `tasks.md` - active priority backlog
7. `harness.md` - validation gates and agent-friendly development workflow
8. `github-issue-fix-loop.md` - scheduled Codex issue-to-PR loop rules
9. `architecture.md` - package boundaries and runtime contracts
10. `roadmap.md` - future product systems
11. `plugin-system-architecture.md` - core-versus-plugin target architecture
12. `plugins.md` - plugin architecture direction
13. `plugin-implementation-plan.md` - phased implementation plan for capability registries, search providers, agent harnesses, activity substrate, plugin manifests, and future permissioned loading
14. `activity-plugin-contract.md` - activity/artifact/provenance/review substrate contract
15. `agent-harness-plugin-contract.md` - harness adapter contract
16. `plugin-surface-contract.md` - safe plugin surface and web viewer endpoint contract
17. `graph-visualization-plugin-contract.md` - graph visualization plugin contract
18. `open-source.md` - release and platform support notes
19. `terminal-architecture-v4.md` - current terminal architecture and module-boundary target
20. `terminal-runtime-decision.md` - terminal runtime decision
21. `terminal-quality-standard.md` - terminal useability and QA standard
22. `terminal-fallback-audit.md` - terminal fallback/recovery policy and current decisions
23. `terminal-refactor-plan.md` - historical tmux migration plan
24. `qmd-integration-notes.md` - live QMD dependency boundary and upgrade checklist

## File Roles

- `architecture.md` explains how Exo is built today.
- `strategy.md` explains why the system exists and where it is going.
- `usability-readiness.md` defines the gate before installed Exo becomes the stable daily runtime.
- `roadmap.md` groups future product systems.
- `tasks.md` tracks the next concrete work.
- `harness.md` explains how changes should be validated.
- `github-issue-fix-loop.md` defines the conservative scheduled GitHub issue-to-draft-PR loop.
- `plugin-system-architecture.md` defines which platform surfaces stay core versus become bundled/external plugins.
- `plugins.md` tracks the intended extension model.
- `plugin-implementation-plan.md` tracks the concrete refactor/implementation order for the first plugin architecture phases.
- `activity-plugin-contract.md` defines the minimal activity substrate and keeps rich workload schemas plugin-owned.
- `agent-harness-plugin-contract.md` defines how harness adapters plug into Exo's core terminal/session service.
- `plugin-surface-contract.md` defines safe plugin surface descriptors and core web viewer endpoint usage.
- `graph-visualization-plugin-contract.md` defines graph snapshot data and graph visualization metadata contracts.
- `open-source.md` tracks public release hygiene.
- `terminal-architecture-v4.md` is the current terminal simplification and extraction proposal.
- `terminal-runtime-decision.md` records the tmux-backed terminal runtime decision.
- `terminal-quality-standard.md` defines the latency, rendering, scrollback, persistence, and QA bar for terminal changes.
- `terminal-fallback-audit.md` explains which fallback/recovery paths are allowed, why they exist, and which ones still need hardening.
- `terminal-refactor-plan.md` is historical; keep it for migration context, not as the current implementation plan.
- `qmd-integration-plan.md` tracks the long-term QMD product integration.
- `qmd-integration-notes.md` tracks the current QMD adapter contract, workarounds, and upgrade checklist.

## HTML Architecture Artifacts

Checked-in static explainers under `docs/artifacts/`:

- `docs/artifacts/overall-exo-architecture.html` - visualizes desktop, CLI, MCP, resident runtime, Markdown graph, terminal runtime, plugin hosts, user files, and `.exo` runtime state.
- `docs/artifacts/core-plugin-boundary.html` - visualizes core substrate versus bundled/external plugins, including terminal core, harness adapters, QMD/search providers, routines/activity records, web viewer endpoints, and permission/trust boundaries.
- `docs/artifacts/terminal-runtime-v3.html` - visualizes tmux, Exo terminal runtime services, transcript store, xterm renderer ownership, hydration rules, CLI/MCP reads, and reconnect/recovery flows.

Do not put private local paths, personal task trackers, or machine-specific setup in committed docs. Keep those in local notes or untracked files.
