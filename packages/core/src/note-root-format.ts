import type { ConceptNode, GraphFinding } from "./knowledge-graph";

export const NOTE_ROOT_FORMAT_ID = Object.freeze({
  genericMarkdown: "generic-markdown",
  okf: "okf",
} as const);

export type NoteRootFormatId = typeof NOTE_ROOT_FORMAT_ID[keyof typeof NOTE_ROOT_FORMAT_ID];

export interface NoteRootFormatStatus {
  readonly id: NoteRootFormatId;
  readonly version: string;
  readonly label: string;
  readonly source: "built-in";
  readonly state: "active";
}

interface NoteRootFormat {
  readonly status: NoteRootFormatStatus;
  readonly absoluteMarkdownLinkBase: "source-document" | "note-root";
  includesConcept(pathOrTarget: string): boolean;
  conceptTypes(properties: Readonly<Record<string, unknown>>): readonly string[];
  validate(concepts: readonly ConceptNode[]): readonly GraphFinding[];
}

const genericMarkdownFormat = Object.freeze<NoteRootFormat>({
  status: Object.freeze({
    id: "generic-markdown",
    version: "1",
    label: "Generic Markdown",
    source: "built-in",
    state: "active",
  }),
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
});

const okf01Format = Object.freeze<NoteRootFormat>({
  status: Object.freeze({
    id: "okf",
    version: "0.1",
    label: "Open Knowledge Format 0.1",
    source: "built-in",
    state: "active",
  }),
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
});

export function noteRootFormat(id: unknown): NoteRootFormat {
  if (id === NOTE_ROOT_FORMAT_ID.genericMarkdown) return genericMarkdownFormat;
  if (id === NOTE_ROOT_FORMAT_ID.okf) return okf01Format;
  throw new Error(`Unknown Note Root Format: ${String(id)}`);
}

function openTypes(value: unknown): string[] {
  const candidates = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return [...new Set(candidates.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort();
}
