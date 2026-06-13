# Exo Agent Map

Exo is a local-first exograph workspace for humans and terminal agents. Treat this file as the concise map; use the linked docs for detail.

The immediate product proving loop is Exo-on-Exo: finish usability/harness readiness, install Exo as the stable resident app, use Exo-managed agents to build and QA Exo, then treat friction in that workflow as product signal.

## Start Here

1. `README.md` - onboarding, current product surface, commands
2. `docs/README.md` - committed docs map
3. `docs/strategy.md` - product direction and system model
4. `ledger.md` - fastest current-state handoff
5. `docs/architecture.md` - runtime and package boundaries
6. `docs/harness.md` - gates, work chunks, agent workflow
7. `docs/tasks.md` - active execution tracker
8. `docs/usability-readiness.md` - near-term standard before installed daily use
9. `docs/terminal-runtime-decision.md` - terminal runtime decision
10. `docs/terminal-refactor-plan.md` - tmux-backed terminal refactor plan
11. `docs/terminal-quality-standard.md` - terminal useability and QA standard
12. `docs/qmd-integration-notes.md` - current QMD adapter contract and upgrade notes
13. `docs/roadmap.md` - future plans
14. `docs/plugins.md` - future extension model
15. `packages/mcp/README.md` - MCP setup and tool contract

## Repository Map

- `apps/desktop` - Electron main/preload/renderer, settings, terminal supervision, command server.
- `packages/core` - workspace model, notes/projects, runtime launch plans, shared command protocol, QMD adapter, integrations.
- `packages/cli` - `bin/exo` CLI.
- `packages/mcp` - MCP server for local agents; stdio by default, Streamable HTTP when explicitly requested.
- `scripts` - launch/build helpers.
- `.github/workflows` - CI and macOS packaging workflows.
- `CLAUDE.md` is a compatibility symlink to `AGENTS.md`; do not add Claude-only repo instructions.

## Canonical Harness

Run the full local gate before handoff when the change is broad:

```bash
pnpm ci:check
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

CI runs `pnpm ci:check` on macOS. `pnpm check` remains the typecheck/test/build subset.

## Dev Loop

- Use installed `Exo.app` as the stable daily runtime once the usability-readiness gate is complete.
- Use `pnpm dev:qa` for source-build QA while installed Exo remains available for notes, monitoring, and agent coordination.
- Use `pnpm dev` only when intentionally running source Exo as the primary runtime.
- Install a repo-backed local CLI with `./scripts/install-local`.
- Install the local packaged macOS app with `./scripts/install-mac-app`.
- Use `pnpm --filter @exo/desktop dev -- --remote-debugging-port=9222` for renderer inspection.
- Restart Exo after touching Electron main, preload, native terminal handling, runtime config, package dependencies, or settings bootstrap.
- HMR is usually enough only for pure renderer changes.
- Inspect the real Electron renderer through CDP on port `9222`; `localhost:5173` lacks `window.exo`.

## Runtime Rules

- Renderer code must not touch filesystem or processes directly; use preload APIs backed by main-process services.
- CLI and MCP are peer clients of the local command server discovered through `${workspace_root}/.exo/server.json`.
- `packages/core/src/command-protocol.ts` owns shared command routes and payload shapes.
- Shell, Claude, and Codex terminals use tmux-backed core sessions with `node-pty` as the live attach bridge. Follow `docs/terminal-runtime-decision.md`, `docs/terminal-refactor-plan.md`, and `docs/terminal-quality-standard.md`; do not add hidden direct-pty/tmux fallbacks or user-facing transport switches.
- Terminal output must stream into xterm imperatively. React state may keep bounded metadata/tail state for restore, tabs, diagnostics, and tests, but must not be the live rendering source for high-volume terminal output.
- Terminal live scrollback is user-facing configuration. Avoid hidden hard caps or internal truncation that users cannot discover or change; if a guard is necessary, expose the behavior in settings/docs and keep durable transcripts independent.
- Full transcripts live under `.exo/terminal-transcripts/` with retention.
- Terminal scroll must stay local to xterm and must not become Claude/Codex history input.
- Workspace filesystem changes should flow from `WorkspaceWatcherService` events. Do not add renderer polling loops for open-document freshness unless a watcher gap is proven and documented.

## Code Organization

- `apps/desktop/src/renderer/src/App.tsx` is the shell orchestrator. Keep bootstrap, top-level workspace composition, and cross-feature coordination there; move feature UI, state machines, and pure algorithms into named modules.
- Pure pane/tree algorithms belong in focused helper modules such as `paneTreeSelectors.ts` and `workspaceTree.ts`. They should not capture React state or call preload APIs.
- Renderer feature modules should have one obvious owner: a component for rendering, a hook for state/effects, and small pure helpers for deterministic transforms. Avoid mixing all three in one file.
- Main-process code should follow the same boundary: command-server routing, terminal management, settings storage, indexing, and filesystem mutation should remain separate services. Do not grow `main/index.ts` with new inline subsystems.
- Prefer extracting stable seams over moving churn. If a block changes often because the product is still being shaped, keep the boundary simple and name the ownership clearly before abstracting deeply.
- Inline comments should explain non-obvious runtime constraints, invariants, or race-prevention logic. Do not add comments that restate the code.

## Product Rules

- `workspace_root` is primary; `note_roots` and `project_roots` are explicit attachments.
- Markdown-on-disk is canonical; notebook mode is a projection.
- Project roots are imported folders, not every folder under workspace `projects/`.
- Live Explore typing stays fast filename/path search; optional indexed search is explicit and should not block the renderer.
- Exo's core object is the exograph: a user-defined graph over notes, projects, agents, sessions, files, artifacts, and workflow runs with growable relational ontologies.
- Durable approved graph facts should live in user-owned Markdown/frontmatter/properties, links, tags, and files. Derived indexes, inferred facts, proposals, workflow runs, and provenance belong under `.exo/` until accepted.
- Exo should not impose one vault schema. It may detect, recommend, and maintain structures such as Shoshin or LM Wiki profiles, but users own the schema.
- QMD is the default notes-index/search provider behind Exo-managed lexical/semantic/hybrid search, CLI, and MCP tools, not the permanent product boundary.
- Keep QMD calls behind `packages/core/src/qmd.ts`; do not patch `node_modules` or fork QMD casually.
- Future provenance work should track human vs agent-authored changes by source, session, and task.
- Project-root mutation belongs in UI/CLI operator surfaces; MCP may inspect attached roots through workspace status but should stay a narrow agent work plane.
- Workcells/evals/training/search-optimization harnesses should probably be plugin sets unless they become necessary for the default Exo-on-Exo loop.
- Optional or personal workflows should go through the plugin architecture rather than becoming core by default.
- CLI-first operator surfaces come before deep UI.
- Every fragile UI/runtime behavior needs an automated harness or a documented manual evidence path.
- Harness engineering is not complete until important architecture rules are mechanical. Prefer lint/structural checks with remediation messages over prose-only guidance for constraints agents repeatedly violate.
- Expose user outcomes, not implementation toggles. Prefer one solid default over user-facing switches like transport modes, streaming modes, or provider-specific branches unless there is a clear workflow that needs the choice.
- Agent-facing configuration is provider-agnostic at the product layer. `AGENTS.md` and `CLAUDE.md` are compatibility outputs, not separate product concepts; do not add Claude-only or Codex-only repo guidance here.
- Settings surfaces should stay compact and task-oriented. When a control affects hidden files, runtime behavior, or indexing, label the outcome and provide just enough tooltip/help text to explain the consequence.

## Work Chunk Rules

- Keep changes small enough that a failed gate points to one cause.
- Update docs in the same chunk when public commands, architecture, settings, runtime behavior, or agent workflow changes.
- Record future work in `docs/tasks.md` or `docs/roadmap.md`; record shipped current state in `ledger.md`.
- Do not include local secrets, private paths as source defaults, transcripts, logs, or `.exo/` runtime files.
- Preserve unrelated local edits. Before staging, inspect `git status` and include only files that belong to the current task.
- UI and terminal changes require app QA in the real Electron app, not only browser or unit tests. Use focused automated tests first, then manually exercise the affected workflow.
- Review tests for quality before accepting them: they should assert user-visible behavior or stable contracts, isolate live Exo state, fail for the intended regression, and avoid only snapshotting implementation details.
- Prefer extracting pure helpers or focused hooks over expanding `App.tsx` or `main/index.ts`. Keep IPC types in `@exo/core` when shared across CLI/MCP/desktop and avoid duplicate type definitions in preload-only files.
- For simplification work, preserve behavior first. Run targeted tests for the moved surface, then full `pnpm ci:check` before handoff. Report line-count movement separately from architecture improvement because extraction can increase net LOC while reducing cognitive load.
