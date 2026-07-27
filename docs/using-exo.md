# Using Exo

Exo works over a folder of Markdown you control. It does not import that folder into a proprietary database: your files remain usable in any editor.

## Set up a workspace

On first launch, choose one **main wiki**: the Markdown folder Exo will show in the Explorer, edit, search, and graph. A workspace saves that choice together with its search, appearance, terminal, and agent-command settings. You can create and switch between independent workspaces later.

When the folder resembles a code repository, Exo asks what should become a Note:

- **Markdown notes** is the safe repository default. It keeps documentation in scope while excluding generated and code-oriented paths.
- **All Markdown** makes every Markdown file under the selected folder a Note.

This is a content decision, not an access-control change. You can change it in **Settings → Workspace**. Local code or attachment links in an in-scope Note remain visible as artifact references; they do not become searchable Notes or graph nodes.

## Notes, folders, links, and properties

Every included Markdown file is a Note. Its filename/path gives it a primary home; its first H1 can supply a title. A heading does not create a separate graph node.

- Use `[[A note]]` to link to another Note. Select a suggestion to create a normal Markdown wikilink.
- Use `#tags` in body text or frontmatter to classify a Note. Tags are clickable and open their related Notes.
- Add frontmatter through the property control. `title`, `date`, and `tags` are useful conventional fields, but Exo preserves arbitrary properties.
- Type `/today` or `/tomorrow`, then press Enter, to create an ordinary date wikilink. Opening it creates or opens that daily Note through the usual link path.

Double-click a folder to open its Overview. An `index.md` can describe that folder, but viewing never creates one. Create it only when you want durable folder metadata or guidance; Exo hides it as a duplicate Explorer row, not from the filesystem.

## Search

The centered search field is immediate filename/path search. If you choose the QMD search engine and enable **Use QMD when I press Enter in Explore**, Enter runs local indexed search instead. QMD can use lexical, semantic, or hybrid retrieval; simple search remains available when indexing is off or recovering.

Read [Search](search.md) before changing index settings or interpreting embedding status.

## Connections and graph

Open **Connections** for the active Note to inspect its outline, links, local graph neighborhood, and earned invocation history. Open the Graph pane to explore the workspace-level graph: pan, zoom, select a node, and double-click a Note node to open it.

The graph is evidence-aware. It distinguishes a relation written in Markdown, one interpreted by an active ontology, and a machine-derived signal. It does not silently turn semantic similarity into a durable fact. Read [Knowledge graph](knowledge-graph.md) for the model and [Workspace ontology](workspace-ontology.md) for optional property interpretation.

## Panes and shortcuts

The Explorer is on the left. The utility rail can show terminals, previews, or Connections; each utility kind keeps its own tabs. Drag a Note, terminal, or preview into the editor canvas when you want a split view.

| Action | macOS | Other platforms |
| --- | --- | --- |
| Toggle Explorer | `⌘ B` | `Ctrl B` |
| Toggle utility rail | `⌘ ⌥ B` | `Ctrl Alt B` |
| New daily Note | `⌘ N` | `Ctrl N` |
| New terminal | `⌘ T` | `Ctrl T` |
| Save active Note | `⌘ S` | `Ctrl S` |
| Send inline agent request | `⌘ Return` | `Ctrl Enter` |
| Zoom focused surface | `⌘ +`, `⌘ -`, `⌘ 0` | `Ctrl +`, `Ctrl -`, `Ctrl 0` |

The lower workspace menu also has the current keyboard and CLI reference.

## Ask an agent

Configure local CLI commands in onboarding or **Settings → Agents**. Claude and
Codex begin as editable recommended templates; you can disable either, replace
its executable and arguments, or add one provider-neutral Custom command with
its own `@` handle. Removing a configuration requires confirmation and does not
remove that command's existing Invocation History.

In a Note, type `@`, select an enabled command, write the request inline, then
press `⌘ Return` / `Ctrl Enter`. Exo asks for authorization when needed, runs
the command headlessly, and shows changed files as a reviewable Changeset.

The command is a native process with the permissions available to your local user account. Exo's review is authoritative only inside the workspace's Note Root. Saving or editing a Note never invokes a command automatically.

Read [Agent invocations](document-agent-protocol.md) for response envelopes,
review behavior, failed runs, and session resume.
