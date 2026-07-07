import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { WorkspaceModel } from "@exo/core";
import type {
  AgentInstructionConfig,
  AgentInstructionProviderFile,
  AgentInstructionScope,
  AgentInstructionScopeId,
  AgentInstructionStatus,
} from "../shared/api";
import { writeAgentInstructionOverlays } from "./agent-instruction-overlays";

export interface AgentInstructionsServiceOptions {
  getWorkspaceModel: () => WorkspaceModel;
  homePath?: string;
  errorMessage?: (error: unknown) => string;
}

interface AgentInstructionScopeCandidate {
  id: AgentInstructionScopeId;
  label: string;
  description: string;
  rootPath: string;
  files: {
    agents: { id: "agents"; label: string; path: string };
    claude: { id: "claude"; label: string; path: string };
  };
}

export class AgentInstructionsService {
  private readonly homePath: string;
  private readonly errorMessage: (error: unknown) => string;

  constructor(private readonly options: AgentInstructionsServiceOptions) {
    this.homePath = options.homePath ?? os.homedir();
    this.errorMessage = options.errorMessage ?? ((error) => error instanceof Error ? error.message : String(error));
  }

  listOverlays() {
    return writeAgentInstructionOverlays(this.options.getWorkspaceModel());
  }

  async getConfig(): Promise<AgentInstructionConfig> {
    const workspaceModel = this.options.getWorkspaceModel();
    return {
      scopes: await Promise.all(this.scopeCandidates().map((scope) => this.readScope(scope))),
      starterTemplate: exoAgentInstructionStarterTemplate(workspaceModel),
      exographContextTemplate: exographAgentContextTemplate(workspaceModel),
    };
  }

  async saveConfig(input: { scopeId: AgentInstructionScopeId; body: string }): Promise<AgentInstructionConfig> {
    const scope = this.scopeCandidates().find((candidate) => candidate.id === input.scopeId);
    if (!scope) {
      throw new Error("Agent instruction scope is unavailable for the active workspace.");
    }
    await Promise.all(Object.values(scope.files).map(async (file) => {
      await mkdir(path.dirname(file.path), { recursive: true });
      await writeFile(file.path, normalizeInstructionFileBody(input.body), "utf8");
    }));
    return this.getConfig();
  }

  async applyGlobalExographContext(input: { body: string }): Promise<AgentInstructionConfig> {
    const scope = this.scopeCandidates().find((candidate) => candidate.id === "global");
    if (!scope) {
      throw new Error("Global agent instruction scope is unavailable.");
    }
    await Promise.all(Object.values(scope.files).map(async (file) => {
      const existing = await readFile(file.path, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return "";
        }
        throw error;
      });
      await mkdir(path.dirname(file.path), { recursive: true });
      await writeFile(file.path, upsertExographContextBlock(existing, input.body), "utf8");
    }));
    return this.getConfig();
  }


  private scopeCandidates(): AgentInstructionScopeCandidate[] {
    const notesRoot = this.options.getWorkspaceModel().noteRoots[0];
    return [
      {
        id: "global",
        label: "Global",
        description: "Personal instructions loaded by supported terminal agents across workspaces.",
        rootPath: this.homePath,
        files: {
          agents: {
            id: "agents",
            label: "Codex AGENTS.md",
            path: path.join(this.homePath, ".codex", "AGENTS.md"),
          },
          claude: {
            id: "claude",
            label: "Claude CLAUDE.md",
            path: path.join(this.homePath, ".claude", "CLAUDE.md"),
          },
        },
      },
      ...(notesRoot ? [{
        id: "exocortex" as const,
        label: "Exocortex",
        description: "Instructions stored in the active notes folder for agents working with your Exo context.",
        rootPath: notesRoot.path,
        files: {
          agents: {
            id: "agents" as const,
            label: "Notes AGENTS.md",
            path: path.join(notesRoot.path, "AGENTS.md"),
          },
          claude: {
            id: "claude" as const,
            label: "Notes CLAUDE.md",
            path: path.join(notesRoot.path, "CLAUDE.md"),
          },
        },
      }] : []),
    ];
  }

  private async readScope(scope: AgentInstructionScopeCandidate): Promise<AgentInstructionScope> {
    const [agents, claude] = await Promise.all([
      this.readProviderFile(scope.files.agents),
      this.readProviderFile(scope.files.claude),
    ]);
    const errorMessages = [agents, claude].flatMap((file) => file.errorMessage ? [`${file.label}: ${file.errorMessage}`] : []);
    const agentsHasBody = agents.body.trim().length > 0;
    const claudeHasBody = claude.body.trim().length > 0;
    const bodiesMatch = normalizeInstructionComparisonBody(agents.body) === normalizeInstructionComparisonBody(claude.body);
    const status = resolveInstructionStatus({
      agentsExists: agents.exists,
      claudeExists: claude.exists,
      bodiesMatch,
      hasErrors: errorMessages.length > 0,
    });
    const source = status === "different" || status === "error"
      ? "unresolved"
      : agentsHasBody
        ? "agents"
        : claudeHasBody
          ? "claude"
          : "empty";
    const body = source === "agents" ? agents.body : source === "claude" ? claude.body : "";
    return {
      id: scope.id,
      label: scope.label,
      description: scope.description,
      rootPath: scope.rootPath,
      files: { agents, claude },
      status,
      body,
      source,
      errorMessages,
    };
  }

  private async readProviderFile(file: AgentInstructionScopeCandidate["files"]["agents"] | AgentInstructionScopeCandidate["files"]["claude"]): Promise<AgentInstructionProviderFile> {
    try {
      const body = await readFile(file.path, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
          return "";
        }
        throw error;
      });
      return {
        ...file,
        exists: body.length > 0 || existsSync(file.path),
        body,
        errorMessage: null,
      };
    } catch (error) {
      return {
        ...file,
        exists: existsSync(file.path),
        body: "",
        errorMessage: this.errorMessage(error),
      };
    }
  }
}

export function resolveInstructionStatus(input: {
  agentsExists: boolean;
  claudeExists: boolean;
  bodiesMatch: boolean;
  hasErrors: boolean;
}): AgentInstructionStatus {
  if (input.hasErrors) {
    return "error";
  }
  if (!input.agentsExists && !input.claudeExists) {
    return "missing-both";
  }
  if (input.agentsExists && !input.claudeExists) {
    return "missing-claude";
  }
  if (!input.agentsExists && input.claudeExists) {
    return "missing-agents";
  }
  return input.bodiesMatch ? "aligned" : "different";
}

export function normalizeInstructionFileBody(body: string) {
  return `${body.trimEnd()}\n`;
}

const EXOGRAPH_CONTEXT_START = "<!-- exo:exograph-context:start -->";
const EXOGRAPH_CONTEXT_END = "<!-- exo:exograph-context:end -->";

export function upsertExographContextBlock(existingBody: string, contextBody: string): string {
  const block = [
    EXOGRAPH_CONTEXT_START,
    normalizeInstructionFileBody(contextBody).trimEnd(),
    EXOGRAPH_CONTEXT_END,
  ].join("\n");
  const normalizedExisting = existingBody.replace(/\r\n/g, "\n").trimEnd();
  const markerPattern = new RegExp(
    `${escapeRegExp(EXOGRAPH_CONTEXT_START)}[\\s\\S]*?${escapeRegExp(EXOGRAPH_CONTEXT_END)}`,
    "m",
  );
  if (markerPattern.test(normalizedExisting)) {
    return normalizeInstructionFileBody(normalizedExisting.replace(markerPattern, block));
  }
  if (!normalizedExisting) {
    return normalizeInstructionFileBody(block);
  }
  return normalizeInstructionFileBody(`${normalizedExisting}\n\n${block}`);
}

function normalizeInstructionComparisonBody(body: string) {
  return body.replace(/\r\n/g, "\n").trimEnd();
}

function exoAgentInstructionStarterTemplate(workspaceModel: WorkspaceModel) {
  return [
    "# Exo Agent Instructions",
    "",
    "- Exo is the local workspace app for navigating the user's notes, projects, terminals, and indexed context.",
    `- Active workspace root: ${workspaceModel.workspaceRoot}`,
    `- Active notes roots: ${formatInlineRootList(workspaceModel.noteRoots)}`,
    "- Use Exo MCP, Exo CLI, filesystem tools, and normal shell tools according to the task. Exact code/string/path work is often best with filesystem search; concept or meaning-oriented note retrieval may be better with Exo search when indexing is enabled.",
    "- Treat notes as user-authored working context. Preserve organization, links, and private drafts unless asked to change them.",
    "- Prefer explicit attached roots over broad home-directory searches.",
  ].join("\n");
}

function exographAgentContextTemplate(workspaceModel: WorkspaceModel) {
  return [
    "## Exograph Context",
    "",
    "- Exo is the local-first Markdown graph workstation for notes, projects, terminals, agent harnesses, plugins, and indexed context.",
    "- Exo augments normal filesystem access rather than replacing it. Use `rg`, file reads, and shell tools for exact code/path/string work; use Exo search/read surfaces when workspace orientation, notes retrieval, backlinks, or semantic/lexical graph context would be more useful.",
    "- Keep agent guidance provider-agnostic. Avoid Claude-only, Codex-only, or harness-specific assumptions unless a task asks for them.",
    "- Treat Exo friction as product signal: if an Exo tool is missing, confusing, slow, or less useful than raw filesystem access, record an issue in the Exo project issue tracker.",
    "",
    "### Active Workspace",
    "",
    `- Workspace root: ${workspaceModel.workspaceRoot}`,
    `- Default terminal cwd: ${workspaceModel.defaultTerminalCwd}`,
    "",
    "### Notes Roots",
    "",
    ...formatRootList(workspaceModel.noteRoots),
    "",
    "### Project Roots",
    "",
    ...formatRootList(workspaceModel.projectRoots),
    "",
    "### Search Capabilities",
    "",
    ...formatSearchGuidance(workspaceModel),
    "",
    "### Exo MCP and CLI Surfaces",
    "",
    "- Exo MCP is the narrow agent work surface: workspace status/orientation, search/read, and live agent session control.",
    "- Exo CLI is the broader operator surface: workspace setup, indexing, project roots, diagnostics, terminals, agents, and MCP/integration helpers when installed.",
    "- If a requested Exo capability is not exposed through MCP, use the CLI or filesystem when available, and record the MCP gap as product feedback.",
  ].join("\n");
}

function formatInlineRootList(roots: Array<{ label: string; path: string }>) {
  return roots.length > 0
    ? roots.map((root) => `${root.label} (${root.path})`).join(", ")
    : "none attached";
}

function formatRootList(roots: Array<{ label: string; path: string }>) {
  return roots.length > 0
    ? roots.map((root) => `- ${root.label}: ${root.path}`)
    : ["- None attached."];
}

function formatSearchGuidance(workspaceModel: WorkspaceModel) {
  const { indexing } = workspaceModel;
  if (!indexing.enabled || indexing.mode === "off") {
    return [
      "- Core filesystem and text search are available.",
      "- Indexed Exo search is currently off. Prefer filesystem search unless a task asks to enable or configure indexing.",
    ];
  }

  const modeGuidance = {
    lexical: "lexical search is best for exact names, tags, headings, filenames, and phrases.",
    semantic: "semantic search is best for concept, meaning, and fuzzy recall across notes.",
    hybrid: "hybrid search combines lexical and semantic retrieval; use it for most exploratory note questions.",
    off: "indexed search is currently off.",
  }[indexing.mode];

  return [
    `- Indexed Exo search is enabled through ${indexing.backend.toUpperCase()} in ${indexing.mode} mode: ${modeGuidance}`,
    "- Use filesystem search for exact code or path questions; use indexed Exo search for graph/context questions where meaning matters.",
  ];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
