# Control-Plane Catalog Proposal

Last updated: 2026-07-07

Status: design-only. This note proposes the future catalog and exposure profiles for Exo CLI/MCP control surfaces. It does not change MCP tool registration, CLI commands, command-server routes, shared protocol payloads, plugin behavior, or settings UI.

## Decision Direction

CLI and MCP should remain peer clients of the local command server. MCP must not shell out through the CLI, and the CLI must not become the hidden policy engine for MCP. A shared typed control-plane catalog in `@exo/core` should eventually classify each command/tool once, then let CLI, MCP, onboarding, Agent Config, Plugin Manager, and docs consume that metadata according to their own surface rules.

The catalog should classify each entry by:

- stable id, such as `mcp.search` or `cli.index.sync`
- risk class: `orientation`, `read`, `view-control`, `agent-lifecycle`, `agent-input`, `destructive`, or `admin`
- default exposure profile membership
- command-server route or local-only implementation route
- allowed surfaces: `mcp`, `cli`, `desktop`, `internal`
- whether it is safe for routine automation, agent use, operator use, or explicit manual confirmation only

The catalog is policy metadata, not authority by itself. MCP exposure is enforceable only when the MCP server uses the catalog to filter registered tools or reject calls. CLI exposure is mostly advisory until the command server has authentication/authorization; a local user or process that can run `bin/exo` or talk to the local command server can still reach CLI/operator routes. Any user-facing copy should be honest about this.

## Exposure Profiles

| Profile | Intent | MCP behavior | CLI guidance |
|---|---|---|---|
| `off` | No recommended agent control-plane access. | Future MCP installer/config should omit Exo MCP or expose no tools. Existing manually configured clients are out of scope until filtering exists. | Do not recommend CLI use in generated agent instructions. This is advisory without command-server auth. |
| `everyday` | Default narrow agent work plane for normal note/project assistance. | Orientation, search/read, bounded document access, and low-risk preview controls only. No agent spawning or terminal input. | Mention CLI only as an operator fallback for setup/diagnostics, not as an agent work plane. |
| `dev` | Exo-on-Exo development and supervised local agent orchestration. | All current MCP tools, including live agent lifecycle/input controls. | Recommend CLI for indexing, project roots, diagnostics, terminal/admin work, and MCP integration management. |
| `custom` | User-reviewed per-tool membership. | User selects exact MCP tools from the catalog, with risk labels and profile diffs. | User selects which CLI command families are described/advised to agents; enforcement still needs command-server auth. |

Do not ship public MCP tool filtering, a settings UI, or profile-controlled tool membership until the user confirms the membership table and the implementation has a public-contract review. This pass only records the proposal.

## Proposed MCP Membership Table

| MCP tool | Command route | Risk class | `off` | `everyday` | `dev` | Notes |
|---|---|---:|:---:|:---:|:---:|---|
| `workspace_status` | `GET /status`, optional `GET /index/status`, optional `GET /terminals/diagnostics` | orientation | No | Yes | Yes | Recommended first orientation call. Read-only but may expose workspace and runtime shape. |
| `search` | `GET /search` | read | No | Yes | Yes | Bounded retrieval across configured workspace/search roots. |
| `read_document` | `POST /read` | read | No | Yes | Yes | Reads indexed or filesystem targets within Exo's current read contract. |
| `open_preview` | `POST /preview/open` | view-control | No | Yes | Yes | Opens local HTML or HTTP(S) URL in Exo's preview; useful but changes UI state and can reach network URLs. |
| `focus_preview` | `POST /preview/focus` | view-control | No | Yes | Yes | UI focus only. |
| `close_preview` | `POST /preview/close` | view-control | No | Yes | Yes | UI state change; low risk but potentially disruptive. |
| `list_agents` | `GET /terminals` | orientation | No | No | Yes | Exposes live terminal sessions; keep out of everyday unless orchestration is explicitly wanted. |
| `create_agent` | `POST /terminals` with `callerSurface: "mcp"` | agent-lifecycle | No | No | Yes | Starts a supervised terminal/harness. Requires explicit dev/operator intent. |
| `read_agent` | `GET /terminals/:id/tail`, `GET /terminals/:id/transcript`, or local semantic trace read | read | No | No | Yes | Reads terminal/trace evidence from live agents; useful for dev orchestration, noisy for everyday use. |
| `send_agent_message` | `POST /terminals/:id/message` | agent-input | No | No | Yes | Sends text into another live agent session. High coordination risk. |
| `interrupt_agent` | `POST /terminals/:id/write` | agent-input | No | No | Yes | Sends Escape or Ctrl-C. Non-destructive in schema terms but can interrupt work. |
| `terminate_agent` | `DELETE /terminals/:id` | destructive | No | No | Yes | Stops a terminal/session. Keep out of everyday and require clear user/operator intent. |

Open question for sign-off: whether `open_preview`, `focus_preview`, and `close_preview` belong in `everyday` or should move to `dev` because they mutate the app layout.

## Future Directory And Index Navigation Tools

Generated folder trees should not be injected into global agent instructions. They go stale, increase prompt noise, and make provider-level context pretend to be a live filesystem/index view.

Instead, Exo should design explicit navigation tools after review:

- `list_roots`: return attached workspace, note, project, and indexed roots with ids, labels, freshness, and allowed operations.
- `list_directory`: list children for an attached root/path with pagination, filters, max depth, file type selection, and freshness/error metadata.
- `describe_index`: summarize indexed roots, document counts, freshness, provider readiness, and degraded states without dumping file names.
- `list_index_documents`: page through indexed document ids/paths by root, prefix, type, and modified time.
- `resolve_document`: map a search result, indexed document id, wikilink-ish target, or root-relative path to a readable target.

These tools should replace generated folder context because they are live, scoped, bounded, and auditable. They also give the MCP/CLI catalog a clear place to classify directory browsing separately from semantic search and document read.

This is future public contract work. Do not add the tools, routes, CLI flags, MCP schemas, or shared protocol payloads without explicit user confirmation and architect/public-contract review.
