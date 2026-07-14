# Fable review — Exo CLI contract and installation

**Repository:** `projects/exo`
**Branch:** `refactor/note-native-exo`
**Baseline:** `66d0e56` on `main`
**Review status:** requested
**Fable session:** `65e69d60-b17c-4a56-a62d-ff276faad9d9`

## Context

Exo is a local-first Markdown workspace. A user chooses one main Wiki/Note
Root scope; Markdown remains canonical. Exo has two distinct agent access
paths:

1. **MCP** for tool-capable clients. It is deliberately frozen to two
   read-only discovery tools: `workspace_status` and `search_notes`.
2. **CLI** for shell-capable clients and local operators. It currently exposes
   a much broader, partly app-off and partly app-backed surface:

   ```text
   exo [start]
   exo status | show | search | read
   exo index [status|sync|add|remove]
   exo open <path>
   exo preview [open|focus|close]
   exo config get
   exo spawn @handle <task>
   exo terminals [list|create|read|write|send|kill]
   exo mcp serve
   ```

The CLI is source-backed today: `scripts/install-local` creates
`~/.local/bin/exo -> <checkout>/bin/exo`. `scripts/install-mac-app --with-cli`
delegates to that installer. It refuses to replace a target pointing at a
different checkout unless `--force` is supplied. The onboarding **Install MCP**
action only registers `exo mcp serve` with Claude/Codex; it does not install or
update the CLI.

A dogfood machine exposed the confusion: it had an old
`~/.local/bin/exo -> ~/Desktop/lab/tools/exo/bin/exo` shim, while the current
repo is `~/Desktop/lab/projects/exo`. The user expected the onboarding action
to update it. The UI also summarized CLI as only `exo status` and `exo search`,
which incorrectly looked like the command's complete public capability set.

Relevant implementation and contract files:

- `packages/cli/src/index.ts` — command parser/dispatch and public help.
- `packages/cli/src/mcp-server.ts` — frozen MCP transport.
- `scripts/install-local` — repo-backed CLI installation and replacement rule.
- `scripts/install-mac-app` — packaged app installation with optional CLI shim.
- `apps/desktop/src/main/provider-mcp-setup.ts` — provider MCP registration.
- `apps/desktop/src/renderer/src/App.tsx` — onboarding UI.
- `docs/provider-mcp-onboarding.md` and `docs/public-contract-reviews.md` —
  existing boundary record.

## Constraints

- Keep MCP scoped to its two read-only discovery tools. It is not a CLI
  replacement.
- No generic plugin/harness/MCP manager, arbitrary server form, or automatic
  host-instruction writer.
- Markdown and Note Roots remain canonical/authorized scope; native shell
  permissions govern direct file reads/writes outside Exo's own bounded tools.
- A CLI command is a public contract and requires an architecture ruling before
  a new/changed command family ships.
- Keep the CLI small enough that a shell-capable agent can orient, retrieve
  local context, perform an explicit Exo action, and understand app-off versus
  app-backed behavior without a large command taxonomy.
- Do not silently replace a non-Exo executable. An explicitly requested update
  may replace an identified legacy Exo shim after a clear target confirmation.
- A standalone packaged/versioned CLI remains a later follow-up; do not require
  it to resolve the immediate onboarding/update problem.

## Decision needed

What is Exo's smallest durable public CLI contract for shell-capable agents and
human operators, and how should onboarding install/update the current
repo-backed shim without conflating it with MCP?

## Options

### A. Preserve the current command families; improve only onboarding copy/install

Keep every existing command, explain the full surface in onboarding, add a CLI
detector/updater, and leave `config get`, Preview control, and broad terminal
control public.

**Benefit:** no compatibility changes; all existing local operator affordances
remain reachable.
**Cost:** the command is a grab-bag of application internals and makes the
agent-facing contract harder to learn, document, test, and stabilize.

### B. Deliberately tier a small public CLI and remove/de-internalize shallow UI controls

Retain:

```text
exo start | show
exo status
exo search <query> [--limit n]
exo read <path-or-docid> [--from n] [--lines n]
exo index status | sync
exo open <path>
exo spawn @handle <task>
exo mcp serve
```

Interpretation:

- `status`, `search`, and `read` are app-off retrieval primitives.
- `start`, `show`, and `open` are thin desktop handoff primitives.
- `index status|sync` is explicit index maintenance; no add/remove root
  management because a Workspace is scoped by onboarding.
- `spawn` is a narrowly named, configured-Command launch for a trusted
  `@handle`; it does not create trust or bypass the command model.
- `mcp serve` is transport plumbing, documented for installation but not
  presented as an ordinary agent task.

Remove or make non-public: `config get`, Preview remote control, and terminal
create/read/write/send/kill. Shell-capable agents already have native terminal
and file tools; these are UI-remote-control conveniences with broad shallow
surface and no established external consumer.

**Benefit:** a coherent four-purpose CLI: orient, retrieve, explicitly invoke,
and hand off to the desktop.
**Cost:** removes local affordances that have existed during dogfooding; `spawn`
may still be too actionful for the public agent-facing contract.

### C. Retrieval-only CLI plus desktop/MCP transports

Expose only `status`, `search`, `read`, `start`, `show`, and `mcp serve`; remove
`index`, `open`, `spawn`, Preview, terminal, and config families.

**Benefit:** minimal and very safe.
**Cost:** strips useful operator and configured-command integration already
implemented, driving users back to UI/manual shell workflows and weakening the
CLI's value for agents.

## My recommendation

Choose **B**, with two refinements:

1. Rename `spawn` to `invoke` only if Fable believes the migration cost is
   justified; `invoke` better matches the product's explicit configured-Command
   model, while `spawn` is already a reviewed existing contract. Avoid aliases
   unless a short deprecation window is materially necessary.
2. Treat `exo read` as retained despite MCP omitting it: CLI callers already
   have shell authority, but a bounded read with paths returned from Exo search
   is useful, consistent, and works app-off. It does not grant authority.

The onboarding should become two independent compact cards:

```text
MCP                         CLI
Two read-only tools          Local command
Claude / Codex choices       Installed / needs update / unavailable
workspace_status             Search · read · open · invoke
search_notes                 [Install] / [Update]
```

The CLI card must identify its actual target briefly (for example, `Exo from
~/Desktop/lab/tools/exo`) and make a replacement explicit. Provider MCP setup
must not change the local CLI. A replace action may only auto-replace a symlink
whose target is demonstrably an Exo `bin/exo`; any other target requires a
manual shell command and explicit warning.

## Please review

1. Is Option B's retained set the right durable boundary? Which retained
   command is still unjustified, and is any proposed removal actually needed
   for the real local agent/operator loop?
2. Is `read` appropriate on the CLI while omitted from MCP, given native shell
   authority and the app-off retrieval design?
3. Should `spawn @handle <task>` stay under that name, become `invoke`, or be
   removed in favor of page-native invocation only?
4. Is "replace only a detected Exo shim after explicit user action" a sound
   immediate installer policy? What exact detection/confirmation/error cases
   are required?
5. What minimum tests and documentation must accompany the contract and
   onboarding change? In particular: app-off parity, stale-shim detection,
   legacy-shim replacement, non-Exo refusal, MCP/CLI independence, and help
   output.
6. Can this proceed as one focused implementation wave before a standalone CLI
   exists, or does the source-backed lifetime force a different sequencing?

-- Shoshin | 2026-07-14
