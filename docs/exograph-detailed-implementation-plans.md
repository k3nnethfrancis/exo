# Exograph Detailed Implementation Plans

Last updated: 2026-07-08

status: Fable-reviewed plans. Required revisions are incorporated below and must be used for implementation fan-out.

This document summarizes the six delegated planning slices for completing `refactor/note-native-exo`. It is derived from the agent plans requested in `docs/exograph-completion-orchestration-plan.md`.

## Agent A: Deletion, Contracts, And Trust Audit

### Scope

Owns removal or hard gating of:

- MCP lifecycle/setup/install paths and installed-machine cleanup.
- Routine product UI/CLI/docs/code not needed by `.exo/invocations/`.
- Plugin Manager as setup spine.
- Profile apply setup paths.
- Harness skill inventory/setup paths.
- Public-contract guard updates.
- Command-server route survival map.
- BrowserPane iframe plus command-server mutation-route trust audit.

Non-goals: terminal runtime deletion, search provider deletion, changed-file review deletion, or implementation of AgentCommand/invocation.

### Current Surfaces

Audit:

- MCP: `packages/mcp/**`, root workspace scripts, `packages/core/src/integrations.ts`, CLI integration commands, installer scripts, Codex MCP launch override.
- Routines: CLI `exo routines`, core `routine*` modules, graph-health and agent-instruction-sync plugin manifests, onboarding/profile/plugin UI references.
- Plugin/profile/skills/harness setup: Plugin Manager dialog/model, profile settings panels, profile apply/recovery modules, Agent Config skills inventory, harness readiness surfaces.
- Public contracts: `scripts/check-repo.mjs`, `docs/public-contract-reviews.md`, `command-protocol.ts`, `command-server.ts`, `app-client.ts`, `preview-target.ts`, `BrowserPane.tsx`.

### Plan

1. Inventory dependencies and split work by deletion dependency.
2. Remove MCP setup/install copy before deleting code.
3. Remove MCP integration installer/doctor paths unless Fable asks for one transitional cleanup command.
4. Remove MCP agent lifecycle exposure.
5. Decide whether `packages/mcp` is fully deleted or temporarily reduced to read/search/status.
6. Remove routine CLI/templates/product UI.
7. Extract any generic invocation-needed utility before deleting routine core; `safeStoreSegment` now lives in neutral `store-paths.ts`.
8. Remove Plugin Manager setup spine, retaining only explicitly justified diagnostic/provider state if still needed.
9. Decouple graph/search from plugin/capability internals before deleting those internals.
10. Remove profile apply setup paths and decide whether `profile-recovery` survives until direct-write review lands.
11. Remove harness skill inventory/setup paths after generic AgentCommand launch exists.
12. Harden BrowserPane/command-server before treating web content as untrusted extension content.

### Trust Hardening

BrowserPane:

- Current iframe is unsandboxed and renderer URL normalization can bypass main validation.
- Route navigation through main validation.
- Add iframe sandbox and `referrerPolicy`.
- Block or confirm arbitrary remote URLs unless BrowserPane remains trusted-only.
- Test outside-root files, non-HTML local files, and `javascript:`/`data:` rejection.

Command server:

- Loopback is not authorization.
- Generate per-runtime random token.
- Require token for all routes, not only mutations.
- Reject non-loopback remotes and suspicious browser-originated requests.
- Add body size/content-type guards.

### Fable Review Packet

1. Delete `packages/mcp` fully after CLI parity and installed cleanup docs, or keep temporary read/search/status adapter?
2. Remove `exo integrations` immediately or keep a one-release cleanup/deprecation surface?
3. Token-auth all command-server routes, and should token live in `server.json`?
4. Disable, confirm-gate, or sandbox arbitrary remote BrowserPane URLs?
5. Delete `RunRecord`/`ActivityRecord` after `InvocationRecord`, or keep minimal generic activity refs?
6. Keep `profile-recovery` until direct-write review ships, or delete profile apply/recovery together?

### Fable-Amended Worker Brief

- Delete `packages/mcp` after CLI parity and documented deregistration steps. Do not preserve a temporary MCP read/search/status adapter.
- Remove `exo integrations` immediately and document manual deregistration in `CHANGELOG.md` plus a short cleanup doc.
- Token-auth all command-server routes in Wave 1, using a per-runtime random token in `server.json` with restrictive permissions. Update `docs/public-contract-reviews.md` and `scripts/check-repo.mjs`.
- Keep BrowserPane trusted-only local/localhost in V1. Add iframe `sandbox`, main-process URL validation, `javascript:`/`data:` rejection, and tests/docs that state it is not an untrusted extension host.
- Own the `WorkspaceWatcherService` subscription/fan-out API before Agent B graph cache work and Agent E invocation observation work consume watcher events.
- Extracted `safeStoreSegment` into neutral `store-paths.ts` before routine deletion.

## Agent B: Graph Core And Graph UI

### Scope

Owns:

- `GraphSnapshot` plus `graph-query` as canonical graph read path.
- Active-note graph context: outgoing links, backlinks, tags, frontmatter/properties, external/unresolved links, neighborhood.
- Replacing renderer pseudo-snapshots from `NoteKnowledge`.
- Property editing affordances.
- Decoupling graph core from plugin/capability metadata.

Non-goals: full canvas/3D graph, MCP graph API, provider hydration, unsaved-buffer graph truth, live agent/provenance graph expansion.

### Current Assets And Gaps

Assets:

- `packages/core/src/graph.ts`
- `packages/core/src/graph-snapshot.ts`
- `packages/core/src/graph-query.ts`
- graph tests
- `InspectorDock.tsx`, `NoteEditor.tsx`, `GraphNeighborhoodView.tsx`, `graphAffordances.ts`

Gaps:

- `graph.ts` mixes graph types with plugin/capability graph visualization metadata.
- Renderer still builds pseudo-`GraphSnapshot` from `NoteKnowledge`.
- `WorkspaceNotesService.getKnowledge()` still drives desktop backlinks/link context.
- No desktop graph snapshot/cache service.
- Property editing handles existing keys only.

### Plan

1. Keep canonical graph model and extraction/query helpers in core.
2. Move or delete old graph visualization capability parsing from `graph.ts`.
3. Add `WorkspaceGraphService` in desktop main:
   - build/cache `GraphSnapshot`;
   - debounce invalidation on watcher changes and saves;
   - expose `getNoteContext` / `getNeighborhood`.
4. Add app-internal preload/IPC graph context route.
5. Move renderer from `knowledgeByPath` to `graphContextByPath`.
6. Convert `graphAffordances.ts` into a mapper from core graph context to renderer labels/targets.
7. Keep saved-disk graph snapshots as canonical V1 graph truth; dirty editor properties can reflect local frontmatter state, but body links do not mutate the canonical snapshot until save.
8. Add property add/edit/delete controls with protected metadata keys.

### Tests

- Core graph tests for aliases, fragments, duplicate basenames, nested properties, tag formats, deterministic ordering, neighborhoods.
- Structural test that graph model files no longer import plugin/capability modules.
- Desktop graph service tests for context lookup/cache invalidation.
- Renderer tests for backlinks, references, external links, tags, properties, neighborhood, property add/edit/delete.
- E2E graph UI checks.

### Fable Review Packet

1. Is an additive graph-context preload route app-internal, or a public contract needing review?
2. Split old `exo.graph:visualization` metadata into a legacy adapter or delete it with Plugin Manager surfaces?
3. Should V1 graph snapshots exclude unsaved editor body changes?
4. Should caching live in desktop main or a reusable core cache?
5. Keep `NoteKnowledge` temporarily after renderer migration, or delete it immediately?

### Fable-Amended Worker Brief

- Promote core graph context with a desktop cache and app-internal preload/IPC route.
- Delete old `exo.graph:visualization` capability parsing with Plugin Manager surfaces. Do not build a legacy adapter.
- Delete `NoteKnowledge` in this work package once the renderer is migrated.
- Consume the shared watcher subscription API from Agent A; do not add a second watcher callback path.
- Keep saved-disk graph snapshots as canonical V1 graph truth. Unsaved editor body changes do not mutate the canonical snapshot until save.

## Agent C: CLI And Search Provider Hardening

### Scope

Owns:

- CLI `workspace/status/search/read` without MCP and without requiring the app for read-only orientation.
- QMD as default advanced provider.
- Real filesystem/lexical fallback provider.
- Provider result path canonicalization.
- Provider-neutral status/read/search boundary.

Non-goals: AgentCommand, invocation, graph UI, out-of-process provider protocol, full V2 hydration.

### Current Assets And Gaps

Assets:

- `search-provider.ts`
- `search-provider-registry.ts`
- `search-providers/qmd-provider.ts`
- `qmd.ts`
- CLI direct core fallback for search/read
- command-server `/search`, `/read`, `/index/status`

Gaps:

- `SearchProvider.metadata` tied to `CapabilityMetadata`.
- Fallback hidden inside `QmdSearchProvider`.
- `IndexBackend = "qmd"` and `source = "qmd" | "filesystem"` are hardcoded.
- QMD path resolution is ad hoc.
- top-level `exo status` and `exo index status` require app.
- fallback lexical recall is weak.

### Plan

1. Introduce provider-neutral `SearchProviderMetadata`.
2. Add `search-service.ts` owning provider selection, fallback, status composition, and canonicalization.
3. Add `filesystemSearchProvider`.
4. Narrow QMD provider to QMD only; let the service do filesystem fallback.
5. Fallback rules:
   - index off/no roots: filesystem fallback;
   - QMD native/open failure: filesystem fallback;
   - QMD hybrid/vector degradation: QMD lexical with warnings;
   - QMD lexical failure: filesystem fallback.
6. Preserve existing fields, then add approved additive fields like `providerId`, `fallbackActive`, `canonicalPath/documentKey`.
7. Make `exo status` a combined read-only command that exits `0` when workspace/search status is available even if app is unavailable.
8. Let `exo index status` run locally; keep `sync/update/embed` app-owned.
9. Add `search-paths.ts` for canonical path/document identity.

### Tests

- Registry tests include QMD and filesystem provider.
- Filesystem provider recall tests.
- QMD degradation and service fallback tests.
- Canonicalization tests for QMD URI, absolute path, workspace/root-relative, symlink, stale outside-root.
- CLI tests for app-unavailable `status`, local `index status`, search/read fallback.
- Command-server route tests for provider warnings.

### Fable Review Packet

1. Are additive provider-neutral status fields acceptable now?
2. Canonical identity: workspace-relative path only, or `rootId + rootRelativePath`?
3. Should `exo status` exit `0` when app discovery fails but local workspace/search status is available?
4. Allow direct local `exo index status` while keeping sync/update/embed app-owned?
5. Must `SearchProvider.metadata` decouple from `CapabilityMetadata` before plugin deletion?
6. Is QMD lexical fallback inside QMD provider acceptable while filesystem fallback lives outside?

### Fable-Amended Worker Brief

- Canonical document identity is `rootId + rootRelativePath`. Workspace-relative path is display metadata only when available.
- Add provider-neutral additive fields now in one reviewed contract change while preserving existing fields.
- Decouple `SearchProvider.metadata` from `CapabilityMetadata` before plugin/capability deletion blocks search.
- `exo status` exits `0` when local workspace/search status is readable without the app, with app availability clearly labeled.
- Keep QMD as one provider and implement filesystem fallback in the search service, not hidden inside QMD.

## Agent D: AgentCommand And Invocation

### Scope

Owns:

- `AgentCommand` as visible agent identity.
- Workspace settings for command config.
- Local trust store outside workspace.
- Trust invalidation on executable behavior changes.
- Strict editor-owned mention parsing.
- Human confirmation.
- Generic configured-command terminal launch.
- CLI `exo spawn @handle "<task>"`.
- Invocation lifecycle and records.

Non-goals: watcher-owned mention detection, auto-run from saved Markdown, proposal staging, line-perfect authorship, MCP work, broad settings UI, direct-write diff UI.

### Plan

1. Refine `AgentCommand` with id, label, handle, command, cwd policy, fixed cwd, prompt delivery, version, enabled.
2. V1 launchability: only `terminalInputAfterLaunch` launches; `stdin`/`argv` may persist as future explicit modes but fail clearly.
3. Add executable fingerprint over id, handle, command, cwd policy, fixed cwd, prompt delivery, and version. V1 has no env/template fields; settings must reject or ignore them explicitly. If env/template fields are added later, they must be fingerprinted before launch.
4. Add local trust store outside workspace, keyed by workspace root plus command identity/fingerprint.
5. Trust states: trusted, untrusted, changed, disabled, unsupportedPromptDelivery.
6. Migrate invocation records to `context: note | cli` instead of note-only shape.
7. Add pure mention parser in core, but invocation triggering belongs only to editor UI.
8. Inline affordance for valid mention lines; confirmation dialog shows path, command, cwd, prompt delivery, trust state, direct-write warning, no-sandbox caveat.
9. Confirmation must save the tagged document before launch or refuse to launch if it cannot save. The pointer prompt and pre-snapshot read disk, so disk must match the visible mention.
10. Generic configured-command terminal path bypasses harness registry/readiness/semantic formatting.
11. V1 command execution uses shell command line via `/bin/zsh -lc "<configured command>"`, shown literally and fingerprinted.
12. Prompt delivery sends pointer/task prompt after terminal launch.
13. Define invocation-end semantics before implementation: interactive sessions can be ended by an explicit user action in the invocation banner/monitor view, and a configurable idle timeout may mark observation complete without terminating the terminal. The record must distinguish terminal process exit, user-ended observation, timeout-ended observation, failure, and orphaned restart.
14. CLI spawn uses same command model and trust gate, requires running app in V1, no CLI self-trust flags.
15. `note_dir` cwd policy is rejected for CLI spawn in V1 with a clear error.

### Tests

- Core command normalization, fingerprinting, trust state, context normalization.
- Mention parser ignores frontmatter, code fences, prose, blockquotes, lists, style/script/pre.
- Trust store tests prove no workspace self-trust and invalidation on changes.
- Desktop main tests for configured command terminal launch bypassing harness registry.
- Invocation service tests for trusted/untrusted/changed, launch failure, exit updates, orphan scan.
- Lifecycle tests for a never-exiting interactive session that resolves through the chosen end mechanism.
- Confirmation tests for dirty tagged documents: save succeeds before launch or launch is refused.
- Renderer tests for affordance and confirmation.
- CLI tests for `exo spawn` parsing, trust failure, success output, app-unavailable diagnostics.

### Fable Review Packet

1. First-class configured-command terminal identity now, or compatibility shim?
2. V1 command string via shell line, or force executable/args separation?
3. CLI spawn runs only already trusted commands, or needs interactive trust path?
4. Reject `note_dir` for CLI context or fallback to workspace root?
5. Persist but reject `stdin`/`argv`, or reject those modes in settings until implemented?
6. Does trust fingerprint include the right fields?
7. Is `context: note | cli` the right record migration?
8. Are tests sufficient for trust/confirmation/public-contract risk?

### Fable-Amended Worker Brief

- Build first-class configured-command terminal metadata. Do not use a harness compatibility shim as the primary path.
- V1 command execution is `/bin/zsh -lc` with the literal configured command shown in confirmation and fingerprinted.
- No CLI self-trust in V1. Untrusted or changed commands fail with instructions to trust in the app.
- Reject `note_dir` in CLI context with a clear error.
- Use `context: note | cli` in invocation records.

## Agent E: Direct-Write Observation And Diff Attribution

### Scope

Owns:

- Tagged-document pre-snapshot.
- Workspace watcher change capture during invocation window plus grace period.
- Patch refs under `.exo/invocations/{id}/diffs/`.
- Invocation record updates with changed files, diffs, attribution.
- Dirty-buffer conflict handling.
- Diff/attribution banner and detail view.
- Orphaned invocation behavior.

Non-goals: line-perfect authorship, proposal staging as default, auto-run mentions, revert button, MCP/routine/feed integration, full-vault pre-snapshot.

### Plan

1. Add main-process `InvocationObservationService`.
2. Before terminal launch, snapshot tagged document only:
   - path, exists/deleted, mtime, size, sha256, UTF-8 content.
3. Extend workspace watcher with subscription/EventEmitter so renderer refresh and invocation observer can consume events.
4. Ignore `.exo` writes and settle/debounce before reading after-state.
5. Keep observation open until the invocation lifecycle ends. V1 lifecycle must support explicit user-ended observation for interactive terminals that keep running, and may also support timeout-ended observation. Do not rely only on terminal process exit.
6. Generate text unified patches under `.exo/invocations/{id}/diffs/`.
7. Record hashes, diff refs, and attribution reasons in `record.json`.
8. Add attribution rules:
   - `likely` only for single invocation, tagged pre-snapshot, observed in window, no conflict/restart/unreadable/missing hash.
   - `ambiguous` for overlaps, out-of-scope files, dirty buffers, user save, restart, unreadable/binary/missing state.
9. Extend open document state with conflict metadata and suspend autosave for dirty-conflicted docs.
10. Add conflict UI actions: view diff, keep my buffer, reload disk.
11. Add invocation diff banner and detail view reusing proposal-review diff styling but without accept/reject.
12. Add internal IPC/preload methods for reading invocation records/diffs; avoid public command-server/CLI/MCP surfaces.

### Tests

- Snapshot/hash/patch generation tests.
- Attribution rule tests.
- Watcher fan-out tests.
- Orphan recovery tests.
- Renderer dirty conflict and autosave suspension tests.
- E2E fake command append, concurrent edit ambiguity, app restart orphan.

### Fable Review Packet

1. Is tagged-document-only snapshot enough for V1?
2. Should orphaned records ever continue observing after restart?
3. First-class `ObservedChange` records or enrich `InvocationChangedFileRef`?
4. Is “likely edited by” acceptable copy, or should labels say only “changed during”?
5. Should dirty-buffer conflict notification to main be IPC, or stay renderer-local?
6. Does internal invocation read/diff IPC need public-contract approval?
7. Need V1 retention setting for `.exo/invocations`, or document follow-up?

### Fable-Amended Worker Brief

- Use tagged-document-only pre-snapshot for V1.
- Record out-of-scope observed files as ambiguous paths without diffs.
- Mark orphaned records on restart unconditionally.
- Use copy based on `Changed during @handle invocation`, with likely/ambiguous badges or qualifiers. Do not say `likely edited by`.
- Consume the shared watcher subscription API from Agent A; do not create a second watcher ownership path.
- Add a mechanical test that `.exo/invocations/` is gitignored.

## Agent F: QA, Docs Closure, Dogfooding, Integration

### Scope

Owns:

- Completion QA gate.
- Automated/manual evidence requirements.
- 10 real pointer-prompt dogfooding plan.
- Docs closure order.
- Cross-agent integration sequencing and stop conditions.

### Plan

Automated matrix must cover:

- graph snapshot/query/UI/properties;
- CLI search/read/status/fallback;
- AgentCommand model/trust/parser/confirmation/launch/spawn;
- direct-write observation/ambiguous attribution/dirty-buffer/orphan/diff UI;
- BrowserPane/command-server trust decision;
- public contract checks;
- removed legacy surfaces.

Manual QA uses `pnpm dev:qa` first and packaged app when app-support/packaging/runtime paths are touched. Evidence bundle includes launch mode, workspace fixture, commands, screenshots for graph/confirmation/diff/trust/dirty-buffer/BrowserPane, and crash/log summary.

Dogfooding:

- 10 real pointer-prompt invocations after fake-command QA passes.
- Start with copied/scratch workspace.
- Runs cover planning note, wikilink note, task note, daily/log note, README/docs note, code-adjacent note, graph-heavy note, ambiguity case, dirty-buffer case, restart/orphan case.
- Release blockers: data loss, untrusted launch, auto-run, invisible direct write, trust contradiction.

Docs closure order:

1. `README.md`
2. `docs/strategy.md`
3. `docs/usability-readiness.md`
4. `docs/README.md`
5. `ledger.md`
6. superseded/historical docs
7. `tasks.md` / `roadmap.md`
8. `docs/public-contract-reviews.md`

Integration order:

1. A deletion/contracts/trust
2. B graph and C CLI/search in parallel where safe
3. D AgentCommand/invocation
4. E direct-write review
5. F QA/docs/dogfooding closure

Stop conditions include data loss, untrusted command launch, auto-run from agent-authored Markdown, command-server mutation exposed to web content without explicit decision, BrowserPane treated as untrusted host too early, public contract change without review, CLI/search requiring MCP, overclaiming attribution, old product path still presented as current, and dogfooding core-loop blocker.

### Fable Questions

1. Is the QA matrix sufficient?
2. Must command-server mutation routes be hardened before V1 completion, or can BrowserPane/web content remain trusted-only?
3. Does `exo spawn` need separate public contract review?
4. Is 10 real pointer-prompt dogfooding a hard branch gate?
5. Should `docs/strategy.md` be rewritten or kept historical with a new current strategy doc?
6. Is the integration order right?
7. Any old Plugin Manager/Routine/MCP/harness surfaces worth temporarily preserving?

## Consolidated Fable Decision Set

The six agent plans reduced to these cross-slice decisions. Fable answered them on 2026-07-08.

1. **MCP fate:** delete `packages/mcp` fully after CLI parity and documented deregistration steps. Do not keep a temporary read/search/status adapter.
2. **Installed cleanup:** remove `exo integrations` immediately. Document manual deregistration in `CHANGELOG.md` and a short cleanup doc.
3. **Command-server auth:** token all routes now. Use a per-runtime random token in `server.json` with restrictive permissions; CLI/app-client read it.
4. **BrowserPane trust:** trusted-only local/localhost for V1. Add cheap hardening now: iframe `sandbox`, main-process URL validation, reject `javascript:`/`data:`, document trusted-only limitation.
5. **Graph model:** promote core graph context with desktop cache and app-internal preload route. Delete `NoteKnowledge` in the same work package once renderer migration is complete.
6. **Graph plugin metadata:** delete old `exo.graph:visualization` capability parsing with Plugin Manager. No legacy adapter.
7. **Search result identity:** canonical identity is `rootId + rootRelativePath`; derive workspace-relative display path only when available.
8. **Provider public fields:** add additive provider/canonical fields now in one reviewed contract change while preserving existing fields.
9. **CLI read-only status:** `exo status` exits `0` when workspace/search status is readable without the app, with app availability clearly labeled.
10. **AgentCommand terminal identity:** add first-class configured-command terminal metadata.
11. **Command execution:** V1 uses shell command string via `/bin/zsh -lc`, shown literally in confirmation and fingerprinted.
12. **CLI trust:** no CLI self-trust in V1. Untrusted/changed command fails with instructions to trust in the app.
13. **CLI `note_dir`:** reject in CLI context with a clear error.
14. **Invocation record shape:** migrate now to `context: note | cli`.
15. **Diff scope:** tagged-document-only pre-snapshot for V1; out-of-scope observed files are recorded as ambiguous paths without diffs.
16. **Orphan behavior:** mark orphaned on restart unconditionally.
17. **Attribution copy:** base copy is `Changed during @handle invocation`, with likely/ambiguous as badges or qualifiers. Avoid `likely edited by`.
18. **Docs strategy:** rewrite `docs/strategy.md` in place.
19. **Dogfooding gate:** 10 pointer-prompt invocations remain a hard branch-completion gate.

## Fable Revisions Incorporated

These were the Fable-required changes. They are now incorporated into the worker briefs above and remain mandatory implementation constraints:

1. **Invocation-end semantics.** V1 uses `terminalInputAfterLaunch` into interactive sessions that often do not exit. The plan must define how an invocation ends: user end gesture in the banner/monitor view, idle timeout, or both. This affects Agent D lifecycle, Agent E observation windows, and Agent F QA.
2. **Dirty tagged document before launch.** Confirmation must save the tagged document or refuse launch while the tagged document is dirty. The pointer prompt and pre-snapshot read disk; they must match the user's visible mention.
3. **Canonical identity.** Search/read uses `rootId + rootRelativePath`, not workspace-relative identity.
4. **Watcher subscription ownership.** One work package must own `WorkspaceWatcherService` subscription/fan-out before graph cache invalidation and invocation observation both consume it.
5. **Command-server token public-contract paperwork.** Token auth for all command-server routes is architecturally approved here, but implementation still must update `docs/public-contract-reviews.md` and `scripts/check-repo.mjs` protected surfaces.
6. **AgentCommand env fields.** If V1 `AgentCommand` has no env field, say so explicitly. If it has env/template fields, they must be included in the executable fingerprint.
7. **Invocation privacy guard.** Add an automated test that `.exo/invocations/` is gitignored because patches may contain private note content.

## Sequencing Revisions

Fable kept the overall A -> B/C -> D -> E -> F sequence with these adjustments:

1. Pull command-server token auth and BrowserPane cheap hardening into Wave 1 under Agent A.
2. Land the watcher subscription API before Agent B graph cache work and Agent E invocation observation work fan out.
3. Resolve invocation-end semantics before Agent D starts implementation because D owns lifecycle states and E hangs observation windows off that lifecycle.

## QA Revisions

Add:

- automated test that `.exo/invocations/` is gitignored;
- automated test that unsaved tagged buffer blocks or force-saves at confirmation;
- automated test that a never-exiting interactive invocation can reach a resolved state via the chosen end mechanism;
- packaged-app QA for trust store persistence and invalidation;
- at least two `exo spawn` dogfooding runs in addition to note-invocation runs;
- command-server-token regression check that CLI still works after token auth;
- release blocker: invocation banner stuck in running forever.

## Implementation Fan-Out Readiness

Planning is complete for implementation fan-out once worker briefs use this document as source of truth. The first implementation wave is:

1. Agent A: delete old surfaces where audited, add command-server token auth, BrowserPane V1 hardening, watcher subscription API, and neutral store-path helper.
2. Agent B and Agent C: proceed in parallel after Agent A lands watcher API and search/graph capability decoupling blockers are clear.
3. Agent D: start only after invocation-end semantics and dirty tagged-document behavior are accepted in code review notes.
4. Agent E: start after Agent D record/lifecycle shape exists and watcher subscription API is available.
5. Agent F: run continuously as verification owner, with packaged-app trust QA and 10 pointer-prompt dogfooding as hard completion gates.

-- Exo | 2026-07-08
