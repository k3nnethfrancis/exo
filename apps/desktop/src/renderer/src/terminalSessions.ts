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
      leftSession.health === rightSession.health &&
      leftSession.healthDetail === rightSession.healthDetail &&
      leftSession.attachGeneration === rightSession.attachGeneration &&
      terminalGeometryEqual(leftSession.geometry, rightSession.geometry);
  });
}

function terminalGeometryEqual(left: TerminalSessionInfo["geometry"], right: TerminalSessionInfo["geometry"]): boolean {
  return left?.cols === right?.cols &&
    left?.rows === right?.rows &&
    left?.reportedAt === right?.reportedAt &&
    left?.source === right?.source;
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
  const activeStatus = activeSession ? terminalStatusForSession(activeSession, hydratingTerminalIds) : null;
  if (activeStatus) {
    return activeStatus;
  }

  const exitedSession = sessions.find((session) => session.status === "exited" || session.health === "exited") ?? null;
  if (exitedSession) {
    return exitedTerminalStatus(exitedSession);
  }

  const unavailableSession = sessions.find((session) => session.status === "running" && session.health === "unhealthy") ?? null;
  if (unavailableSession) {
    return unavailableTerminalStatus(unavailableSession);
  }

  const hydratingSession = sessions.find((session) => hydratingTerminalIds.has(session.id)) ?? null;
  if (hydratingSession) {
    return restoringTerminalStatus(hydratingSession);
  }

  return null;
}

function terminalStatusForSession(
  session: TerminalSessionInfo,
  hydratingTerminalIds: ReadonlySet<string>,
): TerminalStatusLine | null {
  if (session.status === "exited" || session.health === "exited") {
    return exitedTerminalStatus(session);
  }
  if (session.status === "running" && session.health === "unhealthy") {
    return unavailableTerminalStatus(session);
  }
  if (hydratingTerminalIds.has(session.id)) {
    return restoringTerminalStatus(session);
  }
  return null;
}

function exitedTerminalStatus(session: TerminalSessionInfo): TerminalStatusLine {
  return {
    label: "Terminal exited",
    tone: "warn",
    title: terminalStatusTitle(session, "Process exited."),
    busy: false,
    sessionId: session.id,
  };
}

function unavailableTerminalStatus(session: TerminalSessionInfo): TerminalStatusLine {
  return {
    label: "Terminal unavailable",
    tone: "error",
    title: terminalStatusTitle(session, "Terminal process is unavailable."),
    busy: false,
    sessionId: session.id,
  };
}

function restoringTerminalStatus(session: TerminalSessionInfo): TerminalStatusLine {
  return {
    label: "Loading terminal",
    tone: "info",
    title: `${session.title}: loading terminal output.`,
    busy: true,
    sessionId: session.id,
  };
}

function terminalStatusTitle(session: TerminalSessionInfo, fallbackDetail: string): string {
  return `${session.title}: ${session.healthDetail ?? fallbackDetail}`;
}
