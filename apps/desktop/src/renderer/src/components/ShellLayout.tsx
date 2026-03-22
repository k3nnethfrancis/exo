import { useRef, type ReactNode } from "react";

import { FileTree } from "./FileTree";
import { TerminalDock } from "./TerminalDock";
import { TerminalRail } from "./TerminalRail";
import { InspectorDock } from "./InspectorDock";
import { SubagentDock } from "./SubagentDock";
import type { EditorSplitOrientation } from "../hooks/useShellLayout";
import type { TerminalDockState } from "../hooks/useTerminalDockState";
import type { TerminalSessionInfo } from "../../../shared/api";
import type { NoteDocument, NoteKnowledge, SearchResult, TreeNode, WorkspaceSearchResults } from "@exo/core";
import type { AppearanceMode, ResolvedAppearance } from "../App";
import type { ObservedAgent } from "../App";
import type { AgentAnnotation } from "./SubagentDock";

interface RootSection {
  label: string;
  path: string;
  nodes: TreeNode[];
}

interface ShellLayoutProps {
  noteSections: RootSection[];
  projectSections: RootSection[];
  appearanceMode: AppearanceMode;
  resolvedAppearance: ResolvedAppearance;
  searchQuery: string;
  searchResults: WorkspaceSearchResults;
  noteContent: ReactNode;
  activeDocument: NoteDocument | null;
  activeKnowledge: NoteKnowledge | null;
  activeTag: string | null;
  tagResults: SearchResult[];
  terminalSessions: TerminalSessionInfo[];
  activeTerminalId: string | null;
  terminalBuffers: Record<string, string>;
  terminalOutputPreviewById: Record<string, string>;
  agentAnnotations: Record<string, AgentAnnotation>;
  observedAgents: ObservedAgent[];
  compactEditorChrome: boolean;
  shellLayout: {
    workspaceRef: React.RefObject<HTMLDivElement | null>;
    workspaceBodyRef: React.RefObject<HTMLDivElement | null>;
    editorAreaRef: React.RefObject<HTMLDivElement | null>;
    sidebarCollapsed: boolean;
    setSidebarCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    inspectorCollapsed: boolean;
    setInspectorCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    subagentsCollapsed: boolean;
    setSubagentsCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
    editorSplitOrientation: EditorSplitOrientation;
    terminalDock: TerminalDockState;
  };
  onAppearanceModeChange: (mode: AppearanceMode) => void;
  onOpenWorkspaceSettings: () => void;
  onSearchQueryChange: (value: string) => void;
  onOpenFile: (filePath: string) => void;
  onOpenTag: (tag: string) => void;
  onStartDocumentDrag: (filePath: string) => void;
  onEndDocumentDrag: () => void;
  onCreateFile: (directoryPath: string) => void;
  onCreateDirectory: (directoryPath: string) => void;
  onCreateTerminalInDirectory: (directoryPath: string) => void;
  onRenamePath: (targetPath: string) => void;
  onDeletePath: (targetPath: string) => void;
  onWriteTerminal: (id: string, data: string) => void;
  onResizeTerminal: (id: string, cols: number, rows: number) => void;
  onKillTerminal: (id: string) => void;
  onCreateTerminal: (kind: "shell" | "claude" | "codex") => void;
  onSetActiveTerminal: (id: string) => void;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
  onFocusAgent: (id: string) => void;
  onMoveDocumentToSplit: (orientation: "right" | "bottom") => void;
  terminalDragActive: boolean;
  documentDragActive: boolean;
}

export function ShellLayout(props: ShellLayoutProps) {
  const {
    noteSections,
    projectSections,
    appearanceMode,
    resolvedAppearance,
    searchQuery,
    searchResults,
    noteContent,
    activeDocument,
    activeKnowledge,
    activeTag,
    tagResults,
    terminalSessions,
    activeTerminalId,
    terminalBuffers,
    terminalOutputPreviewById,
    agentAnnotations,
    observedAgents,
    compactEditorChrome,
    shellLayout,
    onAppearanceModeChange,
    onOpenWorkspaceSettings,
    onSearchQueryChange,
    onOpenFile,
    onOpenTag,
    onStartDocumentDrag,
    onEndDocumentDrag,
    onCreateFile,
    onCreateDirectory,
    onCreateTerminalInDirectory,
    onRenamePath,
    onDeletePath,
    onWriteTerminal,
    onResizeTerminal,
    onKillTerminal,
    onCreateTerminal,
    onSetActiveTerminal,
    onOpenTarget,
    onOpenExternal,
    onFocusAgent,
    onMoveDocumentToSplit,
    terminalDragActive,
    documentDragActive,
  } = props;

  const {
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
    terminalDock,
  } = shellLayout;

  const terminalDockRef = useRef<HTMLDivElement | null>(null);
  const terminalEmpty = terminalSessions.length === 0;
  const effectiveTerminalPlacement = terminalEmpty ? "bottom" : terminalDock.placement;
  const terminalRailCollapsed = terminalDock.collapsed;
  const rightDockWidth = Math.max(312, terminalDock.rightWidth);
  const terminalRegionWidth = terminalRailCollapsed ? 42 : rightDockWidth + 42;
  return (
    <div
      className={`shell ${sidebarCollapsed ? "shell--sidebar-collapsed" : ""}`}
      style={{ gridTemplateColumns: `${sidebarCollapsed ? 48 : 240}px 1fr` }}
    >
      <FileTree
        collapsed={sidebarCollapsed}
        noteRoots={noteSections}
        projectRoots={projectSections}
        appearanceMode={appearanceMode}
        resolvedAppearance={resolvedAppearance}
        searchQuery={searchQuery}
        searchResults={searchResults}
        onAppearanceModeChange={onAppearanceModeChange}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
        onOpenWorkspaceSettings={onOpenWorkspaceSettings}
        onSearchQueryChange={onSearchQueryChange}
        onOpenFile={onOpenFile}
        onOpenTag={onOpenTag}
        onStartDocumentDrag={onStartDocumentDrag}
        onEndDocumentDrag={onEndDocumentDrag}
        onCreateFile={onCreateFile}
        onCreateDirectory={onCreateDirectory}
        onCreateTerminal={onCreateTerminalInDirectory}
        onRenamePath={onRenamePath}
        onDeletePath={onDeletePath}
      />

      <div ref={workspaceRef} className="workspace">
        <div
          ref={workspaceBodyRef}
          className={`workspace__body workspace__body--terminal-${effectiveTerminalPlacement}`}
          style={
            effectiveTerminalPlacement === "right"
              ? {
                  gridTemplateColumns: `minmax(0, 1fr) ${terminalRailCollapsed ? "0px" : "8px"} ${
                    terminalRailCollapsed ? "0px" : `${terminalDock.rightWidth}px`
                  } 42px`,
                }
              : {
                  gridTemplateColumns: `minmax(0, 1fr) 42px`,
                  gridTemplateRows: `minmax(0, 1fr) ${terminalRailCollapsed ? "0px" : "8px"} ${
                    terminalRailCollapsed ? "0px" : `${terminalDock.bottomHeight}px`
                  }`,
                }
          }
        >
          <div
            ref={editorAreaRef}
            className={`editor-area ${editorSplitOrientation === "right" ? "editor-area--split-right" : ""} ${editorSplitOrientation === "bottom" ? "editor-area--split-bottom" : ""}`}
          >
            <div className="editor-area__main">
              {noteContent}
              <InspectorDock
                document={activeDocument}
                knowledge={activeKnowledge}
                open={!inspectorCollapsed}
                activeTag={activeTag}
                tagResults={tagResults}
                onToggle={() => setInspectorCollapsed((current) => !current)}
                onOpenTarget={onOpenTarget}
                onOpenExternal={onOpenExternal}
                onOpenTag={onOpenTag}
              />

              {documentDragActive ? (
                <div className="dock-drop-zones dock-drop-zones--document">
                  <button
                    className={`dock-drop-zone dock-drop-zone--right ${editorSplitOrientation === "right" ? "dock-drop-zone--active" : ""}`}
                    data-testid="editor-drop-right"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => onMoveDocumentToSplit("right")}
                    type="button"
                  >
                    Split Right
                  </button>
                  <button
                    className={`dock-drop-zone dock-drop-zone--bottom ${editorSplitOrientation === "bottom" ? "dock-drop-zone--active" : ""}`}
                    data-testid="editor-drop-bottom"
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => onMoveDocumentToSplit("bottom")}
                    type="button"
                  >
                    Split Bottom
                  </button>
                </div>
              ) : null}
            </div>
          </div>

          {terminalRailCollapsed ? null : (
            <div
              className={`pane-resizer ${effectiveTerminalPlacement === "right" ? "pane-resizer--vertical" : "pane-resizer--horizontal"}`}
              onMouseDown={(event) =>
                terminalDock.startResize(
                  effectiveTerminalPlacement === "right" ? "vertical" : "horizontal",
                  effectiveTerminalPlacement === "right" ? event.clientX : event.clientY,
                )
              }
            />
          )}

          <TerminalDock
            ref={terminalDockRef}
            placement={effectiveTerminalPlacement}
            compact={compactEditorChrome || terminalRailCollapsed || effectiveTerminalPlacement === "right"}
            empty={terminalEmpty}
            style={
              effectiveTerminalPlacement === "right"
                ? { gridColumn: 3, gridRow: 1 }
                : { gridColumn: 1, gridRow: 3 }
            }
            sessions={terminalSessions}
            activeTerminalId={activeTerminalId}
            buffers={terminalBuffers}
            appearance={resolvedAppearance}
            onSetActiveTerminal={onSetActiveTerminal}
            onWrite={onWriteTerminal}
            onResize={onResizeTerminal}
            onKill={onKillTerminal}
            onStartDockDrag={() => terminalDock.setActiveDrag(true)}
            onEndDockDrag={() => terminalDock.setActiveDrag(false)}
            onTogglePlacement={() => terminalDock.moveDock(terminalDock.placement === "right" ? "bottom" : "right")}
            headerActions={null}
            overlay={
              !terminalRailCollapsed ? (
                <SubagentDock
                  open={!subagentsCollapsed}
                  containerRef={terminalDockRef}
                  terminalSessions={terminalSessions}
                  activeTerminalId={activeTerminalId}
                  terminalOutputPreviewById={terminalOutputPreviewById}
                  agentAnnotations={agentAnnotations}
                  observedAgents={observedAgents}
                  onToggle={() => setSubagentsCollapsed((current) => !current)}
                  onFocusAgent={onFocusAgent}
                />
              ) : null
            }
          />

          <TerminalRail
            placement={effectiveTerminalPlacement}
            collapsed={terminalRailCollapsed}
            style={{ gridColumn: effectiveTerminalPlacement === "right" ? 4 : 2, gridRow: effectiveTerminalPlacement === "right" ? 1 : "1 / span 3" }}
            onToggleCollapsed={() => {
              if (terminalRailCollapsed && terminalEmpty) {
                onCreateTerminal("shell");
              } else {
                terminalDock.toggleCollapsed();
              }
            }}
            onCreateTerminal={onCreateTerminal}
          />

          {terminalDragActive ? (
            <div className="dock-drop-zones dock-drop-zones--terminal">
              <button
                className={`dock-drop-zone dock-drop-zone--right ${terminalDock.placement === "right" ? "dock-drop-zone--active" : ""}`}
                data-testid="dock-drop-right"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  terminalDock.moveDock("right");
                  terminalDock.setActiveDrag(false);
                }}
                type="button"
              >
                Dock Right
              </button>
              <button
                className={`dock-drop-zone dock-drop-zone--bottom ${terminalDock.placement === "bottom" ? "dock-drop-zone--active" : ""}`}
                data-testid="dock-drop-bottom"
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  terminalDock.moveDock("bottom");
                  terminalDock.setActiveDrag(false);
                }}
                type="button"
              >
                Dock Bottom
              </button>
            </div>
          ) : null}
        </div>

      </div>
    </div>
  );
}
