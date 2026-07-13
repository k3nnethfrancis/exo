# Fable review packet — MCP and agent context

## Context

Exo is a local-first Markdown workspace. Its V1 boundaries are deliberately
small: selected Note Roots, read/search retrieval, explicit configured-Command
invocation, and reviewable document edits. It does not have a generic plugin
manager, provider harness manager, arbitrary MCP form, or automatic host-config
writes.

The current first-run order is:

1. choose one main wiki;
2. optionally install Exo context/tools into Claude and/or Codex;
3. configure the local commands Exo can invoke inline.

The current step is labelled **Give agents Exo context**. It lets the user
select Claude and/or Codex, then explicitly runs their native configuration
commands:

```text
claude mcp add --scope user exo -- exo mcp serve
codex mcp add exo -- exo mcp serve
```

`exo mcp serve` is a stdio-only, read-only adapter. It exposes exactly:

- `workspace_status`
- `search_notes`
- `read_note`

The server resolves the active Exo Workspace, uses the running app's retrieval
when available, and otherwise performs bounded filesystem retrieval inside the
configured Note Roots. It has no write, terminal, agent-launch, arbitrary-path,
or configuration tool. Its MCP initialization and tool descriptions tell an
agent to search before reading broadly. The normal Exo CLI remains the broader
human/operator surface.

The change is currently a user-approved exception and needs post-hoc
architectural review before public stabilization. Relevant implementation:

- `packages/cli/src/mcp-server.ts`
- `apps/desktop/src/main/provider-mcp-setup.ts`
- `apps/desktop/src/renderer/src/App.tsx` (first-run step)
- `docs/provider-mcp-onboarding.md`
- `docs/public-contract-reviews.md`

## Product question

The user outcome is not “install MCP.” It is: **do you want selected agents to
have safe Exo context and retrieval tools for the wiki you chose?** MCP appears
to offer the most native capability-discovery route, but tool discovery alone
may not reliably teach an agent when it should use Exo. The alternative is a
CLI-only workflow plus provider instructions or a provider skill.

We need an architecture that works for both:

- a normal Claude/Codex session working near a user's wiki; and
- a configured Command invoked from within Exo, which already receives the
  tagged document snapshot and runs headlessly from the selected workspace.

## Risks and constraints

- The provider registrations are user-scoped while the MCP server reads the
  *active* Exo Workspace. If Exo later supports switching among Workspaces,
  this can be surprising: one provider session may see whatever Workspace is
  active, rather than a scope selected by the session cwd.
- Automatically writing provider `AGENTS.md`, `CLAUDE.md`, or skill files would
  create provider-specific, stale, user-owned configuration that Exo cannot
  safely maintain. “Skill” is not yet a portable installation contract across
  Claude and Codex.
- We must not expand MCP into mutations, terminal control, arbitrary folders,
  agent launch, or a generic server manager merely to make the setup feel more
  complete.
- We must not make MCP a prerequisite for inline invocation: configured
  Commands and their document-review boundary must remain useful without it.

## Options

### A. CLI only, with an installed provider skill/instructions

Do not retain MCP. Teach agents to invoke `exo status/search/read` through a
provider-specific skill or `AGENTS.md`/`CLAUDE.md` content.

- Pros: one operator interface; no MCP lifecycle.
- Cons: no native tool discovery or structured tool boundary; requires host
  instructions/skills that vary by provider and may become stale; makes safe
  retrieval look like arbitrary shell usage.

### B. Keep the narrow MCP; rely solely on MCP tool descriptions

Keep current setup. The model sees its Exo tools in the provider's native tool
list; tool instructions state the search-then-read rule.

- Pros: bounded, discoverable, provider-native capability; no extra files or
  product surface.
- Cons: weak guidance about *when* to reach for Exo; active-Workspace scope is
  not explicit enough as Exo evolves.

### C. Keep the narrow MCP and add one provider-neutral usage contract

Keep the same read-only MCP as the capability transport. Keep the CLI as the
operator/admin/debug transport. Do not install provider skills or mutate
`AGENTS.md`/`CLAUDE.md` automatically. Instead:

1. make onboarding outcome-led: choose providers that should have Exo context;
2. make MCP server/tool descriptions carry terse, capability-local guidance;
3. when Exo invokes a configured Command, include a short provider-neutral
   instruction in the invocation prompt: use Exo retrieval for additional
   Workspace context when available; otherwise work from the supplied snapshot
   and cwd; and
4. only add an explicitly user-managed workspace Skill/instruction template if
   dogfooding proves provider tool discovery is insufficient.

- Pros: separates transport, operator surface, and prompting; avoids a
  provider-specific harness/skill manager; preserves an honest no-MCP path.
- Cons: needs a clear policy for active-Workspace selection and an explicit
  eval/dogfood gate for tool-use discovery.

## Orchestrator recommendation

Choose **C**, with one refinement: `workspace_status` must state the exact
Workspace identity and roots every time, and we should decide now whether a
user-scoped provider registration is allowed to follow the active Exo Workspace
or must bind to an explicit Workspace/cwd. Do not silently install a skill or
write provider instruction files. Treat those as a later, explicit,
user-reviewable template only if observed use proves they are necessary.

## Decision requested

Please review:

1. Is C the simplest durable architecture, or should Exo be CLI-only?
2. What is the right scope model for a user-scoped MCP server: current active
   Workspace, caller cwd, or an explicit workspace identifier? Which choice is
   safest and least surprising for the one-main-wiki launch model and future
   separate Workspaces?
3. Is MCP initialization/tool copy plus the invocation prompt enough agent
   guidance, or is an explicit provider-neutral workspace instruction required
   now? If required, where should it live without recreating a skill/harness
   manager or silently mutating provider-owned files?
4. What exact onboarding promise and next validation gate would you ship?
5. What public-contract changes or tests are missing before stabilization?

-- Exo | 2026-07-13

## Fable ruling — 2026-07-13

Fable approved Option C with mandatory revisions before public stabilization:

- Keep the read-only MCP as the agent retrieval transport and keep CLI as the
  operator surface. Freeze the MCP tool set at `workspace_status`,
  `search_notes`, and `read_note`; a new tool requires a new review.
- Bind resolution to the provider caller's cwd, not the app-active Workspace.
  If the cwd resolves no Note Root and exactly one Workspace is configured,
  allow that single-workspace fallback; otherwise status reports the ambiguity
  and retrieval refuses rather than guessing. Only use app retrieval when it
  resolves to that same Workspace.
- State the resolved Workspace identity and roots in `workspace_status`.
- Do not install or maintain provider instructions or Skills. MCP init/tool
  copy plus a short invocation-prompt line ship first. If dogfood proves that
  ambient provider sessions do not discover the tools, offer a user-owned
  copy-out instruction template rather than writing `AGENTS.md`/`CLAUDE.md`.
- Make onboarding outcome-led and explicit about its native provider command,
  read-only boundary, and removal path. Make skipping first-class.
- Before stabilization, add cwd/singleton/ambiguity/app-mismatch containment
  tests, bounded-output and protocol snapshots, idempotent provider setup and
  uninstall documentation, plus 10–20 real-session dogfood observations across
  Claude and Codex.

## User refinement — 2026-07-13

The user narrowed the short-term transport further: remove `read_note`. Search
already returns an absolute `filePath` with title, snippet, score, and source.
An agent that needs content can use that path with its own native shell/file
permissions; Exo MCP grants only workspace discovery. The resulting frozen
surface is `workspace_status` plus `search_notes`. This is a scope reduction;
Fable's cwd-resolution and stabilization gate remain unchanged.
