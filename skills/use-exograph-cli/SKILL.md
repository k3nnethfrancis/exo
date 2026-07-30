---
name: use-exograph-cli
description: Use the local `exo` CLI to discover Exograph workspaces, inspect workspace and search health, retrieve relevant Markdown context, maintain the local index, open notes, or invoke configured terminal Commands. Use when Exograph can provide workspace orientation, indexed knowledge, or note paths before acting.
---

# Use Exograph CLI

Exograph is a local-first Markdown editor and knowledge-graph interface. Its
`exo` CLI supplements native filesystem tools; it does not replace them.

## Route the task

- Find available workspaces: `exo workspaces`
- Inspect roots, app availability, and search health:
  `exo status --workspace <id|label|path>`
- Find relevant notes:
  `exo search "<query>" --limit 10 --workspace <id|label|path>`
- Continue results: repeat the search with `--cursor <next_cursor>`
- Read or edit content: use the returned absolute `path` with native filesystem
  tools.
- Inspect or refresh the derived index: `exo index status` or `exo index sync`
- Show Exograph or open a note: `exo show` or `exo open <path>`
- Run a configured Command: `exo invoke @handle "<task>"`
- See the canonical surface: `exo --help` or `exo <command> --help`

`status` and `search` work without the desktop app. Index maintenance, opening
notes, and invocation require Exograph to be running.

## Useful sequences

Orient, then retrieve:

```sh
exo workspaces
exo status --workspace notes
exo search "invocation trust and review" --limit 10 --workspace notes
```

Refine broad results before reading files:

```sh
exo search "graph ontology" --limit 5 --workspace notes
exo search "ontology relation evidence" --limit 5 --workspace notes
```

Prefer exact filesystem search for known strings or paths. Prefer `exo search`
when meaning, workspace scope, or indexed context matters. Never invoke a
configured Command merely to retrieve context.
