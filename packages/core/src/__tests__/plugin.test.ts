import path from "node:path";
import os from "node:os";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

import {
  defaultPluginTrust,
  discoverPluginManifests,
  EXO_PLUGIN_MANIFEST_FILE,
  parsePluginManifest,
  PluginRegistry,
  resolvePluginLifecycle,
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
      kind: "exo.training:traceCollector",
      label: "Example Trace Collector",
      description: "Collects example traces.",
      lifecycle: "experimental",
      owner: "example.plugin",
      surfaces: ["internal"],
      permissions: ["artifacts:write"],
    },
    {
      id: "example.search",
      kind: "core:searchProvider",
      label: "Example Search",
      description: "Ships an example search provider.",
      lifecycle: "experimental",
      owner: "example.plugin",
      surfaces: ["desktop", "cli"],
      permissions: ["workspace:read"],
    },
    {
      id: "example.graph-view",
      kind: "exo.graph:visualization",
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

const futureKindManifest = {
  ...manifest,
  id: "future-kind.plugin",
  name: "Future Kind Plugin",
  capabilities: [
    {
      ...manifest.capabilities[0]!,
      id: "future-kind.widget",
      kind: "exo.future:widget",
      label: "Future Widget",
      permissions: ["workspace:read", "artifacts:write"],
    },
    {
      ...manifest.capabilities[1]!,
      id: "future-kind.search",
    },
  ],
} satisfies PluginManifest;

describe("plugin manifest contracts", () => {
  it("parses and validates plugin manifests", () => {
    expect(parsePluginManifest(JSON.stringify(manifest))).toEqual(manifest);
  });

  it("requires namespaced capability kinds", () => {
    expect(() => validatePluginManifest({
      ...manifest,
      capabilities: [
        {
          ...manifest.capabilities[1]!,
          kind: "routineTemplate",
        },
      ],
    })).toThrow("capability.kind contains unsupported value: routineTemplate");
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

  it("rejects unsafe entrypoint paths", () => {
    for (const main of ["/tmp/plugin.js", "../plugin.js", "dist/../plugin.js", "dist//plugin.js", "C:\\plugin.js"]) {
      expect(() => validatePluginManifest({ ...manifest, entrypoints: { main } })).toThrow(
        "entrypoints.main must be a relative path without traversal",
      );
    }
  });

  it("validates manifest-declared settings schemas", () => {
    const settingsSchema = {
      version: 1,
      sections: [{ id: "general", label: "General", fields: ["enabled", "mode"] }],
      fields: [
        { id: "enabled", type: "boolean", label: "Enabled", default: true },
        { id: "name", type: "string", label: "Name", default: "Exo" },
        { id: "limit", type: "number", label: "Limit", default: 3 },
        {
          id: "mode",
          type: "select",
          label: "Mode",
          options: [
            { value: "fast", label: "Fast" },
            { value: "careful", label: "Careful" },
          ],
          default: "fast",
        },
      ],
    };

    expect(validatePluginManifest({ ...manifest, settingsSchema })).toMatchObject({ settingsSchema });
  });

  it("rejects malformed settings schemas", () => {
    expect(() => validatePluginManifest({
      ...manifest,
      settingsSchema: { fields: [] },
    })).toThrow("settingsSchema.version must be 1");
    expect(() => validatePluginManifest({
      ...manifest,
      settingsSchema: { version: 1, fields: [{ id: "Bad Field", type: "boolean", label: "Bad" }] },
    })).toThrow("Plugin settings field id must be lowercase");
    expect(() => validatePluginManifest({
      ...manifest,
      settingsSchema: { version: 1, fields: [{ id: "flag", type: "boolean", label: "Flag" }, { id: "flag", type: "string", label: "Flag" }] },
    })).toThrow("declares duplicate field");
    expect(() => validatePluginManifest({
      ...manifest,
      settingsSchema: { version: 1, fields: [{ id: "flag", type: "boolean", label: "Flag", default: "yes" }] },
    })).toThrow("default must match");
    expect(() => validatePluginManifest({
      ...manifest,
      settingsSchema: { version: 1, fields: [{ id: "mode", type: "select", label: "Mode", options: [{ value: "a", label: "A" }], default: "b" }] },
    })).toThrow("default must match one of its select options");
    expect(() => validatePluginManifest({
      ...manifest,
      settingsSchema: { version: 1, sections: [{ id: "general", label: "General", fields: ["missing"] }], fields: [] },
    })).toThrow("references unknown field");
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
        enabled: true,
        manifestHash: expect.any(String),
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("degrades unknown namespaced capability kinds without dropping valid siblings", () => {
    const parsed = validatePluginManifest(futureKindManifest);

    expect(parsed.capabilities.map((capability) => capability.id)).toEqual([
      "future-kind.widget",
      "future-kind.search",
    ]);
    expect(parsed.capabilities[0]).toMatchObject({
      id: "future-kind.widget",
      kind: "exo.future:widget",
      status: "unsupported-kind",
      permissions: [],
      statusNotes: ["Capability kind exo.future:widget is not supported by this Exo version."],
    });
    expect(parsed.capabilities[1]).toMatchObject({
      id: "future-kind.search",
      kind: "core:searchProvider",
      permissions: ["workspace:read"],
    });
  });

  it("parses a future-kind fixture manifest as one unsupported row plus supported siblings", async () => {
    const raw = await readFile(new URL("./fixtures/future-kind-plugin/exo.plugin.json", import.meta.url), "utf8");
    const parsed = parsePluginManifest(raw);

    expect(parsed.capabilities).toHaveLength(2);
    expect(parsed.capabilities[0]).toMatchObject({
      id: "future-kind-fixture.widget",
      kind: "exo.future:widget",
      status: "unsupported-kind",
      permissions: [],
    });
    expect(parsed.capabilities[1]).toMatchObject({
      id: "future-kind-fixture.search",
      kind: "core:searchProvider",
      permissions: ["workspace:read"],
    });
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
      "example.search",
      "example.graph-view",
    ]);
    expect(registry.list({ trustedOnly: true }).map((plugin) => plugin.manifest.id)).toEqual(["example.plugin"]);
  });

  it("keeps unsupported capability kinds inert while exposing valid siblings", () => {
    const parsed = validatePluginManifest(futureKindManifest);
    const registry = new PluginRegistry([discovered(parsed, "trusted")]);
    const lifecycle = resolvePluginLifecycle(discovered(parsed, "trusted"));

    expect(registry.list({ includeDisabled: true }).map((plugin) => plugin.manifest.id)).toEqual(["future-kind.plugin"]);
    expect(registry.listCapabilities({ includeInactive: true, includeDisabled: true }).map((capability) => capability.id)).toEqual([
      "future-kind.widget",
      "future-kind.search",
    ]);
    expect(registry.listCapabilities().map((capability) => capability.id)).toEqual(["future-kind.search"]);
    expect(lifecycle).toMatchObject({
      active: true,
      capabilityIds: ["future-kind.widget", "future-kind.search"],
      exposedCapabilityIds: ["future-kind.search"],
      statusNotes: ["Capability kind exo.future:widget is not supported by this Exo version."],
    });
  });

  it("does not let unsupported capability kinds reserve active ids", () => {
    const inactiveUnsupported = discovered(validatePluginManifest(futureKindManifest), "trusted");
    const activeSupported = discovered(
      {
        ...manifest,
        id: "supported-sibling.plugin",
        capabilities: [{ ...manifest.capabilities[1]!, id: "future-kind.widget" }],
      },
      "trusted",
    );

    expect(() => new PluginRegistry([inactiveUnsupported, activeSupported])).not.toThrow();
    expect(new PluginRegistry([inactiveUnsupported, activeSupported]).listCapabilities().map((capability) => capability.id)).toEqual([
      "future-kind.search",
      "future-kind.widget",
    ]);
  });

  it("keeps executable entrypoints disabled even for trusted enabled manifests", () => {
    const plugin = discovered(manifest, "trusted");

    expect(resolvePluginLifecycle(plugin)).toMatchObject({
      pluginId: "example.plugin",
      active: true,
      entrypoints: { main: "dist/main.js" },
      exposedCapabilityIds: [
        "example.trace",
        "example.search",
        "example.graph-view",
      ],
      executableLoading: "disabled",
      canLoadEntrypoints: false,
      canGrantPermissions: false,
      reason: expect.stringContaining("arbitrary plugin entrypoint execution is disabled"),
    });
  });

  it("keeps untrusted or disabled plugin capabilities and entrypoints inactive", () => {
    expect(resolvePluginLifecycle(discovered(manifest, "untrusted"))).toMatchObject({
      active: false,
      exposedCapabilityIds: [],
      executableLoading: "disabled",
      canLoadEntrypoints: false,
      reason: expect.stringContaining("untrusted"),
    });
    expect(resolvePluginLifecycle(discovered(manifest, "trusted", false))).toMatchObject({
      active: false,
      exposedCapabilityIds: [],
      executableLoading: "disabled",
      canLoadEntrypoints: false,
      reason: expect.stringContaining("disabled"),
    });
  });

  it("filters disabled and untrusted plugins", () => {
    const registry = new PluginRegistry([discovered(manifest, "untrusted"), discovered({ ...manifest, id: "disabled.plugin" }, "trusted", false)]);

    expect(registry.list().map((plugin) => plugin.manifest.id)).toEqual(["example.plugin"]);
    expect(registry.list({ trustedOnly: true })).toEqual([]);
    expect(registry.list({ includeDisabled: true }).map((plugin) => plugin.manifest.id)).toEqual(["example.plugin", "disabled.plugin"]);
    expect(registry.listCapabilities().map((capability) => capability.id)).toEqual([]);
    expect(registry.listCapabilities({ includeInactive: true, includeDisabled: true }).map((capability) => capability.id)).toEqual([
      "example.trace",
      "example.search",
      "example.graph-view",
      "example.trace",
      "example.search",
      "example.graph-view",
    ]);
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

  it("lets inactive plugins remain inspectable without reserving active capability ids", () => {
    const inactive = discovered(manifest, "trusted", false);
    const active = discovered(
      {
        ...manifest,
        id: "active.plugin",
      },
      "trusted",
    );

    const registry = new PluginRegistry([inactive, active]);

    expect(registry.list({ includeDisabled: true }).map((plugin) => plugin.manifest.id)).toEqual([
      "example.plugin",
      "active.plugin",
    ]);
    expect(registry.listCapabilities().map((capability) => capability.id)).toEqual([
      "example.trace",
      "example.search",
      "example.graph-view",
    ]);
  });
});

function discovered(manifest: PluginManifest, trust: DiscoveredPlugin["trust"] = "trusted", enabled = true): DiscoveredPlugin {
  return {
    manifest,
    manifestPath: `/plugins/${manifest.id}/${EXO_PLUGIN_MANIFEST_FILE}`,
    rootDirectory: `/plugins/${manifest.id}`,
    source: "dev",
    trust,
    enabled,
    manifestHash: `hash-${manifest.id}`,
  };
}

async function mkdirTempPluginRoot(): Promise<string> {
  const root = path.join(os.tmpdir(), `exo-plugin-test-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(root, { recursive: true });
  return root;
}
