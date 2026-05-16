# QMD Integration Plan

## Reference

- Upstream: <https://github.com/tobi/qmd>
- Local reference clone: `/Users/kenneth/Desktop/lab/projects/reference/qmd`
- Investigated commit: `746beedb4863524d337332109dc624a0be0b5aa7`
- License: MIT, copyright Tobi Lutke

QMD is Tobi Lutke's on-device markdown retrieval engine. Exo should present this as an integration with QMD, not as Exo-originated retrieval work. If Exo bundles QMD as a dependency or vendors any source, include the MIT license and a third-party notice.

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

First-run onboarding should require the user to choose or create a notes folder. Exo should not ship a fake vault as user data.

After the notes folder choice, offer notes indexing as an explicit local feature:

- Off: filename/path search only.
- Lexical: local SQLite/FTS index, no models.
- Semantic: lexical plus embeddings.
- Full: semantic plus query expansion/reranking.

The copy should name QMD and credit it. The UI should explain that indexing creates a local SQLite copy of markdown content and that semantic/full modes may download local GGUF models.

Detect existing QMD setups as an import/reuse option, not as the default:

- Check for `qmd` on PATH.
- Check `~/.config/qmd/index.yml` and configured collections.
- If a collection already points at an Exo note root, offer to reuse or import its config.
- Keep Exo-managed storage the recommended path for new users.

## Indexing Policy

Initial implementation should be explicit and conservative:

- No automatic full-vault indexing until the user enables the notes index.
- Run lexical `update()` on setup and by manual command.
- Add debounced incremental reindex after filesystem watcher events once the manual path is stable.
- Add embeddings only when the selected compute profile includes semantic mode.
- Expose reindex controls in settings: manual, on app start, on file save/watch, scheduled interval.

Use QMD's `update()`/`reindexCollection()` and `embed()` APIs instead of shelling out when bundled. Keep a CLI fallback only for environments where the SDK cannot be loaded.

## CLI

Add explicit notes-index commands rather than overloading fast search:

- `exo notes index status`
- `exo notes index update`
- `exo notes index embed`
- `exo notes query <query>`
- `exo notes get <path-or-docid>`
- `exo notes multi-get <pattern>`

Keep `exo notes search` as fast filename/path search until the UI and CLI intentionally expose retrieval tiers.

## MCP

Add Exo MCP tools that mirror QMD's useful primitives but with Exo naming and policy:

- `notes_index_status`
- `search_notes`
- `query_notes`
- `get_note`
- `multi_get_notes`
- `refresh_notes_index`

The MCP tools should call Exo's command server, not instantiate their own QMD store. That keeps all agents pointed at the same desktop-managed index and lets the desktop enforce cancellation, caps, status, and settings.

For agent guidance, update Exo runtime instructions from "QMD is future infrastructure" to "use Exo notes tools when available." Continue to credit QMD in documentation and settings.

## UI

Keep the current explorer search fast and separate.

Add a notes-index status area in workspace settings:

- enabled tier
- indexed note roots
- document count
- pending embeddings
- last update time
- update/embed buttons
- attribution/link to QMD

Later, add a deliberate "deep search" mode in the search pane rather than silently mixing lexical filename results with semantic retrieval.

## Risks

- Native dependencies: QMD depends on `better-sqlite3`, `sqlite-vec`, and `node-llama-cpp`. Electron packaging and native rebuilds need validation before bundling QMD directly into the desktop app.
- Model downloads: semantic/full modes need clear progress, cancellation, and disk-use visibility.
- Latency: QMD query expansion/reranking can be too slow for live UI search; keep it explicit and cancellable.
- Privacy: the QMD DB contains note content. Store it under ignored Exo runtime state and disclose this in onboarding/settings.
- Licensing: Exo is Apache-2.0; QMD is MIT. Dependency use is compatible, but vendored source requires preserving license notices.

## Implementation Slices

1. Dependency spike: add `@tobilu/qmd` behind a small `@exo/core` adapter and prove lexical update/search against test fixtures.
2. Exo-managed storage: create `.exo/qmd`, derive collections from selected note roots, and expose status/update routes on the command server.
3. CLI and MCP: add notes-index commands and MCP tools backed by command-server routes.
4. Settings UI: add indexing tier, root list, status, update button, and attribution.
5. Semantic tier: add embed controls, model status, and guarded query/rerank paths.
6. Watch/reindex policy: wire debounced note-root watcher events after manual update is reliable.
7. Existing QMD import: detect PATH/config collections and offer import/reuse once Exo-managed indexing works.
