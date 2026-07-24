import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import { agentCommandExecutableFingerprint, type AgentCommand } from "./agent-invocation";

export interface TrustedAgentCommand {
  workspaceRoot: string;
  commandId: string;
  handle: string;
  executableFingerprint: string;
  trustedAt: string;
}

export interface AgentCommandTrustStoreData {
  trustedCommands: TrustedAgentCommand[];
}

export interface AgentCommandTrustStatus {
  trusted: boolean;
  executableFingerprint: string;
  trustedCommand?: TrustedAgentCommand;
}

export function resolveAgentCommandTrustStorePath(appStateRoot: string): string {
  return path.join(appStateRoot, "agent-command-trust.json");
}

export class AgentCommandTrustStore {
  constructor(
    private readonly appStateRoot: string,
    private readonly workspaceRoot: string,
  ) {}

  async status(command: AgentCommand, executableFingerprint = agentCommandExecutableFingerprint(command)): Promise<AgentCommandTrustStatus> {
    const data = await this.read();
    const trustedCommand = data.trustedCommands.find(
      (entry) =>
        entry.workspaceRoot === this.workspaceRoot &&
        entry.commandId === command.id &&
        entry.handle === command.handle &&
        entry.executableFingerprint === executableFingerprint,
    );
    return {
      trusted: Boolean(trustedCommand),
      executableFingerprint,
      ...(trustedCommand ? { trustedCommand } : {}),
    };
  }

  async trust(
    command: AgentCommand,
    trustedAt = new Date().toISOString(),
    executableFingerprint = agentCommandExecutableFingerprint(command),
  ): Promise<TrustedAgentCommand> {
    const data = await this.read();
    const trustedCommand: TrustedAgentCommand = {
      workspaceRoot: this.workspaceRoot,
      commandId: command.id,
      handle: command.handle,
      executableFingerprint,
      trustedAt,
    };
    const trustedCommands = data.trustedCommands.filter(
      (entry) => !(entry.workspaceRoot === this.workspaceRoot && entry.commandId === command.id && entry.handle === command.handle),
    );
    trustedCommands.push(trustedCommand);
    await this.write({ trustedCommands: trustedCommands.sort(compareTrustedCommands) });
    return trustedCommand;
  }

  async revoke(command: Pick<AgentCommand, "id" | "handle">): Promise<boolean> {
    const data = await this.read();
    const trustedCommands = data.trustedCommands.filter(
      (entry) => !(entry.workspaceRoot === this.workspaceRoot && entry.commandId === command.id && entry.handle === command.handle),
    );
    if (trustedCommands.length === data.trustedCommands.length) {
      return false;
    }
    await this.write({ trustedCommands });
    return true;
  }

  private async read(): Promise<AgentCommandTrustStoreData> {
    try {
      return normalizeTrustStoreData(JSON.parse(await readFile(resolveAgentCommandTrustStorePath(this.appStateRoot), "utf8")));
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return { trustedCommands: [] };
      }
      throw error;
    }
  }

  private async write(data: AgentCommandTrustStoreData): Promise<void> {
    const target = resolveAgentCommandTrustStorePath(this.appStateRoot);
    await mkdir(path.dirname(target), { recursive: true });
    const temporaryPath = path.join(path.dirname(target), `.agent-command-trust-${process.pid}-${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, `${JSON.stringify(normalizeTrustStoreData(data), null, 2)}\n`, "utf8");
      await rename(temporaryPath, target);
    } catch (error) {
      await rm(temporaryPath, { force: true });
      throw error;
    }
  }
}

function normalizeTrustStoreData(input: unknown): AgentCommandTrustStoreData {
  if (!input || typeof input !== "object" || !Array.isArray((input as Partial<AgentCommandTrustStoreData>).trustedCommands)) {
    return { trustedCommands: [] };
  }
  const trustedCommands = (input as Partial<AgentCommandTrustStoreData>).trustedCommands?.reduce<TrustedAgentCommand[]>((entries, entry) => {
    if (!entry || typeof entry !== "object") {
      return entries;
    }
    const candidate = entry as Partial<TrustedAgentCommand>;
    const commandId = normalizeRequiredString(candidate.commandId);
    const workspaceRoot = normalizeRequiredString(candidate.workspaceRoot);
    const handle = normalizeRequiredString(candidate.handle);
    const executableFingerprint = normalizeRequiredString(candidate.executableFingerprint);
    const trustedAt = normalizeRequiredString(candidate.trustedAt);
    if (!workspaceRoot || !commandId || !handle || !executableFingerprint || !trustedAt) {
      return entries;
    }
    entries.push({ workspaceRoot, commandId, handle, executableFingerprint, trustedAt });
    return entries;
  }, []) ?? [];
  return { trustedCommands: trustedCommands.sort(compareTrustedCommands) };
}

function compareTrustedCommands(left: TrustedAgentCommand, right: TrustedAgentCommand): number {
  const byWorkspace = left.workspaceRoot.localeCompare(right.workspaceRoot);
  if (byWorkspace !== 0) {
    return byWorkspace;
  }
  const byHandle = left.handle.localeCompare(right.handle);
  return byHandle === 0 ? left.commandId.localeCompare(right.commandId) : byHandle;
}

function normalizeRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
