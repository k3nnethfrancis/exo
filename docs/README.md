# Exo Docs

This directory contains committed, public-facing project context. It should be useful to human contributors and to coding agents working in the repo.

## Read Order

1. `../README.md` - product overview, setup, current capabilities
2. `../AGENTS.md` - concise map for coding agents
3. `../CHANGELOG.md` - release notes
4. `strategy.md` - product/system direction
5. `usability-readiness.md` - near-term standard for installed daily use
6. `tasks.md` - active priority backlog
7. `harness.md` - validation gates and agent-friendly development workflow
8. `architecture.md` - package boundaries and runtime contracts
9. `roadmap.md` - future product systems
10. `plugins.md` - plugin architecture direction
11. `plugin-implementation-plan.md` - phased implementation plan for capability registries, search providers, agent harnesses, Routines, artifacts, and tracing
12. `open-source.md` - release and platform support notes
13. `terminal-runtime-decision.md` - terminal runtime decision
14. `terminal-refactor-plan.md` - tmux-backed terminal refactor plan
15. `terminal-quality-standard.md` - terminal useability and QA standard
16. `qmd-integration-notes.md` - live QMD dependency boundary and upgrade checklist

## File Roles

- `architecture.md` explains how Exo is built today.
- `strategy.md` explains why the system exists and where it is going.
- `usability-readiness.md` defines the gate before installed Exo becomes the stable daily runtime.
- `roadmap.md` groups future product systems.
- `tasks.md` tracks the next concrete work.
- `harness.md` explains how changes should be validated.
- `plugins.md` tracks the intended extension model.
- `plugin-implementation-plan.md` tracks the concrete refactor/implementation order for the first plugin architecture phases.
- `open-source.md` tracks public release hygiene.
- `terminal-runtime-decision.md` records the tmux-backed terminal runtime decision.
- `terminal-refactor-plan.md` breaks the terminal runtime refactor into implementation phases.
- `terminal-quality-standard.md` defines the latency, rendering, scrollback, persistence, and QA bar for terminal changes.
- `qmd-integration-plan.md` tracks the long-term QMD product integration.
- `qmd-integration-notes.md` tracks the current QMD adapter contract, workarounds, and upgrade checklist.

Do not put private local paths, personal task trackers, or machine-specific setup in committed docs. Keep those in local notes or untracked files.
