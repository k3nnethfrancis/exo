import { useEffect, type MutableRefObject } from "react";
import type { WorkspaceModel, WorkspaceSettings } from "@stem/core";

import { decodeWorkspaceCanvasLayout, type PaneNode, type WorkspaceCanvasLayout } from "./usePaneTree";

interface UseWorkspaceLayoutPersistenceOptions {
  canvas: PaneNode;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  utilityWidth: number;
  layoutPersistenceReady: boolean;
  onboardingActive: boolean;
  workspaceModel: WorkspaceModel | null;
  workspaceSettingsRef: MutableRefObject<WorkspaceSettings | null>;
  saveSettingsPatch: (patch: Partial<WorkspaceSettings>) => Promise<void>;
}

export function useWorkspaceLayoutPersistence(options: UseWorkspaceLayoutPersistenceOptions) {
  useEffect(() => {
    if (!options.layoutPersistenceReady || options.onboardingActive || !options.workspaceModel) return;
    const timeout = window.setTimeout(() => {
      const currentSettings = options.workspaceSettingsRef.current;
      if (!currentSettings) return;
      const layout = createWorkspaceCanvasSnapshot(options);
      if (stableJson(currentSettings.layout ?? null) === stableJson(layout)) return;
      void options.saveSettingsPatch({
        layout: layout as unknown as WorkspaceSettings["layout"],
      }).catch((error) => console.warn("[stem] failed to persist workspace canvas", error));
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [
    options.canvas,
    options.sidebarCollapsed,
    options.sidebarWidth,
    options.utilityWidth,
    options.layoutPersistenceReady,
    options.onboardingActive,
    options.workspaceModel,
    options.workspaceSettingsRef,
    options.saveSettingsPatch,
  ]);
}

export function createWorkspaceCanvasSnapshot(input: Pick<UseWorkspaceLayoutPersistenceOptions, "canvas" | "sidebarCollapsed" | "sidebarWidth" | "utilityWidth">): WorkspaceCanvasLayout {
  return {
    version: 3,
    canvas: persistableCanvas(input.canvas),
    sidebarCollapsed: input.sidebarCollapsed,
    sidebarWidth: Math.round(input.sidebarWidth),
    utilityWidth: Math.round(input.utilityWidth),
  };
}

/** Restore the current persisted canvas format; live terminal leaves are discarded. */
export function decodePersistedWorkspaceCanvas(layout: unknown): WorkspaceCanvasLayout | null {
  if (!layout || typeof layout !== "object") return null;
  const candidate = layout as { version?: unknown; canvas?: unknown; sidebarCollapsed?: unknown; sidebarWidth?: unknown; utilityWidth?: unknown };
  if (candidate.version !== 3 || !candidate.canvas) return null;
  const canvas = decodeWorkspaceCanvasLayout(candidate.canvas);
  return {
    version: 3,
    canvas,
    sidebarCollapsed: Boolean(candidate.sidebarCollapsed),
    sidebarWidth: Number.isFinite(candidate.sidebarWidth) ? Math.round(candidate.sidebarWidth as number) : 175,
    utilityWidth: Number.isFinite(candidate.utilityWidth) ? Math.round(candidate.utilityWidth as number) : 430,
  };
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function persistableCanvas(node: PaneNode): PaneNode {
  const stripTerminal = (current: PaneNode): PaneNode | null => {
    if (current.kind === "leaf") return current.content.kind === "terminal" ? null : current;
    const left = stripTerminal(current.children[0]);
    const right = stripTerminal(current.children[1]);
    if (!left) return right;
    if (!right) return left;
    return { ...current, children: [left, right] };
  };
  return stripTerminal(node) ?? { kind: "leaf", id: "editor", content: { kind: "editor", openPaths: [], activePath: null } };
}
