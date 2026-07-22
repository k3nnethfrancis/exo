---
status: accepted
---

# Keep an ontology library user-owned and activate one interpretation at a time

The first Workspace Ontology foundation reads one user-owned
`<Workspace Root>/ontology.yaml` as a Candidate and stores the exact kept
source under `.exo/ontology/activation.json`. That is sufficient for one
reviewed interpretation, but not for the product requirement to compare and
switch among several saved interpretations.

## Decision

An Ontology library is user-owned Markdown-adjacent configuration, not an Exo
database or a hidden generated registry.

```text
<Workspace Root>/
  ontology.yaml                 # existing/default source; remains supported
  ontologies/
    research.yaml               # optional additional saved sources
    publishing.yaml
  .exo/ontology/
    activation.json             # derived exact accepted snapshot and selection
```

The library is the regular root `ontology.yaml`, when present, plus direct YAML
files in the flat `ontologies/` directory. Each source declares its own stable
`id`; a filename is a source location, not an ontology identity. Sources must
be regular, bounded files contained by the real Workspace root. Nested library
directories, arbitrary external paths, symlinks, and executable configuration
are not supported by this slice.

There is always exactly one active interpretation:

- **Generic Markdown** — no active Ontology;
- one reviewed saved source; or
- an inert selected candidate under review.

Saved Ontologies never merge, inherit, or compose. Selecting another source
creates a Candidate against the current Active source. It must compile and
preview successfully, then receive an explicit Keep before it becomes Active.
Reject leaves the current Active source untouched. Editing an inactive source
has no graph effect; editing the selected source creates a new Candidate and
invalidates its prior review. Exo records the exact accepted source, revision,
and source-relative path under `.exo/` so restart and a later external edit are
honest and recoverable.

The current root `ontology.yaml` remains an ordinary library source. Exo does
not migrate, move, rename, copy, or replace it. A user who wants a named saved
alternative creates a separate `ontologies/<name>.yaml` file through an
explicit action. The root source can remain active forever.

## Consequences

- Existing Workspaces retain their current contract and file layout.
- Git can version and review saved Ontologies beside the Workspace.
- Exo can offer Generic, Active, and saved alternatives without treating
  `.exo/` as canonical knowledge.
- Candidate/Active revision guards expand to include source identity and path;
  a filename change or source replacement is stale rather than silently
  accepted.
- Workspace watchers distinguish inactive-library changes (refresh library
  listing only) from selected-source changes (refresh inert Candidate review).
- Format selection remains a separate per-Note-Root compatibility decision.
  An Ontology source neither selects Generic/OKF nor encodes Format rules.

## Rejected alternatives

- **Copy the selected file into root `ontology.yaml`.** This mutates
  user-owned source merely to change a view and makes selection indistinguish-
  able from an external edit.
- **Store saved Ontologies only under `.exo/`.** This makes durable user graph
  meaning derived/private rather than inspectable and versionable.
- **Activate multiple sources together.** Conflicting path defaults, validation
  rules, and property meanings would create an opaque implicit schema.
- **Use the legacy internal `KnowledgeProfile` name for saved Ontologies.**
  Formats and Ontologies are different contracts.

The initial rollout may expose the library only in Settings and Graph. The
agent-led discovery flow is a separate read-only proposal path that stages one
of these sources for ordinary Candidate review.
