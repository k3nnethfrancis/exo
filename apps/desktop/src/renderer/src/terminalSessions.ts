import type { TerminalSessionInfo } from "../../shared/api";

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
