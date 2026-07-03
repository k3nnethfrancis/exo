import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { terminalSubstrateKindForManagedAgentKind } from "@exo/core";

import type { TerminalGeometryRecord, TerminalKind, TerminalSessionInfo } from "../shared/api";
import { isTerminalGeometryRecord } from "./terminal-geometry-service";

export interface PersistedTerminalSession {
  id: string;
  title: string;
  cwd: string;
  terminalKind?: TerminalSessionInfo["terminalKind"];
  harnessId?: string | null;
  kind: TerminalKind;
  command: string;
  instructionOverlayPath?: string | null;
  tmuxSessionName: string;
  tmuxPaneId?: string;
  transcriptPath: string;
  createdAt: string;
  lastAttachedAt: string | null;
  status: "running" | "exited" | "missing" | "unhealthy";
  exitCode?: number;
  readiness?: TerminalSessionInfo["readiness"];
  readinessDetail?: string;
  healthDetail?: string;
  geometry?: TerminalGeometryRecord;
}

export interface PersistedTerminalRegistry {
  sessions: PersistedTerminalSession[];
  nextId: number;
}

export interface TerminalRegistryEntry {
  info: TerminalSessionInfo;
  tmuxSessionName: string;
  tmuxPaneId: string;
  transcriptPath: string;
  createdAt: string;
}

export class TerminalSessionRegistry {
  constructor(readonly filePath: string) {}

  load(): PersistedTerminalRegistry {
    if (!existsSync(this.filePath)) {
      return { sessions: [], nextId: 1 };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as { sessions?: unknown; nextId?: unknown };
      const sessions = Array.isArray(parsed.sessions)
        ? parsed.sessions.reduce<PersistedTerminalSession[]>((entries, value) => {
            const session = normalizePersistedTerminalSession(value);
            if (session) {
              entries.push(session);
            }
            return entries;
          }, [])
        : [];
      const sessionNextId = sessions.reduce((next, session) => Math.max(next, terminalNumericId(session.id) + 1), 1);
      const persistedNextId = typeof parsed.nextId === "number" && Number.isFinite(parsed.nextId) ? Math.floor(parsed.nextId) : 1;
      return { sessions, nextId: Math.max(1, sessionNextId, persistedNextId) };
    } catch (error) {
      console.warn("[exo] failed to read terminal session registry", {
        path: this.filePath,
        error: error instanceof Error ? error.message : String(error),
      });
      return { sessions: [], nextId: 1 };
    }
  }

  save(nextId: number, entries: TerminalRegistryEntry[]): void {
    const sessions: PersistedTerminalSession[] = entries.map((entry) => ({
      id: entry.info.id,
      title: entry.info.title,
      cwd: entry.info.cwd,
      terminalKind: entry.info.terminalKind,
      harnessId: entry.info.harnessId,
      kind: entry.info.kind,
      command: entry.info.command,
      instructionOverlayPath: entry.info.instructionOverlayPath ?? null,
      tmuxSessionName: entry.tmuxSessionName,
      tmuxPaneId: entry.tmuxPaneId,
      transcriptPath: entry.transcriptPath,
      createdAt: entry.createdAt,
      lastAttachedAt: new Date().toISOString(),
      status: entry.info.status === "running" ? "running" : "exited",
      exitCode: entry.info.exitCode,
      readiness: entry.info.readiness,
      readinessDetail: entry.info.readinessDetail,
      healthDetail: entry.info.healthDetail,
      geometry: entry.info.geometry,
    }));
    mkdirSync(path.dirname(this.filePath), { recursive: true });
    writeFileSync(this.filePath, JSON.stringify({ version: 1, nextId, sessions }, null, 2));
  }
}

export function terminalNumericId(id: string): number {
  const match = /^term-(\d+)$/.exec(id);
  return match ? Number(match[1]) : 0;
}

function normalizePersistedTerminalSession(value: unknown): PersistedTerminalSession | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const session = value as Partial<PersistedTerminalSession>;
  const valid = (
    typeof session.id === "string" &&
    typeof session.title === "string" &&
    typeof session.cwd === "string" &&
    (session.kind === "shell" || session.kind === "claude" || session.kind === "codex" || session.kind === "pi" || session.kind === "hermes") &&
    typeof session.command === "string" &&
    typeof session.tmuxSessionName === "string" &&
    typeof session.transcriptPath === "string" &&
    (session.status === "running" || session.status === "exited" || session.status === "missing" || session.status === "unhealthy")
  );
  if (!valid) {
    return null;
  }
  const kind = session.kind as TerminalKind;
  return {
    ...session,
    terminalKind:
      session.terminalKind === "shell" || session.terminalKind === "agent"
        ? session.terminalKind
        : terminalSubstrateKindForManagedAgentKind(kind),
    harnessId:
      typeof session.harnessId === "string" || session.harnessId === null
        ? session.harnessId
        : kind === "shell"
          ? null
          : kind,
    geometry: isTerminalGeometryRecord(session.geometry) ? session.geometry : undefined,
  } as PersistedTerminalSession;
}
