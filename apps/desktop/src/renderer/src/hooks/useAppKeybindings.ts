import { useEffect } from "react";

type ZoomSurface = "editor" | "terminal" | "explorer";

interface UseAppKeybindingsOptions {
  activeDocumentPath: string | null;
  zoomSurface: ZoomSurface;
  saveDocument: (filePath: string) => Promise<void>;
  openOrCreateDailyNote: () => Promise<void>;
  createShellTerminal: () => Promise<void>;
  updateFocusedSurfaceZoom: (direction: -1 | 0 | 1, surface?: ZoomSurface) => void;
}

export function useAppKeybindings(options: UseAppKeybindingsOptions) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && !event.altKey && isZoomKey(event.key)) {
        event.preventDefault();
        event.stopPropagation();
        options.updateFocusedSurfaceZoom(zoomDirection(event.key), resolveZoomSurface(event));
        return;
      }
      if (mod && event.key.toLowerCase() === "s" && options.activeDocumentPath) {
        // Let the editor keymap flush an active inline-agent composer into the
        // document model before saving. The window-level capture handler would
        // otherwise persist only the mention and drop the draft text.
        if (event.composedPath().some((entry) => entry instanceof Element && entry.closest(".cm-editor"))) {
          return;
        }
        event.preventDefault();
        void options.saveDocument(options.activeDocumentPath);
        return;
      }
      if (mod && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        void options.openOrCreateDailyNote();
        return;
      }
      if (isNewTerminalShortcut(event)) {
        event.preventDefault();
        void options.createShellTerminal();
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    options.activeDocumentPath,
    options.zoomSurface,
    options.saveDocument,
    options.openOrCreateDailyNote,
    options.createShellTerminal,
    options.updateFocusedSurfaceZoom,
  ]);
}

export function isNewTerminalShortcut(event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "repeat">): boolean {
  const mod = event.metaKey || event.ctrlKey;
  return mod && !event.shiftKey && !event.altKey && !event.repeat && event.key.toLowerCase() === "t";
}

function isZoomKey(key: string): boolean {
  return key === "+" || key === "=" || key === "-" || key === "_" || key === "0";
}

function zoomDirection(key: string): -1 | 0 | 1 {
  if (key === "-" || key === "_") {
    return -1;
  }
  if (key === "0") {
    return 0;
  }
  return 1;
}

function resolveZoomSurface(event: KeyboardEvent): ZoomSurface {
  for (const entry of event.composedPath()) {
    if (!(entry instanceof Element)) {
      continue;
    }
    if (entry.closest(".terminal-dock, .terminal-surface")) {
      return "terminal";
    }
    if (entry.closest(".editor-pane, .editor-panel, .cm-editor")) {
      return "editor";
    }
    if (entry.closest(".sidebar")) {
      return "explorer";
    }
  }

  const activeElement = document.activeElement;
  if (activeElement?.closest(".terminal-dock, .terminal-surface")) {
    return "terminal";
  }
  if (activeElement?.closest(".editor-pane, .editor-panel, .cm-editor")) {
    return "editor";
  }
  if (activeElement?.closest(".sidebar")) {
    return "explorer";
  }
  return "editor";
}
