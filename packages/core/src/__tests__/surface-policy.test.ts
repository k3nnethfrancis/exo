import { describe, expect, it } from "vitest";

import type { CapabilityMetadata } from "../capabilities";
import { builtInCapabilities } from "../capabilities";
import { getSurfaceContributionPolicy, isCapabilityAvailableOnSurface } from "../surface-policy";

describe("surface contribution policy", () => {
  it("keeps MCP as a reviewed agent-facing surface", () => {
    expect(getSurfaceContributionPolicy("mcp")).toEqual({
      surface: "mcp",
      audience: "agent",
      defaultExposure: "review",
    });
  });

  it("keeps command-server routes hidden by default", () => {
    expect(getSurfaceContributionPolicy("commandServer")).toEqual({
      surface: "commandServer",
      audience: "internal",
      defaultExposure: "hidden",
    });
  });

  it("recognizes built-in capabilities on command-server and MCP surfaces", () => {
    const qmd = builtInCapabilities.find((capability) => capability.id === "qmd");

    expect(qmd).toBeDefined();
    expect(isCapabilityAvailableOnSurface(qmd!, "commandServer")).toBe(true);
    expect(isCapabilityAvailableOnSurface(qmd!, "mcp")).toBe(true);
  });

  it("hides disabled capabilities from every surface", () => {
    const disabled: CapabilityMetadata = {
      id: "disabled-surface-test",
      kind: "analyzer",
      label: "Disabled Surface Test",
      description: "Disabled test capability.",
      lifecycle: "disabled",
      owner: "@exo/core/test",
      surfaces: ["desktop", "cli", "mcp", "commandServer", "internal"],
      permissions: [],
    };

    expect(isCapabilityAvailableOnSurface(disabled, "desktop")).toBe(false);
    expect(isCapabilityAvailableOnSurface(disabled, "mcp")).toBe(false);
    expect(isCapabilityAvailableOnSurface(disabled, "commandServer")).toBe(false);
  });
});
