---
status: accepted
---

# Keep the Workspace Ontology user-owned, reviewed, and passive

Exograph reads one candidate from `<Workspace Root>/ontology.yaml`. Merely changing
that file never changes the active graph. Candidate validation is atomic; Keep
must compare the exact reviewed revision before persisting accepted source as
derived state under `.exograph/ontology`. Keeping a reviewed source publishes that
transition and invalidates derived graph state atomically. Reject
leaves both Markdown and the previously kept
interpreter unchanged. A missing or invalid kept state falls back to the base
graph without additional Ontology interpretation.

The Ontology may interpret open Concept Types, Property shapes,
reference-valued Relations, and validation rules. It preserves unknown data,
never mutates Notes, and cannot contain execution, inference, or presentation.
Formats, Ontologies, and Graph Views remain separate contracts. Public
Knowledge Graph Relations use `origin: document | ontology | inferred`, and
ontology-origin Relations cite Property plus exact Ontology-rule Evidence.
