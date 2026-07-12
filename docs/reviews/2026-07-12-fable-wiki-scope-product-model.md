# Fable Review — Wiki Scope, Global Exocortex, and Agent-Maintained Knowledge

## Decision required

Before launch-shaping implementation begins, decide whether Exo should remain conceptually a single Note-Root-only workspace, evolve into a named multi-folder Markdown scope, or eventually support both independent wikis and an opt-in global composed view. We need a crisp model and a staged plan, not a feature list.

## Current product and code reality

Exo is currently: **a local Markdown exocortex with modular search, inline configured-Command invocation, and graph-management skills.**

The just-completed simplification deliberately removed the old `projectRoots` concept everywhere. It was not an explicit wiki concept: it mixed filesystem authorization, Explorer rendering, search, graph scope, command cwd, and persistence. The current shared model is in `packages/core/src/types.ts`:

- `WorkspaceModel` has `workspaceRoot`, `defaultTerminalCwd`, `noteRoots`, `indexedRoots`, and `indexing`.
- `NoteRoot` is an authorized mutable Markdown root.
- `IndexedRoot` is a separate retrieval configuration with path, Markdown pattern/ignores, kind, and QMD backend.
- `WorkspaceFiles` makes Note Root containment the editable/read boundary.
- QMD currently stores managed state under `<workspaceRoot>/.exo/qmd/`; `IndexedRoot` is the sole current typed provider seam.
- Configured `AgentCommand`s are workspace config; trust is app-local and keyed to workspace identity plus command identity. Inline `@agent` invocation carries the current document context and requires explicit Shift+Enter.
- Folder Indexes are the next planned vertical slice: optional user-authored `index.md` within a writable Note Root, hidden only as a duplicate Explorer row.

The current launch contract intentionally says: **a workspace is a named set of Note Roots; no attached/imported Project Root domain.**

## New evidence and hypothesis

LLMWiki is an implementation of the emerging LLM-wiki pattern: project-adjacent Markdown knowledge maintained by agents. Its engine is installed as a dependency in a target wiki/workspace; it keeps agent instructions, raw sources, structured wiki pages, index, and maintenance log adjacent to that work. It separates the wiki repo from application code. Source: <https://github.com/ajeygore/llmwiki>.

Other current LLM-wiki products similarly converge on durable Markdown as agent-maintained compiled memory, but vary between one folder per wiki and multi-wiki applications. The useful observation is not “restore Projects.” It is that users may need:

1. a personal/wiki scope that spans deliberately selected Markdown folders;
2. a project-local wiki adjacent to a code repository; and later
3. an opt-in global view across those scopes.

The product thesis is: **the future unit may be a named, managed Markdown scope—not a single personal vault and not an opaque project attachment.** A scope might be a central exocortex, an independent project wiki, or an explicitly composed global view. This must preserve simple launch behavior and local-first trust.

## Concrete workflows to judge

| Workflow | User intent | Failure we must avoid |
| --- | --- | --- |
| Personal exocortex | Notes plus selected Markdown project documentation are one working memory | Treating code folders or all machine files as silently writable/wiki content |
| Project wiki | A project keeps agent context, decisions, raw-source derivatives, skills, and logs next to its code | Requiring it to become part of the user's personal vault or leaking personal context into it |
| Global composed view | Search/reason over user-selected scopes, with cross-scope links where meaningful | A second hidden filesystem authorization domain, accidental wide retrieval, or unclear provenance |

## Questions

1. What is the durable product object? Is it a `Wiki`, `Workspace`, `Scope`, a `Workspace` containing `Wiki`s, or one other term? Define it so UI, CLI, filesystem authorization, indexing, graph, Commands, and docs use one meaning.
2. For launch, should multiple selected Markdown folders be peer Note Roots of one Workspace, or should one Workspace always be one wiki and multi-wiki composition wait? Give a recommendation and the smallest sequence that preserves the current simplification.
3. If a future global view exists, is it a real writable workspace, a read-only federated search/graph projection, or an ephemeral query scope? How should link identity and title collisions work across roots/machines without pretending links are portable when they are not?
4. What is the correct indexing model?
   - One QMD/local index per wiki/scope, with a separate global index only if earned;
   - a global index with scope filters;
   - or another design?
   Address privacy, deletion, performance, provider variation, migration, and CLI ergonomics.
5. What should the CLI look like? We need a simple default for the active wiki plus explicit selection/filtering for another wiki or global search. Avoid an unbounded matrix of `--workspace`, `--wiki`, `--root`, and provider switches.
6. How should configured Commands, inline invocations, Skills, and eventual maintenance automations be scoped? In particular, should a skill/automation be global user configuration, wiki-owned Markdown/config, or both with explicit precedence? How do we preserve reviewable writes and trust without recreating a harness, plugin runtime, or hidden scheduled-agent system?
7. What are the launch-critical changes, what should remain a research/decision track, and what must we explicitly not build yet? Challenge the user’s thesis where it overreaches.

## Candidate directions

### A. Keep launch simple; generalize terminology and earn composition later

One Workspace remains a named set of peer Note Roots. Treat it as one explicit wiki scope, not a personal-vault assumption. A project-local wiki is simply another selected workspace/scope. Global cross-scope retrieval is deferred until concrete workflows prove it. Index stays per workspace/scope.

**Pros:** preserves current trust model and shipped code; no new global identity/index/automation system; already supports multiple Note Roots structurally.

**Risks:** switching may feel heavy; cannot yet offer cross-wiki retrieval or project/personal federation.

### B. Introduce independent named Wikis plus a global, read-only composed view

Each Wiki owns Note Roots, index config/state, graph, command trust, and local Skills. Exo has an active Wiki and an optional global projection that searches selected Wikis and returns scope-qualified results. It has no global write/invocation target.

**Pros:** clear separation and good product story for personal versus project knowledge; global is useful without bypassing local authority.

**Risks:** materially expands configuration, CLI, index management, link identity, and lifecycle before launch.

### C. One global Workspace with many folder imports and per-root policy

The app manages all selected folders in one Workspace; roots may have local or global index participation and per-root command/skill policy.

**Pros:** elegant “all my Markdown” experience and immediate cross-project graph.

**Risks:** reintroduces the exact ambiguity removed in `projectRoots`; authorization, trust, provenance, and UX become complex before the basic graph-maintenance loop is proven.

## Preliminary recommendation

Choose A for launch, but rename/document the object as an explicit managed Markdown scope rather than a personal vault. Preserve the current multi-Note-Root model as peer roots only. Treat B as a structured research track, beginning with read-only composed retrieval only after dogfooding demonstrates real cross-scope work. Reject C for now.

Agent-maintained wiki behavior should start with explicit, user-initiated Skills through an existing trusted Command and diff review. Do not add background maintenance or scheduler lifecycle until one human-triggered graph-maintenance Skill has measurable value and stable write/review semantics. A later automation should be a scoped declaration plus an explicit trigger/schedule and audit record—not an implicit “skills auto-update the graph” behavior.

## Please review

- Correct or replace the product object and staged recommendation.
- Identify hidden boundary failures in scope identity, links, trust, index storage, provider policy, and agent writes.
- Recommend a minimal CLI and onboarding shape.
- State the first durable decision/ADR we should write and the experiments that would earn the next step.
- Say whether any change is launch-critical before the current Folder Overview / first graph-maintenance Skill slice.

-- Exo architecture review | 2026-07-12

## Fable ruling — 2026-07-12

Adopt candidate A with one correction: do not rename the product object. **Workspace** already is Exo's managed Markdown scope. It owns Note Root write authority, Indexed Root retrieval, index state/configuration, and Command trust. A project wiki is another Workspace; a Workspace never composes other Workspaces.

Reject candidate B for now and C outright. If cross-workspace retrieval earns demand, it is a read-only projection over independent workspace indexes with scope-qualified results; it is not a Workspace, write target, invocation target, global index, or implicit cross-workspace graph.

Launch-critical follow-ups are: record the scope model in an ADR; make derived `.exo/` state safe in Git-backed Workspaces through an ignore convention and visible warning rather than auto-editing `.gitignore`; and state that Commands may write outside Note Roots while Exo's observed-change review covers only Note Root changes. Skills are Workspace-owned Markdown and explicit/reviewed invocation remains the only approved maintenance mechanism. Do not build federation, a global index, cross-workspace link resolution, global Skill precedence, or scheduling.

Decision recorded in `../adr/0004-workspace-is-the-scope-object.md`.
