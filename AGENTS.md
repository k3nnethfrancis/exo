# Exo Agent Map

Exo is the local Markdown exocortex in the shared Ashby vision.

Shared north star: `../../notes/shoshin-codex/ashby.md`
Active execution ledger: `tasks.md`; historical refactor record: `docs/exograph-simplification-plan.md`

Exo owns the workspace, exograph, retrieval, mixed-pane canvas, configured Commands, invocation observation, and review. Guardian owns the separate Pi-compatible execution harness and Principal. Ash is a behavior/evaluation role, not an Exo runtime concept.

The `refactor/note-native-exo` branch is intentionally simplifying to Note Roots, Markdown, search, Connections, panes, direct terminals, configured Commands, and review. Do not restore retired architecture without an explicit product decision.

The note-native simplification, Folder Overview, inline invocation, derived-work
isolation, and isolated graph lab are now established substrate. Current graph
work must follow `docs/graph-system-report-and-plan.md`: consolidate the knowledge
model, prove optional profiles and utility on fixtures, then integrate the
spatial Graph View. Do not import the lab as a third semantics path or add a new
public contract without assignment and review.

## Start Here

1. `../../notes/shoshin-codex/ashby.md` - shared Exo + Guardian + Ash vision and role boundaries
2. `tasks.md` - active execution tracker
3. `CONTEXT.md` - canonical Exo product glossary
4. `docs/architecture.md` - shipped architecture and retained feature/data-model index
5. `docs/graph-system-report-and-plan.md` - graph evidence, knowledge model, quality framework, and production gates
6. `issues.md` - canonical bug, QA, and field-issue tracker
7. `README.md` - current product surface and commands
8. `roadmap.md` - future work only
9. `ledger.md` - shipped history and reusable substrate
10. `skills/terminal-stability/SKILL.md` - current direct-PTY invariants and QA rules
11. `docs/extension-architecture.md` - concrete-seam extension ladder
12. `docs/public-contract-reviews.md` - protected command-server, CLI, and shared-protocol review ledger
13. `docs/usability-readiness.md` - installed-app readiness gate and evidence requirements
14. `docs/exograph-simplification-plan.md` - historical refactor rationale and prior audits

Other dated plans are historical inventory until a separate deletion pass removes or distills them. They are not active instructions.

## Project Skills

Repo-owned Exo skills live in `skills/`. Treat this as the canonical project skill library. `.claude/skills` exposes the full folder for Claude contributors; `.codex/skills` exposes the active Codex subset so lead-orchestrator-only or intake-only skills do not become default Codex behavior.

Skill rule on `refactor/note-native-exo`: skills must describe the current Exo architecture, not transitional warnings around the old product regime. Do not create or use architecture skills for systems that are being removed or whose replacement architecture has not been designed yet.

Before contributing, scan `skills/`. For broad Exo development, load the relevant architecture/runtime skills first. For tightly scoped subagent work, load at least the matching skill before editing:

- `skills/submit-exo-issue/SKILL.md` - available for contributors and intake agents that file, promote, deduplicate, or assign Exo bug/QA/setup reports. The lead/orchestrator may follow the tracker convention directly without invoking this skill.
- `skills/terminal-stability/SKILL.md` - use before changing terminal runtime, rendering, settings, tests, or Command launch behavior.
- `skills/graph-system-stability/SKILL.md` - use before changing graph domain
  types, Knowledge Profiles, graph queries, utility evals, layout, scene,
  rendering, Graph Pane integration, or graph performance tests.
- `skills/deslopify-frontend/SKILL.md` - use before changing setup, settings, onboarding, future extension settings, or other configuration UI.

## Repository Map

- `apps/desktop` - Electron main/preload/renderer, settings, terminal supervision, command server.
- `packages/core` - workspace files/identity, graph/search, configured Commands, invocation records, and shared command protocol.
- `packages/cli` - `bin/exo` CLI.
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
pnpm test:e2e
```

CI runs `pnpm ci:check` on macOS. `pnpm check` remains the typecheck/test/build subset.

## Dev Loop

- Choose the launch mode by evidence needed:
  - `pnpm dev` is for active Electron/Vite development and fast main/renderer iteration.
  - `pnpm dev:qa` is source-build QA with isolated `.exo-dev/` runtime and user-data paths.
  - `pnpm app` is a source-built smoke test; it is not equivalent to packaged or installed Exo.
  - `pnpm pack:mac` followed by `open release/mac-arm64/Exo.app` is the required local packaged-app path for onboarding, first-run setup, app-support/user-data paths, packaged resources, native-module packaging, and terminal cwd defaults.
  - `pnpm dist:mac` is for unsigned DMG/ZIP release artifact validation.
- Use installed `Exo.app` as the stable daily runtime once the usability-readiness gate is complete.
- Use `pnpm dev:qa` for source-build QA while installed Exo remains available for notes, monitoring, and agent coordination.
- Use `pnpm dev` only when intentionally running source Exo as the primary runtime.
- Do not use `pnpm app` as evidence for installed-app or packaged-app behavior.
- Install a repo-backed local CLI with `./scripts/install-local`.
- Install the local packaged macOS app with `./scripts/install-mac-app`.
- Use `pnpm --filter @exo/desktop dev -- --remote-debugging-port=9222` for renderer inspection.
- Restart Exo after touching Electron main, preload, native terminal handling, runtime config, package dependencies, or settings bootstrap.
- HMR is usually enough only for pure renderer changes.
- Inspect the real Electron renderer through CDP on port `9222`; `localhost:5173` lacks `window.exo`.
- First-run workspace rules: missing or invalid workspace settings must lead to onboarding. Do not silently choose or persist a Note Root or default terminal cwd for the user. Validate those paths in a packaged app before marking startup/onboarding work complete.

## Runtime Rules

- Renderer code must not touch filesystem or processes directly; use preload APIs backed by main-process services.
- CLI is the active local integration surface; new architecture must not depend on an unreviewed integration runtime.
- `packages/core/src/command-protocol.ts` owns shared command routes and payload shapes.
- Terminal is direct `node-pty` behind one byte-faithful lifecycle. Do not add tmux transport, attach/restore, transcript, built-in harness, or provider-specific terminal branches.
- xterm owns the live screen and ordinary scrollback. React may keep bounded metadata and an in-memory replay tail for renderer reload, diagnostics, and CLI reads; it must not be the high-volume rendering source or imply durable history.
- Ordinary shell wheel/trackpad/selection stays in xterm. A full-screen mouse-mode TUI may own wheel input only with a visible indicator and documented modifier escape to local scrollback.
- App-process exit ends the PTY. Users may choose tmux or provider-native resume inside the shell; Exo does not own or promise process persistence.
- Command templates are data-only executable/arguments/cwd/environment/pointer policies. Claude, Codex, Pi, Guardian, and future tools all use the same Command and invocation path.
- Workspace filesystem changes should flow from `WorkspaceWatcherService` events. Do not add renderer polling loops for open-document freshness unless a watcher gap is proven and documented.

## Code Organization

- `apps/desktop/src/renderer/src/App.tsx` is the shell orchestrator. Keep bootstrap, top-level workspace composition, and cross-feature coordination there; move feature UI, state machines, and pure algorithms into named modules.
- Pure pane/tree algorithms belong in focused helper modules such as `paneTreeSelectors.ts` and `workspaceTree.ts`. They should not capture React state or call preload APIs.
- Renderer feature modules should have one obvious owner: a component for rendering, a hook for state/effects, and small pure helpers for deterministic transforms. Avoid mixing all three in one file.
- Main-process code should concentrate decisions in deep modules with small interfaces: `WorkspaceConfigStore`, `WorkspaceFiles`, `WorkspaceGraph`, `WorkspaceIndex`, terminal lifecycle, `InvocationRunner`, and `CommandServerLifecycle`. Do not grow `main/index.ts` with inline subsystems or preserve forwarding modules whose complexity disappears when deleted.
- Prefer extracting stable seams over moving churn. If a block changes often because the product is still being shaped, keep the boundary simple and name the ownership clearly before abstracting deeply.
- Inline comments should explain non-obvious runtime constraints, invariants, or race-prevention logic. Do not add comments that restate the code.

## Product Rules

- A Workspace contains explicit Note Roots. Note mutation, reading, search, preview, and workspace watching never accept arbitrary filesystem paths.
- Markdown-on-disk is canonical; notebook mode is a projection.
- Live Search typing stays fast; indexed search and provider degradation are explicit and must not block the renderer.
- Exo is the product. An exograph is the user-owned graph over Markdown notes, properties, links, tags, attachments, and accepted knowledge.
- Durable approved graph facts should live in user-owned Markdown/frontmatter/properties, links, tags, and files. Derived indexes, inferred facts, proposals, activity records, artifact references, and provenance references belong under `.exo/` until accepted.
- Exo may permissively consume Open Knowledge Format conventions—Markdown concepts, YAML frontmatter, normal links, optional `index.md`/`log.md`, and unknown-field preservation—but must not enforce a schema on arbitrary user Markdown.
- Folder Overview and index-aware Explorer presentation are shipped. A Folder
  may have a user-owned `index.md`; viewing remains read-only and only an
  explicit authoring action may create durable folder metadata.
- Folder paths provide primary structural homes and inherited guidance, not exclusive types. Explicit note properties override defaults; tags and typed relationships preserve multiple membership.
- Folder containment and inherited guidance are current graph facts. A future
  Skill may consume a Folder Index chain only through the normal reviewed
  invocation path.
- Exo should not impose one global schema or ontology. Users create ontologies through folders, Folder Indexes, properties, tags, links, and relationships; Exo detects, visualizes, searches, and helps maintain that user-owned structure.
- Knowledge Profiles are optional user-owned interpretations of open Concept
  types, Properties, Relations, and validation rules. Generic Markdown requires
  none; OKF 0.1 is the first planned interoperability profile. Profiles must
  preserve unknown user data and never become a second canonical database.
- Graph Views change layout and visual encoding, not knowledge. Renderer-local
  numeric kinds are performance projections and must not become ontology enums.
- Keep GraphRenderBench and GraphUtilityBench separate. Never present layout
  geometry, semantic similarity, or an unexplained aggregate as universal graph
  quality.
- Feed/event streams are deferred. Activity appears only when reviewed Invocation history earns it.
- Automation is not automatically core. Invocation records are the first activity record; Routine product work is a superseded/deletion-audit target.
- A configured Command is the V1 agent/tool identity: handle, label, executable/arguments, cwd policy, environment allowlist, pointer policy, and invocation metadata. `AgentCommand` is an internal type. Do not rebuild promptable harness identity.
- QMD and filesystem search are concrete adapters behind `WorkspaceIndex`; QMD is not a product boundary. Do not patch `node_modules` or fork QMD casually.
- Reintroduce an extension seam only when two concrete implementations earn it.
- Reserve **Plugin** for a future installable distribution bundle, closer to AI-platform packaging than in-process application extension. Skills author behavior, Commands execute external tools, Providers implement earned varying services, and a Plugin may later package proven combinations for installation/update/sharing.
- A future Plugin may contain declarative material or references to executable capabilities. Declarative packaging does not grant authority; external executables, hooks, native code, or providers require their own visible trust and lifecycle boundaries.
- Do not call an internal interface, registry, graph module, Search adapter, or one-off workflow a Plugin. Do not add plugin installation, manifests, marketplaces, dynamic renderer code, or permission UI until real packages need distribution and lower extension rungs have failed.
- Provenance distinguishes human, invocation, and unknown writers without claiming certainty the evidence cannot support.
- Commands may act in an explicitly confirmed cwd; that explicit command choice never grants Exo a second workspace filesystem surface.
- Root `issues.md` is the canonical Exo bug, QA, and field-report tracker. Do not create parallel Exo issue trackers under `docs/` or the notes vault.
- GraphUtilityBench is active graph-system work. Broader Workcells, training,
  and search-optimization harnesses remain deferred until the graph/read/
  invocation/review loop is stable.
- Optional or personal workflows should not become core by default.
- CLI-first operator surfaces come before deep UI.
- Every fragile UI/runtime behavior needs an automated harness or a documented manual evidence path.
- Architecture work is not complete until important rules are mechanical. Prefer structural checks with remediation messages over prose-only guidance for constraints agents repeatedly violate.
- User-visible changes should update `CHANGELOG.md` under `Unreleased` before push. The repo ships a non-blocking `pre-push` reminder hook in `scripts/git-hooks/`; enable it with `git config core.hooksPath scripts/git-hooks`.
- Expose user outcomes, not implementation toggles. Prefer one solid default over user-facing switches like transport modes, streaming modes, or provider-specific branches unless there is a clear workflow that needs the choice.
- Agent-facing configuration is provider-agnostic at the product layer. `AGENTS.md` and `CLAUDE.md` are compatibility outputs, not separate product concepts; do not add Claude-only or Codex-only repo guidance here.
- Settings surfaces should stay compact and task-oriented. When a control affects hidden files, runtime behavior, or indexing, label the outcome and provide just enough tooltip/help text to explain the consequence.

## Work Chunk Rules

- Keep changes small enough that a failed gate points to one cause.
- Update docs in the same chunk when public commands, architecture, settings, runtime behavior, or agent workflow changes.
- Public agent/operator contracts require lead-provided architect approval before shipping. Do not add or change command-server routes, CLI commands/flags, or shared command/protocol types without explicit approval in the task brief. If such a change is necessary, stop after diagnostic/design work and report the question, evidence, options, and recommendation to the lead/orchestrator.
- Record active bugs and QA findings in root `issues.md`; record future roadmap work in `tasks.md` or `roadmap.md`; record shipped current state in `ledger.md`.
- Do not include local secrets, private paths as source defaults, transcripts, logs, or `.exo/` runtime files.
- Preserve unrelated local edits. Before staging, inspect `git status` and include only files that belong to the current task.
- UI and terminal changes require app QA in the real Electron app, not only browser or unit tests. Use focused automated tests first, then manually exercise the affected workflow.
- Before changing terminal runtime, terminal rendering, terminal settings, terminal tests, or agent terminal launch behavior, use `skills/terminal-stability/SKILL.md` and follow its ownership rules, fallback discipline, invariants, checks, and manual QA script.
- Before changing graph domain types, snapshots, profile interpretation, graph
  queries, layout, scene, WebGPU/Canvas rendering, Graph Pane integration, or
  graph benchmarks, use `skills/graph-system-stability/SKILL.md` and identify
  which graph layer owns the change before editing.
- Before changing setup, settings, onboarding, future extension settings, or other configuration UI, use `skills/deslopify-frontend/SKILL.md` and keep screens dense, scannable, and low-prose.
- When filing or promoting Exo bugs, setup reports, UX issues, or GitHub issues, keep root `issues.md` canonical. Contributor/intake agents should use `skills/submit-exo-issue/SKILL.md`; the lead/orchestrator may apply the same convention directly.
- Exo uses an orchestrator-led coding pattern. Subagents execute scoped work, avoid broad architecture decisions, and report architectural or public-contract questions to the lead/orchestrator with evidence, options, and a recommendation. Subagents must not independently seek external architect/oracle review.
- Review tests for quality before accepting them: they should assert user-visible behavior or stable contracts, isolate live Exo state, fail for the intended regression, and avoid only snapshotting implementation details.
- Prefer extracting pure helpers or focused hooks over expanding `App.tsx` or `main/index.ts`. Keep IPC types in `@exo/core` when shared across CLI/desktop and avoid duplicate type definitions in preload-only files.
- For simplification work, preserve behavior first. Run targeted tests for the moved surface, then full `pnpm ci:check` before handoff. Report line-count movement separately from architecture improvement because extraction can increase net LOC while reducing cognitive load.
