import { describe, expect, it } from "vitest";

import {
  buildExoMcpIntegrationSpec,
  formatMcpServerJson,
  parseMcpListOutput,
} from "../integrations";

describe("integrations", () => {
  const config = {
    exoRoot: "/tmp/exo-test-workspace/projects/exo",
    workspaceRoot: "/tmp/exo-test-workspace",
  };

  it("builds the Codex MCP install command", () => {
    const spec = buildExoMcpIntegrationSpec("codex", config);

    expect(spec.installCommand).toBe("codex");
    expect(spec.installArgs).toEqual([
      "mcp",
      "add",
      "exo",
      "--env",
      "EXO_MCP_AUTOSTART=1",
      "--env",
      "EXO_MCP_SEARCH_TIMEOUT_MS=30000",
      "--env",
      "EXO_MCP_START_COMMAND=/tmp/exo-test-workspace/projects/exo/bin/exo dev",
      "--",
      "node",
      "/tmp/exo-test-workspace/projects/exo/packages/mcp/bin/exo-mcp.mjs",
    ]);
  });

  it("builds the Claude Code MCP install command with user scope", () => {
    const spec = buildExoMcpIntegrationSpec("claude", config);

    expect(spec.installCommand).toBe("claude");
    expect(spec.installArgs.slice(0, 4)).toEqual([
      "mcp",
      "add-json",
      "--scope",
      "user",
    ]);
    expect(JSON.parse(spec.installArgs.at(-1) ?? "{}")).toMatchObject({
      type: "stdio",
      command: "node",
      env: {
        EXO_MCP_AUTOSTART: "1",
        EXO_MCP_SEARCH_TIMEOUT_MS: "30000",
        EXO_MCP_START_COMMAND: "/tmp/exo-test-workspace/projects/exo/bin/exo dev",
      },
    });
    expect(spec.installArgs).toContain("exo");
  });

  it("formats MCP JSON for documentation and config previews", () => {
    const spec = buildExoMcpIntegrationSpec("codex", config);
    const json = JSON.parse(formatMcpServerJson(spec.server));

    expect(json.mcpServers.exo.command).toBe("node");
    expect(json.mcpServers.exo.args).toContain("/tmp/exo-test-workspace/projects/exo/packages/mcp/bin/exo-mcp.mjs");
    expect(json.mcpServers.exo.env.EXO_MCP_AUTOSTART).toBe("1");
    expect(json.mcpServers.exo.env.EXO_MCP_SEARCH_TIMEOUT_MS).toBe("30000");
  });

  it("parses Codex and Claude MCP list output", () => {
    expect(parseMcpListOutput("context7 npx -y context7\nexo pnpm --dir /tmp/exo\n").configured).toBe(true);
    expect(parseMcpListOutput("qmd: qmd mcp\nexo: pnpm --dir /tmp/exo\n").configured).toBe(true);
    expect(parseMcpListOutput("qmd: qmd mcp\n").configured).toBe(false);
  });
});
