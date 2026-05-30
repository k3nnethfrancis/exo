import { useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceModel } from "@exo/core";

import type { TerminalSessionInfo, WorkspaceGitChange, WorkspaceGitStatus } from "../../../shared/api";
import { buildProjectReviewChanges, uniqueCwdMatchedSession, type ObservedWorkspaceWrite } from "../changedFileReview";

export function useProjectReviewState(
  workspaceModel: WorkspaceModel | null,
  terminalSessions: TerminalSessionInfo[],
) {
  const [workspaceGitStatus, setWorkspaceGitStatus] = useState<WorkspaceGitStatus | null>(null);
  const [projectGitChanges, setProjectGitChanges] = useState<Array<WorkspaceGitChange & { rootPath: string; rootLabel: string }>>([]);
  const [observedWorkspaceWrites, setObservedWorkspaceWrites] = useState<ObservedWorkspaceWrite[]>([]);
  const terminalSessionsRef = useRef<TerminalSessionInfo[]>(terminalSessions);

  useEffect(() => {
    terminalSessionsRef.current = terminalSessions;
  }, [terminalSessions]);

  useEffect(() => {
    let cancelled = false;
    void refreshProjectGitStatus(workspaceModel, (nextStatus, nextChanges) => {
      if (cancelled) {
        return;
      }
      setWorkspaceGitStatus(nextStatus);
      setProjectGitChanges(nextChanges);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceModel]);

  const projectReviewChanges = useMemo(
    () => buildProjectReviewChanges(projectGitChanges, observedWorkspaceWrites, terminalSessions),
    [observedWorkspaceWrites, projectGitChanges, terminalSessions],
  );

  async function reload(model = workspaceModel): Promise<void> {
    await refreshProjectGitStatus(model, (nextStatus, nextChanges) => {
      setWorkspaceGitStatus(nextStatus);
      setProjectGitChanges(nextChanges);
    });
  }

  function recordObservedWorkspaceWrite(rootPath: string, filePath: string): void {
    const matchingSession = uniqueCwdMatchedSession(terminalSessionsRef.current, filePath);
    if (!matchingSession) {
      return;
    }
    const observedAt = Date.now();
    setObservedWorkspaceWrites((current) => {
      const withoutDuplicate = current.filter(
        (write) => !(write.filePath === filePath && write.sessionId === matchingSession.id),
      );
      return [
        {
          filePath,
          rootPath,
          sessionId: matchingSession.id,
          observedAt,
          association: "unique-cwd-match" as const,
        },
        ...withoutDuplicate,
      ].slice(0, 200);
    });
  }

  return {
    workspaceGitStatus,
    projectReviewChanges,
    recordObservedWorkspaceWrite,
    refreshProjectGitStatus: reload,
  };
}

async function refreshProjectGitStatus(
  model: WorkspaceModel | null,
  apply: (
    status: WorkspaceGitStatus | null,
    changes: Array<WorkspaceGitChange & { rootPath: string; rootLabel: string }>,
  ) => void,
): Promise<void> {
  const projectRoots = model?.projectRoots ?? [];
  if (projectRoots.length === 0) {
    apply(null, []);
    return;
  }
  const results = await loadProjectGitChanges(projectRoots).catch(() => []);
  apply(
    results[0]?.status ?? null,
    results.flatMap(({ root, status }) =>
      (status?.changes ?? []).map((change) => ({
        ...change,
        rootPath: root.path,
        rootLabel: root.label,
      })),
    ),
  );
}

async function loadProjectGitChanges(projectRoots: WorkspaceModel["projectRoots"]) {
  return Promise.all(
    projectRoots.map(async (root) => ({
      root,
      status: await window.exo.workspace.getGitStatus(root.path).catch(() => null),
    })),
  );
}
