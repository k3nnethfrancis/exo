---
status: accepted
---

# Keep the Workspace Ontology user-owned, reviewed, and passive

Exo reads one candidate from `<Workspace Root>/ontology.yaml`. Merely changing
that file never changes the active graph. Candidate validation is atomic; Keep
must compare the exact reviewed revision before persisting accepted source as
derived state under `.exo/ontology`. The following service/UI slice will publish
that accepted transition and invalidate derived graph state atomically. Reject
leaves both Markdown and the previously kept
interpreter unchanged. A missing or invalid kept state falls back to Generic
Markdown.

The Ontology may interpret open Concept Types, Property shapes,
reference-valued Relations, and validation rules. It preserves unknown data,
never mutates Notes, and cannot contain execution, inference, or presentation.
Formats, Ontologies, and Graph Views remain separate contracts. Public
Knowledge Graph 0.3 Relations use `origin: document | ontology | inferred`, and
ontology-origin Relations cite Property plus exact Ontology-rule Evidence.
