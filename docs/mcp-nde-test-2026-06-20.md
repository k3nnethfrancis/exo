# Exo MCP NDE QA Audit - 2026-06-20

Status: dated QA evidence. Use `packages/mcp/README.md`, `architecture.md`, and `harness.md` for the current MCP contract and validation rules.

## Summary

This was a non-destructive QA/audit pass over Exo MCP in `/Users/kenneth/Desktop/lab/projects/exo`.

Result: the MCP surface contract is correct and narrow, but the live command-server path was blocked by stale discovery in `/Users/kenneth/Desktop/lab/.exo/server.json`. Stdio MCP initialized quickly and listed the expected tools, but all live app-backed MCP calls returned `isError: true` with stale command-server errors. The configured autostart path did not recover the app within the tested 12 second connection window.

No app/runtime code was edited. One product issue was added to the canonical Exo issue tracker, now root `issues.md`: `EXO-ISSUE-046`.

## Environment

- Date: 2026-06-20
- Repo: `/Users/kenneth/Desktop/lab/projects/exo`
- Commit: `980beb4ced0bd58ea8ef9b6bf8d8e8810715332b`
- Git state before edits: clean
- Node: `v25.8.1`
- pnpm: `11.2.2`
- MCP package version: `@exo/mcp 0.1.0-alpha.3`
- Root package version: `exo 0.1.0-alpha.3`
- Active Exo runtime root: `/Users/kenneth/Desktop/lab/.exo`
- Discovery file: `/Users/kenneth/Desktop/lab/.exo/server.json`
- Recorded stale server: pid `14108`, port `53794`
- Exo app/command server reachable: no, command server discovery was stale
- MCP configuration observed through `./bin/exo integrations config codex`:
  - command: `node`
  - args: `/Users/kenneth/Desktop/lab/projects/exo/packages/mcp/bin/exo-mcp.mjs`
  - env: `EXO_MCP_AUTOSTART=1`, `EXO_MCP_SEARCH_TIMEOUT_MS=30000`, `EXO_MCP_START_COMMAND=/Users/kenneth/Desktop/lab/projects/exo/bin/exo start`

## Scope Results

Expected narrow agent work plane:

- `workspace_status`: exposed
- `search`: exposed
- `read_document`: exposed
- `list_agents`: exposed
- `create_agent`: exposed
- `read_agent`: exposed
- `send_agent_message`: exposed
- `interrupt_agent`: exposed
- `terminate_agent`: exposed

Removed admin tools:

- `index_status`: not exposed
- `sync_index`: not exposed
- `list_project_roots`: not exposed
- `add_project_root`: not exposed
- `remove_project_root`: not exposed

Evidence:

```text
TOOLS ["create_agent","interrupt_agent","list_agents","read_agent","read_document","search","send_agent_message","terminate_agent","workspace_status"]
EXPECTED_PRESENT_MISSING []
REMOVED_PRESENT []
```

Calling removed tools through the MCP client returned MCP tool errors, not real tool executions:

```text
index_status: isError=true, "MCP error -32602: Tool index_status not found"
sync_index: isError=true, "MCP error -32602: Tool sync_index not found"
list_project_roots: isError=true, "MCP error -32602: Tool list_project_roots not found"
```

## Commands Run

```bash
git -C /Users/kenneth/Desktop/lab/projects/exo rev-parse HEAD
git -C /Users/kenneth/Desktop/lab/projects/exo status --short
node --version
pnpm --version
./bin/exo --help
./bin/exo workspace status
./bin/exo status
./bin/exo integrations config codex
./bin/exo integrations doctor
./bin/exo runtime status
./bin/exo agents list
./bin/exo search "Exo MCP" --limit 5
./bin/exo search "terminal tmux transcript" --limit 5
./bin/exo search "Sigmund" --limit 5
./bin/exo read /Users/kenneth/Desktop/lab/projects/exo/packages/mcp/README.md --from 1 --lines 20
./bin/exo read /etc/hosts --from 1 --lines 5
pnpm --filter @exo/mcp build
pnpm --filter @exo/mcp test
pnpm --dir /Users/kenneth/Desktop/lab/projects/exo/packages/mcp exec node --input-type=module
```

The inline Node MCP client used `@modelcontextprotocol/sdk` over `StdioClientTransport` against `packages/mcp/bin/exo-mcp.mjs`.

## Latency Observations

MCP stdio without autostart:

| Operation | Observed |
| --- | ---: |
| initialize/connect | 122 ms |
| list tools | 3 ms |
| removed tool error response | 0-1 ms |
| stale `workspace_status` error response | 5 ms |
| stale `search` error response | 1-2 ms |
| stale `read_document` error response | 1 ms |
| stale `list_agents` error response | 1 ms |

MCP stdio with `EXO_MCP_AUTOSTART=1` and `EXO_MCP_CONNECT_TIMEOUT_MS=12000`:

| Operation | Observed |
| --- | ---: |
| initialize/connect | 125 ms |
| list tools | 3 ms |
| `workspace_status` | 12177 ms, returned timeout text as a tool error result |
| `list_agents` | 12138 ms, returned timeout text as a tool error result |

CLI fallback:

- `./bin/exo search "Exo MCP" --limit 5`: about 1.0 s, degraded filesystem search
- `./bin/exo search "terminal tmux transcript" --limit 5`: about 1.0 s, degraded filesystem search
- `./bin/exo search "Sigmund" --limit 5`: about 0.9 s, degraded filesystem search
- `./bin/exo read /Users/kenneth/Desktop/lab/projects/exo/packages/mcp/README.md --from 1 --lines 20`: about 0.01 s

## Functional Findings

### Surface Contract

Pass. `packages/mcp/src/index.ts`, `packages/mcp/README.md`, and the live `listTools` response all agree on the intended nine MCP tools. `packages/mcp/src/stdio-handshake.test.ts` also asserts this exact list for stdio and HTTP transport.

### Live App Reachability

Fail for this environment. `./bin/exo status` reported:

```text
Exo command server discovery is stale. The recorded process (14108) is no longer running; restart Exo with `exo start`.
Runtime root: /Users/kenneth/Desktop/lab/.exo
Discovery file: /Users/kenneth/Desktop/lab/.exo/server.json
Recorded pid: 14108
Recorded port: 53794
Cause: fetch failed
```

MCP without autostart returned the same stale-server failure for app-backed calls. MCP with autostart still waited against `http://127.0.0.1:53794` and timed out:

```text
Timed out waiting for Exo command server at http://127.0.0.1:53794.
```

Impact: agents can discover the MCP server and see the right tools, but cannot do useful Exo work when discovery is stale. The error is delivered as an MCP tool result with `isError: true`, so clients must inspect `isError`; a naive result parser can mistake the resolved call for success.

### Agent Tools

Blocked by stale command server. `list_agents`, `create_agent`, `read_agent`, `send_agent_message`, `interrupt_agent`, and `terminate_agent` could not be safely exercised against a live Exo app through MCP. No agents were created through MCP. No cleanup was required.

CLI `./bin/exo agents list` also failed on the same stale discovery path, so the agent round-trip test was not attempted through CLI fallback.

### MCP Package Tests

Pass.

```text
Test Files  2 passed (2)
Tests       11 passed (11)
Duration    1.56s
```

## Result Quality Notes

### `workspace_status`

The CLI/offline `./bin/exo workspace status` is useful for orientation. It returned:

- workspace root: `/Users/kenneth/Desktop/lab`
- default terminal cwd: `/Users/kenneth/Desktop/lab`
- note root: `shoshin-codex`
- project roots: `exo`, `ga-pi`
- indexed root: `shoshin-codex`
- indexing: enabled, hybrid, qmd

The MCP `workspace_status` tool would be a good first tool for a new agent, but live reachability blocked it.

### `search`

Search degraded to filesystem because QMD native bindings were built for a different Node ABI:

```text
NODE_MODULE_VERSION 145 ... current Node.js requires NODE_MODULE_VERSION 141
```

Quality in degraded mode:

- `"Exo MCP"` returned relevant note/project planning hits, including the prior search performance report, Exo tasks, and Exo issues.
- `"Sigmund"` returned relevant Sigmund and bookmark/report hits.
- `"terminal tmux transcript"` returned only the Exo issues note rather than terminal architecture docs. This is understandable if the active search scope is the notes index, but it is weaker than a new Exo development agent would expect when oriented from the Exo project root.

All degraded search scores were `0`, so ranking confidence is not interpretable.

### `read_document`

CLI read behavior was good for attached/project-root paths and root safety:

- Reading `/Users/kenneth/Desktop/lab/projects/exo/packages/mcp/README.md` succeeded with bounded output.
- Reading `/etc/hosts` was refused with `Refusing to read a path outside attached or indexed roots.`

MCP `read_document` could not reach the live command server in this environment.

## Usability And Discoverability

Good:

- Tool names are clear, short, and agent-oriented.
- The MCP README explicitly says MCP is narrower than CLI and points admin workflows to `bin/exo index`, `bin/exo project-roots`, and `bin/exo terminals`.
- `send_agent_message` description warns that it can affect active Claude/Codex sessions.
- `read_agent` defaults to ANSI cleanup and has bounded tail controls.
- `search` schema caps `limit` at 50 and bounded included content at 300 lines per result.
- `read_document` caps `maxLines` at 1000.

Needs improvement:

- Stale command-server failures are returned as generic tool error text, not structured recovery guidance. A new agent sees working MCP discovery, then app-backed tools fail.
- `workspace_status` description says "runtime status", but when the runtime is stale the tool cannot return a structured stale-runtime object.
- `read_document` description says "filesystem path or docid"; it should say paths are limited to attached/indexed roots.
- `terminate_agent` says it terminates a supervised pty process, but should be even clearer that it can kill active user-visible work.
- Error text recommends `EXO_MCP_AUTOSTART=1`, but in this environment autostart was already configured and still failed.

## Security And Safety Notes

Good:

- Removed admin mutation tools are not exposed over MCP.
- Project root/index root mutation is not available through MCP.
- Outside-root read of `/etc/hosts` was refused through the CLI read path.
- HTTP transport binds to `127.0.0.1` by default and the README warns to use an authenticated proxy if exposed beyond localhost.
- Output-size guards exist in schemas: search result count, search content lines, document lines, terminal tail settings.

Concerns:

- The MCP implementation still contains internal command-client helpers for index and project-root mutation, even though they are not registered as tools. This is not an exposed vulnerability by itself, but it increases the risk of accidental future exposure.
- HTTP transport has no built-in authentication. Localhost default is acceptable for local MCP, but any non-local binding should be treated as unsafe unless protected externally.
- Returned documents and agent transcripts are raw content. Prompt-injection text in notes, project files, or terminal output can be returned directly to an agent. Tool descriptions do not remind agents to treat returned content as untrusted context.
- `send_agent_message`, `interrupt_agent`, and `terminate_agent` are intentionally effectful. The schema requires an explicit `agentId`, but there is no second confirmation or force flag for termination.
- Stale control-plane behavior creates safety ambiguity: an agent may believe it has sent, interrupted, or terminated an agent if it only checks that the MCP call resolved instead of inspecting `isError`.

## Recommended Fixes

1. Make MCP stale-runtime failures structured and self-diagnosing.
   - Return a structured error payload containing runtime root, discovery file, recorded pid, recorded port, reachability, autostart setting, and suggested next action.
   - Ensure clients can distinguish "tool exists but Exo is unreachable" from actual successful tool output.

2. Harden MCP autostart against stale `server.json`.
   - If `server.json` exists but the recorded pid/port is stale, autostart should not keep polling only the stale base URL.
   - It should quarantine/remove stale discovery after validation, start Exo, and wait for a fresh server file or a reachable replacement.

3. Add a regression test for stale command-server discovery in `@exo/mcp`.
   - Fixture: stale server info with dead/unreachable port, `EXO_MCP_AUTOSTART=1`.
   - Expected: either successful recovery to a fresh server or a structured failure that says autostart was attempted and why it failed.

4. Clarify descriptions for safety-sensitive tools.
   - `read_document`: explicitly says attached/indexed roots only.
   - `terminate_agent`: explicitly says it can end active user-visible terminal work.
   - `workspace_status`: says it is the orientation tool and should report runtime health when available.

5. Improve degraded search result quality diagnostics.
   - Keep the current visible QMD warning, but expose whether the active search scope is notes only, project roots, or both.
   - Provide nonzero lexical scores or rank explanations so degraded results are easier to trust.

6. Consider adding a prompt-injection note to MCP docs/tool descriptions.
   - Returned documents and transcripts should be treated as untrusted content, especially when agents use search/read output to guide actions.

## Issues Filed

- `EXO-ISSUE-046`: MCP autostart and tool calls can stay pinned to stale command-server discovery.
