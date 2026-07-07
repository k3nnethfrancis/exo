import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { WorkspaceModel } from "@exo/core";
import { AgentInstructionsService, normalizeInstructionFileBody, resolveInstructionStatus, upsertExographContextBlock } from "./agent-instructions-service";

describe("AgentInstructionsService", () => {
  it("resolves provider file status states", () => {
    expect(resolveInstructionStatus({ agentsExists: false, claudeExists: false, bodiesMatch: true, hasErrors: false })).toBe("missing-both");
    expect(resolveInstructionStatus({ agentsExists: true, claudeExists: false, bodiesMatch: false, hasErrors: false })).toBe("missing-claude");
    expect(resolveInstructionStatus({ agentsExists: false, claudeExists: true, bodiesMatch: false, hasErrors: false })).toBe("missing-agents");
    expect(resolveInstructionStatus({ agentsExists: true, claudeExists: true, bodiesMatch: true, hasErrors: false })).toBe("aligned");
    expect(resolveInstructionStatus({ agentsExists: true, claudeExists: true, bodiesMatch: false, hasErrors: false })).toBe("different");
    expect(resolveInstructionStatus({ agentsExists: true, claudeExists: true, bodiesMatch: true, hasErrors: true })).toBe("error");
  });

  it("normalizes saved instruction bodies with one trailing newline", () => {
    expect(normalizeInstructionFileBody("body\n\n")).toBe("body\n");
  });

  it("adds or replaces the managed Exograph context block without rewriting user instructions", () => {
    const first = upsertExographContextBlock("personal rules\n", "exo context");
    expect(first).toContain("personal rules\n\n<!-- exo:exograph-context:start -->\nexo context\n<!-- exo:exograph-context:end -->\n");

    const second = upsertExographContextBlock(first, "updated context\n\n");
    expect(second).toContain("personal rules\n\n<!-- exo:exograph-context:start -->\nupdated context\n<!-- exo:exograph-context:end -->\n");
    expect(second).not.toContain("exo context\n<!-- exo:exograph-context:end -->\n\n<!-- exo:exograph-context:start -->");
  });

  it("loads aligned global and exocortex scopes", async () => {
    const { service, homeRoot, notesRoot } = await agentInstructionsService();
    await mkdir(path.join(homeRoot, ".codex"), { recursive: true });
    await mkdir(path.join(homeRoot, ".claude"), { recursive: true });
    await writeFile(path.join(homeRoot, ".codex", "AGENTS.md"), "global\n", "utf8");
    await writeFile(path.join(homeRoot, ".claude", "CLAUDE.md"), "global\n", "utf8");
    await writeFile(path.join(notesRoot, "AGENTS.md"), "notes\n", "utf8");
    await writeFile(path.join(notesRoot, "CLAUDE.md"), "notes\n", "utf8");

    const config = await service.getConfig();

    expect(config.scopes).toEqual([
      expect.objectContaining({ id: "global", status: "aligned", body: "global\n", source: "agents" }),
      expect.objectContaining({ id: "exocortex", status: "aligned", body: "notes\n", source: "agents" }),
    ]);
  });

  it("renders stable Exograph context guidance without generated file or tree snapshots", async () => {
    const { service, notesRoot, projectRoot } = await agentInstructionsService({
      indexing: { enabled: true, mode: "hybrid", backend: "qmd" },
    });
    await mkdir(path.join(notesRoot, "projects", "exo"), { recursive: true });
    await writeFile(path.join(notesRoot, "index.md"), "# Index\n", "utf8");
    await writeFile(path.join(notesRoot, "projects", "exo", "roadmap.md"), "# Roadmap\n", "utf8");

    const config = await service.getConfig();

    expect(config.starterTemplate).toContain(`Active notes roots: notes (${notesRoot})`);
    expect(config.exographContextTemplate).toContain(`- Workspace root: ${path.dirname(notesRoot)}`);
    expect(config.exographContextTemplate).toContain(`- notes: ${notesRoot}`);
    expect(config.exographContextTemplate).toContain(`- exo: ${projectRoot}`);
    expect(config.exographContextTemplate).toContain("Indexed Exo search is enabled through QMD in hybrid mode");
    expect(config.exographContextTemplate).toContain("Exo MCP is the narrow agent work surface");
    expect(config.exographContextTemplate).toContain("Exo CLI is the broader operator surface");
    expect(config.exographContextTemplate).toContain("use the CLI or filesystem when available, and record the MCP gap as product feedback");
    expect(config.exographContextTemplate).not.toContain("Notes Navigation Snapshot");
    expect(config.exographContextTemplate).not.toContain("Snapshot policy");
    expect(config.exographContextTemplate).not.toContain("|--");
    expect(config.exographContextTemplate).not.toContain("`--");
    expect(config.exographContextTemplate).not.toContain("index.md");
    expect(config.exographContextTemplate).not.toContain("roadmap.md");
  });

  it("saves a selected scope to both provider files", async () => {
    const { service, notesRoot } = await agentInstructionsService();

    const config = await service.saveConfig({ scopeId: "exocortex", body: "shared instructions\n\n" });

    await expect(readFile(path.join(notesRoot, "AGENTS.md"), "utf8")).resolves.toBe("shared instructions\n");
    await expect(readFile(path.join(notesRoot, "CLAUDE.md"), "utf8")).resolves.toBe("shared instructions\n");
    expect(config.scopes.find((scope) => scope.id === "exocortex")).toEqual(
      expect.objectContaining({ status: "aligned", body: "shared instructions\n" }),
    );
  });

  it("syncs a selected provider file across both instruction files", async () => {
    const { service, notesRoot } = await agentInstructionsService();
    await writeFile(path.join(notesRoot, "AGENTS.md"), "agents source\n\n", "utf8");
    await writeFile(path.join(notesRoot, "CLAUDE.md"), "claude old\n", "utf8");

    const config = await service.syncFromProviderFile({ scopeId: "exocortex", sourceProviderId: "agents" });

    await expect(readFile(path.join(notesRoot, "AGENTS.md"), "utf8")).resolves.toBe("agents source\n");
    await expect(readFile(path.join(notesRoot, "CLAUDE.md"), "utf8")).resolves.toBe("agents source\n");
    expect(config.scopes.find((scope) => scope.id === "exocortex")).toEqual(
      expect.objectContaining({ status: "aligned", body: "agents source\n", source: "agents" }),
    );
  });

  it("does not sync from a missing or empty provider file", async () => {
    const { service, notesRoot } = await agentInstructionsService();
    await writeFile(path.join(notesRoot, "AGENTS.md"), "agents source\n", "utf8");

    await expect(service.syncFromProviderFile({ scopeId: "exocortex", sourceProviderId: "claude" })).rejects.toThrow("has no instruction content to sync");
    await expect(readFile(path.join(notesRoot, "AGENTS.md"), "utf8")).resolves.toBe("agents source\n");
  });

  it("applies Exograph context to both global provider files", async () => {
    const { service, homeRoot } = await agentInstructionsService();
    await mkdir(path.join(homeRoot, ".codex"), { recursive: true });
    await mkdir(path.join(homeRoot, ".claude"), { recursive: true });
    await writeFile(path.join(homeRoot, ".codex", "AGENTS.md"), "codex rules\n", "utf8");

    const config = await service.applyGlobalExographContext({ body: "exo context" });

    await expect(readFile(path.join(homeRoot, ".codex", "AGENTS.md"), "utf8")).resolves.toContain("codex rules\n\n<!-- exo:exograph-context:start -->\nexo context\n<!-- exo:exograph-context:end -->\n");
    await expect(readFile(path.join(homeRoot, ".claude", "CLAUDE.md"), "utf8")).resolves.toBe("<!-- exo:exograph-context:start -->\nexo context\n<!-- exo:exograph-context:end -->\n");
    expect(config.scopes.find((scope) => scope.id === "global")).toEqual(
      expect.objectContaining({ status: "different" }),
    );
  });

  it("surfaces divergent provider files without choosing a source", async () => {
    const { service, notesRoot } = await agentInstructionsService();
    await writeFile(path.join(notesRoot, "AGENTS.md"), "agents\n", "utf8");
    await writeFile(path.join(notesRoot, "CLAUDE.md"), "claude\n", "utf8");

    const config = await service.getConfig();

    expect(config.scopes.find((scope) => scope.id === "exocortex")).toEqual(
      expect.objectContaining({ status: "different", body: "", source: "unresolved" }),
    );
  });
});

async function agentInstructionsService(overrides: Partial<WorkspaceModel> = {}) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-instructions-"));
  const homeRoot = path.join(workspaceRoot, "home");
  const notesRoot = path.join(workspaceRoot, "notes");
  const projectRoot = path.join(workspaceRoot, "projects", "exo");
  await mkdir(notesRoot, { recursive: true });
  await mkdir(projectRoot, { recursive: true });
  const model: WorkspaceModel = {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: [{ id: "note-root-1", label: "notes", path: notesRoot, kind: "notes" }],
    projectRoots: [{ id: "project-root-1", label: "exo", path: projectRoot, kind: "projects" }],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    attachedWorkcells: [],
    ...overrides,
  };
  return {
    homeRoot,
    notesRoot,
    projectRoot,
    service: new AgentInstructionsService({ getWorkspaceModel: () => model, homePath: homeRoot }),
  };
}
