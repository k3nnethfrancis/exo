# CLI and MCP

Exograph exposes two complementary local integration surfaces:

- **CLI** for people and agents that can use a shell.
- **MCP** for clients that can call tools but may not have shell access.

They are separate. Installing MCP does not install, replace, or broaden the CLI; the CLI does not require MCP.

## Install the local CLI

From an Exograph checkout:

```sh
./scripts/install-local
```

This builds Exograph and installs the repo-backed `exo` command in
`~/.local/bin` by default. `./scripts/install-mac-app --with-cli` installs the
unsigned app and the same local command together.

When using `--skip-build`, the CLI installer requires an existing non-empty
`packages/cli/dist/index.cjs` build artifact. Build the CLI first with
`pnpm --filter @exograph/cli build`, or omit `--skip-build`; the installer refuses
to replace an existing `exo` command when that artifact is missing or empty.

## Commands

```text
exo [start]
exo show
exo workspaces
exo status [--workspace <id|label|path>]
exo search <query> [--limit n] [--cursor cursor] [--workspace <id|label|path>]
exo index [status|sync]
exo open <path>
exo invoke @handle <task>
exo mcp serve
```

`exo status` and `exo search` work when the desktop app is not running. They
resolve a saved workspace, use bounded filesystem retrieval, and report that
the app is unavailable rather than claiming indexed app results.

When runtime discovery fails, app-off status includes
`app.diagnostic`, and app-off search includes the same object as `runtime`.
Its `code` distinguishes a missing runtime or discovery file, invalid or stale
discovery, an unreachable live process, an inconclusive/permission-limited
process check, and a running app for a different workspace. Filesystem results
remain available and continue to name `filesystem` as their effective provider.

`show`, `index`, `open`, and `invoke` require the resident Exograph app. `invoke` opens a visible terminal task and is intentionally different from a note-native `@` invocation, which carries document context and uses inline review.

Search output is JSON with ranked paths, titles, snippets, source metadata, and an optional cursor. It does not grant filesystem authority: callers read a returned path only through their own allowed tools.
Search limits must be integers from 1 through 20. Use `exo <command> --help`
for command-specific usage; unknown options, missing option values, and invalid
limits exit unsuccessfully instead of being silently normalized.

## MCP

Exograph can install its small, read-only MCP server into locally installed
Claude and Codex CLIs. In onboarding, the person selects one or both providers
and explicitly chooses **Install MCP**. Exograph then delegates to each
provider's native configuration command:

```text
claude mcp add --scope user exo -- exo mcp serve
codex mcp add exo -- exo mcp serve
```

Both entries start:

```text
exo mcp serve
```

The provider owns its configuration and authentication. Exograph owns only the
`exo mcp serve` process. The local `exo` command must already be installed and
on `PATH`, or `EXOGRAPH_CLI_PATH` must point to it. Run
`./scripts/install-local` from the intended checkout to install or update the
repo-backed command. MCP setup never installs or replaces the CLI.

The server exposes exactly two read-only tools:

| Tool | Returns |
| --- | --- |
| `workspace_status` | resolved workspace identity, roots, app availability, and retrieval health |
| `search_notes` | ranked paths, titles, snippets, source metadata, and an opaque next cursor |

`search_notes` returns a bounded page with absolute and root-relative paths. It
does not expose note-reading, write, terminal, agent-launch, configuration, or
arbitrary-path tools. A caller may inspect a returned path only through tools
and permissions it already has. MCP does not bypass inline-invocation
confirmation or diff review.

MCP scope follows the caller's current directory, never whichever Workspace is
open in the app. A cwd inside exactly one configured Note Root selects that
Workspace. If no root contains the cwd, Exograph may use the only configured
Workspace. If there is no unique answer, `workspace_status` reports the
condition and retrieval refuses rather than guessing.

When the running desktop app belongs to that same resolved Workspace, the MCP
server reuses its configured retrieval. If the app is unavailable, stale, or
belongs to a different Workspace, it uses bounded filesystem retrieval.

Exograph does not install or maintain provider instruction files or Skills.
Tool descriptions establish the local search-then-read rule; provider-specific
instructions remain user configuration. This integration is only Exograph's
bounded retrieval context, not a general server manager or authority layer.
