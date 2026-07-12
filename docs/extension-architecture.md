# Exograph Extension Architecture

Last updated: 2026-07-10

status: Current extension boundary. It describes shipped seams separately from proposed Folder/Skill work.

This document revisits Exo plugin architecture from the Exograph product frame:

> Build your local exocortex from Markdown.

It replaces the old "plugin architecture completion" framing as the working proposal. It does not by itself delete code or stabilize a public plugin API.

## Decision In One Paragraph

Vanilla Exo is the product: **local Markdown exocortex + modular, tunable search + inline agent invocation + graph management skills**. Skills begin as user-editable instructions/data executed by configured Commands, not dynamically loaded code. Extension should happen through the cheapest mechanism that works: Markdown conventions, config, local commands, web views, typed providers, and only later a manifest/distribution system if real external demand proves it is needed.

Exograph does not need the old plugin platform as a product spine. It needs an extension ladder.

## Terminology Ruling

In current Exo architecture, **Plugin is a future distribution unit, not a runtime abstraction**:

```text
Convention / Skill     authors behavior
Command / Provider     executes or supplies a capability
Plugin                 packages proven pieces for installation, updates, and sharing
```

Local configuration can mature independently; a future Plugin may bundle proven Command templates, ontology templates, evals, or external provider configuration only when distribution is valuable. Exo does not adopt the in-process application-extension model; a Plugin does not imply arbitrary renderer code, UI injection, filesystem access, process access, or authority.

Future packages have two materially different trust profiles:

- **Declarative contents:** Markdown Skills, Folder Index/ontology templates, settings defaults, eval cases, and Command templates. These remain data and instructions, though they still require source review.
- **Executable contents:** Commands, hooks, external providers, native code, or services. These require separate install, trust, scope, lifecycle, update, and removal semantics; a manifest declaration is not a sandbox.

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

Folder Indexes are a planned rung-1 convention, not a profile/plugin subsystem. When the Folder vertical slice ships, a normal `index.md` may describe a Folder and its guidance. Until then, it is ordinary Markdown; no Folder Overview or implicit creation is claimed.

## Vanilla Exo Boundary

### V1

Vanilla Exo owns:

- Markdown editor, explorer, and notes-on-disk.
- Pane composition, terminal panes, web viewer panes, and bounded in-memory terminal replay/read tails.
- CLI search/read/status.
- Graph read path: links, backlinks, tags, frontmatter/properties, graph context, and neighborhoods.
- QMD provider plus core fallback provider behind a provider-neutral search contract.
- `AgentCommand` config.
- Note-native invocation.
- CLI `exo spawn @handle`.
- Monitor view for command sessions.
- Invocation records under `.exo/invocations/`.
- Observed-change review and dirty-buffer protection.
- Workspace trust for command-bearing config.

The only active typed extension seam in V1 is search/index providers.

The current product does not ship a catalog, marketplace, general manifest/capability system, plugin-owned settings panels, arbitrary UI injection, or plugin-owned public CLI commands.

### V2

V2 candidates:

- Note-result hydration: search provider result plus Exo-owned note metadata and graph context.
- Folder Overview and the first graph-management Skill, after the trust and distillation gates in `../tasks.md`.
- View projections for Markdown/frontmatter conventions such as tasks, dates, tables, calendar, or kanban if dogfooding proves they matter.
- Out-of-process provider protocol for search/index providers.

### Long Term

Long-term extension work should be demand-gated:

- View projection extensions may become worthwhile if core task/date/kanban patterns prove too narrow.
- Manifest and permission systems should exist only after at least two real external extensions cannot be handled by config, commands, or provider protocols.
- Sharing should start as git repos and copied config, not a marketplace.

Potential capability families must stay orthogonal until implementations earn them:

- source adapters materialize scoped external data as source-faithful Markdown;
- index providers retrieve over allowed corpora;
- evaluation environments define tasks, actions, rewards, and held-out cases;
- learning recipes define SFT, preference, RL, embedding, or reranker experiments;
- executors supply local or cloud compute independently of the learning method;
- artifact adapters make an approved candidate usable by a runtime or index.

Only Search currently has an earned typed provider seam. The other families begin as Markdown, packages, configured Commands, and lineage-bearing artifacts. Do not encode method × executor combinations as separate plugin types.

## Future Plugin Packaging

A later Plugin may package proven pieces such as:

- graph-management Skills;
- Folder Index and ontology templates;
- configured Command templates;
- eval cases and rubrics;
- source-shaping/import recipes;
- external Search/index provider configuration;
- explicitly trusted external executables.

Packaging does not merge the components' internal contracts. A Search provider remains a Search provider; a Command remains an external executable; a Skill remains instructions. The Plugin supplies identity, version, installation source, contents, compatibility, update, and removal metadata only when those distribution needs become real.

## Search Providers And Note Hydration

Hard boundary:

> Providers own relevance. Exo owns note identity and graph.

Provider output should be keyed by Exo's authorized canonical document path. Root-relative identities are a later interface-quality improvement, not the current shared result id. Provider-native collection-relative paths stay provider diagnostics, not the shared result id.

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
- Routine product and routine plugins.
- Profile apply engine.
- Deep harness adapter model.
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
- routine CLI/UI/docs/code not needed by invocation records;
- profile apply engine and setup copy;
- deep harness model after generic AgentCommand launch replaces current callers;

Defer:

- out-of-process provider protocol;
- note-result hydration layer;
- view projection extension API;
- manifest/permission/distribution system;
- plugin marketplace.
- plugin packaging/installation until at least one proven capability set needs repeatable distribution across users or workspaces.

## Durable Docs And Skills

`docs/extension-architecture.md` is the active answer. The former plugin/profile
contracts and implementation plans were retired during the P4 documentation pass;
Git retains their historical text. Do not revive those documents as a compatibility
layer. Write a focused decision only when a concrete extension seam earns it.

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
