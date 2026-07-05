import {
  collectLeaves,
  findNode,
  findTerminalLeaf,
  pruneEmptyLeaves,
  type PaneLeaf,
  type PaneNode,
  type PaneNodeId,
  type PaneTreeActions,
} from "./usePaneTree";
import type { TerminalLaunchKind, TerminalSessionInfo } from "../../../shared/api";
import {
  addTerminalSessionAsSplit,
  addTerminalSessionToFirstLeaf,
  buildTerminalMonitorTree,
  removeTerminalSessionFromTree,
} from "../paneTreeSelectors";

interface TerminalStateApi {
  createTerminal: (terminalKind: TerminalLaunchKind, cwd?: string, harnessId?: string) => Promise<TerminalSessionInfo>;
  setActiveTerminalId: (id: string | null) => void;
  activateTerminal: (id: string) => Promise<void>;
  killTerminal: (id: string) => Promise<TerminalSessionInfo[]>;
}

export interface TerminalPaneController {
  createTerminal: (terminalKind: TerminalLaunchKind, cwd?: string, activate?: boolean, harnessId?: string) => Promise<TerminalSessionInfo>;
  attachExternalTerminalSessions: (sessions: TerminalSessionInfo[], options: { activateLatest: boolean }) => void;
  activateTerminal: (leafId: PaneNodeId, id: string) => Promise<void>;
  focusTerminalSession: (id: string) => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;
}

interface UseTerminalPaneControllerOptions {
  editorTree: PaneNode;
  terminalTree: PaneNode;
  editorFocusedLeafId: PaneNodeId;
  terminalFocusedLeafId: PaneNodeId;
  editorActions: PaneTreeActions;
  terminalActions: PaneTreeActions;
  terminalState: TerminalStateApi;
  setTerminalCollapsed: (collapsed: boolean) => void;
  setZoomSurface: (surface: "editor" | "terminal" | "explorer") => void;
  monitorMode: boolean;
}

export function useTerminalPaneController(options: UseTerminalPaneControllerOptions): TerminalPaneController {
  async function createTerminal(terminalKind: TerminalLaunchKind, cwd?: string, activate = true, harnessId?: string) {
    const session = await options.terminalState.createTerminal(terminalKind, cwd, harnessId);
    options.setTerminalCollapsed(false);

    if (options.monitorMode) {
      options.terminalActions.setTree((currentTree) => {
        const result = addTerminalSessionAsSplit(currentTree, session.id, options.terminalFocusedLeafId);
        return result.tree;
      });
      if (activate) {
        options.setZoomSurface("terminal");
        await options.terminalState.activateTerminal(session.id);
      }
      return session;
    }

    const focusedLeaf = findNode(options.terminalTree, (n) => n.id === options.terminalFocusedLeafId) as PaneLeaf | undefined;
    const termLeaf = (focusedLeaf?.content.kind === "terminal" ? focusedLeaf : null) ?? findTerminalLeaf(options.terminalTree);
    if (termLeaf) {
      if (activate) {
        options.terminalActions.focusLeaf(termLeaf.id);
      }
      options.terminalActions.updateLeafContent(termLeaf.id, (content) => {
        if (content.kind !== "terminal") return content;
        if (content.terminalIds.includes(session.id)) {
          return { ...content, activeTerminalId: activate ? session.id : content.activeTerminalId };
        }
        return {
          ...content,
          terminalIds: [...content.terminalIds, session.id],
          activeTerminalId: activate ? session.id : content.activeTerminalId,
        };
      });
    }
    if (activate) {
      options.setZoomSurface("terminal");
      await options.terminalState.activateTerminal(session.id);
    }
    return session;
  }

  function attachExternalTerminalSessions(
    sessions: TerminalSessionInfo[],
    attachOptions: { activateLatest: boolean },
  ) {
    if (sessions.length === 0) {
      return;
    }
    void attachOptions;
    options.setTerminalCollapsed(false);
    if (options.monitorMode) {
      options.terminalActions.setTree((currentTree) => {
        const existingIds = collectLeaves(currentTree).flatMap((leaf) =>
          leaf.content.kind === "terminal" ? leaf.content.terminalIds : [],
        );
        const nextIds = [...existingIds, ...sessions.map((session) => session.id)];
        const activeId = attachOptions.activateLatest ? sessions.at(-1)?.id ?? null : null;
        return buildTerminalMonitorTree(nextIds, activeId);
      });
      return;
    }
    options.terminalActions.setTree((currentTree) =>
      sessions.reduce((nextTree, session) => addTerminalSessionToFirstLeaf(nextTree, session.id), currentTree),
    );
  }

  async function activateTerminal(leafId: PaneNodeId, id: string) {
    options.terminalActions.updateLeafContent(leafId, (content) => {
      if (content.kind !== "terminal") return content;
      return { ...content, activeTerminalId: id };
    });
    await options.terminalState.activateTerminal(id);
  }

  async function focusTerminalSession(id: string) {
    const editorTerminalLeaf = collectLeaves(options.editorTree).find((leaf) =>
      leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(id),
    );
    if (editorTerminalLeaf) {
      options.editorActions.focusLeaf(editorTerminalLeaf.id);
      options.editorActions.updateLeafContent(editorTerminalLeaf.id, (content) =>
        content.kind === "terminal" ? { ...content, activeTerminalId: id } : content,
      );
      options.setZoomSurface("terminal");
      await options.terminalState.activateTerminal(id);
      return;
    }

    const dockTerminalLeaf = collectLeaves(options.terminalTree).find((leaf) =>
      leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(id),
    );
    if (!dockTerminalLeaf) {
      return;
    }
    options.setTerminalCollapsed(false);
    options.setZoomSurface("terminal");
    options.terminalActions.focusLeaf(dockTerminalLeaf.id);
    await activateTerminal(dockTerminalLeaf.id, id);
  }

  async function closeTerminal(id: string) {
    const remainingSessions = await options.terminalState.killTerminal(id);

    options.editorActions.setTree((prev) =>
      pruneEmptyLeaves(removeTerminalSessionFromTree(prev, id), (leaf) =>
        leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0,
      ),
    );
    options.terminalActions.setTree((prev) => {
      const next = removeTerminalSessionFromTree(prev, id);
      return pruneEmptyLeaves(next, (leaf) => leaf.content.kind === "terminal" && leaf.content.terminalIds.length === 0);
    });

    if (remainingSessions.length === 0) {
      options.setTerminalCollapsed(true);
    }
  }

  return {
    createTerminal,
    attachExternalTerminalSessions,
    activateTerminal,
    focusTerminalSession,
    closeTerminal,
  };
}
