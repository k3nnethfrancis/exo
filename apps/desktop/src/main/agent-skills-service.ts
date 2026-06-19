import path from "node:path";
import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";

import type {
  AgentLibrarySkill,
  AgentSkillFile,
  AgentSkillFileContent,
  AgentSkillHarnessId,
  AgentSkillInventory,
  AgentSkillLocation,
  AgentSkillScope,
  AgentSkillSource,
  AgentSkillSummary,
} from "../shared/api";
import type { WorkspaceModel } from "@exo/core";

export interface AgentSkillsServiceOptions {
  disabledRootPath: string;
  getWorkspaceModel: () => WorkspaceModel;
  homePath: string;
  skillSourcesRootPath: string;
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
const SOURCE_REGISTRY_FILE = "sources.json";
const execFileAsync = promisify(execFile);

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
      sources: await this.listSources(),
      librarySkills: await this.listLibrarySkills(),
    };
  }

  async addSkillSource(input: { url: string; skillsPath?: string; label?: string }): Promise<AgentSkillInventory> {
    const url = input.url.trim();
    if (!url) {
      throw new Error("Skill source URL is required.");
    }
    const skillsPath = normalizeRelativePath(input.skillsPath?.trim() || "skills");
    const sources = await this.readSourceRegistry();
    const existing = sources.find((source) => source.url === url && source.skillsPath === skillsPath);
    const source = existing ?? {
      id: sourceIdFor(url, skillsPath),
      label: input.label?.trim() || sourceLabelFor(url),
      url,
      skillsPath,
      localPath: this.sourceLocalPath(sourceIdFor(url, skillsPath)),
      status: "idle" as const,
      lastSyncedAt: null,
      lastErrorMessage: null,
    };
    const nextSources = existing
      ? sources.map((candidate) => candidate.id === existing.id ? { ...candidate, label: input.label?.trim() || candidate.label } : candidate)
      : [...sources, source];
    await this.writeSourceRegistry(nextSources);
    await this.syncSkillSource(source.id);
    return this.listInventory();
  }

  async syncSkillSource(sourceId: string): Promise<AgentSkillInventory> {
    const sources = await this.readSourceRegistry();
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (!source) {
      throw new Error("Skill source not found.");
    }

    await this.writeSourceRegistry(sources.map((candidate) =>
      candidate.id === source.id ? { ...candidate, status: "syncing", lastErrorMessage: null } : candidate,
    ));

    try {
      await this.syncGitRepository(source);
      await this.writeSourceRegistry((await this.readSourceRegistry()).map((candidate) =>
        candidate.id === source.id
          ? { ...candidate, status: "idle", lastSyncedAt: new Date().toISOString(), lastErrorMessage: null }
          : candidate,
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.writeSourceRegistry((await this.readSourceRegistry()).map((candidate) =>
        candidate.id === source.id ? { ...candidate, status: "error", lastErrorMessage: message } : candidate,
      ));
      throw new Error(`Failed to sync skill source: ${message}`);
    }

    return this.listInventory();
  }

  async installLibrarySkill(input: { librarySkillId: string; locationId: string; targetName?: string }): Promise<AgentSkillInventory> {
    const librarySkill = (await this.listLibrarySkills()).find((skill) => skill.id === input.librarySkillId);
    if (!librarySkill) {
      throw new Error("Library skill not found.");
    }
    const location = this.skillLocations().find((candidate) => candidate.id === input.locationId);
    if (!location) {
      throw new Error("Target skill location not found.");
    }
    const targetName = sanitizeSkillFolderName(input.targetName?.trim() || librarySkill.name);
    const targetPath = path.join(location.path, targetName);
    if (await fileExists(targetPath)) {
      throw new Error(`A skill named ${targetName} already exists in ${location.label}.`);
    }
    await mkdir(location.path, { recursive: true });
    await cp(librarySkill.rootPath, targetPath, { recursive: true, errorOnExist: true });
    return this.listInventory();
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

  private async listLibrarySkills(): Promise<AgentLibrarySkill[]> {
    const sources = await this.listSources();
    const skills: AgentLibrarySkill[] = [];

    for (const source of sources) {
      const sourceSkillsRoot = path.join(source.localPath, source.skillsPath);
      const skillDirectories = await listDirectoryEntries(sourceSkillsRoot);
      for (const entry of skillDirectories) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) {
          continue;
        }
        const rootPath = path.join(sourceSkillsRoot, entry.name);
        const entryFilePath = path.join(rootPath, ENTRY_FILE);
        skills.push({
          id: `library:${source.id}:${entry.name}`,
          sourceId: source.id,
          sourceLabel: source.label,
          name: entry.name,
          label: await readSkillLabel(entryFilePath, entry.name),
          rootPath,
          files: await listSkillFiles(rootPath),
          entryFilePath: await fileExists(entryFilePath) ? entryFilePath : null,
        });
      }
    }

    return skills.sort((a, b) => `${a.sourceLabel}:${a.name}`.localeCompare(`${b.sourceLabel}:${b.name}`));
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

  private async listSources(): Promise<AgentSkillSource[]> {
    return this.readSourceRegistry();
  }

  private async readSourceRegistry(): Promise<AgentSkillSource[]> {
    try {
      const raw = await readFile(this.sourceRegistryPath(), "utf8");
      const parsed = JSON.parse(raw) as AgentSkillSource[];
      return parsed.map((source) => ({
        ...source,
        localPath: source.localPath || this.sourceLocalPath(source.id),
      }));
    } catch {
      return [];
    }
  }

  private async writeSourceRegistry(sources: AgentSkillSource[]): Promise<void> {
    await mkdir(this.options.skillSourcesRootPath, { recursive: true });
    await writeFile(this.sourceRegistryPath(), JSON.stringify(sources, null, 2), "utf8");
  }

  private async syncGitRepository(source: AgentSkillSource): Promise<void> {
    await mkdir(path.dirname(source.localPath), { recursive: true });
    if (await fileExists(path.join(source.localPath, ".git"))) {
      await execFileAsync("git", ["-C", source.localPath, "pull", "--ff-only"], { timeout: 60_000 });
      return;
    }
    if (await fileExists(source.localPath)) {
      throw new Error(`Source cache exists but is not a git repository: ${source.localPath}`);
    }
    await execFileAsync("git", ["clone", "--depth", "1", source.url, source.localPath], { timeout: 120_000 });
  }

  private sourceRegistryPath(): string {
    return path.join(this.options.skillSourcesRootPath, SOURCE_REGISTRY_FILE);
  }

  private sourceLocalPath(sourceId: string): string {
    return path.join(this.options.skillSourcesRootPath, "repos", sourceId);
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

function sanitizeSkillFolderName(name: string): string {
  const sanitized = name.replace(/[\\/]/g, "-").trim();
  if (!sanitized || sanitized === "." || sanitized === "..") {
    throw new Error("Skill folder name is invalid.");
  }
  return sanitized;
}

function skillIdForPath(rootPath: string): string {
  return Buffer.from(path.resolve(rootPath), "utf8").toString("base64url");
}

function sourceIdFor(url: string, skillsPath: string): string {
  return Buffer.from(`${url}\0${skillsPath}`, "utf8").toString("base64url").replace(/=+$/g, "").slice(0, 48);
}

function sourceLabelFor(url: string): string {
  const withoutGitSuffix = url.replace(/\.git$/i, "");
  return path.basename(withoutGitSuffix) || url;
}

function compareSkills(a: AgentSkillSummary, b: AgentSkillSummary): number {
  return `${a.harness}:${a.scope}:${a.name}:${a.enabled ? "0" : "1"}`.localeCompare(
    `${b.harness}:${b.scope}:${b.name}:${b.enabled ? "0" : "1"}`,
  );
}
