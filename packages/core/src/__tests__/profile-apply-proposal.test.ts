import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { applyProposalToWorkspace, contentSha256 } from "../proposal-apply-host";
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
      target: "realVault",
      now: "2026-07-03T12:00:00.000Z",
    });

    expect(proposal).toMatchObject({
      id: "profile-apply-test-profile-2026-07-03T12-00-00-000Z",
      status: "pending",
      provenance: { activityId: "profile-apply:test" },
      metadata: { source: "profileApply", profileId: "test.profile", profileApplyTarget: "realVault", profileApplyCreatedBy: "exo" },
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

  it("matches the exact fixture-vault proposal, apply result, and output bytes", async () => {
    const { pluginRoot, workspaceRoot, runtimeRoot } = await fixture();
    await copyFixtureDirectory("plugin", pluginRoot);
    await copyFixtureDirectory("workspace-initial", workspaceRoot);

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
    expect(staged).toEqual(await readFixtureJson("expected/proposal.json"));

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

    expect(result).toEqual(await readFixtureJson("expected/apply-result.json"));
    await expect(readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8")).resolves.toBe(await readFixtureText("expected/AGENTS.md"));
    await expect(readFile(path.join(workspaceRoot, "CLAUDE.md"), "utf8")).resolves.toBe(await readFixtureText("expected/CLAUDE.md"));
    await expect(readFile(path.join(workspaceRoot, ".exo/mcp/exo.json"), "utf8")).resolves.toBe(await readFixtureText("expected/mcp/exo.json"));
    await expect(readFile(path.join(workspaceRoot, "untouched.md"), "utf8")).resolves.toBe(await readFixtureText("expected/untouched.md"));
    await expect(store.readProposal(staged!.id)).resolves.toMatchObject({ status: "accepted" });
  });

  it("stages and applies real-vault profile proposals only with embedded review-policy evidence", async () => {
    const { pluginRoot, workspaceRoot } = await fixture();
    await writeFile(path.join(pluginRoot, "templates/AGENTS.md"), "# Agents\n");
    await writeFile(path.join(pluginRoot, "templates/CLAUDE.md"), "# Claude\n");
    await writeFile(path.join(workspaceRoot, "CLAUDE.md"), "# Old\n");
    const proposal = await createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "agents", label: "Agents", templatePath: "templates/AGENTS.md", target: "AGENTS.md" }],
        instructionTemplates: [{ id: "claude", label: "Claude", templatePath: "templates/CLAUDE.md", target: "CLAUDE.md" }],
        reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["**/*.md"] },
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:blocked",
      target: "realVault",
      now: "2026-07-04T10:00:00.000Z",
    });

    await expect(applyProposalToWorkspace({
      ...proposal!,
      metadata: {
        ...proposal!.metadata,
        profileApplyCreatedBy: undefined,
      },
    }, {
      workspaceRoot,
      decision: "accept",
      surface: "cli",
    })).rejects.toThrow("Exo-created profileApply metadata");
    await expect(readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });

    const result = await applyProposalToWorkspace(proposal!, {
      workspaceRoot,
      decision: "accept",
      surface: "cli",
      decidedAt: "2026-07-04T10:01:00.000Z",
    });

    expect(result.appliedItems).toEqual([
      { id: "context-agents", kind: "fileCreate", path: "AGENTS.md", action: "created" },
      { id: "instruction-claude", kind: "filePatch", path: "CLAUDE.md", action: "patched" },
    ]);
    await expect(readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8")).resolves.toBe("# Agents\n");
    await expect(readFile(path.join(workspaceRoot, "CLAUDE.md"), "utf8")).resolves.toBe("# Claude\n");
    const recoveryFiles = await readdir(path.join(workspaceRoot, ".exo", "proposal-recovery", "profile-apply"));
    expect(recoveryFiles).toHaveLength(1);
    const recovery = JSON.parse(await readFile(path.join(workspaceRoot, ".exo", "proposal-recovery", "profile-apply", recoveryFiles[0]), "utf8"));
    expect(recovery).toMatchObject({
      format: "exo.profileApplyRecovery.v1",
      proposalId: proposal!.id,
      source: "profileApply",
      profileApplyTarget: "realVault",
      profileId: "test.profile",
      items: [
        {
          id: "context-agents",
          kind: "fileCreate",
          path: "AGENTS.md",
          before: { exists: false },
          afterHash: contentSha256("# Agents\n"),
        },
        {
          id: "instruction-claude",
          kind: "filePatch",
          path: "CLAUDE.md",
          before: { exists: true, hash: contentSha256("# Old\n"), contents: "# Old\n" },
          afterHash: contentSha256("# Claude\n"),
        },
      ],
    });
  });

  it("fails closed without mutating real-vault files when recovery evidence cannot be written", async () => {
    const { pluginRoot, workspaceRoot } = await fixture();
    await writeFile(path.join(pluginRoot, "templates/AGENTS.md"), "# Agents\n");
    await writeFile(path.join(workspaceRoot, ".exo"), "not a directory");
    const proposal = await createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "agents", label: "Agents", templatePath: "templates/AGENTS.md", target: "AGENTS.md" }],
        reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["**/*.md"] },
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:blocked",
      target: "realVault",
      now: "2026-07-04T10:00:00.000Z",
    });

    await expect(applyProposalToWorkspace(proposal!, {
      workspaceRoot,
      decision: "accept",
      surface: "cli",
      decidedAt: "2026-07-04T10:01:00.000Z",
    })).rejects.toMatchObject({ code: "ENOTDIR" });
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
      target: "realVault",
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
      target: "fixtureVault",
    })).rejects.toThrow("escapes plugin root");

    await writeFile(path.join(pluginRoot, "templates/AGENTS.md"), "# Agents\n");
    await expect(createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "bad", label: "Bad", templatePath: "templates/AGENTS.md", target: "../AGENTS.md" }],
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:test",
      target: "fixtureVault",
    })).rejects.toThrow("inside the workspace");
  });

  it("requires real-vault proposals to use human-reviewed propose policy and allowed paths", async () => {
    const { pluginRoot, workspaceRoot } = await fixture();
    await writeFile(path.join(pluginRoot, "templates/AGENTS.md"), "# Agents\n");

    await expect(createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "agents", label: "Agents", templatePath: "templates/AGENTS.md", target: "AGENTS.md" }],
        reviewPolicy: { fileChanges: "apply", requireHumanReview: true, allowedPaths: ["**/*.md"] },
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:test",
      target: "realVault",
    })).rejects.toThrow("fileChanges must be \"propose\"");

    await expect(createProfileApplyProposal({
      profile: profile({
        contextTemplates: [{ id: "agents", label: "Agents", templatePath: "templates/AGENTS.md", target: "AGENTS.md" }],
        reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["notes/**"] },
      }),
      pluginRoot,
      workspaceRoot,
      activityId: "profile-apply:test",
      target: "realVault",
    })).rejects.toThrow("Blocked template target paths: AGENTS.md");
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

async function copyFixtureDirectory(relativePath: string, target: string): Promise<void> {
  await cp(profileApplyFixturePath(relativePath), target, { recursive: true });
}

async function readFixtureText(relativePath: string): Promise<string> {
  return readFile(profileApplyFixturePath(relativePath), "utf8");
}

async function readFixtureJson(relativePath: string): Promise<unknown> {
  return JSON.parse(await readFixtureText(relativePath));
}

function profileApplyFixturePath(relativePath: string): string {
  return path.join(fileURLToPath(new URL("./fixtures/profile-apply-vault", import.meta.url)), relativePath);
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
    reviewPolicy: { fileChanges: "propose", requireHumanReview: true, allowedPaths: ["**/*.md", ".mcp.json", ".exo/**"] },
    ...overrides,
  };
}
