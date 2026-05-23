import { FormEvent, useMemo, useState } from "react";
import { Globe2, RotateCw, X } from "lucide-react";

interface BrowserPaneProps {
  url: string;
  compact: boolean;
  onFocus: () => void;
  onNavigate: (url: string) => void;
  onClosePane: (() => void) | null;
}

export function BrowserPane(props: BrowserPaneProps) {
  const { url, compact, onFocus, onNavigate, onClosePane } = props;
  const [draftUrl, setDraftUrl] = useState(url);
  const safeUrl = useMemo(() => normalizeBrowserUrl(url), [url]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextUrl = normalizeBrowserUrl(draftUrl);
    setDraftUrl(nextUrl);
    onNavigate(nextUrl);
  }

  return (
    <section className={`browser-pane ${compact ? "browser-pane--compact" : ""}`} data-testid="browser-pane" onMouseDown={onFocus}>
      <div className="browser-pane__header">
        <div className="browser-pane__title">
          <Globe2 size={14} />
          Preview
        </div>
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
        {onClosePane ? (
          <button aria-label="Close preview pane" className="browser-pane__button" onClick={onClosePane} type="button">
            <X size={13} />
          </button>
        ) : null}
      </div>
      {safeUrl === "about:blank" ? (
        <div className="browser-pane__empty">Enter a local URL to preview.</div>
      ) : (
        <webview
          className="browser-pane__webview"
          data-testid="browser-webview"
          src={safeUrl}
        />
      )}
    </section>
  );
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
