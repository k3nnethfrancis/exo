import type { TerminalSessionInfo } from "../../shared/api";

export interface TerminalStatusLine {
  label: string;
  tone: "muted" | "ok" | "warn" | "info" | "error";
  title: string;
  busy: boolean;
  sessionId: string;
}

export function terminalSessionsEqual(left: TerminalSessionInfo[], right: TerminalSessionInfo[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((leftSession, index) => {
    const rightSession = right[index];
    return Boolean(rightSession) &&
      leftSession.id === rightSession.id &&
      leftSession.title === rightSession.title &&
      leftSession.cwd === rightSession.cwd &&
      leftSession.kind === rightSession.kind &&
      leftSession.command === rightSession.command &&
      leftSession.status === rightSession.status &&
      leftSession.exitCode === rightSession.exitCode &&
      leftSession.readiness === rightSession.readiness &&
      leftSession.readinessDetail === rightSession.readinessDetail &&
      leftSession.queuedInputCount === rightSession.queuedInputCount &&
      leftSession.health === rightSession.health &&
      leftSession.healthDetail === rightSession.healthDetail &&
      leftSession.attachGeneration === rightSession.attachGeneration &&
      leftSession.instructionOverlayPath === rightSession.instructionOverlayPath &&
      terminalGeometryEqual(leftSession.geometry, rightSession.geometry);
  });
}

function terminalGeometryEqual(left: TerminalSessionInfo["geometry"], right: TerminalSessionInfo["geometry"]): boolean {
  return left?.cols === right?.cols &&
    left?.rows === right?.rows &&
    left?.reportedAt === right?.reportedAt &&
    left?.source === right?.source;
}

export function isReconnectableSession(session: TerminalSessionInfo): boolean {
  return session.status === "running" && session.health === "unhealthy";
}

export function isTerminalInputEnabled(session: TerminalSessionInfo): boolean {
  return session.status === "running" && session.health !== "unhealthy" && session.health !== "exited";
}

export function summarizeTerminalStatusLine(
  sessions: TerminalSessionInfo[],
  activeTerminalId: string | null,
  hydratingTerminalIds: ReadonlySet<string>,
): TerminalStatusLine | null {
  const activeSession = activeTerminalId ? sessions.find((session) => session.id === activeTerminalId) ?? null : null;
  const hydratingSession = firstMatchingTerminalSession(sessions, activeSession, (session) => hydratingTerminalIds.has(session.id));
  if (hydratingSession) {
    return {
      label: "Restoring terminal",
      tone: "info",
      title: `${hydratingSession.title}: reattaching to the durable tmux pane.`,
      busy: true,
      sessionId: hydratingSession.id,
    };
  }

  const exitedSession = firstMatchingTerminalSession(sessions, activeSession, (session) => session.status === "exited" || session.health === "exited");
  if (exitedSession) {
    return {
      label: "Terminal exited",
      tone: "warn",
      title: terminalStatusTitle(exitedSession, "Process exited."),
      busy: false,
      sessionId: exitedSession.id,
    };
  }

  const unavailableSession = firstMatchingTerminalSession(sessions, activeSession, (session) => session.status === "running" && session.health === "unhealthy");
  if (unavailableSession) {
    return {
      label: "Terminal unavailable",
      tone: "error",
      title: terminalStatusTitle(unavailableSession, "Reconnect or inspect terminal diagnostics."),
      busy: false,
      sessionId: unavailableSession.id,
    };
  }

  return null;
}

function firstMatchingTerminalSession(
  sessions: TerminalSessionInfo[],
  activeSession: TerminalSessionInfo | null,
  predicate: (session: TerminalSessionInfo) => boolean,
): TerminalSessionInfo | null {
  if (activeSession && predicate(activeSession)) {
    return activeSession;
  }
  return sessions.find(predicate) ?? null;
}

function terminalStatusTitle(session: TerminalSessionInfo, fallbackDetail: string): string {
  return `${session.title}: ${session.healthDetail ?? fallbackDetail}`;
}
