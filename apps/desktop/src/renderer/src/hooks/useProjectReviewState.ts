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
  const [noteGitChanges, setNoteGitChanges] = useState<Array<WorkspaceGitChange & { rootPath: string; rootLabel: string }>>([]);
  const [observedWorkspaceWrites, setObservedWorkspaceWrites] = useState<ObservedWorkspaceWrite[]>([]);
  const terminalSessionsRef = useRef<TerminalSessionInfo[]>(terminalSessions);

  useEffect(() => {
    terminalSessionsRef.current = terminalSessions;
  }, [terminalSessions]);

  useEffect(() => {
    let cancelled = false;
    void refreshWorkspaceGitStatus(workspaceModel, (nextStatus, nextProjectChanges, nextNoteChanges) => {
      if (cancelled) {
        return;
      }
      setWorkspaceGitStatus(nextStatus);
      setProjectGitChanges(nextProjectChanges);
      setNoteGitChanges(nextNoteChanges);
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
    await refreshWorkspaceGitStatus(model, (nextStatus, nextProjectChanges, nextNoteChanges) => {
      setWorkspaceGitStatus(nextStatus);
      setProjectGitChanges(nextProjectChanges);
      setNoteGitChanges(nextNoteChanges);
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
    noteGitChanges,
    recordObservedWorkspaceWrite,
    refreshProjectGitStatus: reload,
  };
}

async function refreshWorkspaceGitStatus(
  model: WorkspaceModel | null,
  apply: (
    status: WorkspaceGitStatus | null,
    projectChanges: Array<WorkspaceGitChange & { rootPath: string; rootLabel: string }>,
    noteChanges: Array<WorkspaceGitChange & { rootPath: string; rootLabel: string }>,
  ) => void,
): Promise<void> {
  const projectRoots = model?.projectRoots ?? [];
  const noteRoots = model?.noteRoots ?? [];
  if (projectRoots.length === 0 && noteRoots.length === 0) {
    apply(null, [], []);
    return;
  }
  const [projectResults, noteResults] = await Promise.all([
    loadRootGitChanges(projectRoots).catch(() => []),
    loadRootGitChanges(noteRoots).catch(() => []),
  ]);
  apply(
    projectResults[0]?.status ?? noteResults[0]?.status ?? null,
    projectResults.flatMap(({ root, status }) =>
      (status?.changes ?? []).map((change) => ({
        ...change,
        rootPath: root.path,
        rootLabel: root.label,
      })),
    ),
    noteResults.flatMap(({ root, status }) =>
      (status?.changes ?? []).map((change) => ({
        ...change,
        rootPath: root.path,
        rootLabel: root.label,
      })),
    ),
  );
}

async function loadRootGitChanges(roots: WorkspaceModel["projectRoots"]) {
  return Promise.all(
    roots.map(async (root) => ({
      root,
      status: await window.exo.workspace.getGitStatus(root.path).catch(() => null),
    })),
  );
}
