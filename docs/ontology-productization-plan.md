# Ontology discovery, library, and format productization

**Status:** proposed next vertical slice — not a statement of shipped UI

## Purpose

Make Exo's optional Workspace Ontology understandable and useful without
weakening the ordinary Markdown graph. A person may ask a configured local
Command to propose an Ontology, inspect its qualitative effect on the graph,
edit the user-owned YAML, and explicitly select one interpretation at a time.

This is an early-access layer above the stable Markdown, search, graph, and
review loop. Generic Markdown remains the default and works with no Ontology.

## Non-negotiable model

```text
Markdown Notes ──Format──> base Knowledge Graph ──active Ontology──> interpreted graph
                                      │                         │
                                      └──── Graph View ──────────┘
```

- One resolved Markdown file is one Note/Concept node. Headings label or
  structure that Note; they are not additional nodes.
- Authored links and tag membership are document-origin graph facts. Unknown
  frontmatter is preserved.
- A Note Root Format determines base projection. Generic Markdown is the
  zero-configuration default. Permissive OKF 0.1 is explicit interoperability
  compatibility, never an automatic conversion or default.
- An Ontology is a passive interpreter of existing values. It may add
  evidence-bearing `ontology`-origin relations and Findings; it never mutates
  Notes, executes code, or controls visual layout.
- Generic Markdown/no Ontology and exactly one saved Ontology are mutually
  exclusive active interpretations. Saved Ontologies never compose.
- Semantic/inferred signals remain separate from both authored and
  Ontology-origin facts. They are never silently promoted.

## Current foundation and gap

Today Exo has a single user-owned `<Workspace Root>/ontology.yaml`, a
Candidate/Active state machine, stale-safe Keep/Reject, isolated candidate
compilation, and bounded effect summaries. It does not yet have public Format
selection, an agent-led discovery flow, a saved Ontology library, graph-side
comparison controls, or a public OKF setup flow.

The next slice extends this foundation. It does not replace `WorkspaceGraph`,
the existing review guard, the current `document | ontology | inferred` origin
contract, or the Generic Markdown baseline.

## User flows

### First run, after Command setup

The setup flow adds one optional, skippable decision:

```text
Shape your graph
  [Not now]  [Use existing]  [Discover structure]
```

`Discover structure` selects an already configured, usable Command. The Command
receives a frozen, read-only Workspace snapshot plus the Ontology design Skill.
It returns one schema-valid proposal or an abstention; it never edits live
Markdown. The trusted Exo host stages only the exact validated proposal after
rechecking Workspace, Candidate, and Active revisions.

The review presents the smallest useful information:

- editable candidate YAML;
- affected types, typed property Relations, and Findings;
- representative affected Notes and rule Evidence;
- one qualitative before/after graph comparison; and
- Keep / Reject.

There is no migration action in this flow. Applying an accepted Ontology to
existing Notes is a later, distinct reviewed Invocation.

### Settings and Graph

The Workspace surface exposes the current interpretation and a compact switcher:

```text
Generic Markdown · Research · Publishing · Draft
```

Selecting a saved Ontology compiles a new derived graph snapshot; it never
rewrites Markdown. The graph can preview Draft beside the current selection,
but renders only one interpretation at a time. The graph review emphasizes
human legibility and representative relation explanations, not a universal
quality score.

### Existing OKF roots

Generic Markdown is selected unless a user explicitly chooses otherwise. When
Exo detects an existing `okf_version: "0.1"` bundle root, it may offer an
advanced compatibility choice explaining only the observable effects:

- OKF root-relative Markdown links;
- `index.md` and `log.md` remain Notes but are excluded from the Concept graph;
- missing `type` is an evidence-backed Format finding; and
- no files are rewritten.

The offer must be non-destructive and must not appear for a normal Markdown
workspace merely because it resembles an OKF bundle.

## Ontology library contract

The library decision is recorded in
[`ADR 0007`](./adr/0007-ontology-library-is-user-owned-and-single-active.md):
the existing root `ontology.yaml` remains a supported default source, while
additional saved sources live in a flat user-owned `ontologies/` directory.
Exactly one source or Generic Markdown may be active. Exo stores only the exact
accepted snapshot and source identity as derived runtime state; it never copies
one selection over another user's YAML file.

## Delivery sequence

### Phase 0 — product and compatibility design

Define the library storage/migration contract; Format-detection contract; exact
review language; and the narrow preloaded Ontology design Skill packet. Update
the public glossary and architecture docs only after those decisions are fixed.

### Phase 1 — safe core library

Extend the Ontology store and graph worker to enumerate saved sources, select
one Active source or Generic, preserve Candidate/Active guards, and compile
each source in isolation. Add deterministic tests for switch, restart, stale
external edit, missing source, invalid source, and authored-fact invariance.

### Phase 2 — graph and Settings control

Add a compact current-Ontology control and Draft/current/Generic preview to
Settings and Graph. Use existing graph projection/scene contracts; do not add a
second graph model, simulation, or renderer path. Verify selection does not
enter editor/navigation critical paths.

### Phase 3 — read-only discovery Invocation

Build the host-staged discovery runner around configured Commands and the
existing review model. It must use a frozen snapshot, schema validation,
workspace revision recheck, full trace/provenance, and no Note write authority.
Add explicit abstention and failure behavior.

### Phase 4 — onboarding and real-work early access

Expose the skippable onboarding step after Command setup. Run the cleaned
five-Claude/five-Codex trace study first, then dogfood the flow on real
Workspaces. The owner reviews qualitative graph shape and trace evidence;
there is no automated correctness threshold in this phase.

## Verification

Required mechanical contracts:

- no selected Ontology leaves the base Markdown graph usable;
- switching Ontologies does not change authored Note/Link/Tag facts;
- every interpreted Relation retains property and Ontology-rule Evidence;
- one active selection survives restart and handles missing/invalid files
  fail-closed;
- candidate edits are inert until explicit Keep;
- Format selection cannot silently rewrite or reclassify a normal Markdown root;
- discovery runs leave the frozen source manifest unchanged;
- malformed or stale model output stages nothing;
- graph compilation, layout, and UI changes stay outside typing/open/search
  latency paths; and
- each new UI state receives focused Electron coverage and real-app QA.

Required human review:

- read proposal labels, predicates, and rules for intelligibility;
- inspect graph shape and local neighborhoods under Generic, current, and Draft;
- confirm model suggestions do not turn folders, embedding similarity, or
  repeated prose into false facts; and
- approve only the Ontology, not any proposed downstream Note migration.

## Explicitly out of scope

- automatic Ontology activation or optimization;
- automatic Generic Markdown → OKF conversion;
- simultaneous active Ontologies or rule composition;
- a visual Ontology editor or executable Ontology rules;
- model-authored Note migration in the discovery flow;
- a universal graph-quality score; and
- an external AI knowledge-graph benchmark or corpus.

-- Exo | 2026-07-22
