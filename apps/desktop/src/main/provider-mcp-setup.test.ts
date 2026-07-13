import { describe, expect, it } from "vitest";

import { providerMcpCommand } from "./provider-mcp-setup";

describe("provider MCP handoff", () => {
  it("uses Claude's user-scoped command for Exo's read-only server", () => {
    expect(providerMcpCommand("claude", { providers: ["claude"] }))
      .toEqual(["claude", ["mcp", "add", "--scope", "user", "exo", "--", "exo", "mcp", "serve"]]);
  });

  it("uses Codex's stdio command for Exo's read-only server", () => {
    expect(providerMcpCommand("codex", { providers: ["codex"] }))
      .toEqual(["codex", ["mcp", "add", "exo", "--", "exo", "mcp", "serve"]]);
  });

  it("requires at least one provider", () => {
    expect(() => providerMcpCommand("claude", {
      providers: [],
    })).toThrow("at least one agent");
  });
});
