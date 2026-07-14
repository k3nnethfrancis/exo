import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentCommandAdapter } from "./agent-invocation";

export interface InvocationContinuityLane {
  workspaceRoot: string;
  commandId: string;
  commandFingerprint: string;
  adapter: Exclude<AgentCommandAdapter, "generic">;
  cwd: string;
}

export interface InvocationConversationHead {
  version: 1;
  workspaceFingerprint: string;
  commandId: string;
  commandFingerprint: string;
  adapter: Exclude<AgentCommandAdapter, "generic">;
  cwd: string;
  providerSessionId: string;
  sourceInvocationId: string;
  updatedAt: string;
}

export interface InvocationContinuityStoreLayout {
  workspaceRoot: string;
  continuityDir: string;
}

export class InvocationContinuityStore {
  readonly layout: InvocationContinuityStoreLayout;

  constructor(workspaceRoot: string) {
    const resolvedWorkspaceRoot = path.resolve(workspaceRoot);
    this.layout = {
      workspaceRoot: resolvedWorkspaceRoot,
      continuityDir: path.join(resolvedWorkspaceRoot, ".exo", "invocation-continuity", "v1"),
    };
  }

  async readHead(lane: InvocationContinuityLane): Promise<InvocationConversationHead | null> {
    const raw = await readJsonOrNull(this.headPath(lane));
    const head = normalizeInvocationConversationHead(raw);
    return head && headMatchesLane(head, this.normalizeLane(lane)) ? head : null;
  }

  async writeHead(lane: InvocationContinuityLane, input: {
    providerSessionId: string;
    sourceInvocationId: string;
    updatedAt?: string;
  }): Promise<InvocationConversationHead> {
    const normalizedLane = this.normalizeLane(lane);
    if (!isProviderSessionId(input.providerSessionId) || !normalizeRequiredString(input.sourceInvocationId)) {
      throw new Error("Invocation continuity head is incomplete.");
    }
    const head: InvocationConversationHead = {
      version: 1,
      workspaceFingerprint: workspaceFingerprint(normalizedLane.workspaceRoot),
      commandId: normalizedLane.commandId,
      commandFingerprint: normalizedLane.commandFingerprint,
      adapter: normalizedLane.adapter,
      cwd: normalizedLane.cwd,
      providerSessionId: input.providerSessionId,
      sourceInvocationId: input.sourceInvocationId,
      updatedAt: input.updatedAt ?? new Date().toISOString(),
    };
    const target = this.headPath(normalizedLane);
    await mkdir(path.dirname(target), { recursive: true });
    await writeJsonAtomically(target, head);
    return head;
  }

  async clearHead(lane: InvocationContinuityLane): Promise<boolean> {
    const target = this.headPath(lane);
    try {
      await rm(target);
      return true;
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) {
        return false;
      }
      throw error;
    }
  }

  async hasCommandHead(commandId: string): Promise<boolean> {
    return (await this.commandHeadPaths(commandId)).length > 0;
  }

  async clearCommandHeads(commandId: string): Promise<number> {
    const targets = await this.commandHeadPaths(commandId);
    await Promise.all(targets.map((target) => rm(target, { force: true })));
    return targets.length;
  }

  headPath(lane: InvocationContinuityLane): string {
    const normalizedLane = this.normalizeLane(lane);
    const key = createHash("sha256").update(JSON.stringify({
      workspaceFingerprint: workspaceFingerprint(normalizedLane.workspaceRoot),
      commandId: normalizedLane.commandId,
      cwd: normalizedLane.cwd,
    })).digest("hex");
    return path.join(this.layout.continuityDir, `${key}.json`);
  }

  private normalizeLane(lane: InvocationContinuityLane): InvocationContinuityLane {
    const workspaceRoot = path.resolve(lane.workspaceRoot);
    if (workspaceRoot !== this.layout.workspaceRoot) {
      throw new Error("Invocation continuity lane belongs to another Workspace.");
    }
    const commandId = normalizeRequiredString(lane.commandId);
    const commandFingerprint = normalizeSha256(lane.commandFingerprint);
    if (!commandId || !commandFingerprint || (lane.adapter !== "claude-code" && lane.adapter !== "codex-cli")) {
      throw new Error("Invocation continuity lane is incomplete.");
    }
    return { ...lane, workspaceRoot, commandId, commandFingerprint, cwd: path.resolve(lane.cwd) };
  }

  private async commandHeadPaths(commandIdInput: string): Promise<string[]> {
    const commandId = normalizeRequiredString(commandIdInput);
    if (!commandId) return [];
    let entries: string[];
    try {
      entries = (await readdir(this.layout.continuityDir)).filter((entry) => entry.endsWith(".json"));
    } catch (error) {
      if (isNodeErrorCode(error, "ENOENT")) return [];
      throw error;
    }
    const workspaceIdentity = workspaceFingerprint(this.layout.workspaceRoot);
    const matches = await Promise.all(entries.map(async (entry) => {
      const target = path.join(this.layout.continuityDir, entry);
      const head = normalizeInvocationConversationHead(await readJsonOrNull(target));
      return head?.workspaceFingerprint === workspaceIdentity && head.commandId === commandId ? target : null;
    }));
    return matches.filter((target): target is string => Boolean(target));
  }
}

function normalizeInvocationConversationHead(value: unknown): InvocationConversationHead | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as Partial<InvocationConversationHead>;
  const workspaceIdentity = normalizeSha256(candidate.workspaceFingerprint);
  const commandId = normalizeRequiredString(candidate.commandId);
  const commandFingerprint = normalizeSha256(candidate.commandFingerprint);
  const cwd = normalizeRequiredString(candidate.cwd);
  const providerSessionId = isProviderSessionId(candidate.providerSessionId) ? candidate.providerSessionId : null;
  const sourceInvocationId = normalizeRequiredString(candidate.sourceInvocationId);
  const updatedAt = normalizeRequiredString(candidate.updatedAt);
  const adapter = candidate.adapter === "claude-code" || candidate.adapter === "codex-cli" ? candidate.adapter : null;
  if (candidate.version !== 1 || !workspaceIdentity || !commandId || !commandFingerprint || !cwd || !providerSessionId || !sourceInvocationId || !updatedAt || !adapter) {
    return null;
  }
  return {
    version: 1,
    workspaceFingerprint: workspaceIdentity,
    commandId,
    commandFingerprint,
    adapter,
    cwd: path.resolve(cwd),
    providerSessionId,
    sourceInvocationId,
    updatedAt,
  };
}

function headMatchesLane(head: InvocationConversationHead, lane: InvocationContinuityLane): boolean {
  return head.workspaceFingerprint === workspaceFingerprint(lane.workspaceRoot) &&
    head.commandId === lane.commandId &&
    head.commandFingerprint === lane.commandFingerprint &&
    head.adapter === lane.adapter &&
    head.cwd === lane.cwd;
}

function workspaceFingerprint(workspaceRoot: string): string {
  return createHash("sha256").update(path.resolve(workspaceRoot)).digest("hex");
}

function isProviderSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeRequiredString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeSha256(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : null;
}

async function writeJsonAtomically(target: string, value: unknown): Promise<void> {
  const temporaryPath = path.join(path.dirname(target), `.head-${process.pid}-${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporaryPath, target);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

async function readJsonOrNull(target: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(target, "utf8")) as unknown;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    return null;
  }
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === code);
}
