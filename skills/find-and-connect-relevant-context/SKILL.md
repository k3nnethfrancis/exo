---
name: find-and-connect-relevant-context
description: Find a small number of useful, evidence-backed connections for one selected note using Exograph's active graph and ontology.
---

# Find and connect relevant context

Start from the selected note. Inspect its authored links, backlinks, tags,
properties, ontology relations, graph neighbors, and relevant search results.

Propose at most three connections that materially improve retrieval or
traversal. Prefer an ordinary Markdown link or tag. Use an ontology reference
property only when the active ontology defines that property and the target
matches its constraints.

Edit the relevant Markdown notes directly. Preserve unrelated text, unknown
frontmatter, and existing formatting. Do not edit this Skill, `ontology.yaml`,
or anything in `ontologies/`. Do not invent a relationship from semantic
similarity alone; use similarity only to find evidence worth inspecting.

Every connection must be supported by the notes themselves. If no useful
connection is supported, make no change and say so.
