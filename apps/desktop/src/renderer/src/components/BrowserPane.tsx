import { FormEvent, useEffect, useMemo, useState } from "react";
import { Globe2, RotateCw, X } from "lucide-react";

import type { DragManager } from "../hooks/useDragManager";
import { ChromeTab } from "./Chrome";

interface BrowserPaneProps {
  paneId: string;
  url: string;
  compact: boolean;
  onFocus: () => void;
  onNavigate: (target: string) => Promise<string>;
  onClosePane: (() => void) | null;
  dragManager: DragManager;
}

export function BrowserPane(props: BrowserPaneProps) {
  const { paneId, url, compact, onFocus, onNavigate, onClosePane, dragManager } = props;
  const [draftUrl, setDraftUrl] = useState(url);
  const [error, setError] = useState<string | null>(null);
  const safeUrl = useMemo(() => trustedPreviewFrameUrl(url), [url]);

  useEffect(() => {
    setDraftUrl(url);
  }, [url]);

  function focusPreviewPane() {
    onFocus();
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void onNavigate(draftUrl)
      .then((nextUrl) => {
        setError(null);
        setDraftUrl(nextUrl);
      })
      .catch((caught) => {
        setError(caught instanceof Error ? caught.message : "Unable to load preview target.");
      });
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
        <div className="browser-pane__empty">{error ?? "Enter a local or localhost URL to preview."}</div>
      ) : (
        <iframe
          key={safeUrl}
          className="browser-pane__frame"
          data-testid="browser-preview-frame"
          referrerPolicy="no-referrer"
          sandbox="allow-forms allow-scripts"
          src={safeUrl}
          title="Preview"
        />
      )}
    </section>
  );
}

function trustedPreviewFrameUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "about:blank";
  }
  if (trimmed === "about:blank") {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "file:") {
      return parsed.toString();
    }
    if ((parsed.protocol === "http:" || parsed.protocol === "https:") && isLocalhost(parsed.hostname)) {
      return parsed.toString();
    }
  } catch {
    return "about:blank";
  }
  return "about:blank";
}

function isLocalhost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1" || normalized === "[::1]";
}
