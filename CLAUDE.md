# Exo

Exo is a workspace-centric research IDE, not a single-vault editor.

## Read Order

1. `ledger.md`
2. `plan.md`
3. `docs/tasks.md`
4. `docs/roadmap.md`
5. `docs/resources.md`

## Dev Loop — Orchestrator Pattern

When working on Exo, Claude operates as an **orchestrator**:

1. **Keep the dev server running.** Start `pnpm dev` in the background. Restart it when source changes require it (build errors, HMR failures, etc).
2. **Kenneth reports bugs live.** He's using the app and will describe issues as they happen — visual bugs, crashes, broken interactions. Treat these as immediate priority.
3. **Spawn subagents for fixes.** When a bug comes in, spawn an agent (in a worktree if the fix is non-trivial) to investigate and fix it. Run multiple agents in parallel for independent bugs.
4. **Validate before applying.** Every fix must pass: typecheck, e2e tests, and ideally a quick visual check. The orchestrator verifies this before telling Kenneth it's ready.
5. **Restart the server after fixes land.** Once changes are applied, restart the dev server so Kenneth sees them immediately.

### Commands

- **Start server:** `pnpm dev` (background)
- **Typecheck:** `npx tsc --noEmit`
- **E2E tests:** `npx playwright test tests/e2e/shell.spec.ts`
- **Build:** `pnpm build`

### Key Architecture

- **Manual drag** (not HTML5 DnD) — `useDragManager` hook handles mousedown/mousemove/mouseup. HTML5 drag events don't fire in Electron with `titleBarStyle: "hiddenInset"`.
- **Recursive pane tree** — `usePaneTree` hook, `PaneTree` component. Any leaf can hold an editor or terminal. Splits are binary with configurable ratio.
- **CodeMirror 6** markdown editor with live preview decorations (`markdownLivePreview.ts`).

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

