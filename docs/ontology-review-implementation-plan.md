# Ontology candidate review implementation plan

Status: approved next vertical slice after the Ontology parser/compiler and
Candidate/Active persistence foundation lands.

## Product contract

`<Workspace Root>/ontology.yaml` is always a Candidate. Creating, editing, or
deleting it never changes the active graph by itself. Exo previews the bounded
graph effects, then Keep explicitly activates exactly what the user reviewed.
Reject leaves the Active Ontology, graph, Markdown, and caches unchanged.

Candidate deletion while an Ontology is Active is a deactivation Candidate. It
must be previewed and kept before Generic Markdown becomes Active again.

## Bounded review payload

The renderer receives identities, revisions, bounded diagnostics, and counts—not
raw YAML or full graph snapshots:

```ts
interface OntologyGraphEffectSummary {
  baseSnapshotId: string;
  candidateSnapshotId: string;
  affectedConcepts: number;
  before: OntologyEffectCounts;
  after: OntologyEffectCounts;
}

interface OntologyEffectCounts {
  typedConcepts: number;
  ontologyRelations: number;
  findings: { info: number; warning: number; error: number };
}
```

The pure summarizer compares two deterministic `KnowledgeGraphSnapshot`s. It
counts typed Concepts, `origin: "ontology"` Relations, Ontology-evidenced
Findings, and affected Concept identities.

## Ownership

- `WorkspaceGraph` builds Active and Candidate snapshots through one internal
  parameterized builder. Normal reads consume Active only. Preview uses a staged
  slot and never touches active caches.
- `WorkspaceOntologyStore` owns Candidate inspection and exact accepted bytes,
  checkpoint integrity, and an opaque activation-record revision.
- The derived utility worker is the one serialized owner of preview, Keep,
  Reject, and staged graph publication.
- `WorkspaceNotesService` and IPC are thin facades. The renderer never parses
  YAML or derives graph effects.

The internal operations are `ontology-preview`, `ontology-keep`, and
`ontology-reject`. Keep carries a three-part guard:

```ts
{
  candidateRevision: string | null;
  activationRevision: string | null;
  baseSnapshotId: string;
}
```

## Atomic Keep

Inside the worker's existing serialized queue:

1. Re-read Candidate and Active checkpoint.
2. Compare Candidate revision, activation revision, and previewed base snapshot.
3. Reuse or rebuild the staged Candidate snapshot.
4. Persist the exact accepted bytes atomically.
5. Publish the already-complete snapshot synchronously.
6. Clear only obsolete ontology-dependent topology/detail caches.
7. Emit one graph-changed event after success.

A stale guard does not partially activate anything. Exo reports “Changed—review
again” and refreshes the preview. Candidate watcher events invalidate only
preview memoization; they do not change graph identity or wake the renderer.

## Minimal surface

Place one compact row in Workspace Settings directly below the Notes folder.
Do not add a tab, modal, YAML editor, or Connections surface.

- Generic or Active: show the current identity.
- Valid Candidate: show concise effects such as `12 typed · +4 relations · 2
  findings`, plus icon-only Keep and Reject.
- Previewing or applying: small progress indicator; controls disabled.
- Invalid: one concise diagnostic and a disclosure for bounded remainder; Keep
  disabled.
- Stale Keep: refresh automatically and ask for review again.
- Rejected Candidate: quiet `Not applied`; allow deliberate reopening.

Graph and Connections refresh through the ordinary graph-changed event only
after Keep.

## Gates

Core and service tests must prove deterministic summaries; bounded payloads;
zero file/cache/graph mutation during preview; stale Candidate, activation, and
base-graph rejection; exact previewed-snapshot publication; Reject preserving
all Active identities; explicit deactivation; exact-byte checkpoint integrity;
and unchanged Notes.

The Electron tracer bullet creates a Candidate, observes exact effects, proves
Graph and Connections unchanged before Keep, forces a stale Keep with a
concurrent Markdown edit, keeps the refreshed Candidate, verifies Ontology
origin/Evidence, restarts into the same Active revision, rejects a later
Candidate, and compares every Note byte before and after.

## Deferred

YAML editing, discovery, migrations, OKF UX, presentation rules, semantic
inference, Note rewriting, full before/after canvases, onboarding, CLI/MCP, and
multiple Active Ontologies remain outside this slice.
