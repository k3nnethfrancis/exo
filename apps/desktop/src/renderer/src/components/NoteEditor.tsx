import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";

import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { EditorSelection, type EditorState } from "@codemirror/state";
import { keymap, lineNumbers, EditorView, type ViewUpdate } from "@codemirror/view";
import { Code2, GitBranch, Save, SlidersHorizontal } from "lucide-react";
import type { BranchFamily, NoteDocument } from "@exo/core";
import { exoEditorTheme, exoSyntaxHighlighting } from "../theme/codemirror";
import type { ExoThemeVariant } from "../theme/types";
import { codeLanguageForPath } from "./codeLanguages";
import { coerceFrontmatterValue, getDocumentDisplayTitle, stringifyFrontmatterValue } from "./documentDisplay";
import { markdownLivePreview } from "./markdownLivePreview";

const WIKILINK_COMPLETION_LIMIT = 3;

type WikilinkSuggestion = { label: string; target: string; detail?: string };

interface WikilinkSuggestionState {
  from: number;
  to: number;
  left: number;
  top: number;
  items: WikilinkSuggestion[];
}

interface EditorDocument extends NoteDocument {
  dirty: boolean;
}

interface NoteEditorProps {
  document: EditorDocument | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  branchFamily: BranchFamily | null;
  propertiesCollapsed: boolean;
  onToggleProperties: () => void;
  onUpdateFrontmatter: (key: string, value: unknown) => void;
  onBodyChange: (body: string) => void;
  onSave: () => void | Promise<void>;
  onOpenTag: (tag: string) => void;
  onOpenTarget: (target: string) => void;
  onOpenBranch: (filePath: string) => void;
  onSuggestTargets: (query: string) => Promise<Array<{ label: string; target: string; detail?: string }>>;
  onCreateBranch: () => void;
  onFocus: () => void;
  theme: ExoThemeVariant;
  fontSize: number;
  onZoomEditor: (direction: -1 | 0 | 1) => void;
  compact: boolean;
  isNoteDocument: boolean;
  revealLineRequest?: { filePath: string; line: number; nonce: number } | null;
  scrollRestoreRequest?: { filePath: string; scrollTop: number; nonce: number } | null;
}

export function NoteEditor(props: NoteEditorProps) {
  const {
    document,
    saveStatus,
    branchFamily,
    propertiesCollapsed,
    onToggleProperties,
    onUpdateFrontmatter,
    onBodyChange,
    onSave,
    onOpenTag,
    onOpenTarget,
    onOpenBranch,
    onSuggestTargets,
    onCreateBranch,
    onFocus,
    theme,
    fontSize,
    onZoomEditor,
    compact,
    isNoteDocument,
    revealLineRequest,
    scrollRestoreRequest,
  } = props;
  const [rawMarkdownMode, setRawMarkdownMode] = useState(false);
  const codeMirrorRef = useRef<ReactCodeMirrorRef>(null);
  const scrollTopByPathRef = useRef<Map<string, number>>(new Map());
  const selectionByPathRef = useRef<Map<string, { anchor: number; head: number }>>(new Map());
  const previousBodyRef = useRef(document?.body ?? "");
  const previousPathRef = useRef(document?.filePath ?? "");
  const restoringScrollRef = useRef(false);
  const processedRevealLineNonceRef = useRef<number | null>(null);
  const processedScrollRestoreNonceRef = useRef<number | null>(null);
  const wikilinkSuggestionRequestRef = useRef(0);
  const suppressedWikilinkCompletionRef = useRef<{ pos: number; text: string } | null>(null);
  const [wikilinkSuggestions, setWikilinkSuggestions] = useState<WikilinkSuggestionState | null>(null);

  useEffect(() => {
    setRawMarkdownMode(false);
    setWikilinkSuggestions(null);
    suppressedWikilinkCompletionRef.current = null;
  }, [document?.filePath]);

  const documentPath = document?.filePath ?? "";
  const documentBody = document?.body ?? "";
  const isMarkdown = document?.kind === "markdown";
  const useMarkdownEditing = isMarkdown && isNoteDocument;
  const displayTitle = document ? getDocumentDisplayTitle(document.filePath, document.kind) : "";
  const suppressedGeneratedTitle = useMemo(
    () => (document && useMarkdownEditing ? generatedDailyTitleForPath(document.filePath) : null),
    [document, useMarkdownEditing],
  );
  const codeLanguage = useMemo(() => {
    if (!document || useMarkdownEditing) {
      return null;
    }
    if (document.kind === "markdown") {
      return { id: "markdown", label: "Markdown", extensions: [markdown()] };
    }
    return codeLanguageForPath(document.filePath);
  }, [document, useMarkdownEditing]);
  const frontmatterEntries = document ? Object.entries(document.frontmatter).filter(([key]) => !key.startsWith("branch_")) : [];
  const cmTheme = useMemo(() => exoEditorTheme(theme, fontSize), [fontSize, theme]);
  const syntaxTheme = useMemo(() => exoSyntaxHighlighting(theme), [theme]);
  const selectionTracker = useMemo(
    () =>
      EditorView.updateListener.of((update) => {
        if (!documentPath || !update.selectionSet) {
          return;
        }
        const range = update.state.selection.main;
        selectionByPathRef.current.set(documentPath, { anchor: range.anchor, head: range.head });
      }),
    [documentPath],
  );
  const maybeUpdateWikilinkSuggestions = useMemo(
    () =>
      (update: ViewUpdate) => {
        if (!useMarkdownEditing || rawMarkdownMode) {
          setWikilinkSuggestions(null);
          return;
        }
        const range = update.state.selection.main;
        if (!range.empty) {
          setWikilinkSuggestions(null);
          return;
        }
        const linkContext = getWikilinkCompletionContext(update.state, range.head);
        if (!linkContext) {
          suppressedWikilinkCompletionRef.current = null;
          setWikilinkSuggestions(null);
          return;
        }
        const suppressed = suppressedWikilinkCompletionRef.current;
        const linkText = update.state.doc.sliceString(linkContext.from, linkContext.to);
        if (suppressed && suppressed.pos === range.head && suppressed.text === linkText) {
          setWikilinkSuggestions(null);
          return;
        }
        suppressedWikilinkCompletionRef.current = null;

        const requestId = ++wikilinkSuggestionRequestRef.current;
        const cursorCoords = update.view.coordsAtPos(range.head);
        const surface = update.view.dom.closest<HTMLElement>(".editor-surface");
        const surfaceRect = surface?.getBoundingClientRect();
        const left = cursorCoords && surfaceRect ? cursorCoords.left - surfaceRect.left : 24;
        const top = cursorCoords && surfaceRect ? cursorCoords.bottom - surfaceRect.top + 4 : 48;
        void onSuggestTargets(linkContext.query).then((suggestions) => {
          if (requestId !== wikilinkSuggestionRequestRef.current) {
            return;
          }
          const currentRange = update.view.state.selection.main;
          const currentContext = currentRange.empty ? getWikilinkCompletionContext(update.view.state, currentRange.head) : null;
          if (!currentContext || currentContext.query !== linkContext.query) {
            setWikilinkSuggestions(null);
            return;
          }
          const items = suggestions.slice(0, WIKILINK_COMPLETION_LIMIT);
          setWikilinkSuggestions(items.length > 0 ? { ...currentContext, left, top, items } : null);
        }).catch(() => {
          if (requestId === wikilinkSuggestionRequestRef.current) {
            setWikilinkSuggestions(null);
          }
        });
      },
    [onSuggestTargets, rawMarkdownMode, useMarkdownEditing],
  );
  const handleEditorChange = useMemo(
    () =>
      (value: string, update: ViewUpdate) => {
        onBodyChange(value);
        maybeUpdateWikilinkSuggestions(update);
      },
    [maybeUpdateWikilinkSuggestions, onBodyChange],
  );
  const acceptWikilinkSuggestion = useMemo(
    () =>
      (suggestion: WikilinkSuggestion) => {
        const view = codeMirrorRef.current?.view;
        const active = wikilinkSuggestions;
        if (!view || !active) {
          return;
        }
        const insert = `[[${suggestion.target}]]`;
        view.dispatch({
          changes: { from: active.from, to: active.to, insert },
          selection: { anchor: active.from + insert.length },
          userEvent: "input.complete",
        });
        suppressedWikilinkCompletionRef.current = { pos: active.from + insert.length, text: insert };
        setWikilinkSuggestions(null);
        view.focus();
      },
    [wikilinkSuggestions],
  );
  const handleEditorSurfaceKeyDown = useMemo(
    () =>
      (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Escape" && wikilinkSuggestions) {
          event.preventDefault();
          event.stopPropagation();
          setWikilinkSuggestions(null);
          return;
        }
        if (event.key !== "Enter" || !wikilinkSuggestions || wikilinkSuggestions.items.length === 0) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        acceptWikilinkSuggestion(wikilinkSuggestions.items[0]);
      },
    [acceptWikilinkSuggestion, wikilinkSuggestions],
  );
  const saveKeymap = useMemo(
    () =>
      keymap.of([
        {
          key: "Mod-s",
          run: () => {
            onSave();
            return true;
          },
        },
        {
          key: "Mod-=",
          run: () => {
            onZoomEditor(1);
            return true;
          },
        },
        {
          key: "Mod-Shift-=",
          run: () => {
            onZoomEditor(1);
            return true;
          },
        },
        {
          key: "Mod--",
          run: () => {
            onZoomEditor(-1);
            return true;
          },
        },
        {
          key: "Mod-0",
          run: () => {
            onZoomEditor(0);
            return true;
          },
        },
        indentWithTab,
        ...lintKeymap,
      ]),
    [onSave, onZoomEditor],
  );
  const bodyChanged = document !== null && previousPathRef.current === document.filePath && previousBodyRef.current !== document.body;
  if (bodyChanged) {
    restoringScrollRef.current = true;
  }

  useEffect(() => {
    if (!document) {
      return;
    }

    const scroller = codeMirrorRef.current?.view?.scrollDOM;
    if (!scroller) {
      return;
    }

    const recordScroll = () => {
      if (!restoringScrollRef.current) {
        scrollTopByPathRef.current.set(document.filePath, scroller.scrollTop);
      }
    };
    const handleScroll = () => {
      recordScroll();
    };
    const interval = window.setInterval(recordScroll, 250);

    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      window.clearInterval(interval);
      scroller.removeEventListener("scroll", handleScroll);
    };
  }, [document, documentPath, rawMarkdownMode, theme, fontSize]);

  useLayoutEffect(() => {
    if (!document) {
      return;
    }

    const scroller = codeMirrorRef.current?.view?.scrollDOM;
    const scrollTop = scrollTopByPathRef.current.get(document.filePath);
    if (!scroller || scrollTop === undefined) {
      previousPathRef.current = document.filePath;
      previousBodyRef.current = document.body;
      restoringScrollRef.current = false;
      return;
    }

    previousPathRef.current = document.filePath;
    previousBodyRef.current = document.body;

    const restore = () => {
      scroller.scrollTop = scrollTop;
      const view = codeMirrorRef.current?.view;
      const selection = selectionByPathRef.current.get(document.filePath);
      if (view && selection) {
        const anchor = clampPosition(selection.anchor, view.state.doc.length);
        const head = clampPosition(selection.head, view.state.doc.length);
        const current = view.state.selection.main;
        if (current.anchor !== anchor || current.head !== head) {
          view.dispatch({ selection: EditorSelection.range(anchor, head) });
        }
      }
    };
    const frame = window.requestAnimationFrame(restore);
    const interval = window.setInterval(restore, 50);
    const timeout = window.setTimeout(() => {
      restore();
      window.clearInterval(interval);
      restoringScrollRef.current = false;
    }, 650);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [document, documentPath, documentBody, rawMarkdownMode, theme, fontSize]);

  useEffect(() => {
    if (!document || !revealLineRequest || revealLineRequest.filePath !== document.filePath) {
      return;
    }
    if (processedRevealLineNonceRef.current === revealLineRequest.nonce) {
      return;
    }

    processedRevealLineNonceRef.current = revealLineRequest.nonce;
    const reveal = () => {
      const view = codeMirrorRef.current?.view;
      if (!view) {
        return;
      }
      const lineNumber = Math.max(1, Math.min(revealLineRequest.line, view.state.doc.lines));
      const line = view.state.doc.line(lineNumber);
      view.dispatch({
        selection: { anchor: line.from },
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });
      view.focus();
    };

    const frame = window.requestAnimationFrame(reveal);
    const interval = window.setInterval(reveal, 50);
    const timeout = window.setTimeout(() => {
      reveal();
      window.clearInterval(interval);
    }, 350);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [document, documentPath, revealLineRequest]);

  useLayoutEffect(() => {
    if (!document || !scrollRestoreRequest || scrollRestoreRequest.filePath !== document.filePath) {
      return;
    }
    if (processedScrollRestoreNonceRef.current === scrollRestoreRequest.nonce) {
      return;
    }

    const scroller = codeMirrorRef.current?.view?.scrollDOM;
    if (!scroller) {
      return;
    }

    processedScrollRestoreNonceRef.current = scrollRestoreRequest.nonce;
    restoringScrollRef.current = true;
    const restore = () => {
      scroller.scrollTop = scrollRestoreRequest.scrollTop;
      const view = codeMirrorRef.current?.view;
      const selection = selectionByPathRef.current.get(document.filePath);
      if (view && selection) {
        const anchor = clampPosition(selection.anchor, view.state.doc.length);
        const head = clampPosition(selection.head, view.state.doc.length);
        const current = view.state.selection.main;
        if (current.anchor !== anchor || current.head !== head) {
          view.dispatch({ selection: EditorSelection.range(anchor, head) });
        }
      }
    };
    restore();
    const frame = window.requestAnimationFrame(restore);
    const interval = window.setInterval(restore, 50);
    const timeout = window.setTimeout(() => {
      restore();
      window.clearInterval(interval);
      restoringScrollRef.current = false;
    }, 650);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [document, documentPath, scrollRestoreRequest]);

  if (!document) {
    return (
      <section className="editor-panel editor-panel--empty" data-testid="editor-empty">
        <h1>Exo</h1>
        <p>Open a note from the left sidebar to begin.</p>
      </section>
    );
  }

  return (
    <section className={`editor-panel ${compact ? "editor-panel--compact" : ""}`} data-testid="editor-panel" onMouseDown={onFocus}>
      <div className="editor-panel__header">
        <div className="editor-panel__summary">
          <div className="editor-panel__title-row">
            {useMarkdownEditing ? (
              <button
                aria-label={propertiesCollapsed ? "Show properties" : "Hide properties"}
                className={`toolbar-button toolbar-button--icon ${compact ? "toolbar-button--compact" : ""}`}
                data-testid="toggle-properties"
                onClick={onToggleProperties}
                title={propertiesCollapsed ? "Show properties" : "Hide properties"}
                type="button"
              >
                <SlidersHorizontal size={14} />
              </button>
            ) : null}
            <div className="editor-panel__title" data-testid="editor-title" title={document.filePath}>
              {displayTitle}
            </div>
          </div>
        </div>

        <div className="editor-panel__actions">
          <span
            className={`editor-panel__save-state editor-panel__save-state--${saveStatus}`}
            data-testid="editor-save-status"
          >
            {saveStatus === "saving" ? "Saving" : saveStatus === "saved" ? "Saved" : saveStatus === "error" ? "Save failed" : document.dirty ? "Unsaved" : "Saved"}
          </span>
          <button
            aria-label="Save document"
            className={`toolbar-button toolbar-button--icon ${compact ? "toolbar-button--compact" : ""}`}
            data-testid="editor-save"
            disabled={!document.dirty || saveStatus === "saving"}
            onClick={() => void onSave()}
            title={document.dirty ? "Save" : "No unsaved changes"}
            type="button"
          >
            <Save size={14} />
          </button>
          {useMarkdownEditing && branchFamily ? (
            <div className="branch-selector branch-selector--icon-only" data-testid="branch-selector-wrap" title="Branches">
              <GitBranch size={14} />
              <select
                aria-label="Branch selector"
                className="branch-selector__select"
                data-testid="branch-selector"
                value={document.filePath}
                onChange={(event) => {
                  if (event.target.value === "__create__") {
                    onCreateBranch();
                    return;
                  }
                  onOpenBranch(event.target.value);
                }}
                title="Branches"
              >
                {branchFamily.members.map((member) => (
                  <option key={member.filePath} value={member.filePath}>
                    {member.isRoot
                      ? displayTitle
                      : `${member.path.join(".") || "Branch"} · ${getDocumentDisplayTitle(member.filePath, "markdown")}`}
                  </option>
                ))}
                <option value="__create__">Create branch…</option>
              </select>
            </div>
          ) : null}
          {useMarkdownEditing ? (
            <button
              aria-label={rawMarkdownMode ? "Switch to live preview" : "Switch to raw markdown"}
              className={`toolbar-button toolbar-button--icon ${compact ? "toolbar-button--compact" : ""}`}
              data-testid="toggle-markdown-mode"
              onClick={() => setRawMarkdownMode((current) => !current)}
              title={rawMarkdownMode ? "Live preview" : "Raw markdown"}
              type="button"
            >
              <Code2 size={14} />
            </button>
          ) : null}
        </div>
      </div>

      {useMarkdownEditing && !propertiesCollapsed ? (
        <div className="properties-card" data-testid="properties-panel">
          <div className="properties-card__content">
            {frontmatterEntries.map(([key, value]) => (
              <div key={key} className="properties-card__row">
                <label className="properties-card__key" htmlFor={`property-${key}`}>
                  {key}
                </label>
                <div className="properties-card__field">
                  <input
                    id={`property-${key}`}
                    className="properties-card__input"
                    type="text"
                    value={stringifyFrontmatterValue(value)}
                    onChange={(event) => onUpdateFrontmatter(key, coerceFrontmatterValue(event.target.value, value))}
                  />
                  {key === "tags" ? (
                    <div className="tag-list">
                      {(Array.isArray(document.frontmatter.tags)
                        ? document.frontmatter.tags.filter((entry): entry is string => typeof entry === "string")
                        : typeof document.frontmatter.tags === "string"
                          ? document.frontmatter.tags.split(/[,\s]+/)
                          : []
                      ).map((tag) => (
                        <button key={tag} className="tag-pill" onClick={() => onOpenTag(tag.replace(/^#/, ""))} type="button">
                          #{tag.replace(/^#/, "")}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : !useMarkdownEditing ? (
        <div className="properties-card properties-card--file" data-testid="properties-panel">
          <div className="properties-card__file-label">Project file</div>
          <div className="properties-card__file-meta">
            <span>{codeLanguage?.label ?? "Plain text"}</span>
            <span>{document.filePath}</span>
          </div>
        </div>
      ) : null}

      <div
        className={`editor-surface ${useMarkdownEditing && !rawMarkdownMode ? "editor-surface--live-preview" : ""} ${!useMarkdownEditing ? "editor-surface--code" : ""}`}
        onKeyDownCapture={handleEditorSurfaceKeyDown}
      >
        <CodeMirror
          ref={codeMirrorRef}
          key={`${document.filePath}:${useMarkdownEditing && !rawMarkdownMode ? "live" : "code"}:${theme.id}:${fontSize}`}
          value={document.body}
          extensions={
            useMarkdownEditing
              ? [
                  markdown(),
                  EditorView.lineWrapping,
                  saveKeymap,
                  selectionTracker,
                  ...(!rawMarkdownMode
                    ? [
                        markdownLivePreview({
                          onOpenTarget,
                          onOpenTag,
                          suppressedGeneratedTitle,
                        }),
                      ]
                    : []),
                  cmTheme,
                  syntaxTheme,
                ]
              : [
                  lineNumbers(),
                  foldGutter(),
                  bracketMatching(),
                  lintGutter(),
                  saveKeymap,
                  selectionTracker,
                  ...(codeLanguage?.extensions ?? []),
                  cmTheme,
                  syntaxTheme,
                ]
          }
          basicSetup={{
            autocompletion: false,
            lineNumbers: false,
            foldGutter: false,
            highlightSelectionMatches: false,
          }}
          onChange={handleEditorChange}
          height="100%"
        />
        {wikilinkSuggestions ? (
          <div
            className="wikilink-suggestions"
            data-testid="wikilink-suggestions"
            style={{ left: wikilinkSuggestions.left, top: wikilinkSuggestions.top }}
          >
            {wikilinkSuggestions.items.map((suggestion) => (
              <button
                key={suggestion.target}
                className="wikilink-suggestions__item"
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  acceptWikilinkSuggestion(suggestion);
                }}
              >
                <span className="wikilink-suggestions__label">{suggestion.label}</span>
                {suggestion.detail ? <span className="wikilink-suggestions__detail">{suggestion.detail}</span> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

    </section>
  );
}

function clampPosition(position: number, docLength: number): number {
  return Math.max(0, Math.min(position, docLength));
}

function getWikilinkCompletionContext(state: EditorState, pos: number): { from: number; to: number; query: string } | null {
  const line = state.doc.lineAt(pos);
  const offset = pos - line.from;
  const open = line.text.lastIndexOf("[[", offset);
  if (open < 0) {
    return null;
  }

  const close = line.text.indexOf("]]", open + 2);
  if (close !== -1 && offset > close + 2) {
    return null;
  }

  const queryEnd = close === -1 ? offset : close;
  const query = line.text.slice(open + 2, queryEnd);
  if (!query.trim() || /[\[\]\n]/.test(query)) {
    return null;
  }

  return {
    from: line.from + open,
    to: line.from + (close === -1 ? offset : close + 2),
    query,
  };
}

function generatedDailyTitleForPath(filePath: string): string | null {
  const displayTitle = getDocumentDisplayTitle(filePath, "markdown");
  return /^\d{4}-\d{2}-\d{2}$/.test(displayTitle) ? displayTitle : null;
}
