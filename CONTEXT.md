# Exo Domain Context

Exo's shared north star with Guardian and Ash is `../../notes/shoshin-codex/ashby.md`.

This file is the canonical Exo glossary. It defines product meaning, not implementation.

## Language

**Exo**
The local application for building and using a user-owned Markdown exocortex. Exo helps a person capture, connect, find, invoke, and review work without owning the person's durable knowledge.
_Avoid_: agent cockpit, harness manager, Exograph as the app name

**Ashby**
The shared vision joining Exo's exocortex, Guardian's principled execution, and Ash's evaluated artificial-colleague role while keeping their implementations separate.
_Avoid_: monorepo, umbrella runtime

**Exograph**
The user-owned graph formed by Markdown files, frontmatter, links, paths, tags, properties, attachments, and accepted durable knowledge. Exo operates over an exograph; it does not own it.
_Avoid_: proprietary database, second brain

**Workspace**
A named Markdown scope: it owns its writable Note Roots, read-only Indexed Roots, index configuration and derived state, configured Commands, and Command trust decisions. A project wiki is a Workspace whose Note Root is that project's wiki/docs folder; a Workspace never contains other Workspaces.
_Avoid_: vault, project

**Note Root**
A user-authorized folder whose Markdown Notes Exo may create and edit.
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
A selected retrieval location. It can be searched but does not grant Exo edit authority, Command trust, or a second Explorer filesystem domain.
_Avoid_: record, database row

**Folder**
A user-owned filesystem directory that gives Notes a primary structural home. Folder containment is meaningful but does not prevent Notes from belonging to other concepts through tags, properties, or relationships.
_Avoid_: category record, exclusive type

**Folder Index**
An optional user-owned `index.md` that gives a Folder a title, description, properties, ontology guidance, and durable relationships. It remains ordinary Markdown and is created only through an explicit Folder Overview action.
_Avoid_: hidden database record, mandatory schema file

**Folder Overview**
The Folder view combines an existing Folder Index, when present, with direct children and local graph context. Viewing never creates an `index.md`; creation is an explicit action.
_Avoid_: folder settings, generated canonical note

**Primary Home**
The Folder-based classification implied by a Note's path. It supplies a default structural context, while tags and relationships express additional memberships.
_Avoid_: exclusive type, enforced taxonomy

**Ontology**
An optional, user-owned `<Workspace Root>/ontology.yaml` that passively
interprets Concept Types, Property shapes, reference Relations, and validation
rules across the Workspace. One reviewed Ontology may be active at a time. It
complements the vocabulary already expressed in folders and Markdown; it never
owns or mutates that data.
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

**Evidence**
The inspectable source of a graph fact: a Markdown span, Property, path, Ontology rule, or versioned model observation.
_Avoid_: opaque confidence score

**Graph View**
A derived projection that maps selected Concepts, Relations, Properties, and Derived Signals into layout weights, visual encodings, labels, and interaction. It changes presentation, not knowledge.
_Avoid_: canonical graph, ontology

**Derived Signal**
A versioned machine observation such as semantic similarity, inferred type, or proposed Relation. It may support a suggestion but is not durable knowledge until the user accepts a Markdown change.
_Avoid_: automatic edge, inferred fact

**Connection**
A relationship exposed for the focused Note through Outline, Links, Graph, or earned Activity. Connections are derived from user-owned documents and reviewed invocation evidence.
_Avoid_: miscellaneous inspector data

**Relevant Context**
Search results and graph neighbors selected for the focused Note with an inspectable reason such as semantic relevance, an explicit link, a shared tag/property, or a reviewed typed relationship. Similarity may remain Derived State; it is not automatically a durable edge.
_Avoid_: unexplained recommendations, automatic graph facts

**Baseline Core**
The shipped core is a trustworthy Markdown workspace, modular Search, Folder Overview, Connections/graph context, mixed panes, configured Commands, explicit inline invocation, and reviewable observed changes. The first graph-management Skill is the next vertical slice. It does not require plugins, provider-specific harnesses, Feed, Gym, training, cloud indexing, or durable terminal history.
_Avoid_: minimal demo, vanilla app

**Pane**
One user-arranged view in the Workspace Canvas. A Pane shows a Note, Terminal, Preview, Graph, or Diff.
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

**Activity**
Reviewed Invocation history relevant to a Note. Activity is earned by actual use and absent when there is nothing meaningful to show.
_Avoid_: feed, trace stream

**Derived State**
Rebuildable indexes, graph caches, layout projections, and machine observations. Derived State is not accepted durable knowledge.
_Avoid_: source of truth

**Guardian**
The separate Pi-compatible harness used to develop principled execution. Exo may invoke Guardian through a normal Command but does not interpret Guardian's Principal or internal agent loop.
_Avoid_: built-in Exo harness

**Ash**
The first evaluated artificial-colleague role in the Ashby vision. Ash is a behavior contract, not an Exo Pane, provider, or runtime.
_Avoid_: generic assistant, Exo agent type
