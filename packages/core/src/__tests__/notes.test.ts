import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractMarkdownLinks, extractTags, extractWikilinks, noteTitle, readNoteDocument, saveWorkspaceDocument } from "../notes";

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/test-workspace/notes/test-notes");

describe("notes", () => {
  it("parses frontmatter and title", async () => {
    const notePath = path.join(fixtureRoot, "focus-note.md");
    const document = await readNoteDocument(notePath);

    expect(document.title).toBe("Focus Note");
    expect(document.frontmatter.status).toBe("active");
    expect(document.kind).toBe("markdown");
  });

  it("uses an opening heading before the filename when no explicit title exists", () => {
    expect(noteTitle("/notes/weekly-plan.md", {}, "# Weekly Plan\n\nBody")).toBe("Weekly Plan");
    expect(noteTitle("/notes/weekly-plan.md", {}, "Body")).toBe("weekly-plan");
    expect(noteTitle("/notes/weekly-plan.md", {}, "Body\n# Weekly Plan")).toBe("weekly-plan");
    expect(noteTitle("/notes/weekly-plan.md", { title: "Plan" }, "# Weekly Plan")).toBe("Plan");
  });

  it("preserves a date-only property when saving parsed YAML", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "exo-note-date-"));
    const notePath = path.join(root, "dated.md");
    try {
      await writeFile(notePath, "---\ndate: 2026-07-11\n---\n# Dated\n", "utf8");
      const document = await readNoteDocument(notePath);
      await saveWorkspaceDocument(notePath, { ...document.frontmatter, status: "draft" }, document.body);

      await expect(readFile(notePath, "utf8")).resolves.toMatch(
        /date: ['"]?2026-07-11['"]?\nstatus: draft/,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("extracts tags from body and frontmatter", () => {
    const tags = extractTags("Testing #ux and #research", { tags: ["editor", "research"] });
    expect(tags.map((item) => item.tag)).toEqual(["editor", "research", "ux"]);
    expect(tags.find((item) => item.tag === "research")?.occurrences.map((item) => item.source)).toEqual(["frontmatter", "body"]);
  });

  it("extracts wikilinks and markdown links", () => {
    expect(extractWikilinks("[[agent-memory]]").map((item) => item.target)).toEqual(["agent-memory"]);
    expect(extractMarkdownLinks("[related](related-note.md)").map((item) => item.target)).toEqual(["related-note.md"]);
  });

  it("reports body-relative UTF-16 end-exclusive source ranges", () => {
    const body = "🧠 before [[agent-memory]] and [related](related-note.md)";
    const wiki = extractWikilinks(body)[0];
    const markdown = extractMarkdownLinks(body)[0];
    expect(body.slice(wiki.sourceRange.from, wiki.sourceRange.to)).toBe("[[agent-memory]]");
    expect(body.slice(markdown.sourceRange.from, markdown.sourceRange.to)).toBe("[related](related-note.md)");
  });
});
