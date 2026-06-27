# Exo Plugins

This directory contains Exo's official plugin manifests.

Plugin Authoring v0 is metadata-only. Exo can discover and validate `exo.plugin.json`
files, show their declared capabilities, and use selected metadata contracts such as
profiles and routine templates. Exo does not execute plugin code, load renderer
bundles, grant permissions, add MCP tools, add CLI commands, or mount desktop UI from
these manifests yet.

## Official, Local, And Dev Plugins

- Official plugins live in this repository under `plugins/` or in packaged app
  resources. They are reviewed before shipping on `main`.
- Local plugins use the same manifest shape in user or workspace plugin directories.
  They are user-owned and untrusted by default. Plugin Enablement v0 stores
  trust/enablement state locally and exposes it through the desktop Plugin Manager.
- Dev plugins are loaded through explicit operator paths such as `EXO_PLUGIN_DIRS`.
  That path is for local development and should not be treated as a user install
  mechanism.

Official plugins should still look like plugins. If a capability is optional,
replaceable, workflow-specific, or profile-specific, prefer a manifest capability over
hardcoding it into core.

## Current Official Examples

- `exograph-baseline/exo.plugin.json` declares a metadata-only profile capability.
- `graph-health/exo.plugin.json` declares a metadata-only routine template capability.

Templates for new metadata-only plugins live in:

- `_template-profile/exo.plugin.template.json`
- `_template-routine-template/exo.plugin.template.json`

The template files are intentionally not named `exo.plugin.json`, because Exo currently
discovers any direct child directory containing that exact filename as a real plugin.
Copy a template into a real plugin directory and rename it to `exo.plugin.json` only
when you intend Exo to discover it.

## Manifest Shape

A v0 manifest has this top-level shape:

```json
{
  "id": "example.plugin",
  "name": "Example Plugin",
  "version": "0.1.0",
  "exoApiVersion": "0.1",
  "description": "Metadata-only plugin description.",
  "capabilities": [],
  "permissions": [],
  "surfaces": []
}
```

Supported capability kinds are:

- `searchProvider`
- `agentHarness`
- `profile`
- `analyzer`
- `traceCollector`
- `datasetExporter`
- `evalRunner`
- `routineTemplate`
- `graphVisualization`

Supported lifecycle states are `built-in`, `experimental`, and `disabled`.

Supported surfaces are `desktop`, `cli`, `mcp`, `commandServer`, and `internal`.
Surface declarations are descriptive in v0. They do not authorize execution or expose
commands/tools by themselves.

Supported permissions are:

- `workspace:read`
- `notes:read`
- `notes:write`
- `projects:read`
- `projects:write`
- `terminals:launch`
- `agents:launch`
- `network:access`
- `artifacts:write`

Permission declarations are also metadata in v0. Future trust and permission flows must
grant real access explicitly.

## Authoring Rules

- Keep v0 plugins metadata-only.
- Do not add `entrypoints` unless you are documenting future intent; Exo will not
  execute them in v0.
- Do not commit private paths, local machine assumptions, or user-specific defaults.
- Keep profile payloads advisory. They may describe schemas, templates, recommended
  plugins, skills, routine template ids, graph views, and review/output policies, but
  they must not imply automatic file writes or installs.
- Keep routine templates reusable. They define prompts, harness preferences,
  permissions, and output policy; they do not run until instantiated with explicit
  workspace scope.
- Do not declare MCP, CLI, command-server, or desktop surfaces as executable
  contributions. Public surface contribution APIs do not exist yet.

## Manifest Smoke Check

After creating a manifest, run the core plugin tests or at least parse the JSON.
There is intentionally no public `exo plugins` CLI in v0; plugin authoring stays
repo-internal and plugin enablement is managed through the desktop Plugin Manager.

```bash
pnpm --filter @exo/core test -- plugin
node -e 'JSON.parse(require("node:fs").readFileSync("plugins/my-plugin/exo.plugin.json", "utf8"))'
```

Use the full core gate when changing plugin contracts or validation behavior:

```bash
pnpm --filter @exo/core test
pnpm check:repo
```
