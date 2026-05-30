import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { WorkspaceModel } from "@exo/core";
import { AgentInstructionsService, normalizeInstructionFileBody, resolveInstructionStatus } from "./agent-instructions-service";

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

  it("saves a selected scope to both provider files", async () => {
    const { service, notesRoot } = await agentInstructionsService();

    const config = await service.saveConfig({ scopeId: "exocortex", body: "shared instructions\n\n" });

    await expect(readFile(path.join(notesRoot, "AGENTS.md"), "utf8")).resolves.toBe("shared instructions\n");
    await expect(readFile(path.join(notesRoot, "CLAUDE.md"), "utf8")).resolves.toBe("shared instructions\n");
    expect(config.scopes.find((scope) => scope.id === "exocortex")).toEqual(
      expect.objectContaining({ status: "aligned", body: "shared instructions\n" }),
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

async function agentInstructionsService() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-instructions-"));
  const homeRoot = path.join(workspaceRoot, "home");
  const notesRoot = path.join(workspaceRoot, "notes");
  await mkdir(notesRoot, { recursive: true });
  const model: WorkspaceModel = {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: [{ id: "note-root-1", label: "notes", path: notesRoot, kind: "notes" }],
    projectRoots: [],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    attachedWorkcells: [],
  };
  return {
    homeRoot,
    notesRoot,
    service: new AgentInstructionsService({ getWorkspaceModel: () => model, homePath: homeRoot }),
  };
}
