import { useEffect, type MutableRefObject } from "react";
import type { WorkspaceModel, WorkspaceSettings, WorkspaceSettingsRevision } from "@exo/core";

import { decodeWorkspaceCanvasLayout, type PaneNode, type WorkspaceCanvasLayout } from "./usePaneTree";

interface UseWorkspaceLayoutPersistenceOptions {
  canvas: PaneNode;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  inspectorCollapsed: boolean;
  layoutPersistenceReady: boolean;
  onboardingActive: boolean;
  workspaceModel: WorkspaceModel | null;
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings | null>;
  workspaceSettingsRevisionRef: MutableRefObject<WorkspaceSettingsRevision>;
}

export function useWorkspaceLayoutPersistence(options: UseWorkspaceLayoutPersistenceOptions) {
  useEffect(() => {
    if (!options.layoutPersistenceReady || options.onboardingActive || !options.workspaceModel) return;
    const timeout = window.setTimeout(() => {
      const currentSettings = options.workspaceSettingsRef.current;
      if (!currentSettings) return;
      const layout = createWorkspaceCanvasSnapshot(options);
      if (stableJson(currentSettings.layout ?? null) === stableJson(layout)) return;
      void window.exo.workspace.saveSettings({
        settings: { ...currentSettings, layout: layout as unknown as WorkspaceSettings["layout"] },
        expectedRevision: options.workspaceSettingsRevisionRef.current,
      }).then((saved) => {
        options.workspaceSettingsRef.current = saved.settings;
        options.workspaceSettingsRevisionRef.current = saved.revision;
        if (saved.runtimeApply.status === "failed") throw new Error(saved.runtimeApply.errorMessage);
      }).catch((error) => console.warn("[exo] failed to persist workspace canvas", error));
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [
    options.canvas,
    options.sidebarCollapsed,
    options.sidebarWidth,
    options.inspectorCollapsed,
    options.layoutPersistenceReady,
    options.onboardingActive,
    options.workspaceModel,
    options.workspaceSettingsRef,
    options.workspaceSettingsRevisionRef,
  ]);
}

export function createWorkspaceCanvasSnapshot(input: Pick<UseWorkspaceLayoutPersistenceOptions, "canvas" | "sidebarCollapsed" | "sidebarWidth" | "inspectorCollapsed">): WorkspaceCanvasLayout {
  return {
    version: 1,
    canvas: input.canvas,
    sidebarCollapsed: input.sidebarCollapsed,
    sidebarWidth: Math.round(input.sidebarWidth),
    inspectorCollapsed: input.inspectorCollapsed,
  };
}

/** Restore canonical canvas when present; decode the legacy two-zone shape only once at this boundary. */
export function decodePersistedWorkspaceCanvas(layout: unknown): WorkspaceCanvasLayout | null {
  if (!layout || typeof layout !== "object") return null;
  const candidate = layout as Partial<WorkspaceCanvasLayout> & { editorTree?: PaneNode; terminalTree?: PaneNode };
  if (candidate.version === 1 && candidate.canvas) {
    return {
      version: 1,
      canvas: candidate.canvas,
      sidebarCollapsed: Boolean(candidate.sidebarCollapsed),
      sidebarWidth: Number.isFinite(candidate.sidebarWidth) ? Math.round(candidate.sidebarWidth as number) : 175,
      inspectorCollapsed: Boolean(candidate.inspectorCollapsed),
    };
  }
  if (!candidate.editorTree && !candidate.terminalTree) return null;
  return {
    version: 1,
    canvas: decodeWorkspaceCanvasLayout(candidate.editorTree, candidate.terminalTree),
    sidebarCollapsed: Boolean(candidate.sidebarCollapsed),
    sidebarWidth: Number.isFinite(candidate.sidebarWidth) ? Math.round(candidate.sidebarWidth as number) : 175,
    inspectorCollapsed: Boolean(candidate.inspectorCollapsed),
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}
