# CLI and MCP

Exo exposes two complementary local integration surfaces:

- **CLI** for people and agents that can use a shell.
- **MCP** for clients that can call tools but may not have shell access.

They are separate. Installing MCP does not install, replace, or broaden the CLI; the CLI does not require MCP.

## Install the local CLI

From an Exo checkout:

```sh
./scripts/install-local
```

This builds Exo and installs a repo-backed `exo` launcher in `~/.local/bin` by default. `./scripts/install-mac-app --with-cli` installs the unsigned app and the same local launcher together.

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

`exo status` and `exo search` work when the desktop app is not running. They resolve a saved workspace, use bounded filesystem retrieval, and report that the app is unavailable rather than claiming indexed app results.

When runtime discovery fails, app-off status includes
`app.diagnostic`, and app-off search includes the same object as `runtime`.
Its `code` distinguishes a missing runtime or discovery file, invalid or stale
discovery, an unreachable live process, an inconclusive/permission-limited
process check, and a running app for a different workspace. Filesystem results
remain available and continue to name `filesystem` as their effective provider.

`show`, `index`, `open`, and `invoke` require the resident Exo app. `invoke` opens a visible terminal task and is intentionally different from a note-native `@` invocation, which carries document context and uses inline review.

Search output is JSON with ranked paths, titles, snippets, source metadata, and an optional cursor. It does not grant filesystem authority: callers read a returned path only through their own allowed tools.
Search limits must be integers from 1 through 20. Use `exo <command> --help`
for command-specific usage; unknown options, missing option values, and invalid
limits exit unsuccessfully instead of being silently normalized.

## MCP

Onboarding can install Exo MCP into locally installed Claude or Codex. It adds a provider-owned configuration entry that starts:

```text
exo mcp serve
```

The server exposes exactly two read-only tools:

| Tool | Returns |
| --- | --- |
| `workspace_status` | resolved workspace identity, roots, app availability, and retrieval health |
| `search_notes` | ranked paths, titles, snippets, source metadata, and an opaque next cursor |

MCP scope follows the caller's current directory. A cwd inside exactly one configured workspace selects it. If no workspace or more than one workspace matches, search refuses rather than guessing; a single saved workspace can be used as an explicit fallback.

For provider configuration details and security boundaries, see [MCP onboarding](provider-mcp-onboarding.md).
