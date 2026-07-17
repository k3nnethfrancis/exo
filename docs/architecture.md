# Exo Architecture

Last updated: 2026-07-17

Exo is a local, user-owned Markdown exocortex with modular, tunable search, inline agent invocation, and graph management skills.

`../tasks.md` is the active execution ledger; `../issues.md` is the current QA/bug record. This document distinguishes the **shipped substrate** below from the **next vertical slice**. Historical plans may describe removed systems, but do not define current behavior.

## Product substrate

- Markdown and frontmatter under explicit Note Roots are canonical user data.
- Local Markdown image targets stay inside their source Note Root. Relative targets resolve from the source Note's folder; root-relative targets use the nearest source ancestor containing an existing regular file, with the Note Root as the final fallback. Remote and `file:` targets remain disabled.
- Note Roots are the sole Exo-authorized filesystem surface; explicit Command cwd choices do not create another root class.
- `.exo/` contains derived indexes, invocation/review records, artifacts, caches, and provenance references—not canonical knowledge. When the Workspace root is in Git, it must be ignored; Exo warns rather than rewriting `.gitignore`.
- One Workspace Canvas hosts Note, Terminal, Preview, Graph, and Diff panes.
- One focused Connections surface exposes Outline, Links, Graph, and earned Activity.

## Folder Index ontology

The current Folder model is:

- A Folder path gives each Note a primary structural home.
- An optional user-owned `index.md` is the Folder Index. It may contain the Folder's title, description, frontmatter/properties, links, typed relationships, and organization guidance.
- Double-clicking a Folder opens a Folder Overview composed from the Folder Index when present plus derived children and local graph context.
- The Explorer will hide `index.md` only as a duplicate child row. The underlying file will remain ordinary, revealable, editable Markdown.
- Viewing a Folder never writes to it. The Overview provides the explicit authoring action that may create `index.md`; no create-on-navigation behavior is implied here.
- Folder defaults and the nearest Folder Index chain are inherited guidance, not automatic child-note mutations. Explicit Note properties override defaults.
- Tags and typed relationships express additional membership beyond the primary path.

This produces useful ontology through normal organization without a mandatory schema, ontology database, or ontology plugin. Optional user-owned Knowledge Profiles may interpret these same facts; they do not replace Folder Indexes or become another canonical store.

## Accepted graph direction — feature-branch tracer

The isolated graph lab and quality investigation are distilled in
`graph-system-report-and-plan.md`. The `feat/graph-system-foundation` tracer now
enforces this separation:

```text
canonical Markdown
  → schema-agnostic Knowledge Graph
  → profile/view projection
  → deterministic layout
  → renderer-independent scene
  → WebGPU or Canvas pixels
```

The Knowledge Graph preserves open Concept types, arbitrary frontmatter
Properties, Relations, resolution, authority, and Evidence. Generic Markdown is
the zero-configuration profile. Open Knowledge Format 0.1 is the first
implemented built-in interoperability profile on the feature branch. A
Knowledge Profile may interpret a property as a
Concept reference or declare validation rules, but unknown properties and types
must survive and remain usable.

Graph Views compile this cold semantic model into dense numeric topology and
visual classes. Closed numeric node/edge kinds are allowed inside a compiled
View for performance; they are not the ontology contract. Semantic similarity
and inferred relationships remain versioned Derived Signals until accepted as
Markdown changes.

Exo still has overlapping legacy `GraphSnapshot` and `WorkspaceGraph`
representations. The feature branch adds snapshot 0.2 and the dense Graph View
behind `WorkspaceGraph`, but the protected caller/deletion pass remains before
the consolidation can be called complete. The Canvas Graph Pane is an
interaction tracer consuming that projection, not a third semantic model. Do
not move ontology or relation meaning into Canvas/WebGPU code.

Quality has two independent harnesses:

- GraphRenderBench owns rendering, layout geometry, interaction, memory, and
  latency.
- GraphUtilityBench owns the initial independent identity, resolution, Evidence,
  and profile-conformance tracer; its public task corpus must still add relation
  extraction, semantic proposals, navigation, and agent retrieval utility.

Neither produces an unexplained universal quality score.

## Deep modules

### `WorkspaceConfigStore`

Owns workspace configuration, revisions, unknown-key preservation, migration, and atomic persistence.

### `WorkspaceFiles`

Owns Note Root identity, path authorization, containment, symlink policy, absolute-path validation, and filesystem change events. Root-relative identities are a later interface-quality improvement, not a current shared IPC contract.

### `WorkspaceGraph`

Owns the derived Knowledge Graph: Note/Concept identity, lossless Properties,
Relation resolution and Evidence, backlinks, neighborhoods, graph context, and
invalidation. Markdown is canonical; graph snapshots and profile interpretations
are derived. During migration it also owns compatibility for the older graph
representations. Folder Overview and Graph Views consume this boundary rather
than creating their own graph models.

### `WorkspaceIndex`

Owns search selection, health, rebuild, and visible degradation. Filesystem and QMD are the two concrete adapters. Providers own relevance, snippets, rank, and provider health; Exo owns authorization, canonical Note/Folder identity, graph truth, and result hydration.

### `TerminalService`

Owns one direct `node-pty` lifecycle and byte-faithful transport. xterm owns the live screen and ordinary scrollback; only a bounded in-memory tail supports renderer reload and operator reads. App exit ends the PTY.

### `InvocationRunner`

Owns explicit Command authorization, launch, immutable run context, file observation, honest attribution, failure cleanup, review references, and invocation records.

### `WorkspaceCanvas`

Owns the single typed pane tree, focus, split/move/close behavior, and layout persistence.

### `CommandServerLifecycle`

Owns the thin token-authenticated local command server and generation-safe discovery lifecycle. CLI and preload are adapters over the same domain modules.

## Inline invocation and Skills

A configured Command is the provider-neutral executable identity. Claude, Codex, Pi, Guardian, and other tools use the same out-of-process path.

The shipped composer invokes configured Commands with explicit, user-authored messages and current-document context. The first graph-management Skill is next-slice work: it will be user-editable instructions/data for a bounded task, not code, authority, auto-chaining, or a bypass around review.

The initial loop is:

```text
select Note/context → invoke configured Command inline → inspect observed changes
```

The future Skill flow adds a reviewed, bounded proposal step; it is not claimed as shipped until its implementation and real-work dogfood land.

## Retained feature and data-model coverage

| Domain | Owner / durable boundary | User behavior | Evidence / canonical docs |
| --- | --- | --- | --- |
| Note Roots and files | `WorkspaceModel`, `WorkspaceFiles` | Exo reads and mutates only authorized Note Roots | containment tests; `../issues.md#exo-issue-103`, `../CONTEXT.md` |
| Workspace settings | `WorkspaceConfigStore`, revisioned `WorkspaceSettings` | Settings preserve unowned/unknown data and configured Commands | settings tests; `../issues.md#exo-issue-102` |
| Notes and properties | Markdown/frontmatter, `NoteDocument` | Source on disk remains canonical | note/Markdown tests; `../CONTEXT.md` |
| Search and graph | `WorkspaceIndex`, `WorkspaceGraph` | Filesystem/QMD search and Connections expose derived context; the planned schema-agnostic graph preserves open properties, relation authority, and evidence | search/graph tests; `graph-system-report-and-plan.md` |
| Canvas and panes | `WorkspaceCanvasLayoutSettings`, pane tree | Notes, Terminal, Preview, and Connections share one canvas | pane E2E; `../README.md` |
| Terminal | `TerminalManager`, direct `node-pty`, xterm | Live terminal with bounded reload tail; no durable session history | terminal suite; `terminal-runtime-decision.md` |
| Commands and invocation | `AgentCommand`, `InvocationRunner`, invocation records | Explicit inline invocation, headless document work, optional session handoff, observed-change review | invocation E2E; `../issues.md#exo-issue-106` |
| Exo MCP discovery | `packages/cli/src/mcp-server.ts`, `provider-mcp-setup.ts` | Optional provider-owned MCP for tool-capable clients; caller cwd resolves scope, ambiguous scope refuses retrieval, and app retrieval is used only for that exact Workspace. Shell-capable clients keep the Exo CLI path. | MCP + provider-setup tests; `provider-mcp-onboarding.md`, `reviews/2026-07-13-fable-mcp-agent-context-packet.md` |
| Command server and CLI | `command-protocol.ts`, `CommandServerLifecycle` | Resident-app commands plus app-off read/search/status where supported | command-server tests; `public-contract-reviews.md` |

This is the maintained pointer index. `tasks.md` decides what is next; it must not be used to imply implementation.

## Extension boundary

Use the lowest rung that works:

1. Markdown/frontmatter and Folder Index conventions.
2. Data-only configuration.
3. External executables through configured Commands.
4. Core-hosted trusted Preview panes.
5. Typed providers only after two concrete implementations prove shared behavior.
6. Out-of-process protocols only when isolation or external implementations earn them.
7. Manifests/distribution only when lower rungs fail for real extensions.

Search is the only earned typed provider seam. Folder ontology and graph management Skills are Markdown/config/Command behavior, not reasons to restore the old plugin platform.

A future Plugin is an installable distribution bundle, not another deep module or provider interface. It may package proven Skills, ontology templates, Command templates, evals, and explicitly trusted external integrations; each component keeps its own execution and authority boundary.

## Future systems

After the launch loop is stable:

1. Add and evaluate more graph management Skills.
2. Build Ashby Gym and Exograph Steward before assuming training is necessary.
3. Keep SFT, preference, RL, embedding, and reranker recipes separate from local/cloud executors.
4. Materialize selected external sources as source-faithful Markdown when indexing is useful; do not build a native Feed first.
5. Add local/cloud index providers only after concrete demand, privacy/upload/deletion semantics, and measured retrieval value earn them.
6. Extract a Learning Factory only after real recipes expose stable shared behavior; Exo never silently activates a candidate or expands authority.

## Safety boundaries

- Renderer code never accesses files or processes directly.
- Note operations pass canonical-path authorization inside explicit Note Roots; root-relative IDs remain future quality work.
- Folder Overview remains read-only until its explicit metadata authoring action.
- Command trust is app-local, workspace-scoped, fingerprinted, and invalidated when executable fields change. A moved/copied Workspace fails closed and requires explicit re-authorization.
- A Command can have an explicit cwd outside Note Roots, but observed-change review is authoritative only inside the Workspace's Note Roots; Exo never claims it reviewed external writes.
- Human confirmation is required before invocation; agent-authored content cannot auto-chain execution.
- Unknown writers and overlapping changes remain ambiguous rather than falsely attributed.
- Public CLI commands, command-server routes, and shared protocol types require the repository's architecture-review gate.

See `extension-architecture.md`, `graph-system-report-and-plan.md`,
`../CONTEXT.md`, `adr/0002-folder-indexes-as-ontology.md`, and
`adr/0005-schema-agnostic-graph-and-knowledge-profiles.md` for the durable
boundary and vocabulary.
