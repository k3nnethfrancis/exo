import { describe, expect, it } from "vitest";

import {
  controlPlaneEntriesForSurface,
  isKnownMcpToolName,
  isMcpToolExposed,
  mcpToolsForExposureProfile,
  parseMcpCustomToolList,
  resolveControlPlaneExposureProfile,
} from "../control-plane-catalog";

describe("control-plane catalog", () => {
  it("keeps the dev MCP profile aligned to the full current tool surface", () => {
    expect(mcpToolsForExposureProfile("dev")).toEqual([
      "close_preview",
      "create_agent",
      "focus_preview",
      "interrupt_agent",
      "list_agents",
      "open_preview",
      "read_agent",
      "read_document",
      "search",
      "send_agent_message",
      "terminate_agent",
      "workspace_status",
    ]);
  });

  it("keeps everyday MCP exposure narrow and excludes agent lifecycle/input controls", () => {
    expect(mcpToolsForExposureProfile("everyday")).toEqual([
      "close_preview",
      "focus_preview",
      "open_preview",
      "read_document",
      "search",
      "workspace_status",
    ]);
    expect(isMcpToolExposed("create_agent", "everyday")).toBe(false);
    expect(isMcpToolExposed("send_agent_message", "everyday")).toBe(false);
  });

  it("supports off and custom MCP profiles", () => {
    expect(mcpToolsForExposureProfile("off")).toEqual([]);
    expect(mcpToolsForExposureProfile("custom", ["search", "missing", "workspace_status", "search"])).toEqual([
      "search",
      "workspace_status",
    ]);
  });

  it("normalizes profile and custom tool env values", () => {
    expect(resolveControlPlaneExposureProfile("everyday")).toBe("everyday");
    expect(resolveControlPlaneExposureProfile("unknown", "off")).toBe("off");
    expect(parseMcpCustomToolList(" search, workspace_status ,,")).toEqual(["search", "workspace_status"]);
    expect(isKnownMcpToolName("search")).toBe(true);
    expect(isKnownMcpToolName("missing")).toBe(false);
  });

  it("lists MCP catalog entries with risk metadata", () => {
    const entries = controlPlaneEntriesForSurface("mcp");
    expect(entries).toHaveLength(12);
    expect(entries.find((entry) => entry.mcpToolName === "terminate_agent")).toMatchObject({
      riskClass: "destructive",
      operatorOnly: true,
      safeForAgentUse: false,
    });
  });
});
