import { describe, expect, it } from "vitest";

import {
  buildExoMcpIntegrationSpec,
  formatMcpServerJson,
  parseMcpListOutput,
} from "../integrations";

describe("integrations", () => {
  const config = {
    exoRoot: "/tmp/lab/projects/exo",
    workspaceRoot: "/tmp/lab",
  };

  it("builds the Codex MCP install command", () => {
    const spec = buildExoMcpIntegrationSpec("codex", config);

    expect(spec.installCommand).toBe("codex");
    expect(spec.installArgs).toEqual([
      "mcp",
      "add",
      "exo",
      "--env",
      "EXO_WORKSPACE_ROOT=/tmp/lab",
      "--env",
      "EXO_MCP_AUTOSTART=1",
      "--env",
      "EXO_MCP_START_COMMAND=/tmp/lab/projects/exo/bin/exo dev",
      "--",
      "node",
      "/tmp/lab/projects/exo/packages/mcp/bin/exo-mcp.mjs",
    ]);
  });

  it("builds the Claude Code MCP install command with user scope", () => {
    const spec = buildExoMcpIntegrationSpec("claude", config);

    expect(spec.installCommand).toBe("claude");
    expect(spec.installArgs.slice(0, 8)).toEqual([
      "mcp",
      "add",
      "--transport",
      "stdio",
      "--scope",
      "user",
      "--env",
      "EXO_WORKSPACE_ROOT=/tmp/lab",
    ]);
    expect(spec.installArgs).toContain("exo");
    expect(spec.installArgs.slice(-2)).toEqual(["node", "/tmp/lab/projects/exo/packages/mcp/bin/exo-mcp.mjs"]);
  });

  it("formats MCP JSON for documentation and config previews", () => {
    const spec = buildExoMcpIntegrationSpec("codex", config);
    const json = JSON.parse(formatMcpServerJson(spec.server));

    expect(json.mcpServers.exo.command).toBe("node");
    expect(json.mcpServers.exo.args).toContain("/tmp/lab/projects/exo/packages/mcp/bin/exo-mcp.mjs");
    expect(json.mcpServers.exo.env.EXO_MCP_AUTOSTART).toBe("1");
  });

  it("parses Codex and Claude MCP list output", () => {
    expect(parseMcpListOutput("context7 npx -y context7\nexo pnpm --dir /tmp/exo\n").configured).toBe(true);
    expect(parseMcpListOutput("qmd: qmd mcp\nexo: pnpm --dir /tmp/exo\n").configured).toBe(true);
    expect(parseMcpListOutput("qmd: qmd mcp\n").configured).toBe(false);
  });
});
