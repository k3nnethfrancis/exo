# ADR 0004: Workspace is Exo's scope object

**Status:** Accepted  
**Date:** 2026-07-12

## Context

LLM-wiki practice demonstrates a useful workflow: a project can carry its own Markdown knowledge, agent instructions, maintenance log, and sources adjacent to its code. It does not establish that Exo should restore the removed `projectRoots` domain, make every machine folder one global graph, or make a federation a launch feature.

Exo already has the necessary launch object: `WorkspaceModel` owns writable `NoteRoot`s, read-only retrieval `IndexedRoot`s, index configuration, and workspace-scoped Command trust. The previous Project Root surface was deleted because it mixed authorization, Explorer topology, command cwd, retrieval, graph scope, and persistence without one product meaning.

## Decision

A **Workspace** is Exo's unit of scope. It owns:

- writable Note Roots and their filesystem authority;
- read-only Indexed Roots and retrieval policy;
- index configuration and per-workspace derived state;
- configured Commands and workspace-scoped trust decisions.

A project wiki is simply a Workspace whose Note Root is the project's wiki or documentation folder. A Workspace is never composed of other Workspaces.

The two tiers are intentional:

- **Note Roots** are user-authorized Markdown locations Exo may read and mutate.
- **Indexed Roots** are selected retrieval locations. They do not confer edit authority, Command trust, or a second Explorer filesystem domain.

Each Workspace keeps its own index. If cross-workspace retrieval earns demand, it will begin as a read-only fan-out projection over existing Workspace indexes. It is never a Workspace, never a write target, never an invocation target, and never a global index by default. Results must carry workspace/root-qualified identity. Wikilinks resolve inside their owning Workspace; any future cross-workspace reference must be explicit.

Commands and their trust decisions remain Workspace-scoped. Skills are user-editable Markdown owned by a writable Note Root and executed only by explicit configured-Command invocation with reviewable observed changes. Do not add global Skill precedence, background maintenance, scheduler lifecycle, or automatic graph updates until a human-triggered Skill has earned them with measured value.

## Derived-state and boundary rules

- `.exo/` is derived runtime state, not canonical knowledge, and must be ignored when its Workspace root is inside a Git repository. Exo warns before/index status when that state may be tracked; it does not silently edit a user's `.gitignore`.
- Moving or copying a Workspace creates a new path-shaped local identity for index/runtime and trust state. Trust fails closed; users must explicitly re-authorize Commands after a move/copy. This is deliberate until a portable identity is earned.
- Overlapping Note Roots are warned about but not prohibited. They can yield duplicate index work and scope-qualified result ambiguity; implicit graph or write authority is never widened.
- A Command may execute with an explicitly chosen cwd outside Note Roots, but Exo's observed-change review is authoritative only for changes inside its Workspace's Note Roots. The UI and records must not imply a complete audit of external writes.

## Consequences

- Keep the current launch model and the Project Root deletion.
- Improve Workspace switching only if real use proves it is the friction, before building federation.
- Defer global `--all` search, cross-workspace graph, portable workspace identity, and an index-provider matrix until dogfood proves recurring need.
- Dogfood a personal exocortex Workspace and a project-adjacent wiki Workspace for 2–4 weeks. Log switching friction and concrete cross-scope requests in `notes/shoshin-codex/projects/exo/insights.md`.

## Sources

- Fable review: `../reviews/2026-07-12-fable-wiki-scope-product-model.md`
- Product insight log: `notes/shoshin-codex/projects/exo/insights.md`
- LLMWiki reference: <https://github.com/ajeygore/llmwiki>
