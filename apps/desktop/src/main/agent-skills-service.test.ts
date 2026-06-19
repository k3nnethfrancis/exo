import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

import type { WorkspaceModel } from "@exo/core";
import { AgentSkillsService } from "./agent-skills-service";

const execFileAsync = promisify(execFile);

describe("AgentSkillsService", () => {
  it("discovers Claude and Codex skill folders across configured scopes", async () => {
    const { service, homeRoot, workspaceRoot, notesRoot } = await agentSkillsService();
    await createSkill(path.join(homeRoot, ".claude", "skills", "global-claude"), "# Global Claude\n");
    await createSkill(path.join(workspaceRoot, ".codex", "skills", "workspace-codex"), "# Workspace Codex\n");
    await createSkill(path.join(notesRoot, ".claude", "skills", "notes-claude"), "# Notes Claude\n");

    const inventory = await service.listInventory();

    expect(inventory.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "global-claude", label: "Global Claude", harness: "claude", scope: "global", enabled: true }),
      expect.objectContaining({ name: "workspace-codex", label: "Workspace Codex", harness: "codex", scope: "workspace", enabled: true }),
      expect.objectContaining({ name: "notes-claude", label: "Notes Claude", harness: "claude", scope: "exocortex", enabled: true }),
    ]));
  });

  it("reads and saves files inside a selected skill folder", async () => {
    const { service, homeRoot } = await agentSkillsService();
    const skillRoot = path.join(homeRoot, ".claude", "skills", "editable");
    await createSkill(skillRoot, "# Editable\n");
    await writeFile(path.join(skillRoot, "references.md"), "old\n", "utf8");
    const skill = (await service.listInventory()).skills.find((candidate) => candidate.name === "editable");

    expect(skill).toBeTruthy();
    await expect(service.readSkillFile(skill!.id, "references.md")).resolves.toEqual(expect.objectContaining({ body: "old\n" }));

    await service.saveSkillFile(skill!.id, "references.md", "new\n");

    await expect(readFile(path.join(skillRoot, "references.md"), "utf8")).resolves.toBe("new\n");
  });

  it("moves disabled skills to an Exo store and restores them to their harness location", async () => {
    const { service, homeRoot } = await agentSkillsService();
    const activePath = path.join(homeRoot, ".claude", "skills", "toggle-me");
    await createSkill(activePath, "# Toggle Me\n");
    const activeSkill = (await service.listInventory()).skills.find((candidate) => candidate.name === "toggle-me");

    expect(activeSkill).toBeTruthy();
    const disabledInventory = await service.setSkillEnabled({ skillId: activeSkill!.id, enabled: false });
    const disabledSkill = disabledInventory.skills.find((candidate) => candidate.name === "toggle-me");

    expect(await exists(activePath)).toBe(false);
    expect(disabledSkill).toEqual(expect.objectContaining({ enabled: false, harness: "claude", scope: "global" }));

    const enabledInventory = await service.setSkillEnabled({ skillId: disabledSkill!.id, enabled: true });
    const restoredSkill = enabledInventory.skills.find((candidate) => candidate.name === "toggle-me");

    expect(await exists(activePath)).toBe(true);
    expect(restoredSkill).toEqual(expect.objectContaining({ enabled: true, harness: "claude", scope: "global" }));
    await expect(readFile(path.join(activePath, "SKILL.md"), "utf8")).resolves.toBe("# Toggle Me\n");
  });

  it("rejects skill file paths that escape the selected skill folder", async () => {
    const { service, homeRoot } = await agentSkillsService();
    await createSkill(path.join(homeRoot, ".codex", "skills", "sandboxed"), "# Sandboxed\n");
    const skill = (await service.listInventory()).skills.find((candidate) => candidate.name === "sandboxed");

    expect(skill).toBeTruthy();
    await expect(service.readSkillFile(skill!.id, "../outside.md")).rejects.toThrow("escapes");
  });

  it("syncs git skill sources into a library and installs copies without overwriting active skills", async () => {
    const { service, homeRoot, workspaceRoot } = await agentSkillsService();
    const sourceRepo = path.join(workspaceRoot, "skill-source");
    await createSkill(path.join(sourceRepo, "skills", "from-library"), "# From Library\n");
    await git(sourceRepo, "init");
    await git(sourceRepo, "config", "user.email", "exo@example.com");
    await git(sourceRepo, "config", "user.name", "Exo Test");
    await git(sourceRepo, "add", ".");
    await git(sourceRepo, "commit", "-m", "init skills");

    const inventory = await service.addSkillSource({ url: sourceRepo, skillsPath: "skills" });
    const librarySkill = inventory.librarySkills.find((skill) => skill.name === "from-library");
    const targetLocation = inventory.locations.find((location) => location.id === "claude:global");

    expect(librarySkill).toEqual(expect.objectContaining({ label: "From Library", sourceLabel: "skill-source" }));
    expect(targetLocation).toBeTruthy();

    const installedInventory = await service.installLibrarySkill({
      librarySkillId: librarySkill!.id,
      locationId: targetLocation!.id,
    });

    await expect(readFile(path.join(homeRoot, ".claude", "skills", "from-library", "SKILL.md"), "utf8")).resolves.toBe("# From Library\n");
    expect(installedInventory.skills).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "from-library", harness: "claude", scope: "global", enabled: true }),
    ]));
    await expect(service.installLibrarySkill({ librarySkillId: librarySkill!.id, locationId: targetLocation!.id })).rejects.toThrow("already exists");
  });
});

async function agentSkillsService() {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-agent-skills-"));
  const homeRoot = path.join(workspaceRoot, "home");
  const notesRoot = path.join(workspaceRoot, "notes");
  const disabledRootPath = path.join(workspaceRoot, "user-data", "disabled-skills");
  const skillSourcesRootPath = path.join(workspaceRoot, "user-data", "skill-sources");
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
    disabledRootPath,
    homeRoot,
    notesRoot,
    service: new AgentSkillsService({ disabledRootPath, getWorkspaceModel: () => model, homePath: homeRoot, skillSourcesRootPath }),
    skillSourcesRootPath,
    workspaceRoot,
  };
}

async function createSkill(rootPath: string, body: string): Promise<void> {
  await mkdir(rootPath, { recursive: true });
  await writeFile(path.join(rootPath, "SKILL.md"), body, "utf8");
}

async function exists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function git(cwd: string, ...args: string[]): Promise<void> {
  await mkdir(cwd, { recursive: true });
  await execFileAsync("git", args, { cwd });
}
