# Exo Public Surface Ledger

> Historical Wave-1 keep/delete decision record. For the current code-grounded launch
> inventory, use [`launch-surface-ledger.md`](launch-surface-ledger.md). Rows below
> must not be treated as the current CLI, MCP, or command-server contract.

Status: Wave 1 decision record, 2026-07-10. This is a **keep/delete decision ledger**, not an approval to refresh protected hashes. Route and CLI removals land together in Wave 2 and receive one contract review before the guard is updated.

Exo is a local Markdown exocortex. Its operator surface supports workspace retrieval, indexing, ordinary terminals, and explicitly configured commands. It does not expose harness control planes, terminal implementation diagnostics, transcript/trace systems, or hidden maintenance operations as product concepts.

## Command server

| Surface | Decision | Rationale |
| --- | --- | --- |
| `status`, `show` | Keep | minimal local operator discovery and focus |
| `search`, `read` | Keep | core retrieval contract |
| `index/status`, `index/roots`, `index/roots/:id`, `index/sync` | Keep | configured index roots and explicit synchronization |
| `index/update`, `index/embed` | Delete | maintenance implementation, not an operator workflow |
| `open`, `preview/open`, `preview/focus`, `preview/close` | Keep | focused document and preview control |
| `config` | Keep, narrow later | configuration inspection must not become a secret-bearing dump |
| `agent-commands/spawn` | Keep | the one configured-command invocation boundary |
| `terminals` (list/create), `terminals/:id/tail`, `write`, `message`, `DELETE` | Keep | durable direct-PTY control and output |
| `terminals/diagnostics`, `transcript`, `semantic-answer` | Delete | tmux/transcript/trace-era internals; replay is an implementation detail |

## CLI

| Family | Decision | Rationale |
| --- | --- | --- |
| `status`, `search`, `read`, `open`, `preview`, `show`, `config get` | Keep | direct local operator and retrieval actions |
| `index status|sync|add|remove` | Keep | explicit index-root management |
| `index update|embed` | Delete | matches server maintenance-route deletion |
| `spawn @handle <task>` | Keep | configured Command invocation only |
| `terminals list|create|read|write|send|kill` | Keep | direct terminal control |
| `terminals diagnostics|transcript` | Delete | internal diagnostics/transcript surface |
| `agents` aliases and create/read/message/interrupt/terminate paths | Delete | legacy harness vocabulary; use `spawn` and `terminals` |
| `workspace fixture`, note branch commands, `runtime`, `traces` | Delete | test/control-plane/trace leftovers, not Exo V1 work |
| `workspace status|current|list|use`, `notes search|read` | Re-evaluate in Wave 2 | retain only if they are the one coherent workspace-selection path; do not duplicate top-level retrieval |
| `start`, `dev`, `launch` | Re-evaluate in packaging pass | developer/bootstrap commands are not yet a stable operator contract |

## Required review conditions

1. Wave 2 must remove a route and every client/caller in the same change.
2. No compatibility alias or fallback survives without a current external caller and an expiry decision.
3. After caller audit and focused tests, one architect review records the new protected hashes in `public-contract-reviews.md`.
4. The protected hash guard remains red until that review, by design.

-- Shoshin | 2026-07-10
