# Knowledge graph

Exograph derives a live graph from ordinary Markdown. The graph helps navigation and retrieval; it does not replace your files as the source of truth.

## What becomes a graph object

In the default **Generic Markdown** format:

- each included Markdown file becomes one **Concept**;
- its first H1 may label that Concept, but headings do not create Concepts;
- wikilinks and Markdown links create document relations when they resolve;
- tags create shared tag Concepts in the semantic graph;
- frontmatter remains properties of the existing Concept.

`type: project` therefore classifies one Note. It does not create a `project` node or an edge by itself. A local link to code or an attachment is preserved as an **artifact reference**: it is evidence of a relationship, but not a Note, search document, or topology node.

## Why a relation exists

Every graph relation has an **origin** and evidence:

| Origin | Meaning |
| --- | --- |
| `document` | The relationship appears directly in Markdown. |
| `ontology` | The active ontology interpreted an existing property by a named rule. |
| `inferred` | A versioned derived process observed a possible relationship. It is not durable knowledge until a person accepts a Markdown change. |

Evidence can point to a Markdown span, a property, a path, an ontology rule, or a versioned model observation. This answers “why is this line here?” without pretending to prove authorship or truth.

## Views are not the graph

Connections and the Graph pane are derived presentations. They may group tags, suppress hubs, color types, lay out topology, or fetch detail only for the focused Concept. None of that changes a Note or creates knowledge on its own.

The hot rendering path uses compact numeric topology. Labels, paths, properties, findings, and relation evidence are cold, bounded reads. This is why large graph interaction can stay responsive without weakening the semantic model.

## Add more meaning deliberately

An optional workspace `ontology.yaml` can declare property shapes, path-default types, reference-valued relations, and validation rules. Exograph previews its exact effects and requires Keep before activating it. One ontology is active at a time; switching never rewrites Notes. Read [Workspace ontology](workspace-ontology.md).

For the base reading rules and OKF compatibility, read [Note Root Formats](note-root-formats.md).
