# Exograph Refactor Completion Plan

Last updated: 2026-07-09

status: Fable-reviewed plan. Fable cleared the Exograph pivot on 2026-07-08 and reviewed the terminal/harness reset on 2026-07-09.

This is the execution plan for the `refactor/note-native-exo` branch.

## Goal

Refactor Exo into **Exograph**:

> Build your local exocortex from Markdown.

Exograph remains a local-first Markdown exocortex with graph semantics, CLI, custom search/indexing providers, terminals, split panes, web viewers, and LM wiki management tools.

The refactor removes the overbuilt agent-cockpit direction. Agents become configured commands that the graph can call from Markdown. Exograph records what changed.

## Completion Definition

This branch is complete when:

1. The active docs, roadmap, tasks, and agent instructions describe Exograph, not the old plugin/routine/harness product.
2. Old MCP, routine, deep harness-manager, profile-apply, skill-install, and plugin-manager product paths are removed after caller audit.
3. The graph read path exists: link extraction, backlinks, graph properties, and a basic graph/neighborhood viewer.
4. CLI search/read/status is reliable enough to serve as the local integration surface.
5. Custom search/indexing provider seams remain real and test-covered.
6. Agent commands can be configured.
7. A strict Markdown mention can launch a configured command in a plain terminal with a pointer prompt.
8. Invocation records are persisted under `.exo/invocations/`.
9. File changes during an invocation are detected, diffed, and attributed as `likely` or `ambiguous`.
10. Open notes refresh safely without clobbering dirty editor buffers.
11. The UI can toggle a diff/attribution view for invocation changes.
12. Terminal input uses a direct pty path under xterm; Exo no longer owns tmux durability, restore snapshots, or terminal transcripts as V1 product requirements.
13. Built-in harness registry/readiness/product setup is removed; configured `AgentCommand` handles are the only V1 agent launch identity.
14. Tests and app QA cover the graph path, command invocation path, direct-pty terminal input, and direct-write review path.

## Companion Docs

- `docs/pivot-product-definition.md`
- `docs/extension-architecture.md`
- `docs/pivot-subsystem-disposition.md`
- `docs/note-native-agent-invocation-pivot.md`
- `docs/agent-identity-reconciliation.md`
- `docs/invocation-context-and-safety.md`
- `docs/invocation-concurrency-and-attribution.md`
- `docs/agent-output-conventions.md`
- `docs/pivot-roadmap-rewrite-notes.md`

## Phase 0: Plan, Supersede, And Stop The Old Product

### Objective

Prevent agents and humans from continuing to build the plugin/routine/harness roadmap while this branch moves to Exograph.

### Work

- Rewrite `roadmap.md` around Exograph:
  - Markdown exocortex;
  - graph read path;
  - CLI and custom search providers;
  - note-native agent commands;
  - diff/attribution review.
- Rewrite top of `tasks.md` around the new sequence.
- Update `README.md` product copy enough that the repo no longer pitches agent cockpit/platform scope.
- Update `AGENTS.md` and `CLAUDE.md` instructions so implementation agents stop prioritizing plugin/routine/harness expansion.
- Mark old plugin/routine/harness docs as superseded at the top.
- Add a root issue/task note for the heavy deletion audit.

### Acceptance

- No active top-level task says Plugin Architecture Completion, Routine POC, or MCP agent lifecycle is the current ship path.
- Agent instructions point workers at this completion plan.
- Old docs remain available as history, but they no longer look current.

### Ordering Rule

WP0 lands first, sequentially, before implementation fan-out. It updates `AGENTS.md` and `CLAUDE.md`, which every other worker reads. Do not start code workers from the old instruction map.

## Phase 0.5: Prototype Evidence

### Objective

Close the main unknowns before implementation: prompt delivery, mention false positives, and concurrent direct-write behavior.

### Work

- Run 10 real pointer-prompt invocations against representative notes.
- Count likely false positives for strict mention syntax in the vault.
- Run one concurrent-edit case: user edit plus agent direct write.
- Decide prompt delivery:
  - `stdin`;
  - `argv`;
  - terminal input after launch.
- Record findings in a short artifact under `docs/` or `issues.md`.

### Evidence Result

Recorded in `docs/note-native-invocation-prototype-evidence.md`.

V1 decisions:

- Mention syntax is editor-owned, user-confirmed, normal paragraph line start, configured handle only:
  - `^ {0,3}@(?<handle>[a-z][a-z0-9_-]{1,31})\s+(?<message>\S.*)$`
  - validate `handle` against configured `AgentCommand.handle`;
  - ignore fenced code blocks, inline code, frontmatter, and rendered HTML/style blocks;
  - no watcher-owned auto-run in V1.
- Prompt delivery is `terminalInputAfterLaunch` for terminal/tmux-launched configured commands.
- Keep `stdin` and `argv` as future explicit noninteractive modes only if the command template asks for them; do not auto-detect prompt delivery in V1.
- Concurrent user edit plus agent direct write is `ambiguous`, not `likely`.

Gap:

- The 10 real pointer-prompt invocations were not run in the prototype pass. They remain a dogfooding/QA task before broad use, but the fake-command evidence is sufficient to start WP5a core data model/settings work.

### Acceptance

- The `AgentCommand` prompt-delivery field is no longer open-ended.
- Strict mention syntax has evidence behind it.
- Dirty-buffer/concurrent-edit behavior is confirmed or the implementation plan is adjusted.

## Phase 1: Heavy-Handed Deletion

### Objective

Make the branch dogfood the new product shape by removing old product surfaces early.

### Remove After Caller Audit

- MCP as active product surface:
  - MCP agent lifecycle tools;
  - MCP setup/install docs and UI affordances;
  - MCP-first roadmap language.
- MCP public-contract cleanup:
  - update `scripts/check-repo.mjs` public-contract surfaces;
  - update required-file checks if `packages/mcp/README.md` or package paths are removed;
  - update `docs/public-contract-reviews.md` with this Fable-reviewed removal decision.
- MCP installed-machine cleanup:
  - remove or replace `packages/core/src/integrations.ts` install paths that register `packages/mcp/bin/exo-mcp.mjs`;
  - document deregistration for already-installed Claude/Codex MCP configs before deleting the package.
- Routine product:
  - routine UI;
  - routine CLI commands and their tests when the product surface is removed;
  - routine templates and graph-health routine product copy.
- Deep harness manager:
  - readiness/send queue expansion paths;
  - user-facing promptable harness selectors;
  - harness skill inventory setup surfaces.
- Profile apply product:
  - profile apply expansion;
  - profile template writes as onboarding/setup path.
- Plugin Manager as setup spine:
  - plugin review onboarding steps;
  - plugin/routine/profile setup copy that no longer fits.

### Keep Or Reuse

- Plain terminal UI: xterm, split panes, terminal rail/container, resize/focus behavior, and command-server/CLI terminal plumbing that still has a V1 caller.
- Bounded in-memory terminal tails only where needed for visible tabs, CLI reads, or diagnostics during a live app session.
- Command server if CLI/app runtime needs it.
- Existing search provider code.
- Existing changed-file/diff rendering code.
- Proposal/review diff components if reusable read-only.
- Plugin registry internals only where they support search providers or current app boot.

### Terminal/Harness Reset Amendment

2026-07-09 Fable review supersedes the earlier terminal-retention assumption in this plan and in `docs/pivot-subsystem-disposition.md`.

- Delete tmux control-mode as Exo's owned terminal substrate.
- Replace it with direct pty writes under xterm so terminal input bytes, including spaces, paste, Enter, and control keys, pass through without Exo re-encoding them as tmux commands.
- Do not keep terminal session restore, transcript persistence, tmux geometry convergence, or harness readiness queues as V1 product requirements.
- Users who want tmux durability can run tmux inside a plain Exo terminal; Claude/Codex session resume and hook/trace files are the durable agent-memory path.
- Delete the built-in harness registry/readiness architecture rather than renaming it to `AgentCommand`.
- Seed or document default `AgentCommand` templates for Claude/Codex/Fable-style launch, but make the user's configured command the durable interface.
- Update terminal docs and skills before fanning out terminal work; the old tmux-durable instructions are stale and actively misleading for this branch.

2026-07-09 implementation note:

- Desktop terminal creation now uses direct `node-pty`; Exo no longer owns tmux restore, recovery, transcript persistence, or harness readiness queues in the app terminal path.
- The terminal rail launches shell only. Note-native invocation and `exo spawn @handle <task>` use configured `AgentCommand`.
- Harness product surfaces were removed from Workspace Settings, renderer rail detection, workspace IPC/preload, onboarding choices, and built-in capability inventory.
- Remaining legacy harness code is isolated to the old CLI/runtime launch-plan path (`exo launch`, runtime launch-plan/context, and tests). Treat that as deletion debt, not a current architecture to extend.

### Acceptance

- App no longer contains MCP/routines/plugins/harness setup as primary product flow.
- CLI still works for workspace/search/read/status and whatever app runtime commands remain.
- Tests prove removed routes/surfaces are either gone intentionally or covered by migration copy.
- Command-server routes that survive are explicitly named because CLI or app runtime still consumes them.

## Phase 2: Graph Read Path

### Objective

Make "Exograph" true before agents become the headline feature.

### Build

- Audit and extend existing core graph snapshot code:
  - `packages/core/src/graph.ts`;
  - `packages/core/src/graph-snapshot.ts`.
- Graph facts:
  - Markdown links;
  - wikilinks;
  - tags;
  - frontmatter/properties;
  - headings where useful.
- Backlink index and query function.
- Graph properties read/edit surface for a note.
- Backlinks panel in the editor/workspace.
- Basic graph/neighborhood viewer.
- CLI commands for graph/read/search status where appropriate.

### Reuse

- Existing note parsing/search/index services.
- Existing QMD/provider status where useful.
- Existing pane/web viewer surfaces for graph viewer if faster than a new surface.

### Coupling To Watch

The existing graph module imports capability/plugin metadata types. WP1 must either preserve the minimal types needed by graph/search providers or decouple graph code before deleting plugin registry internals.

### Existing Graph Assets

The graph path should reuse and consolidate existing code rather than rebuild:

- `packages/core/src/graph-snapshot.ts` already builds deterministic graph snapshots from note roots, Markdown links, wikilinks, tags, frontmatter, unresolved links, and external links.
- `packages/core/src/graph.ts` already defines `GraphSnapshot`, `GraphNode`, `GraphEdge`, `GraphBacklink`, and `deriveGraphBacklinks`.
- `packages/core/src/notes.ts` has older `NoteKnowledge` helpers; the refactor should avoid keeping two competing graph models long-term.
- `apps/desktop/src/renderer/src/components/InspectorDock.tsx`, `NoteEditor.tsx`, `markdownLivePreview.ts`, and `graphAffordances.ts` already render note knowledge/backlinks/properties in some form.

Main graph gap: desktop/editor surfaces still use `NoteKnowledge`; they should move toward snapshot-derived note graph context.

### Acceptance

- A note shows outgoing links, backlinks, and properties.
- A graph/neighborhood view can open for the active note.
- CLI can inspect graph/search status.
- Graph extraction is deterministic in tests.

## Phase 3: CLI And Search Provider Hardening

### Objective

Make CLI the durable local interface and keep custom search/indexing providers real.

### Build

- Provider-neutral search contract cleanup if needed.
- QMD as one provider behind that contract.
- Core fallback provider that works when QMD is unavailable.
- CLI status that clearly distinguishes:
  - app/runtime state;
  - search provider state;
  - index health;
  - degraded fallback mode.
- CLI read/search commands that are useful for local agents invoked from the graph.

### Future Note Result Hydration

Do not let custom search providers own Exograph semantics.

Longer term, search/read should hydrate provider results into a provider-neutral note result shape:

- note identity, path, title, and durable Markdown source;
- frontmatter, graph properties, tags, outgoing links, backlinks, and neighborhood summary from Exo's graph layer;
- provider-specific relevance, snippets, chunks, scores, and index status;
- enough graph metadata for agents to decide what to read or search next.

In this branch, keep the split simple: graph queries own note metadata and relationships; search providers own relevance and snippets/chunks. A later hydration layer can join them into one agent-facing result without making custom providers implement Exograph ontology.

### Acceptance

- Search works in fallback mode.
- CLI search/read/status works without MCP.
- Degraded QMD is visible and actionable.
- Tests cover provider fallback.

## Phase 4: Agent Commands

### Objective

Replace promptable harness identity with user-owned command identity.

`AgentCommand` is the shared primitive for two invocation contexts:

- note invocation: a Markdown note tags a configured handle and Exo sends a document pointer prompt;
- CLI spawn: `exo spawn @handle ...` starts the configured command from its configured root/context and sends a task prompt.

Both paths should create invocation records, stream to a monitorable terminal/session, and avoid provider-specific harness integration.

### Phase 4a: Core Agent Command Model

- `AgentCommand` core type:
  - id;
  - label;
  - handle;
  - command;
  - cwd policy;
  - prompt delivery;
  - trusted command hash/state;
  - version.
- Workspace settings storage for agent commands.
- Workspace trust state stored outside the workspace and invalidated when executable command fields change.
- If V1 `AgentCommand` has no env/template fields, state that explicitly in the type/docs. If env/template fields are added, they must be included in the executable fingerprint and trust invalidation.
- One hand-edited or minimally surfaced default command, likely `@claude`.
- `InvocationRecord` core type if doing so unblocks WP6.
- Invocation store under `.exo/invocations/{id}/record.json`.

### Phase 4b: Agent Config Surface

- Agent Config reframed as:
  - instruction files;
  - Exograph context;
  - agent commands.
- Command template docs, not deep harness adapters.

### Phase 4c: CLI AgentCommand Spawn

- `exo spawn @handle "<task>"` launches a configured `AgentCommand`.
- The command definition owns:
  - default cwd/root policy;
  - prompt delivery mode;
  - command template;
  - optional context template for CLI-spawned tasks.
- CLI spawn prompt context differs from note invocation:
  - no tagged document by default;
  - task prompt comes from CLI args/stdin;
  - cwd/root context comes from the command config and CLI overrides;
  - output is visible as a terminal/session and persisted as an invocation record.
- This replaces the need to run Fable or other local agents out-of-band with raw shell commands when Exo can provide the session, transcript, and monitor view.
- Spawn must reject untrusted or changed command definitions until the user re-trusts the executable command fields.

### Acceptance

- One configured command can be loaded from settings.
- The mention UI sees command handles.
- No V1 UI exposes both harness id and command id for the same action.
- `exo spawn @fable "review this plan"` can launch a configured command without bespoke Claude/Fable/Codex harness integration.
- Changed command strings, cwd/root policy, prompt delivery, or env/template fields invalidate trust before launch.

## Phase 5: Note-Native Invocation

### Objective

Let a Markdown note call a configured command.

Phase 5 can start only after the Phase 0.5 prompt-delivery decision is incorporated. As of 2026-07-08, V1 uses `terminalInputAfterLaunch`; app-level fake-command QA is still required before dogfooding.

### Build

- Strict editor-owned mention parser.
- Confirm affordance showing:
  - document path;
  - mention text;
  - command label;
  - literal command;
  - cwd;
  - direct-write warning.
- Confirmation must be a human gesture. Agent-authored notes must not auto-chain into new invocations.
- If the tagged document is dirty, confirmation must save it first or refuse to launch. The pointer prompt and pre-snapshot read disk, so disk must match the visible mention before launch.
- Pointer prompt rendering.
- Launch through a generic configured-command path beside the current harness launch path, reusing tmux/session/transcript plumbing without harness readiness, trace, or semantic assumptions.
- Invocation lifecycle:
  - create record;
  - running;
  - ended by user or timeout for interactive sessions that do not exit;
  - exited/failed/orphaned.
- Mention provenance where possible:
  - human-authored;
  - prior-invocation-authored;
  - unknown.
- Transcript ref.

### Acceptance

- `@claude ...` in an open note can launch the configured command.
- The command receives the pointer prompt.
- A terminal opens/runs normally.
- Invocation record persists under `.exo/invocations/`.
- Untrusted or changed command-bearing config blocks launch until re-trusted.
- Interactive invocations have an explicit end mechanism, so observation/diff review can finalize even when the terminal session stays open.

### Web Viewer And Command Server Trust Gate

The web viewer remains a core pane primitive, but the current renderer iframe is not a sufficient security boundary for untrusted content. The local command server is loopback IPC, not an authorization boundary unless routes require a per-runtime token or equivalent.

V1 decision after Fable review:

- command-server token auth applies to all routes;
- BrowserPane remains trusted-only local/localhost content;
- add cheap BrowserPane hardening now: iframe sandbox, main-process URL validation, `javascript:`/`data:` rejection, and docs/tests stating it is not an untrusted extension host.

## Phase 6: Direct-Write Observation And Diff Attribution

### Objective

Show what changed after the graph called an agent.

### Build

- Pre-snapshot for tagged document and bounded scope.
- V1 starts with the tagged document only unless prototype evidence justifies broader pre-snapshot scope.
- Watcher-based observed changes during invocation window.
- Patch refs under `.exo/invocations/{id}/diffs/`.
- Attribution:
  - `likely`;
  - `ambiguous`.
- Dirty-buffer handling:
  - never overwrite unsaved editor state;
  - show conflict/refresh choice;
  - mark affected attribution ambiguous.
- Diff/attribution banner:
  - command;
  - invocation;
  - changed files;
  - exit status;
  - transcript link;
  - toggle per-file diff.

### Acceptance

- Fake command appending to a temp note creates an invocation record, patch, and diff banner.
- Concurrent user edit marks attribution ambiguous.
- Dirty buffer is not clobbered.
- App restart during a run marks orphans honestly.

## Phase 7: LM Wiki Tools

### Objective

Add the first tools that make Exograph useful as an LM wiki manager beyond basic graph display.

### Build Candidates

- Dead-link report.
- Orphan-note report.
- Link hygiene checker.
- Property/frontmatter consistency view.
- Note templates for common node types.
- Search/index health repair surface.

### Acceptance

- At least one graph-maintenance tool works without agents.
- At least one tool can be invoked by an agent command from a note.

Phase 7 and Phase 8 are not part of the first implementation fan-out unless the first waves land cleanly. Treat them as follow-up completion phases, not initial worker assignments.

## Public Contract Approval

This Fable-reviewed plan is the architectural approval to remove the named MCP, routine, deep harness-manager, profile-apply, and plugin-manager product surfaces, subject to the caller audits and repo public-contract updates listed in Phase 1.

Each worker brief that touches CLI, command-server, MCP, or shared protocol code must quote this section and still keep changes within the named removals. New public surfaces remain out of scope.

## Phase 8: Final Deletion And Docs Closure

### Objective

Remove remaining old-product code and align public docs.

### Work

- Delete remaining dead MCP/routine/harness/profile/plugin paths proven unused.
- Rewrite README around Exograph.
- Rewrite `docs/strategy.md`.
- Rewrite `docs/usability-readiness.md`.
- Update `ledger.md` with pivot history.
- Archive superseded Fable/plugin/routine planning docs.
- Run final test/QA pass.

### Acceptance

- Product docs, tasks, roadmap, agent instructions, and UI agree.
- No obvious old product surface remains in primary flows.
- Branch can be reviewed as one coherent Exograph refactor.

## Work Packages For Fan-Out

### WP0: Tracker And Instruction Rewrite

Owns:

- `roadmap.md`
- `tasks.md`
- `README.md`
- `AGENTS.md`
- `CLAUDE.md`
- old docs top banners

Deliverable: old plugin/routine/harness roadmap is no longer active.

### WP1: Deletion Audit

Owns:

- MCP callers and docs;
- routine callers and docs;
- harness-manager callers;
- profile-apply callers;
- plugin-manager setup surfaces.

Additional requirements:

- Map `scripts/check-repo.mjs` public-contract and required-file implications for MCP removal.
- Map `packages/core/src/integrations.ts` and installed-machine MCP registration cleanup.
- Decide current-dependency retentions for Plugin Manager and profile surfaces rather than preserving them by default. Otherwise remove them.
- Identify command-server routes that survive because CLI/app runtime uses them.
- Include graph/plugin type coupling from `packages/core/src/graph.ts` / `graph-snapshot.ts`.
- Use the first safe deletion sequence from the deletion audit:
  1. docs/setup copy;
  2. onboarding/rail removal;
  3. MCP agent lifecycle exposure;
  4. routine product UI/CLI removal;
  5. module deletion only after tests reveal unused internals.

Deliverable: removal map with code paths, tests, public-contract changes, and safe first deletions.

### WP2: Graph Read Path

Owns:

- audit/extend existing `packages/core/src/graph.ts` and `packages/core/src/graph-snapshot.ts`;
- backlink index;
- properties model;
- basic graph snapshot tests.

Deliverable: deterministic graph snapshot and backlink query.

Suggested additions from graph audit:

- new `packages/core/src/graph-query.ts`;
- `getNoteGraphContext(snapshot, filePath)`;
- `getGraphNeighborhood(snapshot, input)`;
- `getBacklinksForNote(snapshot, filePath)`;
- deterministic tests for aliases, fragments, duplicate basenames, frontmatter properties, and neighborhoods.

### WP3: Graph UI

Owns:

- backlinks panel;
- properties surface;
- basic graph/neighborhood viewer.

Deliverable: active note has visible graph context.

Likely reusable files:

- `apps/desktop/src/renderer/src/components/InspectorDock.tsx`;
- `apps/desktop/src/renderer/src/components/NoteEditor.tsx`;
- `apps/desktop/src/renderer/src/hooks/useOpenDocuments.ts`;
- `apps/desktop/src/renderer/src/graphAffordances.ts`;
- new `GraphNeighborhoodView.tsx` if no existing surface fits.

### WP4: CLI/Search Provider Hardening

Owns:

- provider-neutral search status;
- fallback search provider;
- CLI search/read/status cleanup.

Deliverable: CLI-first search/read/status without MCP dependency.

### WP5a: AgentCommand Core And Settings

Owns:

- core `AgentCommand`/`InvocationRecord`;
- settings storage.
- invocation store under `.exo/invocations/{id}/record.json`.

Deliverable: command and invocation data model can be loaded/saved without renderer mention UI.

### WP5b: Mention UI And Invocation Runner

Owns:

- mention parser;
- confirm/launch path;
- generic command launch adapter beside the current harness launch.

Deliverable: mention launches configured command and creates invocation record.

Dependencies:

- WP5a complete.
- Phase 0.5 prompt-delivery decision incorporated: V1 uses `terminalInputAfterLaunch`.
- Coordinate with WP3 because both may touch editor/App surfaces.
- Coordinate with deletion work because current terminal launch still depends on harness registry; do not remove harness internals before generic command launch exists.

### WP6: Observation And Diff Attribution

Owns:

- pre-snapshot;
- watcher change capture;
- patch refs;
- likely/ambiguous attribution;
- dirty-buffer conflict rules.

V1 scope:

- tagged document first;
- broader workspace/file attribution later only after the tagged-document path is stable.

Deliverable: direct write to the tagged document produces visible attributed diff.

## Global Red Lines

- Do not preserve MCP just because it exists.
- Do not rebuild the agent cockpit under a new name.
- Do not auto-run mentions from arbitrary saved Markdown in V1; invocation is editor-owned and user-confirmed.
- Do not introduce line-perfect authorship claims.
- Do not ship direct-write refresh that can clobber dirty editor buffers.
- Do not make Plugin Manager, Routine Manager, or profile apply the setup spine.
- Do not hardcode Shoshin/OKF assumptions into OSS core.
- Do not delete terminal runtime, CLI, search provider seams, or changed-file review without explicit review.
- `.exo/invocations/` stores mention text and diffs that may contain private note content. Ensure it is ignored by git and give it an explicit retention/cleanup story before broad dogfooding.

-- Exo | 2026-07-08
