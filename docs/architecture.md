# Exo Architecture

Last updated: 2026-07-20

Exo is a local, user-owned Markdown exocortex with modular, tunable search, inline agent invocation, and graph management skills.

`../tasks.md` is the active execution ledger; `../issues.md` is the current QA/bug record. This document distinguishes the **shipped substrate** below from the **next vertical slice**. Historical plans may describe removed systems, but do not define current behavior.

## Product substrate

- Markdown and frontmatter under explicit Note Roots are canonical user data.
- Local Markdown image targets stay inside their source Note Root. Relative targets resolve from the source Note's folder; root-relative targets use the nearest source ancestor containing an existing regular file, with the Note Root as the final fallback. Remote and `file:` targets remain disabled.
- Note Roots are the sole Exo-authorized filesystem surface; explicit Command cwd choices do not create another root class.
- `.exo/` contains derived indexes, invocation/review records, artifacts, caches, and provenance references—not canonical knowledge. When the Workspace root is in Git, it must be ignored; Exo warns rather than rewriting `.gitignore`.
- One Workspace Canvas hosts Note, Terminal, Preview, Graph, and Diff panes.
- One focused Connections surface exposes Outline, Links, Graph, and earned Activity.

## Folder structure and indexes

The current Folder model is:

- A Folder path gives each Note a primary structural home.
- An optional user-owned `index.md` is the Folder Index. It may contain the Folder's title, description, frontmatter/properties, links, typed relationships, and organization guidance.
- Double-clicking a Folder opens a Folder Overview composed from the Folder Index when present plus derived children and local graph context.
- The Explorer will hide `index.md` only as a duplicate child row. The underlying file will remain ordinary, revealable, editable Markdown.
- Viewing a Folder never writes to it. The Overview provides the explicit authoring action that may create `index.md`; no create-on-navigation behavior is implied here.
- Folder defaults and the nearest Folder Index chain are inherited guidance, not automatic child-note mutations. Explicit Note properties override defaults.
- Tags and typed relationships express additional membership beyond the primary path.

This produces useful structure through normal organization without a mandatory
schema or ontology database. One optional user-owned `ontology.yaml` may
interpret these facts across the Workspace; it does not replace Folder Indexes
or become another canonical store.

## Note Root Formats and Workspace Ontology

Every Note Root is first projected by a Format. **Generic Markdown** is the
zero-configuration default: one resolved Markdown file becomes one Concept,
headings only label or structure it, authored links connect existing file
Concepts, and tags are shared tag Concepts. Frontmatter remains lossless;
`type: project` is an open classification of that same Note, not a separate
node or edge.

Permissive **OKF 0.1** is a built-in interoperability Format for an existing
OKF workspace. It is not selected automatically and is not a public format
setting today. Under that external convention, `index.md` and `log.md` remain
openable/searchable/editable Notes but do not enter the Concept graph. See
`note-root-formats.md` for the exact boundary.

An explicitly kept `<Workspace Root>/ontology.yaml` applies after Format
projection. It may interpret open Concept Types, Property shapes,
reference-valued Relations, and validation rules. The user-edited file is a
Candidate; only a separately reviewed Keep may persist its exact accepted
source under `.exo/ontology` and publish a new graph generation. Candidate
watcher events alone never invalidate the graph. The Ontology never changes
Markdown or source document Relations. See `workspace-ontology.md` and ADR
0006.

## Accepted graph direction — feature-branch tracer

The isolated graph lab and quality investigation are distilled in
`graph-system-report-and-plan.md`. The `feat/graph-system-foundation` tracer now
enforces this separation:

```text
canonical Markdown
  → Note Root Format projection
  → schema-agnostic Knowledge Graph
  → explicitly kept Workspace Ontology interpretation
  → Graph View projection
  → deterministic layout
  → renderer-independent scene
  → WebGPU or Canvas pixels
```

The Knowledge Graph preserves open Concept types, arbitrary frontmatter
Properties, Relations, resolution, origin, and Evidence. Generic Markdown is
the zero-configuration Format. Open Knowledge Format 0.1 is a built-in
interoperability Format. A kept Workspace Ontology may interpret a Property as
a Concept reference or declare validation rules, but unknown Properties and
Types survive and remain usable. Relation origin is always `document`,
`ontology`, or `inferred`: an Ontology explains a derived relation from
existing Markdown; it cannot turn it into a document-authored fact.

Graph Views compile this cold semantic model into dense numeric topology and
visual classes. Closed numeric node/edge kinds are allowed inside a compiled
View for performance; they are not the ontology contract. Semantic similarity
and inferred relationships remain versioned Derived Signals until accepted as
Markdown changes.

`WorkspaceGraph` is now the single production graph boundary. It derives the
schema-agnostic knowledge snapshot used by Connections and compiles the Graph
Pane's hot path into compact typed topology. Labels, paths, Properties,
Findings, and Relation Evidence remain cold and are fetched through bounded,
snapshot-qualified lookup, summary, and index-detail reads. The former object
Graph View IPC, unbounded concept-detail route, and standalone `GraphSnapshot`
0.1/query modules have been removed. The Canvas and WebGPU renderers consume
the same renderer-neutral scene and cannot invent graph semantics.

Two kinds of verification remain deliberately separate. Graph contract tests
cover identity, resolution, Evidence, and profile conformance. The repo-local
graph performance suite covers rendering, layout geometry, interaction, memory,
resilience, and latency. Neither produces an unexplained universal quality
score.

Electron's normal hardware-acceleration policy is the production default so
the Graph Pane can capability-detect WebGPU without unsafe Chromium flags. A
diagnostic `EXO_DISABLE_GPU=1` launch may disable hardware acceleration, but it
does not change feature lists or renderer semantics; Canvas remains the product
fallback. Source and exact packaged evidence must compile the production graph
shaders, submit a bounded draw, and record an explicit absence, adapter, device,
shader, validation, or success outcome.

## Deep modules

### `WorkspaceConfigStore`

Owns workspace configuration, revisions, unknown-key preservation, migration, and atomic persistence.

### `WorkspaceFiles`

Owns Note Root identity, path authorization, containment, symlink policy, absolute-path validation, and filesystem change events. Root-relative identities are a later interface-quality improvement, not a current shared IPC contract.

### `WorkspaceGraph`

Owns the derived Knowledge Graph: Note/Concept identity, lossless Properties,
Relation resolution and Evidence, backlinks, neighborhoods, graph context, and
invalidation. Markdown is canonical; graph snapshots and Format/Ontology interpretations
are derived. Folder Overview, Connections, and Graph Views consume this
boundary rather than creating their own graph models. Connections receives a
bounded Note-local context; the full Graph Pane receives string-free typed
topology and fetches cold metadata only for inspected/focal Concepts.

### `WorkspaceIndex`

Owns search selection, health, rebuild, and visible degradation. Filesystem and QMD are the two concrete adapters. Providers own relevance, snippets, rank, and provider health; Exo owns authorization, canonical Note/Folder identity, graph truth, and result hydration.

### `TerminalService`

Owns one direct `node-pty` lifecycle and byte-faithful transport. xterm owns the live screen and ordinary scrollback; only a bounded in-memory tail supports renderer reload and operator reads. App exit ends the PTY.

### `InvocationRunner`

Owns explicit Command authorization, launch, immutable run context, process ownership, exact Changeset capture, failure cleanup, review transactions, and invocation records.

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
| Search and graph | `WorkspaceIndex`, `WorkspaceGraph` | Filesystem/QMD search and Connections expose derived context; Knowledge Graph 0.3 preserves open Properties, Relation origin, and Evidence while the Graph Pane uses compact topology plus bounded cold reads | search/graph/transport tests; `graph-system-report-and-plan.md` |
| Canvas and panes | `WorkspaceCanvasLayoutSettings`, pane tree | Notes, Terminal, Preview, and Connections share one canvas | pane E2E; `../README.md` |
| Terminal | `TerminalManager`, direct `node-pty`, xterm | Live terminal with bounded reload tail; no durable session history | terminal suite; `terminal-runtime-decision.md` |
| Commands and invocation | `AgentCommand`, `InvocationRunner`, invocation records | Explicit inline invocation, headless document work, optional session handoff, observed-change review | invocation E2E; `../issues.md#exo-issue-106` |
| Exo MCP discovery | `packages/cli/src/mcp-server.ts`, `provider-mcp-setup.ts` | Optional provider-owned MCP for tool-capable clients; caller cwd resolves scope, ambiguous scope refuses retrieval, and app retrieval is used only for that exact Workspace. Shell-capable clients keep the Exo CLI path. | MCP + provider-setup tests; `provider-mcp-onboarding.md`, `reviews/2026-07-13-fable-mcp-agent-context-packet.md` |
| Command server and CLI | `command-protocol.ts`, `CommandServerLifecycle` | Resident-app commands plus app-off search/status | command-server tests; `public-contract-reviews.md` |

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
- Exo reports exact observed file state and review decisions; it does not infer
  who authored bytes outside the explicit invocation/response envelopes.
- Public CLI commands, command-server routes, and shared protocol types require the repository's architecture-review gate.

See `extension-architecture.md`, `graph-system-report-and-plan.md`,
`../CONTEXT.md`, `adr/0002-folder-indexes-as-ontology.md`, and
`adr/0005-schema-agnostic-graph-and-knowledge-profiles.md` for the durable
boundary and vocabulary.
