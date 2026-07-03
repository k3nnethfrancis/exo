import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { createProfileApplyProposal } from "../profile-apply-proposal";
import type { ProfileDefinition } from "../profile";

describe("createProfileApplyProposal", () => {
  it("creates reviewable file create and patch items from profile templates", async () => {
    const { pluginRoot, workspaceRoot } = await fixture();
    await writeFile(path.join(pluginRoot, "templates/AGENTS.md"), "# Agents\n");
    await writeFile(path.join(pluginRoot, "templates/mcp.json"), "{\"mcpServers\":{}}\n");
    await writeFile(path.join(workspaceRoot, "CLAUDE.md"), "# Old\n");
    await writeFile(path.join(pluginRoot, "templates/CLAUDE.md"), "# Claude\n");

    const proposal = await createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "agents", label: "Agents", templatePath: "templates/AGENTS.md", target: "AGENTS.md" }],
        instructionTemplates: [{ id: "claude", label: "Claude", templatePath: "templates/CLAUDE.md", target: "CLAUDE.md" }],
        mcpConfigTemplates: [{ id: "mcp", label: "MCP", templatePath: "templates/mcp.json", target: ".mcp.json" }],
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:test",
      now: "2026-07-03T12:00:00.000Z",
    });

    expect(proposal).toMatchObject({
      id: "profile-apply-test-profile-2026-07-03T12-00-00-000Z",
      status: "pending",
      provenance: { activityId: "profile-apply:test" },
      metadata: { source: "profileApply", profileId: "test.profile" },
    });
    expect(proposal?.items).toEqual([
      expect.objectContaining({ id: "context-agents", kind: "fileCreate", path: "AGENTS.md", contents: "# Agents\n" }),
      expect.objectContaining({ id: "instruction-claude", kind: "filePatch", path: "CLAUDE.md", unifiedDiff: expect.stringContaining("-# Old\n+# Claude") }),
      expect.objectContaining({ id: "mcp-mcp", kind: "fileCreate", path: ".mcp.json", contents: "{\"mcpServers\":{}}\n" }),
    ]);
  });

  it("returns null when profile template targets already match", async () => {
    const { pluginRoot, workspaceRoot } = await fixture();
    await writeFile(path.join(pluginRoot, "templates/AGENTS.md"), "# Agents\n");
    await writeFile(path.join(workspaceRoot, "AGENTS.md"), "# Agents\n");

    await expect(createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "agents", label: "Agents", templatePath: "templates/AGENTS.md", target: "AGENTS.md" }],
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:test",
      now: "2026-07-03T12:00:00.000Z",
    })).resolves.toBeNull();
  });

  it("rejects template and target paths that escape their roots", async () => {
    const { pluginRoot, workspaceRoot } = await fixture();
    await expect(createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "bad", label: "Bad", templatePath: "../outside.md", target: "AGENTS.md" }],
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:test",
    })).rejects.toThrow("escapes plugin root");

    await writeFile(path.join(pluginRoot, "templates/AGENTS.md"), "# Agents\n");
    await expect(createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "bad", label: "Bad", templatePath: "templates/AGENTS.md", target: "../AGENTS.md" }],
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:test",
    })).rejects.toThrow("inside the workspace");
  });
});

async function fixture(): Promise<{ pluginRoot: string; workspaceRoot: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-profile-apply-"));
  const pluginRoot = path.join(root, "plugin");
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(path.join(pluginRoot, "templates"), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  return { pluginRoot, workspaceRoot };
}

function profile(overrides: Partial<ProfileDefinition> = {}): ProfileDefinition {
  return {
    id: "test.profile",
    label: "Test Profile",
    description: "Test profile.",
    lifecycle: "experimental",
    recommendedPlugins: [],
    metadataSchemas: [],
    contextTemplates: [],
    instructionTemplates: [],
    mcpConfigTemplates: [],
    skills: [],
    routineTemplateIds: [],
    graphViews: [],
    analyzerSettings: [],
    ...overrides,
  };
}
