import { useEffect, type MutableRefObject } from "react";
import type { WorkspaceLayoutSettings, WorkspaceModel, WorkspaceSettings } from "@exo/core";

import type { PaneNode } from "./usePaneTree";

interface UseWorkspaceLayoutPersistenceOptions {
  editorTree: PaneNode;
  terminalTree: PaneNode;
  terminalCollapsed: boolean;
  terminalMonitorMode: boolean;
  sidePanesFlipped: boolean;
  zoneSplitRatio: number;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  layoutPersistenceReady: boolean;
  onboardingActive: boolean;
  workspaceModel: WorkspaceModel | null;
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings | null>;
}

export function useWorkspaceLayoutPersistence(options: UseWorkspaceLayoutPersistenceOptions) {
  useEffect(() => {
    if (!options.layoutPersistenceReady || options.onboardingActive || !options.workspaceModel) {
      return;
    }

    const timeout = window.setTimeout(() => {
      const currentSettings = options.workspaceSettingsRef.current;
      if (!currentSettings) {
        return;
      }

      const layout = createWorkspaceLayoutSnapshot({
        editorTree: options.editorTree,
        terminalTree: options.terminalTree,
        terminalCollapsed: options.terminalCollapsed,
        terminalMonitorMode: options.terminalMonitorMode,
        sidePanesFlipped: options.sidePanesFlipped,
        zoneSplitRatio: options.zoneSplitRatio,
        sidebarCollapsed: options.sidebarCollapsed,
        sidebarWidth: options.sidebarWidth,
      });
      if (stableJson(currentSettings.layout ?? null) === stableJson(layout)) {
        return;
      }

      void window.exo.workspace.saveSettings({ ...currentSettings, layout }).then((saved) => {
        options.workspaceSettingsRef.current = saved;
      }).catch((error) => {
        console.warn("[exo] failed to persist workspace layout", error);
      });
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [
    options.editorTree,
    options.terminalTree,
    options.terminalCollapsed,
    options.terminalMonitorMode,
    options.sidePanesFlipped,
    options.zoneSplitRatio,
    options.sidebarCollapsed,
    options.sidebarWidth,
    options.layoutPersistenceReady,
    options.onboardingActive,
    options.workspaceModel,
    options.workspaceSettingsRef,
  ]);
}

function createWorkspaceLayoutSnapshot(input: Omit<WorkspaceLayoutSettings, "inspectorCollapsed">): WorkspaceLayoutSettings {
  return {
    editorTree: input.editorTree,
    terminalTree: input.terminalTree,
    terminalCollapsed: input.terminalCollapsed,
    terminalMonitorMode: input.terminalMonitorMode,
    sidePanesFlipped: input.sidePanesFlipped,
    zoneSplitRatio: roundLayoutNumber(input.zoneSplitRatio),
    sidebarCollapsed: input.sidebarCollapsed,
    sidebarWidth: Math.round(input.sidebarWidth),
    inspectorCollapsed: true,
  };
}

function roundLayoutNumber(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
