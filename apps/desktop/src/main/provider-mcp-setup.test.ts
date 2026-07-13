import { describe, expect, it } from "vitest";

import { providerMcpCommand } from "./provider-mcp-setup";

describe("provider MCP handoff", () => {
  it("uses Claude's user-scoped command for a local server", () => {
    expect(providerMcpCommand("claude", {
      providers: ["claude"], name: "filesystem", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp/wiki"],
    })).toEqual(["claude", ["mcp", "add", "--scope", "user", "filesystem", "--", "npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp/wiki"]]);
  });

  it("uses Codex's URL command for a remote server", () => {
    expect(providerMcpCommand("codex", {
      providers: ["codex"], name: "research", transport: "http", url: "https://mcp.example.com/",
    })).toEqual(["codex", ["mcp", "add", "research", "--url", "https://mcp.example.com/"]]);
  });

  it("rejects malformed names and unsafe multiline executable input", () => {
    expect(() => providerMcpCommand("claude", {
      providers: ["claude"], name: "not valid", transport: "stdio", command: "npx",
    })).toThrow("short MCP name");
    expect(() => providerMcpCommand("codex", {
      providers: ["codex"], name: "research", transport: "stdio", command: "npx\nrm -rf /",
    })).toThrow("executable");
  });
});
