# Workspace Ontology foundation

Exo recognizes one user-owned candidate at:

```text
<Workspace Root>/ontology.yaml
```

An Ontology is a passive interpreter for existing Markdown. It never owns or
rewrites Notes, executes code, chooses models, or controls presentation. A
Workspace without an explicitly kept Ontology remains Generic Markdown.

## Supported candidate shape

```yaml
ontology_schema: 1
id: personal-research
version: 1
label: Personal research
type_property: type

types:
  paper:
    label: Paper
    paths: [papers/**]
  claim:
    label: Claim

properties:
  status:
    value: string
    allowed: [draft, published]
  supports:
    value: reference[]
    predicate: supports
    direction: outgoing
    targets: [claim]

rules:
  - id: paper-basics
    type: paper
    require: [title]
    recommend: [status]
```

Required top-level fields are `ontology_schema`, `id`, and `version`.
`type_property` defaults to `type`; reference direction defaults to `outgoing`.
Supported Property shapes are `string`, `string[]`, `number`, `number[]`,
`boolean`, `boolean[]`, `reference`, and `reference[]`.

Identifiers and unknown YAML keys are open vocabulary and retained in the
parsed source. Unknown Concept Types remain valid. Candidate validation is
atomic: an invalid rule prevents the whole candidate from compiling, while the
original file remains untouched.

## Candidate and Active are different

Changing `ontology.yaml` creates a **Candidate**. It never changes the active
graph by itself. The core store compares exact candidate revisions for Keep and
Reject, preventing a stale review from accepting newer bytes.

An explicitly kept source and revision are atomically persisted under the
Workspace runtime's `.exo/ontology/activation.json`. This is reproducible
derived state, not canonical knowledge. It allows restart to preserve the last
kept interpreter while the user-owned candidate changes. A missing or invalid
kept state falls back explicitly to Generic Markdown.

Workspace Settings shows one compact review row beneath the Notes folder when a
Candidate differs from Active. It reports bounded typed-Concept, Ontology-
Relation, and Finding effects. Keep and Reject are explicit; stale Candidate,
Active, or Markdown revisions require a fresh review. Keep atomically persists
the exact accepted source and then publishes the already-reviewed graph.
Reject preserves Active. Both actions compare an exact content-derived
Markdown manifest, so they do not depend on filesystem-watcher timing.

Candidate edits alone remain inert. Their dedicated watcher notification does
not invalidate Note caches, refresh Explorer, or replace graph identity. A
successful Keep emits one ordinary graph-changed event. Authored Links and
Backlinks remain authored facts; resolved local Ontology Relations appear only
in the bounded Connections graph neighborhood with their Ontology origin and
Evidence preserved.

## Interpretation contract

The pure compiler supports explicit and bounded path-default Concept Types,
Property shape/allowed-value Findings, reference-valued Relations, target-type
expectations, and required/recommended Properties. Every ontology-origin
Relation cites both the source Property and exact Ontology rule/revision.
Unresolved references return explicit unresolved Concept endpoints, so an
interpreted Relation never dangles. Interpretation does not mutate input
Concepts or Notes.

Relation origin is:

- `document`: present directly in Markdown;
- `ontology`: interpreted from Markdown by an Ontology rule;
- `inferred`: observed by a versioned derived producer.

## Separate contracts

A **Format** reads a Note Root, currently Generic Markdown or permissive OKF
0.1. The **Workspace Ontology** interprets meaning after Format projection. A
**Graph View** controls layout, labels, color, physics, and interaction. The
Ontology cannot contain visual hints, inference policy, executable rules,
prompts, or file mutations.
