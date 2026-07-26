# Search

Exo has two local search paths. They share the same workspace content policy: only Markdown selected as workspace content becomes a searchable Note.

## Immediate search

The workspace search field always starts with filename and path matches. It is fast because it uses loaded workspace metadata rather than parsing every Note body while you type.

## Indexed search

Choose **Settings → Search → QMD** to enable an optional local index. Choose a retrieval mode:

| Mode | Uses | Good for |
| --- | --- | --- |
| Lexical | words and phrases | exact names, terms, and paths |
| Semantic | local embeddings | related concepts with different wording |
| Hybrid | both | the normal default when semantic search is useful |

When **Use QMD when I press Enter in Explore** is enabled, Enter in the search field uses this index. The CLI and MCP search routes use the configured index only when the running app has the same resolved workspace; otherwise they use bounded filesystem retrieval and report that honestly.

## Index maintenance

**Sync documents** reconciles the current Markdown corpus. **Reconcile documents** is the recovery-oriented version when an index may be stale. **Build embeddings** fills semantic work that remains pending; it is unavailable in lexical mode.

Indexing runs outside the Electron main process. During maintenance, foreground retrieval can fall back to filesystem search rather than waiting behind the writer. Pending embeddings do not make Notes unavailable: lexical retrieval continues to work.

The QMD database is local derived state under the workspace `.exo/` runtime. It can be rebuilt; it is not the source of truth. See [Durable state](durable-state.md) and [Performance contracts](performance-contracts.md) for the implementation and latency boundaries.
