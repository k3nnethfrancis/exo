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
A named collection of Note Roots and Attached Folders used together in Exo.
_Avoid_: vault, project

**Note Root**
A user-authorized folder whose Markdown Notes Exo may create and edit.
_Avoid_: arbitrary filesystem root

**Attached Folder**
A user-authorized folder available as read-only context, search input, Command working location, and review target.
_Avoid_: Project Root, editable note root

**Note**
A Markdown document under a Note Root. Its body and frontmatter are canonical user data.
_Avoid_: record, database row

**Properties**
Typed document facts projected from a Note's raw frontmatter. Editing Properties edits the Markdown source.
_Avoid_: app metadata, inspector fields

**Connection**
A relationship exposed for the focused Note through Outline, Links, Graph, or earned Activity. Connections are derived from user-owned documents and reviewed invocation evidence.
_Avoid_: miscellaneous inspector data

**Baseline Core**
The smallest complete Exo experience: workspace setup, Markdown authoring, Explorer/Search, Connections, mixed panes, configured Commands, explicit invocation, and change review. It does not require plugins, MCP, provider-specific harnesses, or durable transcripts.
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

**Invocation**
One explicitly authorized Command run, including its intent, trust decision, lifecycle, observed file changes, attribution confidence, and review references.
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
