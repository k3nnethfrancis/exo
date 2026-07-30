# Exograph documentation

Exograph has two documentation audiences: people using a Markdown workspace and people changing the software. Start with the document that matches your job; the deeper contracts are linked from there.

## Use Exograph

- [Using Exograph](using-exograph.md) — workspaces, Notes, navigation, panes, keyboard shortcuts, and daily work.
- [Search](search.md) — immediate search, optional QMD indexing, and recovery.
- [Knowledge graph](knowledge-graph.md) — what the graph represents and what it deliberately does not.
- [Agent invocations](document-agent-protocol.md) — inline `@` requests, review, durable response blocks, and session handoff.
- [CLI and MCP](cli.md) — shell commands, app-off behavior, and the bounded MCP server.
- [Workspace ontology](workspace-ontology.md) — optional `ontology.yaml` interpretation and review.
- [Note Root Formats](note-root-formats.md) — Generic Markdown and OKF 0.1 compatibility.
- [Troubleshooting](troubleshooting.md) — first repairs for workspace scope, search, invocations, MCP, and CLI.

## Contribute to Exograph

- [Architecture](architecture.md) — runtime topology, deep modules, boundaries, and reading order.
- [Durable state](durable-state.md) — persistence owners and recovery rules.
- [Performance contracts](performance-contracts.md) — protected latency budgets and focused gates.
- [Terminal runtime](terminal-runtime-decision.md) — direct-PTY design constraints.
- [Architecture decisions](adr/) — accepted decisions that remain live.
- [Contributor skills](../skills/README.md) — reusable, provider-neutral working instructions.

The repository root has [setup and contribution guidance](../README.md) plus
[agent guidance](../AGENTS.md). `docs/internal/`, when it exists locally, is
ignored maintainer context; it is never public product documentation.
