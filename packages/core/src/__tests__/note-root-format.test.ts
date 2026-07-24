import { describe, expect, it } from "vitest";

import { NOTE_ROOT_FORMAT_ID, noteRootFormat } from "../note-root-format";

describe("Note Root Format selection", () => {
  it("rejects an unknown Format before it can select Generic Markdown", () => {
    expect(() => noteRootFormat("unknown-format")).toThrow("Unknown Note Root Format: unknown-format");
    expect(() => noteRootFormat("okf-0.1")).toThrow("Unknown Note Root Format: okf-0.1");
    expect(() => noteRootFormat({ id: "okf" })).toThrow("Unknown Note Root Format: [object Object]");
  });

  it("keeps built-in Format identity and behavior immutable at runtime", () => {
    const format = noteRootFormat(NOTE_ROOT_FORMAT_ID.genericMarkdown);

    expect(Object.isFrozen(NOTE_ROOT_FORMAT_ID)).toBe(true);
    expect(Object.isFrozen(format)).toBe(true);
    expect(Object.isFrozen(format.status)).toBe(true);
    expect(() => {
      (format as unknown as { status: { id: string } }).status.id = "mutated";
    }).toThrow();
    expect(() => {
      (format as unknown as { includesConcept: () => boolean }).includesConcept = () => false;
    }).toThrow();
    expect(noteRootFormat(NOTE_ROOT_FORMAT_ID.genericMarkdown).status.id).toBe("generic-markdown");
    expect(noteRootFormat(NOTE_ROOT_FORMAT_ID.genericMarkdown).includesConcept("note.md")).toBe(true);
  });
});
