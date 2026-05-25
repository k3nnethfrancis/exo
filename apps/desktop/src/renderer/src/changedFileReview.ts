import type { TerminalSessionInfo, WorkspaceGitChange } from "../../shared/api";

export interface ObservedWorkspaceWrite {
  filePath: string;
  rootPath: string;
  sessionId: string;
  observedAt: number;
  association: "unique-cwd-match";
}

export type ProjectReviewChangeInput = WorkspaceGitChange & {
  rootPath: string;
  rootLabel: string;
};

export type ProjectReviewChange = ProjectReviewChangeInput & {
  agents: Array<{ id: string; title: string; kind: string; cwd: string; observed: true; observedAt: number | null }>;
};

export function buildProjectReviewChanges(
  projectGitChanges: ProjectReviewChangeInput[],
  _observedWorkspaceWrites: ObservedWorkspaceWrite[],
  terminalSessions: TerminalSessionInfo[],
): ProjectReviewChange[] {
  void terminalSessions;
  return projectGitChanges.map((change) => ({
    ...change,
    agents: [],
  }));
}

export function uniqueCwdMatchedSession(terminalSessions: TerminalSessionInfo[], filePath: string): TerminalSessionInfo | null {
  const candidateSessions = terminalSessions.filter((session) => isPathWithin(session.cwd, filePath));
  const longestCwdLength = Math.max(0, ...candidateSessions.map((session) => session.cwd.length));
  const matchingSessions = candidateSessions.filter((session) => session.cwd.length === longestCwdLength);
  return matchingSessions.length === 1 ? matchingSessions[0] : null;
}

function isPathWithin(parentPath: string, targetPath: string): boolean {
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}
