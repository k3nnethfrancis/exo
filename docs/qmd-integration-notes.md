# QMD Integration Notes

Last updated: 2026-05-17

This file tracks Exo's live dependency boundary with QMD. Use `docs/qmd-integration-plan.md` for longer-term product direction; use this file when upgrading QMD or changing Exo's adapter.

## Dependency Policy

- Exo depends on the published `@tobilu/qmd` package, currently pinned to `2.1.0`.
- Exo does not vendor QMD source and does not patch `node_modules`.
- All runtime QMD usage should stay behind `packages/core/src/qmd.ts`.
- QMD is MIT licensed. If Exo ever vendors QMD source, preserve upstream license notices and add a third-party notice.
- Prefer upstream QMD issues/PRs for missing indexing capabilities instead of carrying an Exo fork.

## Public APIs Exo Uses

Exo creates one QMD store per operation with Exo-managed runtime storage:

- `createStore({ dbPath, config })`
- `store.getStatus()`
- `store.update({ collections })`
- `store.embed(...)`
- `store.searchLex(...)`
- `store.searchVector(...)`
- `store.search(...)`
- `store.get(...)`
- `store.getDocumentBody(...)`
- `store.close()`

The QMD database lives at `<workspaceRoot>/.exo/qmd/index.sqlite`.

## Current Exo Behavior

- Settings can enable QMD-backed indexing in lexical, semantic, or hybrid mode.
- The footer status pill reports disabled, empty, ready, syncing, warning, and error states.
- The Settings Index panel exposes `Sync index` as the primary action.
- `Sync index` runs document refresh first; semantic and hybrid modes then build embeddings.
- Advanced controls keep document refresh and embedding build available as separate phases.
- Applying changed index configuration triggers a full sync.
- The default save trigger is conservative: note saves refresh only the matching indexed root and defer embeddings.
- Live Explore typing remains filename/path search; pressing Enter can run QMD lexical search when enabled.
- CLI exposes status, search, read, sync, update, and embed flows through the running Exo command server. MCP exposes the narrower agent-facing search/read primitives, with index status summarized in `workspace_status`.
- QMD remains the default local provider. New product docs should describe Exo search in provider-neutral terms unless they are specifically documenting the QMD adapter.

## Known QMD Gaps And Exo Workarounds

- QMD does not currently expose a public single-file update/delete API.
- Exo therefore uses collection-scoped `store.update({ collections })` for save-triggered refreshes.
- QMD embedding is heavier than lexical update and can make the desktop less responsive if run too frequently.
- Exo defers embeddings on note save and reserves embedding builds for explicit `Sync index` or settings Apply.
- Search should remain safe while embeddings are building; Exo reports warnings and falls back to lexical/filesystem behavior where possible.

## Desired Upstream QMD Capabilities

- `updateFile(collection, absolutePath)` for changed-file refresh.
- `removeFile(collection, absolutePath)` for deleted-file cleanup.
- A way to embed pending chunks for a bounded document set.
- Progress/cancellation hooks that Exo can surface in the desktop footer and MCP/CLI responses.
- Clear status fields for "embedding model loading", "embedding in progress", and "search fallback active".

## Upgrade Checklist

When updating QMD:

1. Read QMD release notes for SDK shape, native dependency, and model/runtime changes.
2. Re-run adapter tests in `packages/core/src/__tests__/qmd.test.ts`.
3. Re-run CLI tests for status, search, sync, update, and embed command-server routes plus MCP tests for `workspace_status`, `search`, and `read_document`.
4. Smoke-test desktop Settings Index panel and footer status.
5. Confirm `.exo/qmd/` storage remains workspace-local and ignored.
6. Update this file if Exo removes a workaround or relies on a new QMD API.
