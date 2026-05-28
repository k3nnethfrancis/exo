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
      leftSession.transport === rightSession.transport &&
      leftSession.status === rightSession.status &&
      leftSession.exitCode === rightSession.exitCode &&
      leftSession.readiness === rightSession.readiness &&
      leftSession.readinessDetail === rightSession.readinessDetail &&
      leftSession.queuedInputCount === rightSession.queuedInputCount &&
      leftSession.health === rightSession.health &&
      leftSession.healthDetail === rightSession.healthDetail &&
      leftSession.instructionOverlayPath === rightSession.instructionOverlayPath;
  });
}
