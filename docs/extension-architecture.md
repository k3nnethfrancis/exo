# Exograph Extension Architecture

Last updated: 2026-07-09

status: Fable-reviewed branch plan; V1 code now follows the search-provider-only typed seam and deletion-first plugin boundary.

This document revisits Exo plugin architecture from the Exograph product frame:

> Build your local exocortex from Markdown.

It replaces the old "plugin architecture completion" framing as the working proposal. It does not by itself delete code or stabilize a public plugin API.

## Decision In One Paragraph

Vanilla Exo is the product: Markdown notes, terminal panes, freely composable workspace, graph/read/search, AgentCommands, invocation records, monitor view, and diff review. Extension should happen through the cheapest mechanism that works: Markdown conventions, config, local commands, web views, typed providers, and only later a manifest/distribution system if real external demand proves it is needed.

Exograph does not need the old plugin platform as a product spine. It needs an extension ladder.

## Core Vs Extension Framework

A capability belongs in vanilla Exo if it passes any of these tests:

1. Substrate test: removing it makes Markdown plus terminal plus panes incoherent.
2. Referee test: it enforces safety, provenance, confirmation, dirty-buffer protection, or review.
3. Single-implementation test: there is only one sensible implementation.

A capability belongs outside core only when all of these are true:

1. Variation is real: at least two concrete implementations exist or are actively wanted.
2. Data cannot express it: prefer Markdown/frontmatter/config over code.
3. A local command cannot express it: many tools are just executables Exo can launch and monitor.

## Extension Ladder

Use the lowest rung that works.

| Rung | Mechanism | Trust Model | Status |
| --- | --- | --- | --- |
| 0 | Open-source fork | User owns code | Always available |
| 1 | Markdown and frontmatter conventions | User-owned files | Active now |
| 2 | Config records such as `AgentCommand` and search settings | User-authored config | Active now |
| 3 | External executables through terminal, CLI, or AgentCommand | OS process, user-confirmed launch | Active now |
| 4 | Web viewer panes serving local or trusted content | Sandboxed frame, no preload APIs, and main-process URL validation for trusted local/file/localhost targets. Still not a general untrusted extension host. | Core primitive |
| 5 | Typed in-process providers | Fork/in-tree only; compiled in and reviewed with the app. This is not a dynamic user extension path. | SearchProvider only for now |
| 6 | Out-of-process provider protocol over stdio/JSON | Explicit install, subprocess boundary | Defer to V2 |
| 7 | Manifest, permission, and distribution system | Declared manifests plus enforced boundaries | Defer until real demand |

Do not build a higher rung to host something a lower rung can express.

## Vanilla Exo Boundary

### V1

Vanilla Exo owns:

- Markdown editor, explorer, and notes-on-disk.
- Pane composition, terminal panes, web viewer panes, and terminal transcripts.
- CLI search/read/status.
- Graph read path: links, backlinks, tags, frontmatter/properties, graph context, and neighborhood view.
- QMD provider plus core fallback provider behind a provider-neutral search contract.
- `AgentCommand` config.
- Note-native invocation.
- CLI `exo spawn @handle`.
- Monitor view for command sessions.
- Invocation records under `.exo/invocations/`.
- Direct-write diff attribution and dirty-buffer protection.
- Workspace trust for command-bearing config.

The only active typed extension seam in V1 is search/index providers.

V1 should not ship:

- Plugin Manager as product spine.
- Plugin marketplace or distribution.
- General manifest/capability system.
- Routine plugins.
- Deep harness plugins.
- Profile apply plugins.
- MCP plugins.

### V2

V2 candidates:

- Note-result hydration: search provider result plus Exo-owned note metadata and graph context.
- LM wiki maintenance tools as core CLI/graph tools first.
- View projections for Markdown/frontmatter conventions such as tasks, dates, tables, calendar, or kanban if dogfooding proves they matter.
- Out-of-process provider protocol for search/index providers.

### Long Term

Long-term extension work should be demand-gated:

- View projection extensions may become worthwhile if core task/date/kanban patterns prove too narrow.
- Manifest and permission systems should exist only after at least two real external extensions cannot be handled by config, commands, or provider protocols.
- Sharing should start as git repos and copied config, not a marketplace.

## Plugin Categories

### Should Exist

- Search/index providers.
- AgentCommand templates as shareable config.
- LM wiki tool packs as Markdown/config/commands.
- Import/export providers if command/config is not enough.
- View projections, later, if repeated use proves the need.

### Should Not Exist In V1

- Agent harness plugins. `AgentCommand` replaces provider-specific harness identity.
- Routine/automation plugins. Invocation records are the first activity primitive.
- Profile plugins that execute or apply changes.
- Plugin-owned settings panels or general UI injection.
- Plugin-owned MCP tools or CLI commands.

### Uncertain

- Chat module: start as a note plus invocation loop; only build a module if that fails.
- Sync/publish integrations: start as external commands.
- Provenance analyzers: wait until invocation records are used in real work.

## Search Providers And Note Hydration

Hard boundary:

> Providers own relevance. Exo owns note identity and graph.

Provider output should be keyed by Exo-canonical document identity. V1 canonical identity is `rootId + rootRelativePath`, because note/project/index roots may live outside `workspaceRoot`. A workspace-relative path can still be exposed as display metadata when one exists. Provider-native collection-relative paths stay provider diagnostics, not the shared result id.

Provider output should include:

- score/rank;
- snippets;
- chunk ranges;
- provider/index status;
- provider-specific diagnostics.

Exo hydrates that into an agent-facing note result:

- note identity, path, title;
- frontmatter/properties/tags;
- outgoing links, backlinks, and neighborhood summary;
- snippets/chunks from the provider;
- index/provider health.

This keeps custom providers swappable. They do not implement Exograph ontology, and Exo does not depend on them for graph truth.

## Named Surface Decisions

- Browser/web view: core primitive, not plugin-only. It is the escape hatch that makes many UI plugins unnecessary, but sandboxed trusted-target hosting is still not a general extension security boundary.
- Project/code views: changed-files and diff review are core because invocation review depends on them. Full IDE features are not core.
- Tasks/dates/kanban: Markdown/frontmatter conventions first; core projections later if dogfooding proves them useful; plugin/view projection only after the core pattern is clear.
- Chat: not core for now. Try conversation notes plus AgentCommand invocation first.
- LM wiki skills/tools: core graph-maintenance CLI tools plus shareable command/config files first.
- Agent command templates: core supports templates as data. They are not plugins.

## Salvage From The Old Architecture

Worth keeping or redesigning:

- `SearchProvider` and search-provider registry concepts.
- QMD provider implementation.
- Provider-neutral status/fallback thinking.
- Terminal runtime is core.
- Web viewer host is core.
- Metadata-only discovery lessons.
- Trust and permission separation as design wisdom, not necessarily the old code.
- Read-only diff/review UI components if useful for invocation review.

Worth removing if caller audit allows:

- General plugin/capability system.
- Plugin Manager as setup/product surface.
- Routine product and routine plugins.
- Profile apply engine.
- Deep harness adapter model.
- MCP plugin or agent lifecycle ideas.
- Manifest parsing and permission machinery unless a new extension architecture explicitly reintroduces them.

## Trust And Security

Be honest about real boundaries.

Local native code is not sandboxed just because a manifest says it has permissions. Exo should not present permission toggles that do not enforce anything.

Real boundaries:

1. Process boundary: external commands and future out-of-process providers run as subprocesses. They can still access local files according to OS permissions, so trust comes from explicit user installation and launch confirmation.
2. Web content boundary: target state is sandboxed frame/webview hosting with no preload APIs by default and explicit message passing only. Current renderer iframe hosting is not sufficient for untrusted content.
3. Command-server boundary: the local command server is loopback IPC, not an authorization boundary unless routes require a per-runtime token or equivalent. Web viewer content and arbitrary browser pages must not be able to call mutation routes by guessing `127.0.0.1` ports.

V1 security decision to add:

- Workspace trust for command-bearing config. A cloned vault or imported workspace must not silently activate executable `AgentCommand` definitions.
- Trust state lives outside the workspace, in local app/runtime state keyed by workspace root and command identity.
- Trust is invalidated when executable command fields change, including command string/template, cwd/root policy, prompt delivery mode, env/template fields, and any future field that changes what runs or where it runs.
- Invocation confirmation requires a human gesture. Agent-authored document changes must not auto-chain into new invocations.
- Invocation records should capture mention provenance where possible: human-authored, prior-invocation-authored, or unknown.

Invocation confirmation should show:

- handle;
- label;
- literal command;
- cwd/root;
- prompt delivery mode;
- target document or CLI task context.

## Minimal Plan For This Branch

Decide now:

- Extension ladder.
- SearchProvider is the only active typed provider seam.
- No general manifest, marketplace, or permission system in V1.
- `AgentCommand` templates are config, not plugins.
- Workspace trust is required for command-bearing config.
- Web viewer panes are core, but current iframe hosting is not a sufficient trust boundary.
- Local command-server routes need token/auth hardening or an explicit accepted-risk decision before web viewer content is treated as untrusted extension content.

Build now:

- Keep search provider seam test-covered.
- Add core fallback search provider if not already reliable.
- Decouple search provider metadata from old capability/plugin metadata.
- Add workspace trust gate for `AgentCommand` config before note invocation or CLI spawn dogfooding.
- Keep BrowserPane sandbox/navigation policy test-covered before using web viewer panes as an extension host.
- Keep command-server token auth test-covered before any web viewer content can interact with mutation routes.

Remove now after caller audit:

- old plugin/capability product surfaces;
- Plugin Manager as setup/product surface;
- routine CLI/UI/docs/code not needed by invocation records;
- profile apply engine and setup copy;
- deep harness model after generic AgentCommand launch replaces current callers;
- MCP package/surfaces after CLI parity and installed-machine cleanup.

Defer:

- out-of-process provider protocol;
- note-result hydration layer;
- view projection extension API;
- manifest/permission/distribution system;
- plugin marketplace.

## Durable Docs And Skills

Docs to create or update after this plan is accepted:

- `docs/extension-architecture.md` as the active answer.
- `docs/search-provider-contract.md` after the search provider contract is cleaned up.
- Archive or mark superseded:
  - `docs/plugin-system-architecture.md`;
  - `docs/plugin-implementation-plan.md`;
  - `docs/plugins.md`;
  - `docs/activity-plugin-contract.md`;
  - `docs/agent-harness-plugin-contract.md`.

Skills:

- Do not recreate `skills/plugin-development` yet.
- Create an `extending-exo` skill only after the active extension architecture has at least one stable external extension path.
- Keep `terminal-stability`, `deslopify-frontend`, and `submit-exo-issue` product-regime-neutral.

## Open Questions

- Does V1 need any user-facing provider management UI, or is config plus status enough?
- Should QMD remain in-process for V1 only, then move behind a stdio provider protocol in V2?
- Which old plugin/capability modules are still called by app boot or graph/search code?
- Which Exograph view projection should be the first real test case after invocation review stabilizes: tasks, calendar, kanban, graph table, or note result table?

-- Exo | 2026-07-08
