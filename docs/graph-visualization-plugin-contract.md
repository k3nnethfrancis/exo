# Graph Visualization Plugin Contract

Last updated: 2026-07-05

status: unstable. This contract is pre-public and carries no compatibility promise until the plugin manifest can declare a minimum supported contract version and the contract has two real consumers.

This document defines the first concrete boundary between Exo core graph data and future graph visualization plugins.

## Boundary

Core owns graph data extraction and host surfaces. A graph visualization plugin owns rendering, layout, interaction, and any plugin-specific settings.

This contract is metadata-only today. Exo can discover graph visualization capabilities, show them in plugin/surface inventory, and provide typed descriptors for future host wiring. Exo does not yet load renderer plugin code, mount a default graph explorer, or execute plugin entrypoints.

## Core Graph Snapshot

The current data unit is `GraphSnapshot` from `packages/core/src/graph.ts`.

Required snapshot properties:

- `version`: currently `0.1`.
- `snapshotId`: deterministic content id for scope, schema, nodes, edges, and warnings. It excludes `generatedAt`.
- `generatedAt`: ISO timestamp for when Exo built the snapshot.
- `schema`: declares supported node/edge kinds and graph invariants.
- `scope`: workspace/note/project roots and paths included in the snapshot.
- `nodes`: sorted graph nodes.
- `edges`: sorted outgoing graph edges.
- `warnings`: sorted extraction warnings.

Graph facts are canonicalized as outgoing edges. Backlinks are derived with `deriveGraphBacklinks(snapshot)` and must not be stored as independent graph facts by visualization plugins.

Current node kinds:

- `note`
- `tag`
- `external`
- `unresolved`

Current edge kinds:

- `wikilink`
- `markdownLink`
- `hasTag`

## Graph Visualization Capability

A plugin declares a graph visualization through an `exo.graph:visualization` capability. Manifests should put the payload under `capability.compatibility.graphVisualization`.

Example:

```json
{
  "id": "example-3d-graph.view",
  "kind": "exo.graph:visualization",
  "label": "Example 3D Graph",
  "description": "Renders Exo graph snapshots as a 3D relationship map.",
  "lifecycle": "experimental",
  "owner": "example-3d-graph.plugin",
  "surfaces": ["desktop"],
  "permissions": ["workspace:read", "notes:read"],
  "compatibility": {
    "graphVisualization": {
      "graphDataVersion": "0.1",
      "acceptedNodeKinds": ["note", "tag", "external", "unresolved"],
      "acceptedEdgeKinds": ["wikilink", "markdownLink", "hasTag"],
      "hostSurface": "editorPane",
      "renderMode": "3d",
      "preferredPlacement": "editorGrid"
    }
  }
}
```

Supported graph visualization fields:

- `graphDataVersion`: currently `0.1`.
- `acceptedNodeKinds`: optional allow-list; defaults to all current node kinds.
- `acceptedEdgeKinds`: optional allow-list; defaults to all current edge kinds.
- `hostSurface`: `editorPane` or `webPreview`.
- `renderMode`: `2d`, `3d`, or `custom`.
- `preferredPlacement`: `toolDock`, `editorGrid`, or `webPreview`.

Flat graph visualization compatibility payloads are still accepted during migration, but new manifests should use `compatibility.graphVisualization`.

## Surface Metadata

Tool surface descriptors for graph visualizations include:

- `action.type = "graphVisualization.open"`
- `action.graphVisualizationId`
- `graphVisualization.data`
- `graphVisualization.surface`
- `webViewer` endpoint metadata when `hostSurface` is `webPreview`

This descriptor metadata is placement and compatibility information only. It is not runtime authorization, plugin loading, or permission grant.

Graph visualizations that choose `hostSurface: "webPreview"` must use the core web viewer contract in `docs/plugin-surface-contract.md`. They do not own the WebView, preload bridge, pane mutation, or preview target validation.

## Non-Goals

- No full graph explorer UI in this slice.
- No renderer plugin loading.
- No plugin-owned graph extraction.
- No plugin-owned web view host.
- No MCP/CLI graph visualization command registration from manifest metadata alone.

-- Exo | 2026-07-05
