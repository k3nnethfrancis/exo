# QMD Integration Plan

Historical note: this plan predates the MCP surface cleanup. QMD-backed `search` and `read_document` remain MCP tools, while index maintenance and project-root administration now stay in CLI/UI operator surfaces.

## Reference

- Upstream: <https://github.com/tobi/qmd>
- Investigated commit: `746beedb4863524d337332109dc624a0be0b5aa7`
- License: MIT, copyright Tobi Lutke

QMD is Tobi Lutke's on-device markdown retrieval engine. Exo should present this as an integration with QMD, not as Exo-originated retrieval work. If Exo bundles QMD as a dependency or vendors any source, include the MIT license and a third-party notice.

For the current live adapter contract, known gaps, and upgrade checklist, see `qmd-integration-notes.md`.

## What QMD Provides

QMD has three usable surfaces:

- CLI: `qmd collection`, `qmd update`, `qmd embed`, `qmd search`, `qmd vsearch`, `qmd query`, `qmd get`, `qmd multi-get`, `qmd status`, and `qmd mcp`.
- SDK: `createStore({ dbPath, config | configPath })` with collection management, lexical search, vector search, hybrid query, document retrieval, status, update, and embed operations.
- MCP: tools `query`, `get`, `multi_get`, and `status`, plus `qmd://` document resources.

QMD stores indexed content in SQLite, uses FTS/BM25 for fast lexical search, optionally uses `sqlite-vec` for vector search, and lazily imports `node-llama-cpp` for local GGUF embedding, expansion, and reranking. Lexical indexing works without model downloads; semantic retrieval and reranking require local models.

## Exo Direction

Exo should not ask users or agents to configure a separate QMD MCP server. Exo should own one MCP server and expose QMD-backed notes tools through that server.

The clean architecture is:

1. Exo settings define note roots and notes-index preferences.
2. Exo core owns a QMD adapter backed by the QMD SDK where possible.
3. The desktop command server exposes notes-index routes.
4. The Exo CLI calls those routes when the app is running, with offline/local commands for explicit maintenance where useful.
5. The Exo MCP server calls the Exo command server and exposes notes tools to agents.

This keeps one MCP endpoint named `exo`, one runtime state directory, one onboarding flow, and one place to apply privacy and performance policy.

## Storage And Config

Use Exo-managed files under the ignored runtime root:

- DB: `<workspaceRoot>/.exo/qmd/index.sqlite`
- generated config, if needed: `<workspaceRoot>/.exo/qmd/index.yml`
- status/locks/logs: `<workspaceRoot>/.exo/qmd/`

Do not use `~/.config/qmd` or `~/.cache/qmd` for Exo-managed indexes by default. That avoids cross-workspace leakage and makes it obvious the index is local runtime state. Keep `.exo/` ignored.

Collection names should come from attached note roots, using stable sanitized labels:

- first note root can be `notes`
- additional roots can use their root label with suffixes for collision avoidance
- project roots stay excluded unless the user explicitly opts in later

## Onboarding

First-run onboarding should use the same workspace create/select surface as workspace switching. It should require the user to choose or create a notes folder before the app shell is shown. Exo should not ship a fake vault as user data, and it should not silently create the user's primary notes location.

Project folders are optional during setup and should be managed through native folder selection plus a removable list, not a comma- or newline-separated text box. Source builds can include the Exo repo as the default project folder, but users must be able to add or remove project folders explicitly.

The selected notes folder is the initial workspace boundary for Exo runtime state. That keeps `.exo/qmd` and related local state scoped to that notes folder by default, so separate notes folders can have separate indexes. Switching workspaces should return to the workspace create/select surface rather than editing a raw path in place.

During workspace setup, show and allow changing the default terminal folder and notes indexing settings so users learn those concepts before entering the app:

- Off: filename/path search only.
- Lexical: local SQLite/FTS index, no models.
- Semantic: lexical plus embeddings.
- Hybrid: semantic plus query expansion/reranking.

The copy should name QMD and credit it. The UI should explain that indexing creates a local SQLite copy of markdown content and that semantic/full modes may download local GGUF models.

Detect existing QMD setups as an import/reuse option, not as the default:

- Check for `qmd` on PATH.
- Check `~/.config/qmd/index.yml` and configured collections.
- If a collection already points at an Exo note root, offer to reuse or import its config.
- Keep Exo-managed storage the recommended path for new users.

## Indexing Policy

Initial implementation is explicit and conservative:

- No automatic full-vault indexing until the user enables the notes index.
- Run document refresh and embeddings through a user-visible `Sync index` action.
- Trigger a full sync when index configuration changes and the user applies settings.
- Debounce note-save refreshes and scope them to the matching indexed root.
- Defer embeddings on note save; semantic/hybrid users can rebuild embeddings with `Sync index`.
- Keep future reindex controls open for app start, scheduled interval, and git events.

Use QMD's public SDK APIs instead of shelling out when bundled. Current QMD exposes collection-scoped `update({ collections })`, not a public single-file update/delete API.

## CLI

Expose explicit index commands rather than overloading fast search:

- `exo index status`
- `exo index sync`
- `exo index update`
- `exo index embed`
- `exo search <query>`
- `exo read <path-or-docid>`

Live Explore typing remains fast filename/path search. Indexed retrieval is explicit through Enter in Explore when enabled, through CLI index/search commands, and through MCP `search`.

## MCP

Current MCP exposes only the agent-facing QMD primitives:

- `search`
- `read_document`

Index status is summarized in `workspace_status`. Index maintenance stays in CLI/UI. MCP tools should call Exo's command server, not instantiate their own QMD store. That keeps all agents pointed at the same desktop-managed index and lets the desktop enforce cancellation, caps, status, and settings.

Agent-facing search responses should report fallback/warning state when embeddings are not ready or QMD is disabled. Continue to credit QMD in documentation and settings.

## UI

Keep the current explorer search fast and separate.

The current notes-index status surfaces are:

- footer status pill
- Settings Index panel
- indexed note roots
- document count
- pending embeddings
- last update time
- primary `Sync index` button
- advanced refresh/embed phase buttons
- attribution/link to QMD

Live search should remain snappy. Heavy semantic retrieval should stay explicit, cancellable, and visible.

## Risks

- Native dependencies: QMD depends on `better-sqlite3`, `sqlite-vec`, and `node-llama-cpp`. Electron packaging and native rebuilds need validation before bundling QMD directly into the desktop app.
- Model downloads: semantic/full modes need clear progress, cancellation, and disk-use visibility.
- Latency: QMD query expansion/reranking can be too slow for live UI search; keep it explicit and cancellable.
- Privacy: the QMD DB contains note content. Store it under ignored Exo runtime state and disclose this in onboarding/settings.
- Licensing: Exo is Apache-2.0; QMD is MIT. Dependency use is compatible, but vendored source requires preserving license notices.

## Implementation Slices

1. Dependency spike: add `@tobilu/qmd` behind a small `@exo/core` adapter and prove lexical update/search against test fixtures.
2. Exo-managed storage: create `.exo/qmd`, derive collections from selected note roots, and expose status/update routes on the command server.
3. CLI and MCP: add notes-index commands and MCP tools backed by command-server routes. Completed with CLI status/search/read/sync/update/embed and narrow MCP search/read.
4. Settings UI: add indexing tier, root list, status, update button, and attribution. Completed for the current Index panel.
5. Semantic tier: add embed controls, model status, and guarded query/rerank paths. Partially complete; improve progress/cancellation and performance.
6. Watch/reindex policy: wire debounced note-root watcher events after manual update is reliable. Partially complete with collection-scoped save refreshes; true file-level updates need upstream QMD support.
7. Existing QMD import: detect PATH/config collections and offer import/reuse once Exo-managed indexing works.
