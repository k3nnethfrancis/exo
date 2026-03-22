import { useRef, useState } from "react";

import { useTerminalDockState } from "./useTerminalDockState";

export type EditorSplitOrientation = "right" | "bottom" | null;

export function useShellLayout() {
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const workspaceBodyRef = useRef<HTMLDivElement | null>(null);
  const editorAreaRef = useRef<HTMLDivElement | null>(null);

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(true);
  const [subagentsCollapsed, setSubagentsCollapsed] = useState(true);
  const [editorSplitOrientation, setEditorSplitOrientation] = useState<EditorSplitOrientation>(null);

  const terminalDock = useTerminalDockState(workspaceBodyRef);

  return {
    workspaceRef,
    workspaceBodyRef,
    editorAreaRef,
    sidebarCollapsed,
    setSidebarCollapsed,
    inspectorCollapsed,
    setInspectorCollapsed,
    subagentsCollapsed,
    setSubagentsCollapsed,
    editorSplitOrientation,
    setEditorSplitOrientation,
    terminalDock,
  };
}
