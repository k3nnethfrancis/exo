# Plugin Surface Contract

Last updated: 2026-06-28

This document defines the safe renderer surface and web viewer extension points for plugin-produced local apps and artifacts.

## Boundary

Core owns pane layout, renderer hosts, the browser/web viewer implementation, command-server routes, target validation, focus, and close behavior.

Plugins may request surfaces through metadata and core APIs. A plugin does not own an Electron `WebView`, preload bridge, renderer entrypoint, pane mutation path, command-server route, or permission grant by declaring a manifest.

The current contract is metadata-only for native renderer panels. Web viewer requests use the already implemented core preview endpoints.

## Core Web Viewer

The core web viewer is the supported path for plugin-produced local apps, dashboards, reports, and HTML artifacts.

Endpoint routes:

- `POST /preview/open` with `{ "target": "<url-or-html-path>" }`
- `POST /preview/focus` with `{}`
- `POST /preview/close` with `{}`

Shared route constants live in `packages/core/src/command-protocol.ts` as:

- `EXO_COMMAND_ROUTES.openPreview`
- `EXO_COMMAND_ROUTES.focusPreview`
- `EXO_COMMAND_ROUTES.closePreview`

CLI usage:

```bash
exo preview open <url-or-html-path>
exo preview focus
exo preview close
```

Allowed target classes for plugin intent metadata:

- `localFile`: local `.html` or `.htm` files accepted by core preview validation.
- `localhostUrl`: a plugin-managed local service URL.
- `artifact`: an Exo artifact reference that resolves to a core-approved local preview target.
- `trustedUrl`: remote or trusted URLs accepted by core preview validation.

Core validation remains authoritative. Today, desktop preview resolution accepts `http`, `https`, and `file` URLs, and local file paths must resolve inside the workspace, attached note roots, or attached project roots and point to existing `.html` or `.htm` files.

Surface descriptors can carry `webViewer` metadata with:

- contract version `0.1`
- allowed target kinds
- validation owner `core`
- open/focus/close endpoint routes

This metadata tells future renderer wiring how to call the core host. It is not a permission grant and does not bypass preview target validation.

## Native Plugin Panels

Native plugin panels are a future Exo-rendered panel extension point. The safe v0 descriptor is:

- `kind: "pluginPanel"`
- `action.type: "pluginPanel.open"`
- `pluginPanel.contractVersion: "0.1"`
- `pluginPanel.hostKind: "coreRendererPanel"`
- `pluginPanel.rendererEntrypointLoading: "disabled"`

The descriptor is intentionally inert. It can describe a reviewed, core-hosted panel slot, but it cannot load plugin renderer code. A future implementation must add explicit policy, permission grants, sandboxing or component registration rules, renderer tests, and Plugin Manager review before local plugin manifests can expose native panels.

Until then, plugin-produced rich UI should use the core web viewer path.

## Graph Visualizations

Graph visualization capabilities can request `hostSurface: "webPreview"` in `capability.compatibility.graphVisualization`. Surface descriptors for those capabilities include web viewer endpoint metadata so future graph plugins can render through a core-hosted preview pane rather than owning the browser host.

Graph data remains core-owned. The graph visualization contract is defined in `docs/graph-visualization-plugin-contract.md`.

## Non-Goals

- No renderer plugin code loading.
- No plugin-owned `WebView`.
- No manifest-granted command-server routes.
- No MCP or CLI tool registration from surface metadata alone.
- No direct pane mutation from plugin code.
- No bypass around workspace/note/project-root preview validation.

-- Exo | 2026-06-28
