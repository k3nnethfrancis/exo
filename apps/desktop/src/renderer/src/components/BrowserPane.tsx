import { FormEvent, useEffect, useMemo, useState } from "react";
import { Globe2, RotateCw, X } from "lucide-react";

import type { DragManager } from "../hooks/useDragManager";
import { ChromeTab } from "./Chrome";
import { refreshAllTerminals } from "./terminalRegistry";

interface BrowserPaneProps {
  paneId: string;
  url: string;
  compact: boolean;
  onFocus: () => void;
  onNavigate: (url: string) => void;
  onClosePane: (() => void) | null;
  dragManager: DragManager;
}

export function BrowserPane(props: BrowserPaneProps) {
  const { paneId, url, compact, onFocus, onNavigate, onClosePane, dragManager } = props;
  const [draftUrl, setDraftUrl] = useState(url);
  const safeUrl = useMemo(() => normalizeBrowserUrl(url), [url]);

  useEffect(() => {
    return schedulePreviewTerminalRefresh();
  }, [safeUrl]);

  useEffect(() => {
    let cancelPendingRefresh = () => {};
    const refresh = () => {
      cancelPendingRefresh();
      cancelPendingRefresh = schedulePreviewTerminalRefresh();
    };
    const eventNames: Array<"focus" | "blur" | "resize" | "pageshow" | "visibilitychange"> = [
      "focus",
      "blur",
      "resize",
      "pageshow",
      "visibilitychange",
    ];
    for (const eventName of eventNames) {
      window.addEventListener(eventName, refresh);
    }
    return () => {
      cancelPendingRefresh();
      for (const eventName of eventNames) {
        window.removeEventListener(eventName, refresh);
      }
    };
  }, []);

  function focusPreviewPane() {
    onFocus();
    schedulePreviewTerminalRefresh();
  }

  function refreshPreviewTerminals() {
    schedulePreviewTerminalRefresh();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUrl = normalizeBrowserUrl(draftUrl);
    setDraftUrl(nextUrl);
    onNavigate(nextUrl);
  }

  return (
    <section className={`browser-pane ${compact ? "browser-pane--compact" : ""}`} data-testid="browser-pane" onMouseDown={focusPreviewPane}>
      <div className="browser-pane__header">
        <ChromeTab
          active
          className="browser-tab"
          testId="browser-tab-preview"
          dropPaneId={paneId}
          dropKind="browser"
          onClick={focusPreviewPane}
          onMouseDown={(event) => {
            dragManager.startDrag(event, {
              kind: "browser",
              url: safeUrl,
              sourcePaneId: paneId,
            });
          }}
          leading={<Globe2 size={13} />}
          closeLabel="Close preview pane"
          closeIcon={<X size={12} />}
          onClose={onClosePane ? (event) => {
            event.stopPropagation();
            onClosePane();
          } : undefined}
        >
          Preview
        </ChromeTab>
        <form className="browser-pane__address" onSubmit={submit}>
          <input
            aria-label="Preview URL"
            data-testid="browser-url-input"
            value={draftUrl}
            onChange={(event) => setDraftUrl(event.target.value)}
            spellCheck={false}
          />
          <button aria-label="Load preview URL" className="browser-pane__button" data-testid="browser-load-url" type="submit">
            <RotateCw size={13} />
          </button>
        </form>
      </div>
      {safeUrl === "about:blank" ? (
        <div className="browser-pane__empty">Enter a local URL to preview.</div>
      ) : (
        <webview
          className="browser-pane__webview"
          data-testid="browser-webview"
          src={safeUrl}
          onBlur={refreshPreviewTerminals}
          onFocus={refreshPreviewTerminals}
          onLoad={refreshPreviewTerminals}
        />
      )}
    </section>
  );
}

interface PreviewRefreshScheduler {
  requestAnimationFrame: typeof window.requestAnimationFrame;
  cancelAnimationFrame: typeof window.cancelAnimationFrame;
  setTimeout: typeof window.setTimeout;
  clearTimeout: typeof window.clearTimeout;
}

export function schedulePreviewTerminalRefresh(
  refresh: () => void = refreshAllTerminals,
  scheduler: PreviewRefreshScheduler = window,
): () => void {
  refresh();
  const frameId = scheduler.requestAnimationFrame(refresh);
  const timerIds = [
    scheduler.setTimeout(refresh, 75),
    scheduler.setTimeout(refresh, 250),
  ];

  return () => {
    scheduler.cancelAnimationFrame(frameId);
    for (const timerId of timerIds) {
      scheduler.clearTimeout(timerId);
    }
  };
}

function normalizeBrowserUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "about:blank";
  }
  if (trimmed === "about:blank" || /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `http://${trimmed}`;
}
