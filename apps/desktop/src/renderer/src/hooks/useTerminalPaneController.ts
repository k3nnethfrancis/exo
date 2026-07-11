import type { TerminalLaunchKind, TerminalSessionInfo } from "../../../shared/api";
import {
  addTerminalSessionToCanvas,
  pruneEmptyTerminalLeaves,
  removeTerminalSessionFromTree,
} from "../paneTreeSelectors";
import {
  collectLeaves,
  type PaneNode,
  type PaneNodeId,
  type PaneTreeActions,
} from "./usePaneTree";

interface TerminalStateApi {
  createTerminal: (terminalKind: TerminalLaunchKind, cwd?: string) => Promise<TerminalSessionInfo>;
  setActiveTerminalId: (id: string | null) => void;
  activateTerminal: (id: string) => Promise<void>;
  killTerminal: (id: string) => Promise<TerminalSessionInfo[]>;
}

export interface TerminalPaneController {
  createTerminal: (terminalKind: TerminalLaunchKind, cwd?: string, activate?: boolean) => Promise<TerminalSessionInfo>;
  attachExternalTerminalSessions: (sessions: TerminalSessionInfo[], options: { activateLatest: boolean }) => void;
  activateTerminal: (leafId: PaneNodeId, id: string) => Promise<void>;
  focusTerminalSession: (id: string) => Promise<void>;
  closeTerminal: (id: string) => Promise<void>;
}

interface UseTerminalPaneControllerOptions {
  canvasTree: PaneNode;
  focusedPaneId: PaneNodeId;
  canvasActions: PaneTreeActions;
  terminalState: TerminalStateApi;
}

export function useTerminalPaneController(options: UseTerminalPaneControllerOptions): TerminalPaneController {
  async function createTerminal(terminalKind: TerminalLaunchKind, cwd?: string, activate = true) {
    const session = await options.terminalState.createTerminal(terminalKind, cwd);
    const placement = addTerminalSessionToCanvas(options.canvasTree, session.id, options.focusedPaneId);
    options.canvasActions.setTree(placement.tree);
    if (activate) {
      options.canvasActions.focusLeaf(placement.leafId);
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

    let next = options.canvasTree;
    let leafId = options.focusedPaneId;
    for (const session of sessions) {
      const placement = addTerminalSessionToCanvas(next, session.id, leafId);
      next = placement.tree;
      leafId = placement.leafId;
    }
    options.canvasActions.setTree(next);

    if (!attachOptions.activateLatest) {
      return;
    }
    const latest = sessions.at(-1);
    if (latest) {
      options.canvasActions.focusLeaf(leafId);
      void options.terminalState.activateTerminal(latest.id);
    }
  }

  async function activateTerminal(leafId: PaneNodeId, id: string) {
    options.canvasActions.updateLeafContent(leafId, (content) =>
      content.kind === "terminal" ? { ...content, activeTerminalId: id } : content,
    );
    options.canvasActions.focusLeaf(leafId);
    await options.terminalState.activateTerminal(id);
  }

  async function focusTerminalSession(id: string) {
    const terminalLeaf = collectLeaves(options.canvasTree).find((leaf) =>
      leaf.content.kind === "terminal" && leaf.content.terminalIds.includes(id),
    );
    if (!terminalLeaf) {
      return;
    }
    await activateTerminal(terminalLeaf.id, id);
  }

  async function closeTerminal(id: string) {
    await options.terminalState.killTerminal(id);
    options.canvasActions.setTree((current) =>
      pruneEmptyTerminalLeaves(removeTerminalSessionFromTree(current, id)),
    );
  }

  return {
    createTerminal,
    attachExternalTerminalSessions,
    activateTerminal,
    focusTerminalSession,
    closeTerminal,
  };
}
