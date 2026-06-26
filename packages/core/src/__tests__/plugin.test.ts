import path from "node:path";
import os from "node:os";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  defaultPluginTrust,
  discoverPluginManifests,
  EXO_PLUGIN_MANIFEST_FILE,
  parsePluginManifest,
  PluginRegistry,
  validatePluginManifest,
  type DiscoveredPlugin,
  type PluginManifest,
} from "../plugin";

const manifest: PluginManifest = {
  id: "example.plugin",
  name: "Example Plugin",
  version: "0.1.0",
  exoApiVersion: "0.1",
  description: "Example plugin.",
  entrypoints: {
    main: "dist/main.js",
  },
  capabilities: [
    {
      id: "example.trace",
      kind: "traceCollector",
      label: "Example Trace Collector",
      description: "Collects example traces.",
      lifecycle: "experimental",
      owner: "example.plugin",
      surfaces: ["internal"],
      permissions: ["artifacts:write"],
    },
    {
      id: "example.routine",
      kind: "routineTemplate",
      label: "Example Routine",
      description: "Ships an example routine template.",
      lifecycle: "experimental",
      owner: "example.plugin",
      surfaces: ["desktop", "cli"],
      permissions: ["workspace:read"],
    },
    {
      id: "example.profile",
      kind: "profile",
      label: "Example Profile",
      description: "Ships an example profile bundle.",
      lifecycle: "experimental",
      owner: "example.plugin",
      surfaces: ["desktop"],
      permissions: ["workspace:read", "notes:read"],
      compatibility: {
        profile: {
          recommendedPlugins: [{ id: "example.routine", required: false }],
        },
      },
    },
    {
      id: "example.graph-view",
      kind: "graphVisualization",
      label: "Example Graph View",
      description: "Renders graph snapshots.",
      lifecycle: "experimental",
      owner: "example.plugin",
      surfaces: ["desktop"],
      permissions: ["workspace:read", "notes:read"],
      compatibility: {
        graphDataVersion: "0.1",
        hostSurface: "editorPane",
      },
    },
  ],
  permissions: ["workspace:read", "artifacts:write"],
  surfaces: ["desktop", "cli", "internal"],
};

describe("plugin manifest contracts", () => {
  it("parses and validates plugin manifests", () => {
    expect(parsePluginManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("rejects malformed manifests", () => {
    expect(() => validatePluginManifest({ ...manifest, id: "Bad Plugin" })).toThrow("Plugin id must be lowercase");
    expect(() => validatePluginManifest({ ...manifest, capabilities: [] })).toThrow("must declare at least one capability");
    expect(() =>
      validatePluginManifest({
        ...manifest,
        capabilities: [manifest.capabilities[0], manifest.capabilities[0]],
      }),
    ).toThrow("declares duplicate capability");
    expect(() =>
      validatePluginManifest({
        ...manifest,
        capabilities: [{ ...manifest.capabilities[0]!, kind: "unknownKind" }],
      }),
    ).toThrow("capability.kind contains unsupported value");
    expect(() => validatePluginManifest({ ...manifest, surfaces: ["desktop", "unknown"] })).toThrow(
      "surfaces contains unsupported value",
    );
    expect(() => validatePluginManifest({ ...manifest, permissions: ["workspace:read", "filesystem:all"] })).toThrow(
      "permissions contains unsupported value",
    );
  });

  it("discovers manifests from plugin directories without loading code", async () => {
    const root = await mkdirTempPluginRoot();
    try {
      const pluginRoot = path.join(root, "example");
      await mkdir(pluginRoot);
      await writeFile(path.join(pluginRoot, EXO_PLUGIN_MANIFEST_FILE), JSON.stringify(manifest, null, 2), "utf8");

      const [discovered] = await discoverPluginManifests([root], { source: "workspace" });

      expect(discovered).toMatchObject({
        manifest,
        manifestPath: path.join(pluginRoot, EXO_PLUGIN_MANIFEST_FILE),
        rootDirectory: pluginRoot,
        source: "workspace",
        trust: "untrusted",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uses conservative trust defaults by source", () => {
    expect(defaultPluginTrust("built-in")).toBe("trusted");
    expect(defaultPluginTrust("dev")).toBe("trusted");
    expect(defaultPluginTrust("user")).toBe("untrusted");
    expect(defaultPluginTrust("workspace")).toBe("untrusted");
  });

  it("registers plugins and exposes capabilities", () => {
    const registry = new PluginRegistry([discovered(manifest, "trusted")]);

    expect(registry.require("example.plugin").manifest).toBe(manifest);
    expect(registry.listCapabilities().map((capability) => capability.id)).toEqual([
      "example.trace",
      "example.routine",
      "example.profile",
      "example.graph-view",
    ]);
    expect(registry.list({ trustedOnly: true }).map((plugin) => plugin.manifest.id)).toEqual(["example.plugin"]);
  });

  it("filters disabled and untrusted plugins", () => {
    const registry = new PluginRegistry([discovered(manifest, "untrusted"), discovered({ ...manifest, id: "disabled.plugin" }, "disabled")]);

    expect(registry.list().map((plugin) => plugin.manifest.id)).toEqual(["example.plugin"]);
    expect(registry.list({ trustedOnly: true })).toEqual([]);
    expect(registry.list({ includeDisabled: true }).map((plugin) => plugin.manifest.id)).toEqual(["example.plugin", "disabled.plugin"]);
  });

  it("rejects duplicate plugin and capability ids", () => {
    expect(() => new PluginRegistry([discovered(manifest, "trusted"), discovered(manifest, "trusted")])).toThrow("Plugin already registered");
    expect(
      () =>
        new PluginRegistry([
          discovered(manifest, "trusted"),
          discovered({
            ...manifest,
            id: "other.plugin",
            capabilities: [{ ...manifest.capabilities[0]!, id: "example.trace" }],
          }),
        ]),
    ).toThrow("Plugin capability already registered");
  });
});

function discovered(manifest: PluginManifest, trust: DiscoveredPlugin["trust"] = "trusted"): DiscoveredPlugin {
  return {
    manifest,
    manifestPath: `/plugins/${manifest.id}/${EXO_PLUGIN_MANIFEST_FILE}`,
    rootDirectory: `/plugins/${manifest.id}`,
    source: "dev",
    trust,
  };
}

async function mkdirTempPluginRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `exo-plugin-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  return root;
}
