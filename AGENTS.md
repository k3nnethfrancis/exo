# Exo Agent Map

Exo is a local-first agentic development environment built around a shared exocortex for humans and terminal agents. Treat this file as the concise map; use the linked docs for detail.

## Start Here

1. `README.md` - onboarding, current product surface, commands
2. `docs/README.md` - committed docs map
3. `docs/strategy.md` - product direction and system model
4. `ledger.md` - fastest current-state handoff
5. `docs/architecture.md` - runtime and package boundaries
6. `docs/harness.md` - gates, work chunks, agent workflow
7. `docs/tasks.md` - active execution tracker
8. `docs/qmd-integration-notes.md` - current QMD adapter contract and upgrade notes
9. `docs/roadmap.md` - future plans
10. `docs/plugins.md` - future extension model
11. `packages/mcp/README.md` - MCP setup and tool contract

## Repository Map

- `apps/desktop` - Electron main/preload/renderer, settings, terminal supervision, command server.
- `packages/core` - workspace model, notes/projects, runtime launch plans, shared command protocol, QMD adapter, integrations.
- `packages/cli` - `bin/exo` CLI.
- `packages/mcp` - stdio MCP server for local agents.
- `scripts` - launch/build helpers.
- `.github/workflows` - CI and macOS packaging workflows.

## Canonical Harness

Run the full local gate before handoff when the change is broad:

```bash
pnpm check
```

Focused gates:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm --filter @exo/desktop typecheck
pnpm --filter @exo/desktop test
pnpm --filter @exo/cli typecheck && pnpm --filter @exo/cli test
pnpm --filter @exo/core test
pnpm --filter @exo/mcp typecheck && pnpm --filter @exo/mcp test
pnpm test:e2e
```

CI runs `pnpm check` on macOS.

## Dev Loop

- Start Exo with `pnpm dev`.
- Install a repo-backed local CLI with `./scripts/install-local`.
- Use `pnpm --filter @exo/desktop dev -- --remote-debugging-port=9222` for renderer inspection.
- Restart Exo after touching Electron main, preload, native terminal handling, runtime config, package dependencies, or settings bootstrap.
- HMR is usually enough only for pure renderer changes.
- Inspect the real Electron renderer through CDP on port `9222`; `localhost:5173` lacks `window.exo`.

## Runtime Rules

- Renderer code must not touch filesystem or processes directly; use preload APIs backed by main-process services.
- CLI and MCP are peer clients of the local command server discovered through `${workspace_root}/.exo/server.json`.
- `packages/core/src/command-protocol.ts` owns shared command routes and payload shapes.
- Claude/Codex terminals are tmux-backed `exo-agent-*` sessions; close/kill through Exo must terminate the backing tmux session.
- Terminal live buffers are bounded; full transcripts live under `.exo/terminal-transcripts/` with retention.
- Terminal scroll must stay local to xterm and must not become Claude/Codex history input.

## Product Rules

- `workspace_root` is primary; `note_roots` and `project_roots` are explicit attachments.
- Markdown-on-disk is canonical; notebook mode is a projection.
- Project roots are imported folders, not every folder under workspace `projects/`.
- Live Explore typing stays fast filename/path search; optional indexed search is explicit and should not block the renderer.
- QMD is the active notes-index substrate behind Exo-managed lexical/semantic/hybrid search, CLI, and MCP tools.
- Keep QMD calls behind `packages/core/src/qmd.ts`; do not patch `node_modules` or fork QMD casually.
- Future provenance work should track human vs agent-authored changes by source, session, and task.
- Future project-root control should be exposed through CLI/MCP, not hidden renderer-only state.
- Optional or personal workflows should go through the plugin architecture rather than becoming core by default.
- CLI-first operator surfaces come before deep UI.
- Every fragile UI/runtime behavior needs an automated harness or a documented manual evidence path.

## Work Chunk Rules

- Keep changes small enough that a failed gate points to one cause.
- Update docs in the same chunk when public commands, architecture, settings, runtime behavior, or agent workflow changes.
- Record future work in `docs/tasks.md` or `docs/roadmap.md`; record shipped current state in `ledger.md`.
- Do not include local secrets, private paths as source defaults, transcripts, logs, or `.exo/` runtime files.
