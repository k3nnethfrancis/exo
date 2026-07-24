import type { ConceptNode, GraphFinding, NoteRootFormatStatus } from "./knowledge-graph";

export interface NoteRootFormat {
  readonly status: NoteRootFormatStatus;
  readonly absoluteMarkdownLinkBase: "source-document" | "note-root";
  includesConcept(pathOrTarget: string): boolean;
  conceptTypes(properties: Readonly<Record<string, unknown>>): readonly string[];
  validate(concepts: readonly ConceptNode[]): readonly GraphFinding[];
}

export const genericMarkdownFormat: NoteRootFormat = {
  status: {
    id: "generic-markdown",
    version: "1",
    label: "Generic Markdown",
    source: "built-in",
    state: "active",
  },
  absoluteMarkdownLinkBase: "source-document",
  includesConcept() {
    return true;
  },
  conceptTypes(properties) {
    return openTypes(properties.type);
  },
  validate() {
    return [];
  },
};

export const okf01Format: NoteRootFormat = {
  status: {
    id: "okf",
    version: "0.1",
    label: "Open Knowledge Format 0.1",
    source: "built-in",
    state: "active",
  },
  absoluteMarkdownLinkBase: "note-root",
  includesConcept(pathOrTarget) {
    const basename = pathOrTarget
      .split(/[?#]/u, 1)[0]
      ?.replaceAll("\\", "/")
      .split("/")
      .at(-1)
      ?.replace(/\.md(?:own)?$/iu, "")
      .toLowerCase();
    return basename !== "index" && basename !== "log";
  },
  conceptTypes(properties) {
    return openTypes(properties.type);
  },
  validate(concepts) {
    return concepts
      .filter((concept) => concept.resolution === "resolved" && concept.conceptTypes.length === 0)
      .map((concept) => ({
        id: `okf:missing-type:${concept.id}`,
        severity: "warning" as const,
        code: "okf.missing-type",
        message: `${concept.label} has no type property.`,
        conceptIds: [concept.id],
        relationIds: [],
        evidence: concept.noteId ? [{ kind: "property" as const, noteId: concept.noteId, property: "type" }] : [],
      }));
  },
};

export function noteRootFormat(id: string): NoteRootFormat {
  if (id === "generic-markdown") return genericMarkdownFormat;
  if (id === "okf" || id === "okf-0.1") return okf01Format;
  throw new Error(`Unknown Note Root Format: ${id}`);
}

function openTypes(value: unknown): string[] {
  const candidates = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(candidates.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort();
}
