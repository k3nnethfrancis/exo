---
status: accepted
---

# Folder Indexes Provide The First Ontology Substrate

Exo will use user-owned Folder structure plus optional `index.md` Folder Indexes as the first custom-ontology substrate instead of introducing an app-owned schema/profile database. A Folder gives Notes a primary structural home; its index may describe the collection, declare suggested properties and relationships, and guide graph-management Skills. The planned Folder Overview derives containment and context from that Markdown while tags and typed relationships preserve multiple membership.

At acceptance this was a next-slice decision rather than shipped behavior.
Folder Overview and explicit index creation subsequently shipped; existing
folders remain untouched by viewing and `index.md` creation remains an explicit
authoring action. ADR 0005 extends this decision with optional user-owned
Knowledge Profiles while retaining the prohibition on an app-owned ontology
database.
