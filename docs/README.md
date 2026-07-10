# Exo Docs

This directory contains committed, public-facing project context. It should be useful to human contributors and to coding agents working in the repo.

## Canonical Current Docs

- `../README.md` - product overview, setup, commands, build/install caveats, and repository map.
- `../AGENTS.md` - concise coding-agent map and runtime rules.
- `../issues.md` - canonical active bug, QA, and field-issue tracker.
- `../tasks.md` - active execution tracker.
- `../roadmap.md` - future product systems and sequencing.
- `feature-ideas.md` - parked product ideas that are not yet active implementation plans.
- `../exo-themes-plan.md` - active planning note for named theme work.
- `strategy.md` - product direction and system model.
- `architecture.md` - current package, runtime, terminal, CLI, pane, search, and extension boundaries.
- `exograph-completion-orchestration-plan.md` - high-level completion plan, delegation map, and Fable review protocol for the Exograph branch.
- `exograph-detailed-implementation-plans.md` - delegated detailed plans for deletion/contracts, graph, CLI/search, AgentCommand, direct-write review, and QA.
- `exograph-refactor-completion-plan.md` - canonical implementation plan for the Exograph pivot.
- `extension-architecture.md` - current core-versus-extension architecture for the Exograph pivot.
- `plugin-system-architecture.md` - historical plugin-platform target architecture, superseded by `extension-architecture.md`.
- `plugin-architecture-audit.md` - historical plugin decision/fallback audit and hardening policy.
- `public-contract-reviews.md` - SHA-256 review-note ledger for guarded command-server, CLI, and shared protocol surfaces.
- `profile-plugin-management-plan.md` - historical plan for the previous profile/plugin management regime.
- `onboarding-settings-boundaries.md` - current product ownership map for onboarding, Settings, Agent Context, profiles, and deferred extension/plugin concepts.
- `activity-plugin-contract.md` - minimal activity/artifact/provenance/review substrate boundary for plugin workloads.
- `agent-harness-plugin-contract.md` - harness adapter contract for Claude, Codex, Pi-compatible, and future local/open-source agents.
- `plugin-surface-contract.md` - safe plugin surface and core web viewer endpoint contribution contract.
- `graph-visualization-plugin-contract.md` - core graph snapshot and future graph visualization plugin contract.
- `terminal-architecture-v4.md` - current terminal architecture and module-boundary target.
- `terminal-runtime-decision.md` - current tmux-backed terminal runtime decision and constraints.
- `terminal-quality-standard.md` - terminal useability, configuration, and QA standard.
- `terminal-fallback-audit.md` - current terminal fallback/recovery decisions, steelman objections, and hardening backlog.
- `harness.md` - validation gates and agent-friendly development workflow.
- `github-issue-fix-loop.md` - scheduled Codex loop rules for turning labeled GitHub issues into tested draft PRs.
- `qmd-integration-notes.md` - live QMD adapter contract and upgrade checklist.

## Historical And Reference Docs

These remain in place for traceability but should not be treated as the latest architecture source:

- `terminal-refactor-plan.md` - historical tmux migration plan; superseded for current design work by `terminal-architecture-v4.md`, `terminal-runtime-decision.md`, and `terminal-quality-standard.md`.
- `qmd-integration-plan.md` - longer-term QMD product plan; live adapter details are in `qmd-integration-notes.md`.
- `staff-code-review-2026-05-27.md` - dated code review; terminal guidance inside it has been superseded.
- `mcp-nde-test-2026-06-20.md` - dated MCP non-destructive QA audit.

## Read Order

1. `../README.md` - product overview, setup, current capabilities
2. `../AGENTS.md` - concise map for coding agents
3. `../issues.md` - active bug, QA, and field-issue tracker
4. `../CHANGELOG.md` - release notes
5. `strategy.md` - product/system direction
6. `usability-readiness.md` - near-term standard for installed daily use
7. `../tasks.md` - active priority backlog
8. `harness.md` - validation gates and agent-friendly development workflow
9. `github-issue-fix-loop.md` - scheduled Codex issue-to-PR loop rules
10. `architecture.md` - package boundaries and runtime contracts
11. `../roadmap.md` - future product systems
12. `feature-ideas.md` - parked product ideas and graduation criteria
13. `exograph-completion-orchestration-plan.md` - high-level completion and delegation plan
14. `exograph-detailed-implementation-plans.md` - delegated detailed implementation plans
15. `exograph-refactor-completion-plan.md` - canonical Exograph implementation plan
16. `extension-architecture.md` - current core-versus-extension architecture
17. `plugin-system-architecture.md` - historical plugin-platform target architecture
18. `plugin-architecture-audit.md` - historical plugin decision/fallback audit and hardening policy
19. `public-contract-reviews.md` - public contract guard ledger for command-server, CLI, and shared protocol surfaces
20. `profile-plugin-management-plan.md` - historical product and implementation plan for profile/plugin management UX
22. `onboarding-settings-boundaries.md` - current IA boundary for first-run setup versus ongoing management
23. `plugins.md` - historical plugin architecture direction
24. `plugin-implementation-plan.md` - historical phased implementation plan for capability registries, search providers, agent harnesses, activity substrate, plugin manifests, and future permissioned loading
25. `activity-plugin-contract.md` - historical activity/artifact/provenance/review substrate contract
26. `agent-harness-plugin-contract.md` - historical harness adapter contract
27. `plugin-surface-contract.md` - safe plugin surface and web viewer endpoint contract
28. `graph-visualization-plugin-contract.md` - graph visualization plugin contract
29. `open-source.md` - release and platform support notes
30. `terminal-architecture-v4.md` - current terminal architecture and module-boundary target
31. `terminal-runtime-decision.md` - terminal runtime decision
32. `terminal-quality-standard.md` - terminal useability and QA standard
33. `terminal-fallback-audit.md` - terminal fallback/recovery policy and current decisions
34. `terminal-refactor-plan.md` - historical tmux migration plan
35. `qmd-integration-notes.md` - live QMD dependency boundary and upgrade checklist

## File Roles

- `architecture.md` explains how Exo is built today.
- `strategy.md` explains why the system exists and where it is going.
- `usability-readiness.md` defines the gate before installed Exo becomes the stable daily runtime.
- `../roadmap.md` groups future product systems.
- `../issues.md` tracks active bugs, QA findings, and field reports with `EXO-ISSUE-*` ids.
- `../tasks.md` tracks the next concrete work.
- `feature-ideas.md` captures future ideas before they are ready for active sequencing.
- `harness.md` explains how changes should be validated.
- `github-issue-fix-loop.md` defines the conservative scheduled GitHub issue-to-draft-PR loop.
- `exograph-completion-orchestration-plan.md` defines the completion sequence, delegated planning work, and Fable review protocol for this branch.
- `exograph-detailed-implementation-plans.md` records the delegated slice plans and consolidated Fable decision set.
- `exograph-refactor-completion-plan.md` defines the canonical implementation sequence for the Exograph pivot.
- `extension-architecture.md` defines the current Exograph extension ladder and core-versus-extension boundary.
- `plugin-system-architecture.md` records the superseded plugin-platform target architecture for inventory/history.
- `plugin-architecture-audit.md` records historical plugin fallback decisions, rejected shortcuts, and hardening rules.
- `public-contract-reviews.md` records the review-note hashes that `pnpm check:repo` requires before protected public contract files can change.
- `profile-plugin-management-plan.md` records the superseded profile/plugin management plan for reuse inventory.
- `onboarding-settings-boundaries.md` defines which concepts belong to onboarding, Settings, Agent Context, profiles, and deferred extension/plugin surfaces.
- `plugins.md` tracks the historical plugin model superseded by the extension ladder.
- `plugin-implementation-plan.md` tracks the historical refactor/implementation order for the first plugin architecture phases.
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

- `docs/artifacts/overall-exo-architecture.html` - historical architecture explainer for desktop, CLI, MCP, resident runtime, Markdown graph, terminal runtime, plugin hosts, user files, and `.exo` runtime state.
- `docs/artifacts/core-plugin-boundary.html` - visualizes core substrate versus bundled/external plugins, including terminal core, harness adapters, QMD/search providers, routines/activity records, web viewer endpoints, and permission/trust boundaries.
- `docs/artifacts/terminal-runtime-v3.html` - historical terminal explainer including old CLI/MCP reads and reconnect/recovery flows.

Do not put private local paths, personal task trackers, or machine-specific setup in committed docs. Keep those in local notes or untracked files.
