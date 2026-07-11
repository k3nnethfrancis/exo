import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import type {
  MarkdownLinkReference,
  NoteDocument,
  TagReference,
  WikilinkReference,
} from "./types";

const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const TAG_PATTERN = /(^|\s)#([a-zA-Z0-9/_-]+)/g;

export async function readNoteDocument(filePath: string): Promise<NoteDocument> {
  return readWorkspaceDocument(filePath);
}

export async function readWorkspaceDocument(filePath: string): Promise<NoteDocument> {
  const raw = await readFile(filePath, "utf8");
  if (!isMarkdownPath(filePath)) {
    return {
      filePath,
      title: path.basename(filePath),
      frontmatter: {},
      body: raw,
      kind: "text",
    };
  }

  const parsed = matter(raw);
  const title = typeof parsed.data.title === "string" ? parsed.data.title : path.basename(filePath, path.extname(filePath));

  return {
    filePath,
    title,
    frontmatter: parsed.data,
    body: parsed.content,
    kind: "markdown",
  };
}

export async function saveNoteDocument(filePath: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
  return saveWorkspaceDocument(filePath, frontmatter, body);
}

export async function saveWorkspaceDocument(
  filePath: string,
  frontmatter: Record<string, unknown>,
  body: string,
): Promise<void> {
  if (!isMarkdownPath(filePath)) {
    await writeFile(filePath, body, "utf8");
    return;
  }

  const serialized = matter.stringify(body, frontmatter);
  await writeFile(filePath, serialized, "utf8");
}

export function extractWikilinks(body: string): WikilinkReference[] {
  return Array.from(body.matchAll(WIKILINK_PATTERN)).map((match) => {
    const target = match[1].trim();
    return { label: target, target };
  });
}

export function extractMarkdownLinks(body: string): MarkdownLinkReference[] {
  return Array.from(body.matchAll(MARKDOWN_LINK_PATTERN)).map((match) => ({
    label: match[1].trim(),
    target: match[2].trim(),
  }));
}

export function extractTags(body: string, frontmatter: Record<string, unknown>): TagReference[] {
  const bodyTags = Array.from(body.matchAll(TAG_PATTERN)).map((match) => match[2]);
  const frontmatterTags = Array.isArray(frontmatter.tags)
    ? frontmatter.tags.filter((tag): tag is string => typeof tag === "string")
    : typeof frontmatter.tags === "string"
      ? frontmatter.tags
          .split(/[,\s]+/)
          .map((tag) => tag.replace(/^#/, ""))
          .filter(Boolean)
      : [];

  const tags = Array.from(new Set([...frontmatterTags, ...bodyTags])).sort();
  return tags.map((tag) => ({ tag }));
}

function isMarkdownPath(filePath: string): boolean {
  return /\.md(?:own)?$/i.test(filePath);
}
