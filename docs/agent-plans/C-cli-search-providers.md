# Agent C Plan: CLI And Search Provider Hardening

Last updated: 2026-07-09

status: Fable-reviewed planning packet. Planning only; implementation must follow the amendments below.

## Fable Amendments

- Approved: `rootId + rootRelativePath` plus `documentKey` as canonical search/read document identity.
- Approved: provider-neutral additive fields while preserving existing fields during the branch.
- Approved: QMD is one provider; QMD semantic/hybrid degradation to QMD lexical can remain internal, but QMD failure falls back through the search service to filesystem.
- Approved: later document hydration where providers own relevance/snippets and Exo joins note metadata/graph context.
- Settled symlink rule: resolve real path for identity, preserve the user's/display path separately.
- Renderer/main preload IPC is app-internal; CLI, command-server, and `command-protocol.ts` are public contracts.

## Scope

Own the Exograph read/search CLI path without MCP:

- CLI `status`, `search`, `read`, and `index status` as durable local orientation commands.
- QMD as the bundled advanced provider.
- Filesystem lexical fallback as a real provider, not a hidden emergency branch.
- Provider-neutral result/status fields that do not depend on the old plugin/capability product.
- Canonical document identity: `rootId + rootRelativePath`.
- Custom provider seam preservation through the in-process `SearchProvider` contract.
- Documentation of later document metadata hydration: provider relevance/snippets are joined with Exo-owned document metadata and graph context in a later layer.

## Non-Goals

- No MCP replacement or MCP compatibility adapter.
- No Plugin Manager, marketplace, manifest execution, or out-of-process provider protocol.
- No graph UI or graph cache implementation.
- No AgentCommand invocation or `exo spawn` launch behavior.
- No broad directory/index navigation command family beyond what the current completion plan already names.
- No full document hydration in this branch; record the follow-up and keep V1 result fields additive.

## Evidence Checked

- `docs/exograph-refactor-completion-plan.md`: Phase 3 requires CLI search/read/status without MCP, QMD plus fallback, and custom provider seams.
- `docs/exograph-completion-orchestration-plan.md`: Agent C owns provider-neutral status, QMD/fallback, path canonicalization, and CLI behavior.
- `docs/exograph-detailed-implementation-plans.md`: Fable-amended Agent C brief requires `rootId + rootRelativePath`, provider-neutral additive fields, metadata decoupling, local `exo status`, and service-owned filesystem fallback.
- `docs/extension-architecture.md`: V1 typed extension seam is search/index providers only; providers own relevance while Exo owns document identity and graph.
- `docs/plugin-system-architecture.md`, `docs/plugins.md`, `docs/plugin-implementation-plan.md`: historical plugin platform docs are superseded; only search-provider concepts should be salvaged for V1.
- `tasks.md`: WP3 is marked complete, but WP1 plugin-registry cleanup is still open and depends partly on preserving search-provider boot.
- `issues.md`: `EXO-ISSUE-100` names CLI search/read/status and custom search provider seams as survival requirements during deletion.
- `packages/core/src/search-provider.ts`: `SearchProviderMetadata` is already provider-owned, not `CapabilityMetadata`.
- `packages/core/src/search-provider-registry.ts`: built-in registry already registers `filesystem` and `qmd`; default remains QMD.
- `packages/core/src/search-providers/qmd-provider.ts`: QMD owns search/read/status/update/embed/sync, but still performs filesystem fallback internally.
- `packages/core/src/search-providers/filesystem-provider.ts`: filesystem provider exists and uses `searchWorkspace` / `readWorkspaceDocument`.
- `packages/core/src/qmd.ts`: public compatibility facade still delegates to the default provider.
- `packages/core/src/types.ts`: `IndexBackend`, result `source`, and response shape remain hardcoded to `qmd | filesystem`; results lack canonical identity.
- `packages/core/src/graph.ts` and `graph-snapshot.ts`: graph nodes already carry `rootId`; this should inform search document identity but not make providers implement graph semantics.
- `packages/cli/src/index.ts`: `exo status`, `search`, `read`, and `index status` already work without the app by calling core directly when command-server discovery fails.
- `packages/cli/src/index.test.ts`: current tests cover app-unavailable status/index status and app-routed search limits.
- `apps/desktop/src/main/command-server.ts`: `/search`, `/read`, and `/index/status` are token-authenticated command-server routes over core search/index behavior.

## Current State

Already done:

- MCP is no longer required for CLI search/read/status.
- CLI app-unavailable fallback exists for `exo status`, `exo search`, `exo read`, and `exo index status`.
- `SearchProviderMetadata` is decoupled from old `CapabilityMetadata`.
- QMD and filesystem providers both implement the `SearchProvider` interface.
- Search fallback is warning-bearing.
- Command-server search/read/status routes require the runtime token.

Remaining hardening:

- Fallback ownership is split incorrectly: QMD currently opens filesystem search itself when QMD is off or broken.
- `IndexStatus` reports only one backend at a time and does not clearly describe provider selection, fallback activity, app availability, and index health as one status object.
- Result identity is still mostly `filePath` plus optional QMD `docid`; there is no stable `rootId + rootRelativePath` document key.
- Provider result types still use hardcoded `source: "qmd" | "filesystem"` and `IndexBackend = "filesystem" | "qmd"`, which constrains custom providers.
- QMD path resolution is ad hoc and collection-name based.
- Filesystem lexical recall is useful but shallow; scoring is currently flat and path/body/title/tag ranking is not explicit.
- Later document hydration is documented in architecture, but not captured as a named follow-up artifact owned by this slice.

## Add

1. `packages/core/src/search-paths.ts`
   - Resolve canonical document identity from absolute paths and workspace roots.
   - Output:
     - `rootId`
     - `rootRelativePath`
     - `documentKey` or `canonicalDocumentId`
     - `absolutePath`
     - optional `workspaceRelativePath` for display only.
   - Prefer the most-specific matching root if roots overlap.
   - Reject outside-root paths for shared search/read identity.

2. `packages/core/src/search-service.ts`
   - Own provider selection, provider status composition, fallback policy, and canonicalization.
   - Treat QMD as one provider and filesystem as the core fallback provider.
   - Keep QMD semantic/hybrid to QMD lexical degradation inside QMD with warnings, because it is still the same provider and index.
   - Move QMD-open failure and QMD lexical failure to service-level filesystem fallback.

3. Provider-neutral additive fields on search/read/status responses:
   - `providerId`
   - `providerLabel`
   - `fallbackActive`
   - `fallbackReason`
   - `documentKey` or `canonicalDocumentId`
   - `rootId`
   - `rootRelativePath`
   - `workspaceRelativePath` when applicable
   - `providerDiagnostics` for QMD docid/collection/native failure details.

4. Tests for canonical identity and service fallback:
   - duplicate basenames across roots;
   - note root outside workspace root;
   - project/index root outside workspace root;
   - overlapping roots;
   - symlink behavior: resolve real paths for identity and preserve display paths separately;
   - stale QMD result outside configured roots;
   - QMD open failure to filesystem fallback;
   - QMD lexical failure to filesystem fallback;
   - QMD semantic/hybrid vector failure to QMD lexical warning.

5. Docs follow-up:
   - Add a short `docs/search-provider-contract.md` or a section in `docs/extension-architecture.md` after implementation.
   - Record deferred document metadata hydration as V2: providers return relevance/snippets/chunks keyed by canonical document identity; Exo later hydrates frontmatter, graph properties, tags, backlinks, outgoing links, and neighborhood summary.

## Delete

- Delete QMD's internal filesystem fallback branch after `search-service.ts` owns fallback.
- Delete or stop exporting any search-provider API that requires `CapabilityMetadata`.
  - Current evidence suggests this is already done for `SearchProviderMetadata`; implementation should verify with `rg`.
- Delete stale CLI/help copy that says `index status` is app-only.
- Delete any tests that assert QMD owns filesystem fallback directly; replace them with service tests.
- Do not delete the `SearchProvider` interface, QMD provider, filesystem provider, or provider registry.

## Modify

- `packages/core/src/types.ts`
  - Add provider-neutral fields while preserving existing `filePath`, `source`, `docid`, and `backend` for compatibility.
  - Consider widening provider ids to `string` in additive fields before changing existing unions.

- `packages/core/src/qmd.ts`
  - Keep as compatibility facade for now, but delegate to `search-service.ts` rather than directly to `defaultSearchProvider()`.
  - Keep update/embed/sync app/admin semantics QMD-owned unless a later provider chooses to support them.

- `packages/core/src/search-provider.ts`
  - Keep provider interface in-process and metadata-only.
  - Add optional provider diagnostics only if needed by service/result types.

- `packages/core/src/search-providers/qmd-provider.ts`
  - Narrow to QMD behavior.
  - Resolve QMD result paths through shared canonical identity helper.
  - Preserve QMD lexical fallback warnings for semantic/hybrid degradation.

- `packages/core/src/search-providers/filesystem-provider.ts`
  - Improve lexical ranking enough for agent orientation:
    - title/path hits rank above body-only hits;
    - tags/frontmatter hits are visible in snippets;
    - stable deterministic order for equal scores.
  - Attach canonical document identity to every result.

- `packages/core/src/search-provider-registry.ts`
  - Preserve in-process registry and built-in registration.
  - Do not make registry depend on plugin manifests.

- `packages/cli/src/index.ts`
  - Keep app-first behavior when the app is reachable.
  - Keep local read/search/status behavior when the app is unavailable.
  - Make `exo status` explicitly label:
    - app availability;
    - workspace roots;
    - selected/default provider;
    - fallback provider;
    - index health;
    - warnings/errors.
  - Keep mutating index commands (`sync`, `add`, `remove`, `update`, `embed`) app-owned.

- `apps/desktop/src/main/command-server.ts`
  - Return additive provider/canonical fields from existing `/search`, `/read`, and `/index/status` routes.
  - No new route required for this slice unless Fable approves.

## Sequencing And Dependencies

1. Contract inventory
   - Freeze exact existing response fields from CLI, command-server, and shared types.
   - Confirm `scripts/check-repo.mjs` public-contract slices that would need review hash updates.

2. Canonical identity helper
   - Implement and test `rootId + rootRelativePath` before changing provider outputs.
   - Coordinate with Agent B so graph and search use compatible root ids but do not share a graph cache dependency.

3. Search service
   - Add service over existing providers.
   - Move filesystem fallback out of QMD.
   - Keep QMD update/embed/sync behavior stable.

4. Additive result/status fields
   - Add new fields without removing current fields.
   - Update CLI and command-server snapshots/tests.
   - Update public-contract review notes if guarded slices change.

5. Filesystem recall hardening
   - Improve ranking/snippets after service/canonical identity is stable.
   - Keep this deterministic and small; no new indexing database.

6. Docs and follow-up capture
   - Document the search-provider V1 contract and the later document metadata hydration plan.
   - Update `tasks.md` only after implementation and tests pass.

Dependencies:

- Agent A must not delete provider registry/search modules before this plan lands or explicitly replace their callers.
- Agent B graph work can proceed in parallel as long as root ids remain stable.
- Agent D/E can consume CLI search/read/status after service result shape is stable.
- Agent F owns final dogfooding and CLI QA but should use this test matrix.

## Public CLI Contract Implications

This slice touches public-ish local contracts:

- CLI JSON output for `exo status`, `exo search`, `exo read`, `exo index status`.
- Command-server JSON output for `/search`, `/read`, `/index/status`.
- Shared `@exo/core` response types.

Recommended contract posture:

- Treat new provider/canonical fields as additive and reviewed in one batch.
- Preserve existing fields during this branch:
  - `filePath`
  - `title`
  - `snippet`
  - `score`
  - `docid`
  - `source`
  - `backend`
  - `warnings`
  - `errors`
- Do not add new CLI commands or command-server routes in this slice unless Fable approves.
- Update `docs/public-contract-reviews.md` and `scripts/check-repo.mjs` only if the guarded slices change.

## Tests And QA

Core tests:

- `packages/core/src/__tests__/search-paths.test.ts`
- `packages/core/src/__tests__/search-service.test.ts`
- Update `qmd.test.ts` to distinguish QMD lexical degradation from service-level filesystem fallback.
- Update `search-provider-registry.test.ts` to prove custom in-process providers still register without plugin/capability metadata.
- Filesystem provider tests for title/path/tag/body ranking and deterministic ordering.

CLI tests:

- `exo status` exits `0` with no app and labels app unavailable plus local search status.
- `exo search` exits `0` with no app and returns canonical document fields.
- `exo read` exits `0` with no app for absolute path and canonical document identity.
- `exo index status` exits `0` with no app and reports provider/index/fallback state.
- App-reachable behavior still delegates to command-server routes.

Command-server tests:

- `/search` returns additive provider/canonical fields.
- `/read` returns canonical identity for path and QMD docid reads.
- `/index/status` includes provider status and remains token-authenticated.
- QMD failure warning remains visible rather than reporting a healthy index.

Manual/QA:

- Run `exo status`, `exo search`, `exo read`, and `exo index status` with the app stopped.
- Run the same commands with the app running.
- Test QMD disabled/off, QMD lexical, QMD hybrid without embeddings, and simulated native QMD failure.
- Verify no MCP package or MCP config is required.

Gate:

```bash
pnpm --filter @exo/core test
pnpm --filter @exo/cli test
pnpm --filter @exo/desktop test -- command-server
pnpm --filter @exo/core typecheck
pnpm --filter @exo/cli typecheck
pnpm --filter @exo/desktop typecheck
pnpm check:repo
```

## Open Unknowns

1. Should `IndexBackend` / result `source` be widened to `string` now, or should V1 keep old unions and add `providerId: string`?
   - Recommendation: keep old unions for compatibility, add `providerId: string`, and widen only when a second non-built-in provider exists.

2. What exact field name should represent canonical identity?
   - Recommendation: `documentKey` for `rootId:rootRelativePath`, plus explicit `rootId` and `rootRelativePath`. Use `canonicalDocumentId` only if the broader graph model already uses that term elsewhere.

3. How should symlinks be represented?
   - Recommendation: canonicalize by resolved real path for safety, but preserve display path when it is under an attached root. Stop for Fable if this conflicts with note-root identity expectations.

4. Should `exo read` accept `rootId:rootRelativePath` directly?
   - Recommendation: defer unless already needed by Agent D/E. Add fields first; add a new input format only after public-contract review.

5. Should provider health include all registered providers or only selected/default plus fallback?
   - Recommendation: V1 status reports selected/default provider and fallback provider. Full provider inventory belongs to a later provider diagnostics surface, not Plugin Manager.

6. Does filesystem fallback search all attached roots or only indexed roots?
   - Recommendation: search attached note/project roots for orientation, but label results with canonical root identity and keep status clear that this is fallback, not indexed search.

7. Where should document metadata hydration live later?
   - Recommendation: a separate Exo-owned `document-result-hydration` layer after graph context stabilizes. Providers should never own frontmatter/backlinks/neighborhood semantics.

## Fable Review Packet

Questions for Fable, routed by the orchestrator:

1. Approve additive provider/canonical fields on CLI, command-server, and shared core response types in one batch?
2. Approve `documentKey` as the V1 canonical identity field, with explicit `rootId` and `rootRelativePath`?
3. Confirm service-owned filesystem fallback, with only QMD semantic/hybrid to QMD lexical degradation remaining inside QMD.
4. Confirm `exo status` should exit `0` when app discovery fails but local workspace/search status is readable.
5. Confirm mutating index commands stay app-owned in V1 while `index status` can run locally.
6. Confirm keeping the in-process `SearchProvider` registry as the only active typed extension seam, with no Plugin Manager dependency.
7. Confirm deferring full document metadata hydration while documenting the future join of provider snippets/chunks with Exo-owned graph/document metadata.

Agent C recommendation:

- Proceed with this plan after Fable review.
- Keep changes additive at public boundaries.
- Move fallback orchestration into `search-service.ts`.
- Use `rootId + rootRelativePath` immediately in search/read outputs.
- Preserve QMD and filesystem providers as compiled-in providers only; do not reintroduce plugin-manager setup or manifest execution.

## Stop Conditions

Stop and escalate before implementation continues if:

- A new CLI command, command-server route, or shared protocol field is required and not covered by Fable/public-contract review.
- Provider execution would require loading user/workspace plugin code.
- A provider result cannot be mapped to an attached/indexed root but would still be exposed as trusted document identity.
- QMD fallback hides errors from status/admin surfaces.
- Filesystem fallback starts writing indexes or state.
- Graph/document metadata semantics are pushed into provider implementations.
- Deletion work removes search-provider internals before service/canonical identity replacement lands.

-- Exo | 2026-07-09
