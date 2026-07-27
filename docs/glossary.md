# Stem Glossary

This public glossary defines product meaning, not implementation.

## Language

**Stem**
The open-source knowledge-graph interface and Markdown editor. Stem lets people
work with and manage a user-owned knowledge graph alongside terminal agents.
_Avoid_: lab name, the category name itself

**Exocortex**
The user-owned system formed by Markdown, relationships, evidence, local
retrieval, and reviewable agent work. Stem is its interface; ordinary files
remain the durable substrate.
_Avoid_: proprietary database, app-owned memory, product synonym

**Knowledge Graph**
A user-owned, durable graph of Notes, relationships, evidence, and history that
people and machines can read and maintain in common. Stem derives it from
Markdown files, frontmatter, links, paths, tags, properties, attachments, and
accepted durable knowledge; Stem operates over it but does not own it.
_Avoid_: proprietary database, app-specific knowledge base, model memory

**Workspace**
A named, independently saved and switchable Markdown scope. It owns its writable Note Root, read-only Indexed Roots, index configuration and derived state, configured Commands, and Command trust decisions. A project or repository wiki is a Workspace whose Note Root is that project's Markdown folder; a Workspace never contains other Workspaces. The current release begins with one authoritative Note Root per Workspace.
_Avoid_: vault, project

**Note Root**
A user-authorized folder whose Markdown Notes Stem may create and edit. Each Note Root has one Format.
_Avoid_: arbitrary filesystem root

**Note**
A Markdown document under a Note Root. Its body and frontmatter are canonical user data.

**Concept**
A knowledge identity projected from a resolved Note by its Note Root Format and
optionally interpreted by the Workspace Ontology. Generic Markdown and OKF
normally project one Concept per Note; headings label or structure that Note,
not additional Concepts. The Note remains canonical.
_Avoid_: graph node as source of truth, database entity

**Indexed Root**
A selected retrieval location. It can be searched but does not grant Stem edit authority, Command trust, or a second Explorer filesystem domain.
_Avoid_: record, database row

**Content Policy**
A Workspace-owned rule for which paths beneath the authorized Note Root are Markdown content. Explorer visibility, QMD ingestion, Graph Notes, and Folder Note suggestions must agree with it. It is not an access-control mechanism and it never changes files on its own.
_Avoid_: hidden index setting, automatic repository rewrite

**Artifact Reference**
An evidenced Markdown link to local code or an attachment. It preserves the
relationship without becoming a Note, a QMD document, or a graph node.
_Avoid_: code Note, unresolved Markdown link

**Folder**
A user-owned filesystem directory that gives Notes a primary structural home. Folder containment is meaningful but does not prevent Notes from belonging to other concepts through tags, properties, or relationships.
_Avoid_: category record, exclusive type

**Folder Note**
An optional user-owned `index.md` that gives a Folder a title, description, properties, ontology guidance, and durable relationships. It remains ordinary Markdown and is created only through an explicit Folder Overview action.
_Avoid_: hidden database record, mandatory schema file

**Folder Overview**
The Folder view combines an existing Folder Note, when present, with direct children and local graph context. Viewing never creates an `index.md`; creation is an explicit action.
_Avoid_: folder settings, generated canonical note

**Primary Home**
The Folder-based classification implied by a Note's path. It supplies a default structural context, while tags and relationships express additional memberships.
_Avoid_: exclusive type, enforced taxonomy

**Ontology**
An optional, user-owned interpretation stored at `<Workspace Root>/ontology.yaml`
or as a direct `.yaml` child of `<Workspace Root>/ontologies/`. It passively
interprets Concept Types, Property shapes, reference Relations, and validation
rules across the Workspace. Exactly one reviewed Ontology—or Generic
Markdown—may be active at a time. Ontologies are selected, never merged. They
complement the vocabulary already expressed in folders and Markdown and never
own or mutate that data.
_Avoid_: fixed taxonomy, app-owned schema

**Format**
The interoperability convention used to project base Concepts from a Note Root.
Generic Markdown is the zero-configuration default; permissive OKF 0.1 is an
explicit compatibility format. Format is not the Workspace Ontology, does not
control graph presentation, and does not change source files.
_Avoid_: ontology, plugin, visual profile

**Properties**
Losslessly preserved document facts projected from a Note's raw frontmatter. A
Property identifier and its Property Shape are distinct: `date` identifies the
fact while `string` describes its expected value. `type: project` classifies
the existing Note; it does not create another Concept or Relation. Editing
Properties edits the Markdown source.
_Avoid_: app metadata, inspector fields

**Property Shape**
The optional Workspace Ontology interpretation of a Property's value type, cardinality, allowed values, or reference constraints. It describes a Property without becoming part of its identifier.
_Avoid_: decorated property name, semantic alias

**Relation**
A directed connection between Concepts with a family, optional user-defined predicate, origin, resolution, and Evidence. Origin is `document`, `ontology`, or `inferred`; those states are never interchangeable.
_Avoid_: unexplained edge, visual line as truth

**Origin**
How Stem obtained a Relation: `document` when Markdown states it directly, `ontology` when the active Ontology interprets Markdown data, or `inferred` when a versioned machine process proposes it. Origin explains derivation, not authorship or truth.
_Avoid_: authority, author, confidence class

**Evidence**
The inspectable source of a graph fact: a Markdown span, Property, path, Ontology rule, or versioned model observation.
_Avoid_: opaque confidence score

**Graph View**
A derived projection that maps selected Concepts, Relations, Properties, Ontology meaning, and Derived Signals into layout weights, visual encodings, labels, and interaction. It changes presentation, not knowledge.
_Avoid_: canonical graph, ontology

**Derived Signal**
A versioned machine observation such as semantic similarity, inferred type, or proposed Relation. It may support a suggestion but is not durable knowledge until the user accepts a Markdown change.
_Avoid_: automatic edge, inferred fact

**Connection**
A relationship exposed for the focused Note through Outline, Links, Graph, or earned Invocation History. Connections are derived from user-owned documents and reviewed invocation evidence.
_Avoid_: miscellaneous inspector data

**Baseline Core**
The shipped core is a trustworthy Markdown workspace, modular Search, Folder
Overview, Connections/graph context, mixed panes, configured Commands, explicit
inline invocation, reviewable observed changes, a single-active user-owned
Ontology library, and the first reviewable graph-maintenance Skill. Optional
Ontology discovery is an early-access proposal flow, not a required onboarding
gate. The core does not require plugins, provider-specific harnesses, Feed,
Gym, training, cloud indexing, or durable terminal history.
_Avoid_: minimal demo, vanilla app

**Pane**
One user-arranged view in the Workspace Canvas. A Pane shows a Note, Terminal, Preview, or Graph. Invocation changes are reviewed inline in the affected Note rather than in a separate Diff Pane.
_Avoid_: section, dock

**Workspace Canvas**
The single spatial model in which Panes can be focused, split, moved, and closed.
_Avoid_: terminal workspace, editor grid

**Command**
A provider-neutral, user-configured executable addressed by a handle. A Command declares how it launches and which context pointer it receives; it does not define an agent species.
_Avoid_: Harness, provider, agent type

**Skill**
User-editable instructions and data in a writable Note Root for a bounded graph/wiki task executed by a configured Command. A Skill declares purpose, scope, expected proposal, and evaluation criteria; it does not load code, grant authority, run in the background, or bypass invocation review.
_Avoid_: Skill Manager, plugin entrypoint, automatic agent action

**Plugin**
A future installable, versioned distribution bundle that may package Skills, ontology templates, Command templates, integrations, or other proven capabilities. Plugin describes packaging and sharing, not an internal module, runtime seam, permission grant, or arbitrary renderer code.
_Avoid_: capability interface, core module, dynamic UI injection

**Invocation**
One explicitly authorized Command run, including its intent, executable-bound trust decision, owned process lifecycle, provider-session provenance, and one exact Changeset with durable review decisions.
_Avoid_: session, trace

**Trust Decision**
Human authorization for a specific executable fingerprint in a specific Workspace.
_Avoid_: global approval, provider trust

**Invocation History**
Reviewed Invocation records relevant to a Note. History is earned by actual use and absent when there is nothing meaningful to show.
_Avoid_: Activity, feed, trace stream

**Derived State**
Rebuildable indexes, graph caches, layout projections, and machine observations. Derived State is not accepted durable knowledge.
_Avoid_: source of truth
