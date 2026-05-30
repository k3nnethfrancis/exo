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
    return {
      scopes: await Promise.all(this.scopeCandidates().map((scope) => this.readScope(scope))),
      starterTemplate: exoAgentInstructionStarterTemplate(),
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

function normalizeInstructionComparisonBody(body: string) {
  return body.replace(/\r\n/g, "\n").trimEnd();
}

function exoAgentInstructionStarterTemplate() {
  return [
    "# Exo Agent Instructions",
    "",
    "- Exo is the local workspace app for navigating the user's notes, projects, terminals, and indexed context.",
    "- Use Exo MCP or CLI tools to inspect attached project roots and indexed notes before guessing where context lives.",
    "- Treat notes as user-authored working context. Preserve organization, links, and private drafts unless asked to change them.",
    "- Prefer explicit attached roots over broad filesystem searches.",
  ].join("\n");
}
