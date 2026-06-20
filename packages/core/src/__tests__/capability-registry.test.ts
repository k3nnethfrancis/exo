import { describe, expect, it } from "vitest";

import { builtInCapabilities, type CapabilityMetadata } from "../capabilities";
import { CapabilityRegistry, capabilityRegistry, createBuiltInCapabilityRegistry } from "../capability-registry";

const disabledCapability: CapabilityMetadata = {
  id: "disabled-test",
  kind: "analyzer",
  label: "Disabled Test",
  description: "Disabled test capability.",
  lifecycle: "disabled",
  owner: "@exo/core/test",
  surfaces: ["internal"],
  permissions: [],
};

describe("capability registry", () => {
  it("exposes built-in QMD and agent harness metadata", () => {
    const ids = capabilityRegistry.listActive().map((capability) => capability.id);

    expect(ids).toEqual(expect.arrayContaining(["qmd", "shell", "claude", "codex", "pi", "hermes"]));
    expect(capabilityRegistry.get("qmd")).toMatchObject({
      kind: "searchProvider",
      lifecycle: "built-in",
    });
    expect(capabilityRegistry.get("claude")).toMatchObject({
      kind: "agentHarness",
      lifecycle: "built-in",
    });
  });

  it("rejects duplicate ids", () => {
    const registry = new CapabilityRegistry();
    const [qmd] = builtInCapabilities;

    registry.register(qmd);

    expect(() => registry.register({ ...qmd })).toThrow("Capability already registered: qmd");
  });

  it("filters capabilities by kind", () => {
    const registry = createBuiltInCapabilityRegistry();

    expect(registry.listActive({ kind: "searchProvider" }).map((capability) => capability.id)).toEqual(["qmd"]);
    expect(registry.listActive({ kind: "agentHarness" }).map((capability) => capability.id)).toEqual(["shell", "claude", "codex", "pi", "hermes"]);
    expect(registry.listActive({ kind: "traceCollector" }).map((capability) => capability.id)).toEqual([]);
  });

  it("excludes disabled capabilities from active lists", () => {
    const registry = new CapabilityRegistry([...builtInCapabilities, disabledCapability]);

    expect(registry.listActive().map((capability) => capability.id)).not.toContain("disabled-test");
    expect(registry.list({ includeDisabled: true }).map((capability) => capability.id)).toContain("disabled-test");
    expect(registry.list({ lifecycle: "disabled", includeDisabled: true })).toEqual([disabledCapability]);
  });

  it("filters capabilities by surface", () => {
    const registry = new CapabilityRegistry([
      ...builtInCapabilities,
      {
        id: "internal-only-test",
        kind: "routineTemplate",
        label: "Internal Only Test",
        description: "Internal-only test capability.",
        lifecycle: "experimental",
        owner: "@exo/core/test",
        surfaces: ["internal"],
        permissions: [],
      },
    ]);

    expect(registry.listActive({ surface: "desktop" }).map((capability) => capability.id)).toEqual(["qmd", "shell", "claude", "codex", "pi", "hermes"]);
    expect(registry.listActive({ surface: "cli" }).map((capability) => capability.id)).toEqual(["qmd", "shell", "claude", "codex", "pi", "hermes"]);
    expect(registry.listActive({ surface: "mcp" }).map((capability) => capability.id)).toEqual(["qmd", "shell", "claude", "codex", "pi", "hermes"]);
    expect(registry.listActive({ surface: "commandServer" }).map((capability) => capability.id)).toEqual(["qmd", "shell", "claude", "codex", "pi", "hermes"]);
    expect(registry.listActive({ surface: "internal" }).map((capability) => capability.id)).toEqual([
      "qmd",
      "shell",
      "claude",
      "codex",
      "pi",
      "hermes",
      "internal-only-test",
    ]);
  });
});
