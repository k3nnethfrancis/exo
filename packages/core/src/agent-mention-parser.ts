export interface ParsedAgentMention {
  handle: string;
  message: string;
  originalText: string;
  line: number;
  column: number;
  offset: number;
}

const AGENT_HANDLE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

export function normalizeMentionAgentHandle(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().replace(/^@/, "").toLowerCase();
  return AGENT_HANDLE_PATTERN.test(trimmed) ? trimmed : null;
}

export function parseAgentMentions(markdown: string, configuredHandles?: Iterable<string>): ParsedAgentMention[] {
  const allowedHandles = configuredHandles ? new Set(Array.from(configuredHandles, (handle) => normalizeMentionAgentHandle(handle)).filter((handle): handle is string => Boolean(handle))) : null;
  const mentions: ParsedAgentMention[] = [];
  const lines = markdown.split(/\r?\n/);
  const lineBreakMatches = markdown.match(/\r?\n/g) ?? [];
  let offset = 0;
  let inFrontmatter = lines[0]?.trim() === "---";
  let inFence: string | null = null;
  let htmlBlock: "script" | "style" | "pre" | "comment" | null = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const lineNumber = index + 1;
    const lineBreakLength = lineBreakMatches[index]?.length ?? 0;

    if (index > 0 && inFrontmatter && trimmed === "---") {
      inFrontmatter = false;
      offset += line.length + lineBreakLength;
      continue;
    }
    if (inFrontmatter) {
      offset += line.length + lineBreakLength;
      continue;
    }

    if (htmlBlock) {
      if (
        (htmlBlock === "comment" && trimmed.includes("-->")) ||
        (htmlBlock !== "comment" && new RegExp(`</${htmlBlock}>`, "i").test(trimmed))
      ) {
        htmlBlock = null;
      }
      offset += line.length + lineBreakLength;
      continue;
    }

    const htmlBlockStart = trimmed.match(/^<!--|^<(script|style|pre)(?:\s|>|$)/i);
    if (htmlBlockStart) {
      htmlBlock = htmlBlockStart[0].startsWith("<!--") ? "comment" : (htmlBlockStart[1]?.toLowerCase() as "script" | "style" | "pre");
      if (
        htmlBlock === "comment" ? trimmed.includes("-->") : new RegExp(`</${htmlBlock}>`, "i").test(trimmed)
      ) {
        htmlBlock = null;
      }
      offset += line.length + lineBreakLength;
      continue;
    }

    const fence = trimmed.match(/^(```+|~~~+)/);
    if (fence) {
      const marker = fence[1]?.[0] ?? "`";
      inFence = inFence === marker ? null : marker;
      offset += line.length + lineBreakLength;
      continue;
    }
    if (inFence || /^ {0,3}>/.test(line) || /^ {0,3}(?:[-*+]|\d+[.)])\s+/.test(line)) {
      offset += line.length + lineBreakLength;
      continue;
    }

    const match = line.match(/^( {0,3})@([a-z][a-z0-9_-]{1,31})\s+(.+\S)\s*$/i);
    const handle = match ? normalizeMentionAgentHandle(match[2]) : null;
    if (match && handle && (!allowedHandles || allowedHandles.has(handle))) {
      mentions.push({
        handle,
        message: match[3]?.trim() ?? "",
        originalText: line.trim(),
        line: lineNumber,
        column: (match[1]?.length ?? 0) + 1,
        offset: offset + (match[1]?.length ?? 0),
      });
    }

    offset += line.length + lineBreakLength;
  }

  return mentions;
}
