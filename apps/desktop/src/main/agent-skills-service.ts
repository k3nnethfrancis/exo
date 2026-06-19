import path from "node:path";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";

import type {
  AgentSkillFile,
  AgentSkillFileContent,
  AgentSkillHarnessId,
  AgentSkillInventory,
  AgentSkillLocation,
  AgentSkillScope,
  AgentSkillSummary,
} from "../shared/api";
import type { WorkspaceModel } from "@exo/core";

export interface AgentSkillsServiceOptions {
  disabledRootPath: string;
  getWorkspaceModel: () => WorkspaceModel;
  homePath: string;
}

interface SkillLocationCandidate extends AgentSkillLocation {
  disabledPath: string;
}

interface DisabledSkillMetadata {
  harness: AgentSkillHarnessId;
  scope: AgentSkillScope;
  activeRootPath: string;
}

const METADATA_FILE = ".exo-skill-location.json";
const ENTRY_FILE = "SKILL.md";

export class AgentSkillsService {
  constructor(private readonly options: AgentSkillsServiceOptions) {}

  async listInventory(): Promise<AgentSkillInventory> {
    const activeLocations = this.skillLocations();
    const skills: AgentSkillSummary[] = [];

    for (const location of activeLocations) {
      skills.push(...await this.listActiveSkills(location));
      skills.push(...await this.listDisabledSkills(location));
    }

    return {
      skills: skills.sort(compareSkills),
      locations: activeLocations.flatMap((location) => [
        location,
        {
          ...location,
          id: `${location.id}:disabled`,
          label: `${location.label} disabled store`,
          path: location.disabledPath,
          enabled: false,
        },
      ]),
    };
  }

  async readSkillFile(skillId: string, relativePath: string): Promise<AgentSkillFileContent> {
    const skill = await this.findSkill(skillId);
    const filePath = resolveContainedPath(skill.rootPath, relativePath);
    const info = await stat(filePath);
    if (!info.isFile()) {
      throw new Error("Selected skill path is not a file.");
    }

    return {
      skillId,
      relativePath: normalizeRelativePath(relativePath),
      path: filePath,
      body: await readFile(filePath, "utf8"),
    };
  }

  async saveSkillFile(skillId: string, relativePath: string, body: string): Promise<AgentSkillFileContent> {
    const skill = await this.findSkill(skillId);
    const filePath = resolveContainedPath(skill.rootPath, relativePath);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body, "utf8");
    return {
      skillId,
      relativePath: normalizeRelativePath(relativePath),
      path: filePath,
      body,
    };
  }

  async setSkillEnabled(input: { skillId: string; enabled: boolean }): Promise<AgentSkillInventory> {
    const skill = await this.findSkill(input.skillId);
    if (skill.enabled === input.enabled) {
      return this.listInventory();
    }

    if (input.enabled) {
      await this.enableSkill(skill);
    } else {
      await this.disableSkill(skill);
    }

    return this.listInventory();
  }

  private async findSkill(skillId: string): Promise<AgentSkillSummary> {
    const inventory = await this.listInventory();
    const skill = inventory.skills.find((candidate) => candidate.id === skillId);
    if (!skill) {
      throw new Error("Agent skill not found.");
    }
    return skill;
  }

  private async listActiveSkills(location: SkillLocationCandidate): Promise<AgentSkillSummary[]> {
    const skillDirectories = await listDirectoryEntries(location.path);
    const skills: AgentSkillSummary[] = [];

    for (const entry of skillDirectories) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const rootPath = path.join(location.path, entry.name);
      skills.push(await this.skillSummary(rootPath, location, true));
    }

    return skills;
  }

  private async listDisabledSkills(location: SkillLocationCandidate): Promise<AgentSkillSummary[]> {
    const skillDirectories = await listDirectoryEntries(location.disabledPath);
    const skills: AgentSkillSummary[] = [];

    for (const entry of skillDirectories) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const rootPath = path.join(location.disabledPath, entry.name);
      skills.push(await this.skillSummary(rootPath, location, false));
    }

    return skills;
  }

  private async skillSummary(rootPath: string, location: SkillLocationCandidate, enabled: boolean): Promise<AgentSkillSummary> {
    const name = path.basename(rootPath);
    const entryFilePath = path.join(rootPath, ENTRY_FILE);
    const label = await readSkillLabel(entryFilePath, name);
    return {
      id: skillIdForPath(rootPath),
      name,
      label,
      harness: location.harness,
      scope: location.scope,
      enabled,
      rootPath,
      locationId: enabled ? location.id : `${location.id}:disabled`,
      locationLabel: enabled ? location.label : `${location.label} disabled`,
      files: await listSkillFiles(rootPath),
      entryFilePath: await fileExists(entryFilePath) ? entryFilePath : null,
    };
  }

  private async disableSkill(skill: AgentSkillSummary): Promise<void> {
    const location = this.skillLocations().find((candidate) => candidate.id === skill.locationId);
    if (!location) {
      throw new Error("Cannot disable skill because its active location is no longer available.");
    }
    const destination = path.join(location.disabledPath, skill.name);
    if (await fileExists(destination)) {
      throw new Error("A disabled copy of this skill already exists.");
    }
    await mkdir(path.dirname(destination), { recursive: true });
    await moveDirectory(skill.rootPath, destination);
    await writeFile(
      path.join(destination, METADATA_FILE),
      JSON.stringify({ harness: skill.harness, scope: skill.scope, activeRootPath: location.path } satisfies DisabledSkillMetadata, null, 2),
      "utf8",
    );
  }

  private async enableSkill(skill: AgentSkillSummary): Promise<void> {
    const metadata = await readDisabledSkillMetadata(skill.rootPath);
    const targetRootPath = path.join(metadata?.activeRootPath ?? this.resolveActiveRootPath(skill), skill.name);
    if (await fileExists(targetRootPath)) {
      throw new Error("An enabled skill with this name already exists.");
    }
    await mkdir(path.dirname(targetRootPath), { recursive: true });
    await rm(path.join(skill.rootPath, METADATA_FILE), { force: true });
    await moveDirectory(skill.rootPath, targetRootPath);
  }

  private resolveActiveRootPath(skill: AgentSkillSummary): string {
    const location = this.skillLocations().find((candidate) => candidate.harness === skill.harness && candidate.scope === skill.scope);
    if (!location) {
      throw new Error("Cannot re-enable skill because its harness location is no longer available.");
    }
    return location.path;
  }

  private skillLocations(): SkillLocationCandidate[] {
    const workspaceModel = this.options.getWorkspaceModel();
    const notesRoot = workspaceModel.noteRoots[0]?.path ?? workspaceModel.workspaceRoot;
    const candidates: Array<Omit<SkillLocationCandidate, "disabledPath">> = [
      {
        id: "claude:global",
        harness: "claude",
        scope: "global",
        label: "Claude global",
        path: path.join(this.options.homePath, ".claude", "skills"),
        enabled: true,
      },
      {
        id: "claude:workspace",
        harness: "claude",
        scope: "workspace",
        label: "Claude workspace",
        path: path.join(workspaceModel.workspaceRoot, ".claude", "skills"),
        enabled: true,
      },
      {
        id: "claude:exocortex",
        harness: "claude",
        scope: "exocortex",
        label: "Claude notes",
        path: path.join(notesRoot, ".claude", "skills"),
        enabled: true,
      },
      {
        id: "codex:global",
        harness: "codex",
        scope: "global",
        label: "Codex global",
        path: path.join(this.options.homePath, ".codex", "skills"),
        enabled: true,
      },
      {
        id: "codex:workspace",
        harness: "codex",
        scope: "workspace",
        label: "Codex workspace",
        path: path.join(workspaceModel.workspaceRoot, ".codex", "skills"),
        enabled: true,
      },
      {
        id: "codex:exocortex",
        harness: "codex",
        scope: "exocortex",
        label: "Codex notes",
        path: path.join(notesRoot, ".codex", "skills"),
        enabled: true,
      },
    ];

    return candidates.map((candidate) => ({
      ...candidate,
      disabledPath: path.join(this.options.disabledRootPath, candidate.harness, candidate.scope),
    }));
  }
}

async function listDirectoryEntries(rootPath: string) {
  try {
    return await readdir(rootPath, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function listSkillFiles(rootPath: string, relativeRoot = ""): Promise<AgentSkillFile[]> {
  const entries = await listDirectoryEntries(path.join(rootPath, relativeRoot));
  const files: AgentSkillFile[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === METADATA_FILE) {
      continue;
    }
    const relativePath = normalizeRelativePath(path.join(relativeRoot, entry.name));
    const absolutePath = path.join(rootPath, relativePath);
    if (entry.isDirectory()) {
      files.push({
        relativePath,
        path: absolutePath,
        kind: "directory",
        children: await listSkillFiles(rootPath, relativePath),
      });
    } else if (entry.isFile()) {
      files.push({
        relativePath,
        path: absolutePath,
        kind: "file",
      });
    }
  }

  return files;
}

async function readSkillLabel(entryFilePath: string, fallback: string): Promise<string> {
  try {
    const body = await readFile(entryFilePath, "utf8");
    const heading = body.split(/\r?\n/).find((line) => line.startsWith("# "));
    return heading ? heading.replace(/^#\s+/, "").trim() || fallback : fallback;
  } catch {
    return fallback;
  }
}

async function readDisabledSkillMetadata(rootPath: string): Promise<DisabledSkillMetadata | null> {
  try {
    const raw = await readFile(path.join(rootPath, METADATA_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<DisabledSkillMetadata>;
    if (
      (parsed.harness === "claude" || parsed.harness === "codex") &&
      (parsed.scope === "global" || parsed.scope === "workspace" || parsed.scope === "exocortex") &&
      typeof parsed.activeRootPath === "string"
    ) {
      return parsed as DisabledSkillMetadata;
    }
  } catch {
    return null;
  }
  return null;
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function moveDirectory(sourcePath: string, destinationPath: string): Promise<void> {
  try {
    await rename(sourcePath, destinationPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") {
      throw error;
    }
    await cp(sourcePath, destinationPath, { recursive: true, errorOnExist: true });
    await rm(sourcePath, { recursive: true, force: true });
  }
}

function resolveContainedPath(rootPath: string, relativePath: string): string {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const resolved = path.resolve(rootPath, normalizedRelativePath);
  const root = path.resolve(rootPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Skill file path escapes the selected skill folder.");
  }
  return resolved;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.split(/[\\/]+/).filter(Boolean).join(path.sep);
}

function skillIdForPath(rootPath: string): string {
  return Buffer.from(path.resolve(rootPath), "utf8").toString("base64url");
}

function compareSkills(a: AgentSkillSummary, b: AgentSkillSummary): number {
  return `${a.harness}:${a.scope}:${a.name}:${a.enabled ? "0" : "1"}`.localeCompare(
    `${b.harness}:${b.scope}:${b.name}:${b.enabled ? "0" : "1"}`,
  );
}
