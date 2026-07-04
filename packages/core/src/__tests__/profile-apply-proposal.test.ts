import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { applyProposalToWorkspace } from "../proposal-apply-host";
import { createProfileApplyProposal } from "../profile-apply-proposal";
import { ProposalReviewStore } from "../proposal-review-store";
import type { ProfileDefinition } from "../profile";

const tempPaths: string[] = [];

afterEach(async () => {
  await Promise.all(tempPaths.splice(0).map((target) => rm(target, { recursive: true, force: true })));
});

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
      expect.objectContaining({
        id: "context-agents",
        kind: "fileCreate",
        path: "AGENTS.md",
        contents: "# Agents\n",
        metadata: expect.objectContaining({ profileTemplateKind: "context" }),
      }),
      expect.objectContaining({
        id: "instruction-claude",
        kind: "filePatch",
        path: "CLAUDE.md",
        unifiedDiff: expect.stringContaining("-# Old\n+# Claude"),
        metadata: expect.objectContaining({ profileTemplateKind: "instruction" }),
      }),
      expect.objectContaining({
        id: "mcp-mcp",
        kind: "fileCreate",
        path: ".mcp.json",
        contents: "{\"mcpServers\":{}}\n",
        metadata: expect.objectContaining({ profileTemplateKind: "mcp" }),
      }),
    ]);
  });

  it("materializes exact context, instruction, and MCP template bytes through fixture-vault proposal apply", async () => {
    const { pluginRoot, workspaceRoot, runtimeRoot } = await fixture();
    const agents = "# Exo Fixture Agents\n\n- Use fixture-only context.\n";
    const claude = "# Fixture Instructions\n\nUse deterministic profile instructions.\n";
    const mcp = "{\n  \"mcpServers\": {\n    \"exo-fixture\": {\n      \"command\": \"exo-mcp-fixture\"\n    }\n  }\n}\n";
    await writeFile(path.join(pluginRoot, "templates/context/AGENTS.md"), agents);
    await writeFile(path.join(pluginRoot, "templates/instructions/CLAUDE.md"), claude);
    await writeFile(path.join(pluginRoot, "templates/mcp/exo.json"), mcp);
    await writeFile(path.join(workspaceRoot, "CLAUDE.md"), "# Old Fixture Instructions\n");
    await writeFile(path.join(workspaceRoot, "untouched.md"), "# Do not change\n");

    const staged = await createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "agents", label: "Agents", templatePath: "templates/context/AGENTS.md", target: "AGENTS.md" }],
        instructionTemplates: [{ id: "claude", label: "Claude", templatePath: "templates/instructions/CLAUDE.md", target: "CLAUDE.md" }],
        mcpConfigTemplates: [{ id: "mcp", label: "MCP", templatePath: "templates/mcp/exo.json", target: ".exo/mcp/exo.json" }],
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:fixture-vault",
      sessionId: "term-fixture",
      target: "fixtureVault",
      now: "2026-07-04T10:00:00.000Z",
    });
    expect(staged).toMatchObject({
      provenance: { activityId: "profile-apply:fixture-vault", sessionId: "term-fixture" },
      metadata: { source: "profileApply", profileApplyTarget: "fixtureVault" },
    });

    const store = new ProposalReviewStore(runtimeRoot);
    await store.writeProposal(staged!);
    const reviewed = await store.readProposal(staged!.id);
    const result = await applyProposalToWorkspace(reviewed!, {
      workspaceRoot,
      decision: "accept",
      surface: "cli",
      profileApplyMode: "fixtureVault",
      decidedAt: "2026-07-04T10:01:00.000Z",
    });
    await store.writeProposal(result.proposal);

    expect(result.proposal.status).toBe("accepted");
    expect(result.appliedItems.map((item) => [item.id, item.kind, item.path, item.action])).toEqual([
      ["context-agents", "fileCreate", "AGENTS.md", "created"],
      ["instruction-claude", "filePatch", "CLAUDE.md", "patched"],
      ["mcp-mcp", "fileCreate", ".exo/mcp/exo.json", "created"],
    ]);
    await expect(readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8")).resolves.toBe(agents);
    await expect(readFile(path.join(workspaceRoot, "CLAUDE.md"), "utf8")).resolves.toBe(claude);
    await expect(readFile(path.join(workspaceRoot, ".exo/mcp/exo.json"), "utf8")).resolves.toBe(mcp);
    await expect(readFile(path.join(workspaceRoot, "untouched.md"), "utf8")).resolves.toBe("# Do not change\n");
    await expect(store.readProposal(staged!.id)).resolves.toMatchObject({ status: "accepted" });
  });

  it("does not write unmarked profile apply proposals outside the fixture-vault path", async () => {
    const { pluginRoot, workspaceRoot } = await fixture();
    await writeFile(path.join(pluginRoot, "templates/AGENTS.md"), "# Agents\n");
    const proposal = await createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "agents", label: "Agents", templatePath: "templates/AGENTS.md", target: "AGENTS.md" }],
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:blocked",
      now: "2026-07-04T10:00:00.000Z",
    });

    await expect(applyProposalToWorkspace(proposal!, {
      workspaceRoot,
      decision: "accept",
      surface: "cli",
    })).rejects.toThrow("fixture-vault only");
    await expect(readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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

async function fixture(): Promise<{ pluginRoot: string; workspaceRoot: string; runtimeRoot: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "exo-profile-apply-"));
  tempPaths.push(root);
  const pluginRoot = path.join(root, "plugin");
  const workspaceRoot = path.join(root, "workspace");
  const runtimeRoot = path.join(root, "runtime");
  await mkdir(path.join(pluginRoot, "templates/context"), { recursive: true });
  await mkdir(path.join(pluginRoot, "templates/instructions"), { recursive: true });
  await mkdir(path.join(pluginRoot, "templates/mcp"), { recursive: true });
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(runtimeRoot, { recursive: true });
  return { pluginRoot, workspaceRoot, runtimeRoot };
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
