import { isDeepStrictEqual } from "node:util";

import type { WorkspaceSettings } from "@exo/core";

export interface WorkspaceSettingsApplyPlan {
  reactivateWorkspace: boolean;
  rebindIndex: boolean;
  updateIndexPolicy: boolean;
  updateTerminalDefault: boolean;
}

/**
 * Maps persisted settings to the runtime owners they actually affect.
 *
 * Unknown and renderer-only settings deliberately produce no effects. They
 * still publish through the active settings snapshot, but they must not
 * restart long-lived Workspace resources.
 */
export function planWorkspaceSettingsApply(
  previous: WorkspaceSettings,
  next: WorkspaceSettings,
): WorkspaceSettingsApplyPlan {
  return {
    reactivateWorkspace: (
      previous.workspaceRoot !== next.workspaceRoot
      || !isDeepStrictEqual(previous.noteRoots, next.noteRoots)
    ),
    rebindIndex: (
      !isDeepStrictEqual(previous.indexedRoots, next.indexedRoots)
      || !isDeepStrictEqual(previous.indexing, next.indexing)
      || previous.searchEngine !== next.searchEngine
    ),
    updateIndexPolicy: previous.indexUpdateStrategy !== next.indexUpdateStrategy,
    updateTerminalDefault: previous.defaultTerminalCwd !== next.defaultTerminalCwd,
  };
}
