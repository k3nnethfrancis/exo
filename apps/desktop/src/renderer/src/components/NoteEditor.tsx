import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import CodeMirror, { type ReactCodeMirrorRef } from "@uiw/react-codemirror";
import { autocompletion, type CompletionContext } from "@codemirror/autocomplete";
import { indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, foldGutter } from "@codemirror/language";
import { lintGutter, lintKeymap } from "@codemirror/lint";
import { keymap, lineNumbers, EditorView } from "@codemirror/view";
import { Code2, GitBranch, SlidersHorizontal } from "lucide-react";
import type { BranchFamily, NoteDocument } from "@exo/core";
import type { ResolvedAppearance } from "../App";
import { codeLanguageForPath } from "./codeLanguages";
import { coerceFrontmatterValue, getDocumentDisplayTitle, stringifyFrontmatterValue } from "./documentDisplay";
import { markdownLivePreview } from "./markdownLivePreview";

interface EditorDocument extends NoteDocument {
  dirty: boolean;
}

interface NoteEditorProps {
  document: EditorDocument | null;
  branchFamily: BranchFamily | null;
  propertiesCollapsed: boolean;
  onToggleProperties: () => void;
  onUpdateFrontmatter: (key: string, value: unknown) => void;
  onBodyChange: (body: string) => void;
  onSave: () => void;
  onOpenTag: (tag: string) => void;
  onOpenTarget: (target: string) => void;
  onOpenBranch: (filePath: string) => void;
  onSuggestTargets: (query: string) => Promise<Array<{ label: string; target: string; detail?: string }>>;
  onCreateBranch: () => void;
  onFocus: () => void;
  appearance: ResolvedAppearance;
  fontSize: number;
  onZoomEditor: (direction: -1 | 0 | 1) => void;
  compact: boolean;
}

export function NoteEditor(props: NoteEditorProps) {
  const {
    document,
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
    appearance,
    fontSize,
    onZoomEditor,
    compact,
  } = props;
  const [rawMarkdownMode, setRawMarkdownMode] = useState(false);
  const codeMirrorRef = useRef<ReactCodeMirrorRef>(null);
  const scrollTopByPathRef = useRef<Map<string, number>>(new Map());
  const previousBodyRef = useRef(document?.body ?? "");
  const previousPathRef = useRef(document?.filePath ?? "");
  const restoringScrollRef = useRef(false);

  useEffect(() => {
    setRawMarkdownMode(false);
  }, [document?.filePath]);

  if (!document) {
    return (
      <section className="editor-panel editor-panel--empty" data-testid="editor-empty">
        <h1>Exo</h1>
        <p>Open a note from the left sidebar to begin.</p>
      </section>
    );
  }

  const isMarkdown = document.kind === "markdown";
  const displayTitle = getDocumentDisplayTitle(document.filePath, document.kind);
  const codeLanguage = useMemo(() => (isMarkdown ? null : codeLanguageForPath(document.filePath)), [document.filePath, isMarkdown]);
  const frontmatterEntries = Object.entries(document.frontmatter).filter(([key]) => !key.startsWith("branch_"));
  const cmTheme = useMemo(() => editorTheme(appearance, fontSize), [appearance, fontSize]);
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
  const bodyChanged = previousPathRef.current === document.filePath && previousBodyRef.current !== document.body;
  if (bodyChanged) {
    restoringScrollRef.current = true;
  }

  useEffect(() => {
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
  }, [document.filePath, rawMarkdownMode, appearance, fontSize]);

  useLayoutEffect(() => {
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
  }, [document.filePath, document.body, rawMarkdownMode, appearance, fontSize]);

  return (
    <section className={`editor-panel ${compact ? "editor-panel--compact" : ""}`} data-testid="editor-panel" onMouseDown={onFocus}>
      <div className="editor-panel__header">
        <div className="editor-panel__summary">
          <div className="editor-panel__title-row">
            {isMarkdown ? (
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
          {isMarkdown && branchFamily ? (
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
          {isMarkdown ? (
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

      {isMarkdown && !propertiesCollapsed ? (
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
      ) : !isMarkdown ? (
        <div className="properties-card properties-card--file" data-testid="properties-panel">
          <div className="properties-card__file-label">Project file</div>
          <div className="properties-card__file-meta">
            <span>{codeLanguage?.label ?? "Plain text"}</span>
            <span>{document.filePath}</span>
          </div>
        </div>
      ) : null}

      <div className={`editor-surface ${isMarkdown && !rawMarkdownMode ? "editor-surface--live-preview" : ""} ${!isMarkdown ? "editor-surface--code" : ""}`}>
        <CodeMirror
          ref={codeMirrorRef}
          key={`${document.filePath}:${isMarkdown && !rawMarkdownMode ? "live" : "code"}:${appearance}:${fontSize}`}
          value={document.body}
          extensions={
            document.kind === "markdown"
              ? [
                  markdown(),
                  EditorView.lineWrapping,
                  saveKeymap,
                  ...(!rawMarkdownMode
                    ? [
                        markdownLivePreview({
                          onOpenTarget,
                          onOpenTag,
                        }),
                        autocompletion({
                          override: [
                            async (context: CompletionContext) => {
                              const before = context.matchBefore(/\[\[[^\]]*/);
                              if (!before) {
                                return null;
                              }

                              if (!context.explicit && before.from === before.to) {
                                return null;
                              }

                              const query = before.text.replace(/^\[\[/, "");
                              const suggestions = await onSuggestTargets(query);
                              return {
                                from: before.from,
                                options: suggestions.map((suggestion) => ({
                                  label: suggestion.label,
                                  detail: suggestion.detail,
                                  type: "text",
                                  apply: `[[${suggestion.target}]]`,
                                })),
                              };
                            },
                          ],
                        }),
                      ]
                    : []),
                  cmTheme,
                ]
              : [
                  lineNumbers(),
                  foldGutter(),
                  bracketMatching(),
                  lintGutter(),
                  saveKeymap,
                  ...(codeLanguage?.extensions ?? []),
                  cmTheme,
                ]
          }
          basicSetup={{
            lineNumbers: false,
            foldGutter: false,
          }}
          onChange={onBodyChange}
          height="100%"
        />
      </div>

    </section>
  );
}

function editorTheme(appearance: ResolvedAppearance, fontSize: number) {
  return EditorView.theme(
    {
      "&": {
        color: "var(--text)",
        backgroundColor: "transparent",
        fontSize: `${fontSize}px`,
      },
      ".cm-content": {
        caretColor: "var(--accent)",
      },
      "&.cm-focused .cm-cursor": {
        borderLeftColor: "var(--accent)",
      },
      "&.cm-focused .cm-selectionBackground, ::selection": {
        backgroundColor: "var(--accent-soft)",
      },
      ".cm-selectionBackground": {
        backgroundColor: "var(--accent-soft)",
      },
      ".cm-gutters": {
        backgroundColor: "transparent",
        color: "var(--muted)",
        border: "none",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--surface-2)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "transparent",
      },
    },
    { dark: appearance === "dark" },
  );
}
