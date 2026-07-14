import { startTransition, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";

import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { EditorSelection } from "@codemirror/state";
import { keymap, lineNumbers, EditorView, type ViewUpdate } from "@codemirror/view";
import { ArrowUpRight, Check, CircleAlert, Code2, LoaderCircle, Plus, Save, SlidersHorizontal, X } from "lucide-react";
import type { AgentCommand, InvocationRecord, NoteDocument, WorkspaceGraphContext } from "@exo/core";
import { createDefaultClaudeAgentCommand } from "@exo/core/default-agent-command";
import type { InvocationReviewPayload } from "../../../shared/api";
import { exoEditorTheme, exoSyntaxHighlighting } from "../theme/codemirror";
import type { ExoThemeVariant } from "../theme/types";
import { codeLanguageForPath } from "./codeLanguages";
import { AgentIcon } from "./AgentIcon";
import { coerceFrontmatterValue, getDocumentDisplayTitle, stringifyFrontmatterValue } from "./documentDisplay";
import { markdownLivePreview, type MarkdownGraphReferences } from "./markdownLivePreview";
import { inlineAgentComposerExtension, isPersistedInvocationPosition, openInlineAgentComposer, type InlineAgentDraft } from "./inlineAgentComposer";
import { presentInvocation } from "../invocationPresentation";
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
  selectedIndex: number;
}

interface WikilinkPreviewState {
  target: string;
  left: number;
  top: number;
  title: string;
  excerpt: string;
  loading: boolean;
}

interface AgentSuggestionState {
  from: number;
  to: number;
  left: number;
  top: number;
  items: AgentCommand[];
  selectedIndex: number;
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
  onInvokeAgent: (draft: InlineAgentDraft) => void;
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

const STANDARD_NOTE_PROPERTY_KEYS = ["title", "date", "tags"] as const;

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
    onInvokeAgent,
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
  const seededAuthoringPathsRef = useRef<Set<string>>(new Set());
  const restoringScrollRef = useRef(false);
  const processedRevealLineNonceRef = useRef<number | null>(null);
  const processedScrollRestoreNonceRef = useRef<number | null>(null);
  const wikilinkSuggestionRequestRef = useRef(0);
  const wikilinkPreviewRequestRef = useRef(0);
  const suppressedWikilinkCompletionRef = useRef<{ pos: number; text: string } | null>(null);
  const [wikilinkSuggestions, setWikilinkSuggestions] = useState<WikilinkSuggestionState | null>(null);
  const [agentSuggestions, setAgentSuggestions] = useState<AgentSuggestionState | null>(null);
  const [wikilinkPreview, setWikilinkPreview] = useState<WikilinkPreviewState | null>(null);
  const [newPropertyKey, setNewPropertyKey] = useState("");
  const [newPropertyValue, setNewPropertyValue] = useState("");

  useEffect(() => {
    setRawMarkdownMode(false);
    setChromeVisible(false);
    setWikilinkSuggestions(null);
    setAgentSuggestions(null);
    setWikilinkPreview(null);
    suppressedWikilinkCompletionRef.current = null;
  }, [document?.filePath]);

  const documentPath = document?.filePath ?? "";
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
  const graphPropertyEntries = notePropertyEntries(document);
  const cmTheme = useMemo(() => exoEditorTheme(theme, fontSize), [fontSize, theme]);
  const syntaxTheme = useMemo(() => exoSyntaxHighlighting(theme), [theme]);
  const graphReferences = useMemo((): MarkdownGraphReferences | null => {
    return graphReferencesForMarkdownMode(showNoteMetadata, rawMarkdownMode, graphContext);
  }, [graphContext, rawMarkdownMode, showNoteMetadata]);
  const invocationCommands = useMemo(() => {
    const enabled = agentCommands.filter((command) => command.enabled);
    return enabled.some((command) => command.handle === "claude") ? enabled : [createDefaultClaudeAgentCommand(), ...enabled];
  }, [agentCommands]);
  const invokeAgentRef = useRef(onInvokeAgent);
  const openTargetRef = useRef(onOpenTarget);
  const openTagRef = useRef(onOpenTag);
  const resolveMarkdownImageRef = useRef(window.exo.notes.resolveMarkdownImage);
  const saveRef = useRef(onSave);
  const zoomEditorRef = useRef(onZoomEditor);
  useEffect(() => {
    invokeAgentRef.current = onInvokeAgent;
  }, [onInvokeAgent]);
  useEffect(() => { openTargetRef.current = onOpenTarget; }, [onOpenTarget]);
  useEffect(() => { openTagRef.current = onOpenTag; }, [onOpenTag]);
  useEffect(() => { saveRef.current = onSave; }, [onSave]);
  useEffect(() => { zoomEditorRef.current = onZoomEditor; }, [onZoomEditor]);
  const agentComposer = useMemo(
    () => inlineAgentComposerExtension({
      onSend: (draft) => invokeAgentRef.current(draft),
      renderPersistedInvocations: !rawMarkdownMode,
    }),
    [rawMarkdownMode],
  );
  const normalizedNewPropertyKey = normalizeFrontmatterPropertyKey(newPropertyKey);
  const newPropertyKeyFeedback = frontmatterPropertyKeyFeedback(newPropertyKey, document?.frontmatter ?? {});
  const canAddProperty =
    Boolean(normalizedNewPropertyKey) &&
    !newPropertyKeyFeedback;
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
          setWikilinkSuggestions(items.length > 0 ? { ...currentContext, left, top, items, selectedIndex: 0 } : null);
        }).catch(() => {
          if (requestId === wikilinkSuggestionRequestRef.current) {
            setWikilinkSuggestions(null);
          }
        });
      },
    [onSuggestTargets, rawMarkdownMode, useMarkdownEditing],
  );
  const maybeUpdateAgentSuggestions = useMemo(
    () =>
      (update: ViewUpdate) => {
        if (!useMarkdownEditing || rawMarkdownMode || (!update.selectionSet && !update.docChanged)) {
          setAgentSuggestions(null);
          return;
        }
        const range = update.state.selection.main;
        if (!range.empty) {
          setAgentSuggestions(null);
          return;
        }
        const context = getAgentCompletionContext(update.state.doc, range.head);
        if (!context) {
          setAgentSuggestions(null);
          return;
        }
        // Parsing durable invocation envelopes requires inspecting the full
        // document. Ordinary typing cannot open agent completion, so keep that
        // work out of the keystroke path until an @ query actually exists.
        if (isPersistedInvocationPosition(update.state, range.head)) {
          setAgentSuggestions(null);
          return;
        }
        const items = invocationCommands.filter((command) => command.handle.startsWith(context.query));
        if (items.length === 0) {
          setAgentSuggestions(null);
          return;
        }
        const coords = update.view.coordsAtPos(range.head);
        const surfaceRect = update.view.dom.closest<HTMLElement>(".editor-surface")?.getBoundingClientRect();
        setAgentSuggestions({
          ...context,
          left: coords && surfaceRect ? coords.left - surfaceRect.left : 24,
          top: coords && surfaceRect ? coords.bottom - surfaceRect.top + 4 : 48,
          items,
          selectedIndex: 0,
        });
      },
    [invocationCommands, rawMarkdownMode, useMarkdownEditing],
  );
  const handleEditorChange = useMemo(
    () =>
      (value: string, update: ViewUpdate) => {
        // CodeMirror has already applied this edit. Deprioritise the
        // workspace-model update so long inline requests stay responsive.
        startTransition(() => onBodyChange(value));
        maybeUpdateWikilinkSuggestions(update);
        maybeUpdateAgentSuggestions(update);
      },
    [maybeUpdateAgentSuggestions, maybeUpdateWikilinkSuggestions, onBodyChange],
  );
  const acceptAgentSuggestion = useMemo(
    () =>
      (command: AgentCommand) => {
        const view = codeMirrorRef.current?.view;
        const active = agentSuggestions;
        if (!view || !active) return;
        openInlineAgentComposer(view, { from: active.from, to: active.to, handle: command.handle });
        setAgentSuggestions(null);
      },
    [agentSuggestions],
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
        if (event.key === "Escape" && agentSuggestions) {
          event.preventDefault();
          event.stopPropagation();
          setAgentSuggestions(null);
          return;
        }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && agentSuggestions?.items.length) {
          event.preventDefault();
          event.stopPropagation();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setAgentSuggestions((current) => current
            ? { ...current, selectedIndex: nextSuggestionIndex(current.selectedIndex, current.items.length, delta) }
            : current);
          return;
        }
        if ((event.key === "ArrowDown" || event.key === "ArrowUp") && wikilinkSuggestions?.items.length) {
          event.preventDefault();
          event.stopPropagation();
          const delta = event.key === "ArrowDown" ? 1 : -1;
          setWikilinkSuggestions((current) => current
            ? { ...current, selectedIndex: nextSuggestionIndex(current.selectedIndex, current.items.length, delta) }
            : current);
          return;
        }
        if (event.key === "Enter" && agentSuggestions?.items.length) {
          event.preventDefault();
          event.stopPropagation();
          acceptAgentSuggestion(agentSuggestions.items[agentSuggestions.selectedIndex]);
          return;
        }
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
        acceptWikilinkSuggestion(wikilinkSuggestions.items[wikilinkSuggestions.selectedIndex]);
      },
    [acceptAgentSuggestion, acceptWikilinkSuggestion, agentSuggestions, wikilinkSuggestions],
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
            saveRef.current();
            return true;
          },
        },
        {
          key: "Mod-=",
          run: () => {
            zoomEditorRef.current(1);
            return true;
          },
        },
        {
          key: "Mod-Shift-=",
          run: () => {
            zoomEditorRef.current(1);
            return true;
          },
        },
        {
          key: "Mod--",
          run: () => {
            zoomEditorRef.current(-1);
            return true;
          },
        },
        {
          key: "Mod-0",
          run: () => {
            zoomEditorRef.current(0);
            return true;
          },
        },
        indentWithTab,
        ...lintKeymap,
      ]),
    [],
  );

  const markdownPreviewExtensions = useMemo(
    () => markdownLivePreview({
      onOpenTarget: (target) => openTargetRef.current(target),
      onOpenTag: (tag) => openTagRef.current(tag),
      onResolveImage: (target) => resolveMarkdownImageRef.current(documentPath, target),
      suppressedGeneratedTitle,
      graphReferences,
    }),
    [documentPath, graphReferences, suppressedGeneratedTitle],
  );
  const editorExtensions = useMemo(
    () => useMarkdownEditing
      ? [
          markdown(),
          EditorView.lineWrapping,
          saveKeymap,
          selectionTracker,
          agentComposer,
          ...(!rawMarkdownMode ? markdownPreviewExtensions : []),
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
          agentComposer,
          ...(codeLanguage?.extensions ?? []),
          cmTheme,
          syntaxTheme,
        ],
    [agentComposer, cmTheme, codeLanguage?.extensions, markdownPreviewExtensions, rawMarkdownMode, saveKeymap, selectionTracker, syntaxTheme, useMarkdownEditing],
  );

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
  }, [documentPath, rawMarkdownMode, theme.id, fontSize]);

  useLayoutEffect(() => {
    if (!document) {
      return;
    }

    const scroller = codeMirrorRef.current?.view?.scrollDOM;
    const scrollTop = scrollTopByPathRef.current.get(document.filePath);
    if (!scroller || scrollTop === undefined) {
      restoringScrollRef.current = false;
      return;
    }

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
  }, [documentPath, rawMarkdownMode, theme.id, fontSize]);

  const handleEditorCreated = useMemo(
    () =>
      (view: EditorView) => {
        if (!document || !useMarkdownEditing || rawMarkdownMode || seededAuthoringPathsRef.current.has(document.filePath)) {
          return;
        }
        const initialPosition = initialMarkdownAuthoringPosition(document.body);
        if (initialPosition === null || view.state.doc.toString() !== document.body) {
          return;
        }
        seededAuthoringPathsRef.current.add(document.filePath);
        const position = clampPosition(initialPosition, view.state.doc.length);
        view.dispatch({ selection: EditorSelection.cursor(position) });
        selectionByPathRef.current.set(document.filePath, { anchor: position, head: position });
        view.focus();
      },
    [document, rawMarkdownMode, useMarkdownEditing],
  );

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

  const invocationPresentation = invocationReview
    ? presentInvocation(invocationReview.record, invocationReview.hasDirtyConflict)
    : null;
  const InvocationStatusIcon = invocationPresentation?.tone === "active"
    ? LoaderCircle
    : invocationPresentation?.tone === "danger" ? CircleAlert : Check;

  return (
    <section
      className={`editor-panel ${compact ? "editor-panel--compact" : ""}`}
      data-testid="editor-panel"
      onMouseDown={onFocus}
      onMouseEnter={() => setChromeVisible(true)}
      onMouseLeave={() => setChromeVisible(false)}
    >
      <div
        className={`editor-panel__header ${chromeVisible || !propertiesCollapsed ? "editor-panel__header--visible" : ""}`}
      >
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
        </div>
      </div>

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
                  aria-describedby={newPropertyKeyFeedback ? "property-key-feedback" : undefined}
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
                  title={canAddProperty ? "Add property" : newPropertyKeyFeedback || "Enter a new property key"}
                  type="button"
                >
                  <Plus size={14} />
                </button>
                {newPropertyKeyFeedback ? (
                  <span
                    aria-live="polite"
                    className="properties-card__feedback"
                    data-testid="property-key-feedback"
                    id="property-key-feedback"
                  >
                    {newPropertyKeyFeedback}
                  </span>
                ) : null}
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
          extensions={editorExtensions}
          basicSetup={{
            autocompletion: false,
            lineNumbers: false,
            foldGutter: false,
            highlightSelectionMatches: false,
          }}
          onChange={handleEditorChange}
          onCreateEditor={handleEditorCreated}
          height="100%"
        />
        {agentSuggestions ? (
          <div
            className="agent-suggestions"
            data-testid="agent-suggestions"
            style={{ left: agentSuggestions.left, top: agentSuggestions.top }}
          >
            <div className="agent-suggestions__title">Agents</div>
            {agentSuggestions.items.map((command, index) => (
              <button
                key={command.id}
                aria-selected={index === agentSuggestions.selectedIndex}
                className={`agent-suggestions__item ${index === agentSuggestions.selectedIndex ? "agent-suggestions__item--active" : ""}`}
                data-testid={`agent-suggestion-${command.handle}`}
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  acceptAgentSuggestion(command);
                }}
              >
                {command.handle === "claude" || command.handle === "codex" ? <AgentIcon kind={command.handle} size={16} /> : null}
                <span className="agent-suggestions__copy">
                  <span className="agent-suggestions__label">{command.label}</span>
                  <span className="agent-suggestions__command">{command.command}</span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
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
            <div className="wikilink-suggestions__title">Links</div>
            {wikilinkSuggestions.items.map((suggestion, index) => (
              <button
                key={suggestion.target}
                aria-selected={index === wikilinkSuggestions.selectedIndex}
                className={`wikilink-suggestions__item ${index === wikilinkSuggestions.selectedIndex ? "wikilink-suggestions__item--active" : ""}`}
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
        {invocationReview && invocationPresentation ? (
          <div className={`invocation-review invocation-review--${invocationPresentation.tone}`} data-testid="invocation-review-banner" role="status">
            <InvocationStatusIcon aria-hidden="true" className={`invocation-review__status-icon ${invocationPresentation.tone === "active" ? "invocation-review__status-icon--spinning" : ""}`} size={15} strokeWidth={1.8} />
            <div className="invocation-review__summary">
              <strong>{invocationPresentation.title}</strong>
              <span>{invocationPresentation.detail}</span>
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
              {invocationReview.onResumeInTerminal ? (
                <button className="invocation-review__resume" data-testid="invocation-resume-terminal" onClick={invocationReview.onResumeInTerminal} title="Open this session in Terminal" type="button">
                  <span><strong>Resume</strong><code>{invocationPresentation.resumeCommand}</code></span>
                  <ArrowUpRight aria-hidden="true" size={14} strokeWidth={1.8} />
                </button>
              ) : null}
              {invocationPresentation.dismissible ? (
                <button aria-label="Dismiss invocation status" className="icon-button invocation-review__dismiss" data-testid="invocation-dismiss" onClick={invocationReview.onDismiss} title="Dismiss" type="button">
                  <X aria-hidden="true" size={14} />
                </button>
              ) : null}
            </div>
            {invocationReview.reviewPayload?.patch ? (
              <div className="invocation-review__proposal" data-testid="invocation-review-proposal">
                <div className="invocation-review__proposal-header">
                  <strong>Proposed document change</strong>
                  {invocationReview.reviewPayload.invocation.review?.status === "pending" ? (
                    <span>
                      <button className="toolbar-button" data-testid="invocation-keep-review" onClick={invocationReview.onKeepReview} type="button">Keep</button>
                      {invocationReview.reviewPayload.canReject && !invocationReview.hasDirtyConflict ? <button className="toolbar-button" data-testid="invocation-reject-review" onClick={invocationReview.onRejectReview} type="button">Reject</button> : null}
                    </span>
                  ) : <span>{invocationReview.reviewPayload.invocation.review?.status === "kept" ? "Kept" : "Rejected"}</span>}
                </div>
                <pre>{invocationReview.reviewPayload.patch}</pre>
              </div>
            ) : null}
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
  reviewPayload: InvocationReviewPayload | null;
  onKeepReview: () => void;
  onRejectReview: () => void;
  onResumeInTerminal?: () => void;
  onDismiss: () => void;
}

function clampPosition(position: number, docLength: number): number {
  return Math.max(0, Math.min(position, docLength));
}

function initialMarkdownAuthoringPosition(body: string): number | null {
  // NoteDocument.body deliberately excludes frontmatter. A body containing only
  // the generated H1 is the untouched authoring state for a new Markdown note.
  if (!/^\n?# [^\n]+\n$/.test(body)) {
    return null;
  }
  return body.indexOf("# ") + 2;
}

function getAgentCompletionContext(doc: { lineAt: (position: number) => { from: number; text: string }; sliceString: (from: number, to: number) => string }, position: number): {
  from: number;
  to: number;
  query: string;
} | null {
  const line = doc.lineAt(position);
  const beforeCursor = doc.sliceString(line.from, position);
  const match = beforeCursor.match(/(?:^|\s)@([a-z0-9_-]*)$/i);
  if (!match) return null;
  return {
    from: position - match[0].length + (match[0].startsWith(" ") ? 1 : 0),
    to: position,
    query: match[1].toLowerCase(),
  };
}

export function nextSuggestionIndex(current: number, count: number, delta: -1 | 1): number {
  if (count <= 0) {
    return 0;
  }
  return (current + delta + count) % count;
}

export function shouldUseMarkdownRenderer(document: Pick<NoteDocument, "kind"> | null): boolean {
  return document?.kind === "markdown";
}

export function normalizeFrontmatterPropertyKey(value: string): string {
  const trimmed = value.trim();
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(trimmed) ? trimmed : "";
}

export function frontmatterPropertyKeyFeedback(value: string, frontmatter: Record<string, unknown>): string {
  if (!value.trim()) {
    return "";
  }
  const normalized = normalizeFrontmatterPropertyKey(value);
  if (!normalized) {
    return "Use letters, numbers, _ or -; begin with a letter or _.";
  }
  if (
    STANDARD_NOTE_PROPERTY_KEYS.includes(normalized as (typeof STANDARD_NOTE_PROPERTY_KEYS)[number]) ||
    Object.prototype.hasOwnProperty.call(frontmatter, normalized)
  ) {
    return `${normalized} already exists.`;
  }
  return "";
}

function notePropertyEntries(document: EditorDocument | null): Array<[string, unknown]> {
  if (!document) {
    return [];
  }

  const frontmatter = document.frontmatter;
  return [
    ["title", frontmatter.title ?? document.title],
    ["date", frontmatter.date ?? ""],
    ["tags", frontmatter.tags ?? []],
    ...Object.entries(frontmatter).filter(([key]) => !STANDARD_NOTE_PROPERTY_KEYS.includes(key as (typeof STANDARD_NOTE_PROPERTY_KEYS)[number]) && !key.startsWith("branch_")),
  ];
}

function generatedDailyTitleForPath(filePath: string): string | null {
  const displayTitle = getDocumentDisplayTitle(filePath, "markdown");
  return /^\d{4}-\d{2}-\d{2}$/.test(displayTitle) ? displayTitle : null;
}
