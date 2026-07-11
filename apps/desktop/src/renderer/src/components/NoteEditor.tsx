import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { EditorSelection } from "@codemirror/state";
import { keymap, lineNumbers, EditorView, type ViewUpdate } from "@codemirror/view";
import { Code2, Plus, Send, Save, SlidersHorizontal } from "lucide-react";
import type { AgentCommand, InvocationRecord, NoteDocument, WorkspaceGraphContext } from "@exo/core";
import { parseAgentMentions, type ParsedAgentMention } from "@exo/core/agent-mention-parser";
import { exoEditorTheme, exoSyntaxHighlighting } from "../theme/codemirror";
import type { ExoThemeVariant } from "../theme/types";
import { codeLanguageForPath } from "./codeLanguages";
import { coerceFrontmatterValue, getDocumentDisplayTitle, stringifyFrontmatterValue } from "./documentDisplay";
import { markdownLivePreview, type MarkdownGraphReferences } from "./markdownLivePreview";
import {
  buildNoteGraphContext,
  graphReferencesForMarkdownMode,
  getWikilinkCompletionContext,
  wikilinkSuggestionEdit,
  WIKILINK_COMPLETION_LIMIT,
  type WikilinkSuggestion,
} from "../graphAffordances";

interface WikilinkSuggestionState {
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
  items: WikilinkSuggestion[];
}

interface WikilinkPreviewState {
  target: string;
  left: number;
  top: number;
  title: string;
  excerpt: string;
  loading: boolean;
}

interface EditorDocument extends NoteDocument {
  dirty: boolean;
}

interface NoteEditorProps {
  document: EditorDocument | null;
  graphContext: WorkspaceGraphContext | null;
  saveStatus: "idle" | "saving" | "saved" | "error";
  propertiesCollapsed: boolean;
  onToggleProperties: () => void;
  onUpdateFrontmatter: (key: string, value: unknown) => void;
  onBodyChange: (body: string) => void;
  onSave: () => void | Promise<void>;
  onOpenTag: (tag: string) => void;
  onOpenTarget: (target: string) => void;
  onSuggestTargets: (query: string) => Promise<Array<{ label: string; target: string; detail?: string }>>;
  onPreviewTarget: (target: string) => Promise<{ title: string; excerpt: string } | null>;
  agentCommands: AgentCommand[];
  onInvokeAgentMention: (mention: ParsedAgentMention) => void;
  invocationReview: NoteInvocationReview | null;
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
    graphContext: loadedGraphContext,
    saveStatus,
    propertiesCollapsed,
    onToggleProperties,
    onUpdateFrontmatter,
    onBodyChange,
    onSave,
    onOpenTag,
    onOpenTarget,
    onSuggestTargets,
    onPreviewTarget,
    agentCommands,
    onInvokeAgentMention,
    invocationReview,
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
  const [chromeVisible, setChromeVisible] = useState(false);
  const codeMirrorRef = useRef<ReactCodeMirrorRef>(null);
  const scrollTopByPathRef = useRef<Map<string, number>>(new Map());
  const selectionByPathRef = useRef<Map<string, { anchor: number; head: number }>>(new Map());
  const previousBodyRef = useRef(document?.body ?? "");
  const previousPathRef = useRef(document?.filePath ?? "");
  const restoringScrollRef = useRef(false);
  const processedRevealLineNonceRef = useRef<number | null>(null);
  const processedScrollRestoreNonceRef = useRef<number | null>(null);
  const wikilinkSuggestionRequestRef = useRef(0);
  const wikilinkPreviewRequestRef = useRef(0);
  const suppressedWikilinkCompletionRef = useRef<{ pos: number; text: string } | null>(null);
  const [wikilinkSuggestions, setWikilinkSuggestions] = useState<WikilinkSuggestionState | null>(null);
  const [wikilinkPreview, setWikilinkPreview] = useState<WikilinkPreviewState | null>(null);
  const [newPropertyKey, setNewPropertyKey] = useState("");
  const [newPropertyValue, setNewPropertyValue] = useState("");

  useEffect(() => {
    setRawMarkdownMode(false);
    setChromeVisible(false);
    setWikilinkSuggestions(null);
    setWikilinkPreview(null);
    suppressedWikilinkCompletionRef.current = null;
  }, [document?.filePath]);

  const documentPath = document?.filePath ?? "";
  const documentBody = document?.body ?? "";
  const useMarkdownEditing = shouldUseMarkdownRenderer(document);
  const showNoteMetadata = useMarkdownEditing && isNoteDocument;
  const displayTitle = document ? getDocumentDisplayTitle(document.filePath, document.kind) : "";
  const suppressedGeneratedTitle = useMemo(
    () => (document && showNoteMetadata ? generatedDailyTitleForPath(document.filePath) : null),
    [document, showNoteMetadata],
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
  const graphContext = useMemo(() => buildNoteGraphContext(loadedGraphContext), [loadedGraphContext]);
  const graphProperties = graphContext?.properties ?? document?.frontmatter ?? {};
  const graphPropertyEntries = Object.entries(graphProperties).filter(([key]) => !key.startsWith("branch_"));
  const cmTheme = useMemo(() => exoEditorTheme(theme, fontSize), [fontSize, theme]);
  const syntaxTheme = useMemo(() => exoSyntaxHighlighting(theme), [theme]);
  const graphReferences = useMemo((): MarkdownGraphReferences | null => {
    return graphReferencesForMarkdownMode(showNoteMetadata, rawMarkdownMode, graphContext);
  }, [graphContext, rawMarkdownMode, showNoteMetadata]);
  const activeAgentMention = useMemo(() => {
    if (!document || !showNoteMetadata || agentCommands.length === 0) {
      return null;
    }
    const enabledHandles = agentCommands.filter((command) => command.enabled).map((command) => command.handle);
    return parseAgentMentions(document.body, enabledHandles)[0] ?? null;
  }, [agentCommands, document, showNoteMetadata]);
  const normalizedNewPropertyKey = normalizeFrontmatterPropertyKey(newPropertyKey);
  const canAddProperty =
    Boolean(normalizedNewPropertyKey) &&
    !Object.prototype.hasOwnProperty.call(document?.frontmatter ?? {}, normalizedNewPropertyKey);
  const handleAddProperty = useMemo(
    () =>
      () => {
        if (!normalizedNewPropertyKey || !canAddProperty) {
          return;
        }
        onUpdateFrontmatter(normalizedNewPropertyKey, newPropertyValue);
        setNewPropertyKey("");
        setNewPropertyValue("");
      },
    [canAddProperty, newPropertyValue, normalizedNewPropertyKey, onUpdateFrontmatter],
  );
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
        const edit = wikilinkSuggestionEdit(active, suggestion);
        view.dispatch({
          changes: { from: active.from, to: active.to, insert: edit.insert },
          selection: { anchor: edit.selection },
          userEvent: "input.complete",
        });
        suppressedWikilinkCompletionRef.current = { pos: edit.selection, text: edit.insert };
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
  const handleEditorSurfaceMouseMove = useMemo(
    () =>
      (event: MouseEvent<HTMLDivElement>) => {
        if (!useMarkdownEditing || rawMarkdownMode) {
          return;
        }
        const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-exo-link-kind='wikilink'][data-exo-link-target]");
        if (!target) {
          wikilinkPreviewRequestRef.current += 1;
          setWikilinkPreview(null);
          return;
        }

        const linkTarget = target.dataset.exoLinkTarget;
        if (!linkTarget || wikilinkPreview?.target === linkTarget) {
          return;
        }

        const surface = target.closest<HTMLElement>(".editor-surface");
        const surfaceRect = surface?.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const left = surfaceRect ? targetRect.left - surfaceRect.left : 24;
        const top = surfaceRect ? targetRect.bottom - surfaceRect.top + 8 : 48;
        const requestId = ++wikilinkPreviewRequestRef.current;
        setWikilinkPreview({ target: linkTarget, left, top, title: linkTarget, excerpt: "", loading: true });

        void onPreviewTarget(linkTarget).then((preview) => {
          if (requestId !== wikilinkPreviewRequestRef.current) {
            return;
          }
          if (!preview) {
            setWikilinkPreview(null);
            return;
          }
          setWikilinkPreview({ target: linkTarget, left, top, title: preview.title, excerpt: preview.excerpt, loading: false });
        }).catch(() => {
          if (requestId === wikilinkPreviewRequestRef.current) {
            setWikilinkPreview(null);
          }
        });
      },
    [onPreviewTarget, rawMarkdownMode, useMarkdownEditing, wikilinkPreview?.target],
  );
  const handleEditorSurfaceMouseLeave = useMemo(
    () =>
      () => {
        wikilinkPreviewRequestRef.current += 1;
        setWikilinkPreview(null);
      },
    [],
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
      <div aria-hidden="true" className="editor-panel__chrome-reveal" onMouseEnter={() => setChromeVisible(true)} />
      <div className={`editor-panel__header ${chromeVisible ? "editor-panel__header--visible" : ""}`} onMouseEnter={() => setChromeVisible(true)} onMouseLeave={() => setChromeVisible(false)}>
        <div className="editor-panel__summary">
          <div className="editor-panel__title-row">
            {showNoteMetadata ? (
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
          <span className="sr-only" data-testid="editor-save-status" aria-live="polite">
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
          {activeAgentMention ? (
            <button
              aria-label={`Run ${activeAgentMention.originalText}`}
              className={`toolbar-button toolbar-button--icon ${compact ? "toolbar-button--compact" : ""}`}
              data-testid="invoke-agent-mention"
              onClick={() => onInvokeAgentMention(activeAgentMention)}
              title={`Run @${activeAgentMention.handle}`}
              type="button"
            >
              <Send size={14} />
            </button>
          ) : null}
        </div>
      </div>

      {invocationReview ? (
        <div className="invocation-review" data-testid="invocation-review-banner">
          <div className="invocation-review__summary">
            <strong>{invocationReview.record.status === "running" ? `Running @${invocationReview.record.command.handle}` : `Changed during @${invocationReview.record.command.handle}`}</strong>
            <span>{formatInvocationReviewDetail(invocationReview.record, invocationReview.hasDirtyConflict)}</span>
          </div>
          <div className="invocation-review__actions">
            {invocationReview.hasDirtyConflict ? (
              <>
                <button className="toolbar-button" data-testid="invocation-keep-dirty-buffer" onClick={invocationReview.onKeepDirtyBuffer} type="button">
                  Keep buffer
                </button>
                <button className="toolbar-button toolbar-button--primary" data-testid="invocation-reload-disk" onClick={invocationReview.onReloadFromDisk} type="button">
                  Reload disk
                </button>
              </>
            ) : null}
            {invocationReview.record.status === "running" ? (
              <button className="toolbar-button" data-testid="invocation-end-observation" onClick={invocationReview.onEndObservation} type="button">
                End
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {showNoteMetadata && !propertiesCollapsed ? (
        <div className="properties-card" data-testid="properties-panel">
          <div className="properties-card__content">
            {graphPropertyEntries.map(([key, value]) => (
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
            <div className="properties-card__row properties-card__row--add">
              <label className="properties-card__key" htmlFor="property-new-key">
                New
              </label>
              <div className="properties-card__add">
                <input
                  id="property-new-key"
                  className="properties-card__input"
                  type="text"
                  value={newPropertyKey}
                  onChange={(event) => setNewPropertyKey(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleAddProperty();
                    }
                  }}
                  placeholder="key"
                />
                <input
                  aria-label="New property value"
                  className="properties-card__input"
                  type="text"
                  value={newPropertyValue}
                  onChange={(event) => setNewPropertyValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleAddProperty();
                    }
                  }}
                  placeholder="value"
                />
                <button
                  aria-label="Add property"
                  className={`toolbar-button toolbar-button--icon ${compact ? "toolbar-button--compact" : ""}`}
                  data-testid="add-frontmatter-property"
                  disabled={!canAddProperty}
                  onClick={handleAddProperty}
                  title={canAddProperty ? "Add property" : "Enter a new property key"}
                  type="button"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            {graphPropertyEntries.length === 0 ? <div className="properties-card__empty">No properties</div> : null}
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
        onMouseLeave={handleEditorSurfaceMouseLeave}
        onMouseMove={handleEditorSurfaceMouseMove}
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
                          graphReferences,
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
        {wikilinkPreview ? (
          <div
            className="wikilink-preview"
            data-testid="wikilink-preview"
            style={{ left: wikilinkPreview.left, top: wikilinkPreview.top }}
          >
            <div className="wikilink-preview__title">{wikilinkPreview.title}</div>
            <div className="wikilink-preview__excerpt">
              {wikilinkPreview.loading ? "Loading..." : wikilinkPreview.excerpt}
            </div>
          </div>
        ) : null}
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

interface NoteInvocationReview {
  record: InvocationRecord;
  hasDirtyConflict: boolean;
  onEndObservation: () => void;
  onKeepDirtyBuffer: () => void;
  onReloadFromDisk: () => void;
}

function formatInvocationReviewDetail(record: InvocationRecord, hasDirtyConflict = false): string {
  if (hasDirtyConflict) {
    return "Disk changed while this editor has unsaved edits.";
  }
  if (record.status === "running") {
    return "Observation is active for this document.";
  }
  if (record.changedFileRefs.length === 0) {
    return "No tagged document changes were observed.";
  }
  const ambiguous = record.changedFileRefs.some((file) => file.attribution === "ambiguous");
  return `${record.changedFileRefs.length} changed file${record.changedFileRefs.length === 1 ? "" : "s"}${ambiguous ? " with ambiguous attribution" : ""}.`;
}

function clampPosition(position: number, docLength: number): number {
  return Math.max(0, Math.min(position, docLength));
}

export function shouldUseMarkdownRenderer(document: Pick<NoteDocument, "kind"> | null): boolean {
  return document?.kind === "markdown";
}

export function normalizeFrontmatterPropertyKey(value: string): string {
  const trimmed = value.trim();
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed) ? trimmed : "";
}

function generatedDailyTitleForPath(filePath: string): string | null {
  const displayTitle = getDocumentDisplayTitle(filePath, "markdown");
  return /^\d{4}-\d{2}-\d{2}$/.test(displayTitle) ? displayTitle : null;
}
