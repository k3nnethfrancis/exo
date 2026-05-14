import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { extractMarkdownLinks, extractTags, extractWikilinks, getNoteKnowledge, readNoteDocument } from "../notes";

const fixtureRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/test-workspace/notes/test-notes");

describe("notes", () => {
  it("parses frontmatter and title", async () => {
    const notePath = path.join(fixtureRoot, "focus-note.md");
    const document = await readNoteDocument(notePath);

    expect(document.title).toBe("Focus Note");
    expect(document.frontmatter.status).toBe("active");
    expect(document.kind).toBe("markdown");
  });

  it("extracts knowledge references", async () => {
    const notePath = path.join(fixtureRoot, "focus-note.md");
    const knowledge = await getNoteKnowledge(notePath, [fixtureRoot]);

    expect(knowledge.wikilinks.map((item) => item.target)).toContain("agent-memory");
    expect(knowledge.markdownLinks.map((item) => item.target)).toContain("related-note.md");
    expect(knowledge.tags.map((item) => item.tag)).toContain("research");
    expect(knowledge.backlinks.map((item) => item.title)).toContain("Related Note");
  });

  it("extracts tags from body and frontmatter", () => {
    const tags = extractTags("Testing #ux and #research", { tags: ["editor", "research"] });
    expect(tags.map((item) => item.tag)).toEqual(["editor", "research", "ux"]);
  });

  it("extracts wikilinks and markdown links", () => {
    expect(extractWikilinks("[[agent-memory]]").map((item) => item.target)).toEqual(["agent-memory"]);
    expect(extractMarkdownLinks("[related](related-note.md)").map((item) => item.target)).toEqual(["related-note.md"]);
  });
});
