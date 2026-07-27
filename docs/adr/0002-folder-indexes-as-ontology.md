---
status: accepted
---

# Folder Notes Provide The First Ontology Substrate

Stem uses user-owned Folder structure plus optional `index.md` Folder Notes as
the first custom-ontology substrate instead of introducing an app-owned
schema/profile database. A Folder gives Notes a primary structural home; its
Folder Note may describe the collection, declare suggested properties and
relationships, and guide graph-maintenance Skills. Folder Overview derives
containment and context from that Markdown while tags and typed relationships
preserve multiple membership.

Folder Overview and explicit Folder Note creation are implemented. Existing
folders remain untouched by viewing and `index.md` creation remains a
folder-scoped authoring action. Bulk creation is deliberately not a workspace
action. ADRs 0006 and 0007 extend this decision with an optional, reviewed,
user-owned Workspace Ontology while retaining the prohibition on an app-owned
ontology database.
