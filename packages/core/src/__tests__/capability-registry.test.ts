import { describe, expect, it } from "vitest";

import { builtInCapabilities, type CapabilityMetadata } from "../capabilities";
import { CapabilityRegistry, capabilityRegistry, createBuiltInCapabilityRegistry } from "../capability-registry";

const disabledCapability: CapabilityMetadata = {
  id: "disabled-test",
  kind: "exo.graph:analyzer",
  label: "Disabled Test",
  description: "Disabled test capability.",
  lifecycle: "disabled",
  owner: "@exo/core/test",
  surfaces: ["internal"],
  permissions: [],
};

const unsupportedCapability: CapabilityMetadata = {
  id: "future-widget",
  kind: "exo.future:widget",
  label: "Future Widget",
  description: "Future capability kind.",
  lifecycle: "experimental",
  owner: "@exo/core/test",
  surfaces: ["desktop"],
  permissions: [],
  status: "unsupported-kind",
};

describe("capability registry", () => {
  it("exposes built-in QMD metadata without built-in harness capabilities", () => {
    const ids = capabilityRegistry.listActive().map((capability) => capability.id);

    expect(ids).toEqual(["qmd"]);
    expect(capabilityRegistry.get("qmd")).toMatchObject({
      kind: "core:searchProvider",
      label: "QMD advanced search",
      description: expect.stringContaining("Core filename, path, and text search remains available"),
      lifecycle: "built-in",
    });
    expect(capabilityRegistry.get("claude")).toBeUndefined();
  });

  it("rejects duplicate ids", () => {
    const registry = new CapabilityRegistry();
    const [qmd] = builtInCapabilities;

    registry.register(qmd);

    expect(() => registry.register({ ...qmd })).toThrow("Capability already registered: qmd");
  });

  it("filters capabilities by kind", () => {
    const registry = createBuiltInCapabilityRegistry();

    expect(registry.listActive({ kind: "core:searchProvider" }).map((capability) => capability.id)).toEqual(["qmd"]);
    expect(registry.listActive({ kind: "exo.training:traceCollector" }).map((capability) => capability.id)).toEqual([]);
  });

  it("excludes disabled capabilities from active lists", () => {
    const registry = new CapabilityRegistry([...builtInCapabilities, disabledCapability]);

    expect(registry.listActive().map((capability) => capability.id)).not.toContain("disabled-test");
    expect(registry.list({ includeDisabled: true }).map((capability) => capability.id)).toContain("disabled-test");
    expect(registry.list({ lifecycle: "disabled", includeDisabled: true })).toEqual([disabledCapability]);
  });

  it("keeps unsupported capability kinds inspectable but inactive", () => {
    const registry = new CapabilityRegistry([...builtInCapabilities, unsupportedCapability]);

    expect(registry.get("future-widget")).toBe(unsupportedCapability);
    expect(registry.list({ includeDisabled: true }).map((capability) => capability.id)).toContain("future-widget");
    expect(registry.listActive({ surface: "desktop" }).map((capability) => capability.id)).not.toContain("future-widget");
  });

  it("filters capabilities by surface", () => {
    const registry = new CapabilityRegistry([
      ...builtInCapabilities,
      {
        id: "internal-only-test",
        kind: "exo.graph:analyzer",
        label: "Internal Only Test",
        description: "Internal-only test capability.",
        lifecycle: "experimental",
        owner: "@exo/core/test",
        surfaces: ["internal"],
        permissions: [],
      },
    ]);

    expect(registry.listActive({ surface: "desktop" }).map((capability) => capability.id)).toEqual(["qmd"]);
    expect(registry.listActive({ surface: "cli" }).map((capability) => capability.id)).toEqual(["qmd"]);
    expect(registry.listActive({ surface: "commandServer" }).map((capability) => capability.id)).toEqual(["qmd"]);
    expect(registry.listActive({ surface: "internal" }).map((capability) => capability.id)).toEqual([
      "qmd",
      "internal-only-test",
    ]);
  });
});
