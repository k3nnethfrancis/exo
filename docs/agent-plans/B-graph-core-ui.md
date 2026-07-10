# Agent B Plan: Graph Core And Graph UI

Last updated: 2026-07-09

Status: Fable-reviewed planning packet. Implement only with the amendments below.

## Fable Amendments

- Keep `GraphNode.id` as the existing `note:${absolutePath}` for this branch.
- Search/read canonical document identity is `rootId + rootRelativePath`; graph/search identity convergence is a V2 follow-up.
- Renderer/main preload IPC is app-internal, not a public contract. Command-server routes, CLI, and `command-protocol.ts` are the public-contract surfaces.
- Agent B owns the first renderer migration through `useOpenDocuments.ts` and `NoteEditor.tsx`; Agent E dirty-conflict/autosave renderer work must sequence after this or be assigned to the same worker.
- Add a performance stop condition: full graph snapshot rebuild above roughly 1.5-2 seconds on the real vault or a 5k-note synthetic fixture stops implementation for an incremental design.

## Slice

Agent B owns the Exograph graph read path and graph UI:

- canonical graph read path;
- backlinks, outgoing references, tags, properties, unresolved/external links, and neighborhood view;
- renderer data flow for graph context;
- deletion of competing `NoteKnowledge`/old graph-plugin coupling where still present;
- graph QA;
- a durable note that future search results should hydrate into `document` plus metadata/snippets.

## Scope

Build Exograph around one canonical saved-disk graph model:

- `GraphSnapshot` is the canonical graph fact set.
- Outgoing edges are canonical facts.
- Backlinks are derived from outgoing edges.
- Graph context for a note is snapshot-derived.
- The renderer consumes graph context, not ad hoc note knowledge.
- Saved disk is V1 graph truth. Dirty editor body changes do not mutate the canonical snapshot until save.
- Frontmatter property edits can be shown optimistically in the editor because they are the edited document state, but canonical graph context refreshes from disk after save.

## Non-Goals

- Do not build a full graph canvas, force-directed 3D graph, or replaceable graph visualization plugin.
- Do not add MCP graph APIs.
- Do not define the V2 out-of-process provider protocol.
- Do not implement search-result hydration in this slice. Record the `document` metadata direction and leave provider integration to Agent C / future V2.
- Do not attempt unsaved-buffer graph extraction for body links in V1.
- Do not preserve old graph-visualization plugin metadata through a compatibility adapter.
- Do not implement code during this planning fan-out.

## Current Branch Evidence

The current branch already contains the important core graph substrate:

- `packages/core/src/graph.ts`
  - Defines `GraphSnapshot`, `GraphNode`, `GraphEdge`, `GraphBacklink`, node/edge kinds, and `deriveGraphBacklinks`.
  - Already decoupled from plugin/capability imports.
- `packages/core/src/graph-snapshot.ts`
  - Builds deterministic snapshots from configured note roots.
  - Extracts Markdown links, wikilinks, tags, frontmatter, unresolved links, external links, duplicate-basename warnings, root ids, and paths.
- `packages/core/src/graph-query.ts`
  - Provides `findGraphNote`, `getNoteGraphContext`, `getGraphBacklinks`, and `getGraphNeighborhood`.
- `packages/core/src/__tests__/graph*.test.ts`
  - Cover deterministic graph facts, aliases/fragments, duplicate basenames, frontmatter, backlinks, neighborhoods, and the structural no-plugin-import invariant.

The remaining branch evidence shows the graph path is not yet canonical end-to-end:

- `packages/core/src/notes.ts`
  - Still exports `getNoteKnowledge`.
  - `getNoteKnowledge` and `findBacklinks` are a competing graph read path.
  - Keep parser helpers (`extractWikilinks`, `extractMarkdownLinks`, `extractTags`, `readWorkspaceDocument`); remove the old knowledge API after migration.
- `packages/core/src/types.ts`
  - Still defines `NoteKnowledge` and related backlink/reference types for the old API.
- `apps/desktop/src/main/workspace-notes-service.ts`
  - Still exposes `getKnowledge(filePath)` via `getNoteKnowledge`.
- `apps/desktop/src/shared/api.ts`, `apps/desktop/src/shared/desktop-ipc.ts`, `apps/desktop/src/preload/index.ts`, `apps/desktop/src/main/workspace-ipc.ts`, `apps/desktop/src/main/index.ts`
  - Still expose `notes:get-knowledge`.
- `apps/desktop/src/renderer/src/hooks/useOpenDocuments.ts`
  - Tracks `knowledgeByPath` and calls `window.exo.notes.getKnowledge`.
- `apps/desktop/src/renderer/src/graphAffordances.ts`
  - Builds a renderer pseudo-`GraphSnapshot` from `NoteKnowledge`.
  - This loses canonical resolution semantics and duplicates graph construction in the renderer.
- `apps/desktop/src/renderer/src/components/EditorPane.tsx`, `NoteEditor.tsx`, and `InspectorDock.tsx`
  - Accept `NoteKnowledge` and call `buildNoteGraphContext(document, knowledge)`.
- `apps/desktop/src/main/workspace-watchers.ts`
  - Already has `WorkspaceWatcherService.subscribe`; this satisfies the Fable-amended dependency that graph cache invalidation should consume the shared watcher API rather than adding another watcher path.
- `packages/core/src/capabilities.ts`, `packages/core/src/plugin-inventory.ts`, and plugin docs still mention `exo.graph:visualization`.
  - Core graph files are decoupled already.
  - The remaining `exo.graph:visualization` capability/category belongs to Agent A/plugin cleanup unless graph implementation touches it. Agent B should add/keep a structural regression that graph model/query files do not import plugin/capability modules.

## Add / Delete / Modify List

### Add

- `apps/desktop/src/main/workspace-graph-service.ts`
  - Main-process graph service.
  - Builds/caches `GraphSnapshot` from the current `WorkspaceModel`.
  - Exposes snapshot-derived note context and neighborhoods.
  - Invalidates from `WorkspaceWatcherService.subscribe` and explicit note save/create/rename/delete events.
- `apps/desktop/src/main/workspace-graph-service.test.ts`
  - Cache, invalidation, lookup, deleted note, changed link, multi-root behavior, and no duplicate watcher path coverage.
- Shared app-internal API types in `apps/desktop/src/shared/api.ts`
  - Prefer returning core types or a compact `NoteGraphContext` DTO that mirrors `packages/core/src/graph-query.ts`.
  - Proposed methods:
    - `workspace.getGraphSnapshot(): Promise<GraphSnapshot>`
    - `workspace.getNoteGraphContext(filePath): Promise<NoteGraphContext | null>`
    - `workspace.getGraphNeighborhood(filePath, options?): Promise<GraphNeighborhood | null>`
  - Alternative: put these under `notes` if the team wants all document-adjacent calls together. Recommendation: use `workspace` because snapshot scope is workspace/root-level, not single-file only.
- Renderer mapper tests for a new graph-context mapper:
  - Convert `NoteGraphContext` / `GraphNeighborhood` into `RendererNoteGraphContext`.
  - Keep label/target UI semantics out of core.

### Delete

- Old core read path after all callers migrate:
  - `getNoteKnowledge` in `packages/core/src/notes.ts`.
  - `NoteKnowledge`, `BacklinkReference`, `MarkdownLinkReference`, `WikilinkReference`, and `TagReference` only if no parser helper still needs exported typed references.
  - Tests that only validate old `getNoteKnowledge` behavior, replacing useful parser coverage with graph snapshot/query tests.
- Desktop old API path:
  - `notes:get-knowledge` IPC channel.
  - `window.exo.notes.getKnowledge`.
  - `WorkspaceNotesService.getKnowledge`.
- Renderer pseudo-snapshot path:
  - `buildNoteGraphContext(document, knowledge)` as currently implemented.
  - `knowledgeByPath`, `activeKnowledge`, and `NoteKnowledge` props.
- Any graph-plugin metadata parsing still found in graph model/query files.
  - Current evidence: none in `graph.ts`; keep this as a verification item, not a code change unless new evidence appears.

### Modify

- `packages/core/src/graph-query.ts`
  - Keep current functions, but consider adding small DTO helpers only if renderer/main mapping otherwise duplicates too much.
  - Preserve deterministic sorted outputs.
- `packages/core/src/graph-snapshot.ts`
  - Keep current extraction.
  - Add only targeted fixes discovered by QA, such as root-relative identity, title fallback, path normalization, or markdown link edge metadata gaps.
- `apps/desktop/src/main/index.ts` and `workspace-ipc.ts`
  - Wire graph service and graph IPC.
  - Ensure graph cache invalidates after notes save/create/rename/delete and watcher events.
- `apps/desktop/src/renderer/src/hooks/useOpenDocuments.ts`
  - Replace `knowledgeByPath` with `graphContextByPath`.
  - Load graph context for open markdown note documents.
  - After save, reload graph context from the graph service.
  - Keep dirty-buffer protection behavior unchanged.
- `apps/desktop/src/renderer/src/graphAffordances.ts`
  - Convert into pure renderer mappers:
    - `rendererGraphContextFromCore(context, neighborhood?)`
    - `buildGraphReferences(rendererContext)`
    - existing wikilink completion helpers can stay.
  - Remove renderer-owned graph node/edge construction.
- `EditorPane.tsx`, `NoteEditor.tsx`, `InspectorDock.tsx`
  - Accept `RendererNoteGraphContext | null`, not `NoteKnowledge`.
  - Continue showing backlinks, references, external links, tags, properties, and neighborhood from that context.
- `apps/desktop/src/renderer/src/App.test.tsx`
  - Replace `NoteKnowledge` fixtures with graph-context fixtures or core snapshot/query fixtures.
- `apps/desktop/tests/e2e/shell.spec.ts`
  - Keep existing UI assertions for backlinks/properties/neighborhood.
  - Add or revise cases to prove resolved targets come from canonical snapshot behavior, not basename-only `NoteKnowledge`.

## Sequencing And Dependencies

1. **Confirm Agent A deletion boundary**
   - Agent B does not need plugin/capability code for core graph extraction.
   - If Agent A deletes plugin inventory/capability files in the same window, Agent B must avoid touching those except for no-import tests.

2. **Stabilize core graph query contract**
   - Review `GraphSnapshot`, `NoteGraphContext`, and `GraphNeighborhood` for renderer needs.
   - Do not add UI-only fields to core if they can be mapped in renderer.
   - Add missing core tests first if the renderer currently relies on behavior not covered in core.

3. **Add desktop graph service**
   - Build snapshot on demand.
   - Cache one active snapshot per current workspace model.
   - Invalidate by monotonically increasing cache generation.
   - Consume `WorkspaceWatcherService.subscribe`.
   - Debounce rebuilds; do not rebuild on every keystroke or unsaved editor change.

4. **Expose app-internal graph IPC**
   - Add graph read methods to shared API/preload/main IPC.
   - Treat this as app-internal unless Fable/orchestrator says shared preload API is a public contract requiring review.
   - Do not add CLI/MCP graph commands in this slice.

5. **Migrate renderer data flow**
   - `useOpenDocuments` loads document + graph context + branch family.
   - Editor and inspector receive graph context directly.
   - `graphAffordances.ts` maps core graph context to renderer targets/labels.
   - Existing UI behavior should be preserved except it becomes more accurate for resolved links and duplicate basenames.

6. **Delete the old path**
   - Remove `NoteKnowledge` only after all desktop callers are gone.
   - Keep parser helpers in `notes.ts`.
   - Remove `notes:get-knowledge` IPC and preload API.
   - Remove renderer pseudo-snapshot tests and replace them with canonical graph mapper tests.

7. **QA and docs**
   - Run graph unit tests, desktop main service tests, renderer tests, typechecks, and focused E2E graph UI checks.
   - Update `tasks.md` only after implementation/QA, not during this planning-only pass.
   - Add the future `document` metadata note to the graph/search docs if not already captured elsewhere.

## Data Model And API Decisions

### Canonical Identity

- Current core graph note ids are `note:${absolutePath}`.
- Search/read canonical document identity is `rootId + rootRelativePath`.
- Fable settled this fork: keep graph ids stable for this branch and record graph/search/document identity convergence as V2 follow-up.
- Add `rootRelativePath` to graph node metadata only if the renderer needs it; do not force a graph id migration in this branch.

### Snapshot Truth

- `GraphSnapshot` is saved-disk truth.
- A dirty editor buffer can show edited frontmatter in the property card, but graph links/backlinks/neighborhood update after save.
- The graph service should make this explicit in tests and not silently parse unsaved editor state.

### Renderer DTO

Renderer needs:

- `note`;
- `outgoingLinks`;
- `backlinks`;
- `tags`;
- `properties/frontmatter`;
- `unresolvedLinks`;
- `externalLinks`;
- `neighborhood`;
- optional `snapshotId`/`generatedAt` for diagnostics.

Recommendation:

- Reuse core `NoteGraphContext` and `GraphNeighborhood` over IPC initially.
- Map to `RendererNoteGraphContext` in renderer for UI labels and click targets.
- Do not put React-specific or display-only fields in core.

### Graph Properties

- Existing property editing in `NoteEditor.tsx` supports editing existing frontmatter keys and adding new keys.
- It does not delete keys.
- Recommendation:
  - Keep add/edit in V1 if deletion UX is not already designed.
  - If "read/edit affordance" is interpreted as full CRUD, add delete only with explicit UI and tests.
  - Protect Exo-reserved keys such as `branch_*` from normal property editing/deletion.

### Backlinks And Link Resolution

- Old `NoteKnowledge.findBacklinks` resolves by basename and can produce weaker results.
- Core snapshot resolves:
  - path-like wikilinks;
  - basename-only wikilinks when unambiguous;
  - duplicate basename warnings;
  - relative Markdown links;
  - external links.
- Renderer should display unresolved and ambiguous cases honestly rather than making them clickable as if resolved.

### Future Document Metadata Note

Record this design note in graph/search docs after implementation planning review:

> Long term, search returns should hydrate into a `document` result: note identity, path/title, frontmatter/properties, tags, outgoing links, backlinks, neighborhood summary, provider snippets/chunks, and provider/index health. Providers own relevance and snippets; Exo owns note identity, metadata, and graph context.

This is a later integration point. Do not force all search providers to understand Exograph ontology in this branch.

## Tests And QA

### Core Unit Tests

Keep and extend:

- `packages/core/src/__tests__/graph.test.ts`
- `packages/core/src/__tests__/graph-snapshot.test.ts`
- `packages/core/src/__tests__/graph-query.test.ts`

Required coverage:

- aliases/fragments in wikilinks and markdown links;
- duplicate basenames produce unresolved/ambiguous behavior and warnings;
- nested frontmatter/properties preserve values;
- tag extraction from body and frontmatter;
- deterministic ordering and snapshot id stability;
- backlink derivation from outgoing edges only;
- neighborhoods with tags/external/unresolved toggles;
- graph model/query files do not import plugin/capability modules.

### Desktop Main Tests

Add `workspace-graph-service.test.ts`:

- first call builds snapshot;
- repeated call uses cache when generation unchanged;
- watcher event invalidates cache;
- note save path invalidates or refreshes cache;
- deleted note returns `null` context;
- changed note updates backlinks after save/change;
- multi-root note paths resolve with correct `rootId`;
- watcher subscription is used, no direct second `fs.watch` path.

### Renderer Tests

Update `App.test.tsx` / component tests:

- editor property card uses graph context properties;
- add/edit property still mutates document frontmatter and save path;
- inspector backlinks render from graph context;
- references distinguish resolved/internal, unresolved, and external;
- neighborhood renders note/tag/external/unresolved nodes without layout overflow;
- live Markdown preview backlinks/references use graph context;
- dirty document does not have body-link graph changes until save.

### E2E QA

Focused Electron tests should cover:

- open note with incoming backlink and verify backlinks panel opens correct target;
- open note with outgoing resolved wikilink and verify references open correct target;
- duplicate basename wikilink does not silently open the wrong note;
- edit/add frontmatter property, save, reload, property persists;
- graph neighborhood panel shows adjacent note and tag;
- external link opens through shell external path, not note open path;
- dirty buffer remains protected during graph refresh.

### Validation Commands

Implementation worker should run at minimum:

- `pnpm --filter @exo/core test -- graph`
- `pnpm --filter @exo/core typecheck`
- `pnpm --filter @exo/desktop test -- workspace-graph-service`
- `pnpm --filter @exo/desktop test -- App`
- `pnpm --filter @exo/desktop typecheck`
- focused Electron graph/editor specs in `apps/desktop/tests/e2e/shell.spec.ts`

If implementation touches shared API/preload IPC:

- run `pnpm check:repo`;
- update public-contract review paperwork only if the orchestrator classifies the preload/shared API change as public.

## Open Unknowns

### Known Unknowns

- Settled by Fable: graph preload/shared API methods are app-internal unless they touch command-server, CLI, or `command-protocol.ts`.
- Settled by Fable: keep graph ids as `note:${absolutePath}` for this branch; search/read uses `rootId + rootRelativePath`.
- Does "graph properties read/edit" require delete controls in V1?
- Should graph context be loaded for every open note, only the active note, or active plus recently opened notes?
- What cache invalidation behavior is acceptable for large vaults if `buildGraphSnapshot` scans all note roots?

### Unknown Unknown Candidates

- Large-vault performance may make full snapshot rebuild on every save too slow.
- Path identity may break across symlinked note roots or duplicate root-relative paths.
- Renderer tests may be accidentally asserting old weak basename behavior.
- Existing E2E fixtures may pass because old `NoteKnowledge` and new graph snapshot agree on simple names; add duplicate-path fixtures to avoid false confidence.
- Frontmatter serialization may reorder/normalize values in ways users notice when property editing.
- Search-provider work may introduce document identity fields that should be reflected in graph nodes before this slice lands.

## Fable Review Packet

Fable answered this packet on 2026-07-09:

1. V1 desktop should use a main-process `WorkspaceGraphService` cached `GraphSnapshot` as the graph read source.
2. Keep `GraphNode.id = note:${absolutePath}` for this branch while search/read uses `rootId + rootRelativePath`.
3. New graph preload/shared API methods are app-internal unless they touch CLI, command-server, or `command-protocol.ts`.
4. Delete `NoteKnowledge` and `notes:get-knowledge` after renderer migration, keeping parser helpers in `notes.ts`.
5. Saved-disk-only graph truth is acceptable for V1.
6. Property delete controls remain an implementation/product choice; add/edit is enough unless the user explicitly requires full CRUD.
7. Full snapshot rebuild above roughly 1.5-2 seconds on the real vault or a 5k-note synthetic fixture stops implementation for an incremental design.

Recommendation for Fable:

- Approve the main-process graph service and renderer migration plan.
- Keep `note:${absolutePath}` ids for this branch unless Agent C has already landed `rootId + rootRelativePath` document identity primitives that can be reused without churn.
- Classify graph preload methods as app-internal if they are only renderer/main calls, but require public-contract review if they touch CLI, command server, or external protocol files.
- Delete `NoteKnowledge` and `notes:get-knowledge` after migration; do not preserve a compatibility adapter.
- Keep saved-disk graph truth in V1.
- Treat property delete as optional unless user-facing QA shows the absence blocks the "properties read/edit" promise.
- Stop for redesign if full snapshot rebuild exceeds an agreed latency threshold on the user's real vault or a synthetic large-vault fixture.

## Stop Conditions

Implementation must stop and report options before continuing if any of these occur:

- A graph API change crosses CLI, command-server, MCP, or other external/public contract surfaces.
- The graph service needs a second file watcher instead of `WorkspaceWatcherService.subscribe`.
- The implementation must change Agent C search provider identity or result contracts.
- The implementation would parse dirty unsaved editor body text as canonical graph truth.
- Deleting `NoteKnowledge` would break non-graph note features that have not been mapped to another API.
- Full snapshot rebuild is visibly slow or testably expensive enough to harm normal save/open flows.
- Plugin/capability deletion conflicts with graph/search provider boot.
- Property editing risks data loss or unexpected frontmatter rewrites beyond the existing save behavior.
- E2E graph behavior regresses dirty-buffer protection, note opening, or external link handling.

## Handoff Checklist

- [ ] Fable review packet routed by orchestrator.
- [ ] Fable feedback incorporated into this plan or the implementation brief.
- [ ] Agent A confirms plugin/capability deletion boundary.
- [ ] Agent C confirms whether `rootId + rootRelativePath` identity is available now or deferred.
- [ ] Implementation worker starts with failing/updated tests for desktop graph service and renderer migration.
- [ ] Old `NoteKnowledge` API is deleted only after all callers are gone.
- [ ] QA evidence is recorded before marking WP2 truly complete.

-- Exo | 2026-07-09
