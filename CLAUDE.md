# Exo

Exo is a workspace-centric research IDE, not a single-vault editor.

## Read Order

1. `ledger.md`
2. `plan.md`
3. `docs/tasks.md`
4. `docs/roadmap.md`
5. `docs/resources.md`

## Current Build Rule

Phase 1 is UI-first. Prioritize:
- workspace-root aware shell
- markdown notebook editor
- plain terminal panes
- deterministic Playwright interaction and screenshot coverage

Do not reintroduce higher-order runtime complexity before the shell is stable.

## Product Rules

- `workspace_root` is primary
- `note_roots` and `project_roots` are separate attachments
- markdown-on-disk stays canonical
- notebook mode is a projection
- terminals are plain by default
- `Claude` and `Codex` launch by running those commands in new terminals
- CLI-first operator surfaces come before MCP and before deep UI
- memory, workcells, datasets, and evals are separate system layers
- every fragile UI behavior needs an automated harness

## Validation Rule

UI work is not complete until:
- typecheck passes
- tests pass
- Playwright e2e passes
- screenshot baselines pass

