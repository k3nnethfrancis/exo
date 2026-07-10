# Control-Plane Catalog Proposal

> Superseded as an active control-plane direction by `docs/exograph-refactor-completion-plan.md` on `refactor/note-native-exo`. CLI is now the active local integration surface; the MCP package and setup surface were deleted and should not shape new work.

Last updated: 2026-07-07

Historical status at the time of this proposal: `@exo/core` owned a typed control-plane catalog and MCP exposure profiles, and `packages/mcp` used that catalog to filter registered MCP tools. Those MCP surfaces have since been deleted on the Exograph refactor branch.

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

Public MCP filtering is implemented as an environment/config surface with `dev` as the default, preserving the current full Exo-on-Exo tool set unless explicitly narrowed. Invalid explicit profiles fail closed to no registered tools. A settings UI and profile-controlled tool membership still require a separate public-contract review.

`everyday` is not a strictly read-only profile: it includes bounded `view-control` preview tools so agents can open local artifacts for review. It intentionally excludes agent lifecycle, agent input, destructive, and admin tools.

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

Decision for this implementation: `open_preview`, `focus_preview`, and `close_preview` stay in `everyday` because they are bounded core web-viewer controls useful for artifact review. They remain marked `view-control`, not read-only, so future UI/profile copy can show the layout-mutation tradeoff. `everyday` membership is an explicit reviewed list, not derived automatically from risk classes.

Future default flip criterion: keep `dev` as the default while Exo-on-Exo coordination depends on the full local work plane. When daily-driver agents can operate through orientation/search/read/preview plus explicit user-triggered escalation, make `everyday` the default and `dev` opt-in.

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
