import { Children, cloneElement, isValidElement, useMemo, type ReactElement, type ReactNode } from "react";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownPreviewProps {
  body: string;
  onOpenTag: (tag: string) => void;
  onOpenTarget: (target: string) => void;
  onOpenExternal: (target: string) => void;
}

const WIKILINK_PATTERN = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

export function MarkdownPreview(props: MarkdownPreviewProps) {
  const { body, onOpenTag, onOpenTarget, onOpenExternal } = props;
  const preparedBody = useMemo(() => rewriteWikilinks(body), [body]);

  return (
    <div className="markdown-preview" data-testid="markdown-preview">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => {
            const target = href ?? "";
            const isWikilink = target.startsWith("exo-note://");
            const resolvedTarget = isWikilink ? decodeURIComponent(target.replace("exo-note://", "")) : target;
            const isExternal = /^https?:\/\//.test(resolvedTarget);

            return (
              <button
                className="markdown-preview__link"
                onClick={(event) => {
                  event.preventDefault();
                  if (isExternal) {
                    onOpenExternal(resolvedTarget);
                    return;
                  }

                  onOpenTarget(resolvedTarget);
                }}
                title={resolvedTarget}
                type="button"
              >
                {children}
              </button>
            );
          },
          p: ({ children }) => <p>{renderInlineTags(children, onOpenTag)}</p>,
          li: ({ children, ...rest }) => <li {...rest}>{renderInlineTags(children, onOpenTag)}</li>,
          blockquote: ({ children }) => <blockquote>{renderInlineTags(children, onOpenTag)}</blockquote>,
        }}
      >
        {preparedBody}
      </ReactMarkdown>
    </div>
  );
}

function rewriteWikilinks(source: string): string {
  return source.replace(WIKILINK_PATTERN, (_match, target: string, label?: string) => {
    const nextLabel = (label ?? target).trim();
    const nextTarget = target.trim();
    return `[${nextLabel}](exo-note://${encodeURIComponent(nextTarget)})`;
  });
}

function renderInlineTags(
  children: ReactNode,
  onOpenTag: (tag: string) => void,
): ReactNode {
  return mapNode(children, onOpenTag);
}

function mapNode(node: ReactNode, onOpenTag: (tag: string) => void): ReactNode {
  if (typeof node === "string") {
    return splitTags(node, onOpenTag);
  }

  if (Array.isArray(node)) {
    return node.map((child, index) => <span key={index}>{mapNode(child, onOpenTag)}</span>);
  }

  if (isValidElement(node)) {
    const element = node as ReactElement<{ children?: ReactNode }>;
    return cloneElement(element, undefined, Children.map(element.props.children, (child) => mapNode(child, onOpenTag)));
  }

  return node;
}

function splitTags(text: string, onOpenTag: (tag: string) => void): ReactNode {
  const parts = text.split(/(#[A-Za-z0-9/_-]+)/g);
  if (parts.length === 1) {
    return text;
  }

  return parts.map((part, index) => {
    if (!part.startsWith("#") || part.length <= 1) {
      return <span key={index}>{part}</span>;
    }

    const tag = part.replace(/^#/, "");
    return (
      <button
        key={index}
        className="markdown-preview__tag"
        onClick={() => onOpenTag(tag)}
        type="button"
      >
        #{tag}
      </button>
    );
  });
}
