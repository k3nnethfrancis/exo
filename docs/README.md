# Exo Docs

This directory contains committed, public-facing project context. It should be useful to human contributors and to coding agents working in the repo.

## Read Order

1. `../README.md` - product overview, setup, current capabilities
2. `../AGENTS.md` - concise map for coding agents
3. `strategy.md` - product/system direction
4. `usability-readiness.md` - near-term standard for installed daily use
5. `tasks.md` - active priority backlog
6. `harness.md` - validation gates and agent-friendly development workflow
7. `architecture.md` - package boundaries and runtime contracts
8. `roadmap.md` - future product systems
9. `plugins.md` - plugin architecture direction
10. `open-source.md` - release and platform support notes
11. `terminal-runtime-decision.md` - pty/tmux decision and revisit criteria
12. `qmd-integration-notes.md` - live QMD dependency boundary and upgrade checklist

## File Roles

- `architecture.md` explains how Exo is built today.
- `strategy.md` explains why the system exists and where it is going.
- `usability-readiness.md` defines the gate before installed Exo becomes the stable daily runtime.
- `roadmap.md` groups future product systems.
- `tasks.md` tracks the next concrete work.
- `harness.md` explains how changes should be validated.
- `plugins.md` tracks the intended extension model.
- `open-source.md` tracks public release hygiene.
- `terminal-runtime-decision.md` records the direct pty terminal decision and what would justify revisiting tmux.
- `qmd-integration-plan.md` tracks the long-term QMD product integration.
- `qmd-integration-notes.md` tracks the current QMD adapter contract, workarounds, and upgrade checklist.

Do not put private local paths, personal task trackers, or machine-specific setup in committed docs. Keep those in local notes or untracked files.
