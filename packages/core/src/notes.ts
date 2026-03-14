import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import matter from "gray-matter";

import type {
  BacklinkReference,
  MarkdownLinkReference,
  NoteDocument,
  NoteKnowledge,
  TagReference,
  WikilinkReference,
} from "./types";
import { listMarkdownFiles } from "./workspace";

const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;
const MARKDOWN_LINK_PATTERN = /\[([^\]]+)\]\(([^)]+)\)/g;
const TAG_PATTERN = /(^|\s)#([a-zA-Z0-9/_-]+)/g;

export async function readNoteDocument(filePath: string): Promise<NoteDocument> {
  const raw = await readFile(filePath, "utf8");
  const parsed = matter(raw);
  const title = typeof parsed.data.title === "string" ? parsed.data.title : path.basename(filePath, ".md");

  return {
    filePath,
    title,
    frontmatter: parsed.data,
    body: parsed.content,
  };
}

export async function saveNoteDocument(filePath: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
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

export async function getNoteKnowledge(filePath: string, noteRootPaths: string[]): Promise<NoteKnowledge> {
  const document = await readNoteDocument(filePath);
  const wikilinks = extractWikilinks(document.body);
  const markdownLinks = extractMarkdownLinks(document.body);
  const tags = extractTags(document.body, document.frontmatter);
  const backlinks = await findBacklinks(filePath, noteRootPaths);

  return {
    wikilinks,
    markdownLinks,
    tags,
    backlinks,
  };
}

async function findBacklinks(filePath: string, noteRootPaths: string[]): Promise<BacklinkReference[]> {
  const noteFiles = await listMarkdownFiles(noteRootPaths);
  const targetBasename = path.basename(filePath, ".md").toLowerCase();
  const results = await Promise.all(
    noteFiles
      .filter((candidate) => candidate !== filePath)
      .map(async (candidate) => {
        const document = await readNoteDocument(candidate);
        const wikilinks = extractWikilinks(document.body);
        const markdownLinks = extractMarkdownLinks(document.body);
        const hasWikilink = wikilinks.some((link) => normalizeNoteTarget(link.target) === targetBasename);
        const hasMarkdownLink = markdownLinks.some((link) => normalizeMarkdownTarget(link.target) === targetBasename);

        if (!hasWikilink && !hasMarkdownLink) {
          return null;
        }

        return {
          filePath: candidate,
          title: document.title,
        } satisfies BacklinkReference;
      }),
  );

  return results.filter((result): result is BacklinkReference => result !== null);
}

function normalizeNoteTarget(target: string): string {
  return target.replace(/\.md$/i, "").trim().toLowerCase();
}

function normalizeMarkdownTarget(target: string): string {
  if (!target.endsWith(".md")) {
    return "";
  }

  return path.basename(target, ".md").trim().toLowerCase();
}

