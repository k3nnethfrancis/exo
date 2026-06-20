import { useEffect, useRef, useState } from "react";
import type { BranchCreateResult, BranchFamily, NoteDocument, NoteKnowledge, WorkspaceModel } from "@exo/core";

import type { FileStatInfo } from "../../../shared/api";

export interface OpenEditorDocument extends NoteDocument {
  dirty: boolean;
  diskVersion: FileStatInfo | null;
}

export type DocumentSaveStatus = "idle" | "saving" | "saved" | "error";

export interface UseOpenDocumentsOptions {
  workspaceModel: WorkspaceModel | null;
  getOpenEditorPaths: () => Set<string>;
  getEditorScrollTopForPath: (filePath: string) => number | null;
}

export function useOpenDocuments(options: UseOpenDocumentsOptions) {
  const [openDocuments, setOpenDocuments] = useState<Record<string, OpenEditorDocument>>({});
  const [documentSaveStatuses, setDocumentSaveStatuses] = useState<Record<string, DocumentSaveStatus>>({});
  const [knowledgeByPath, setKnowledgeByPath] = useState<Record<string, NoteKnowledge>>({});
  const [branchFamiliesByPath, setBranchFamiliesByPath] = useState<Record<string, BranchFamily>>({});
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(null);
  const [scrollRestoreRequest, setScrollRestoreRequest] = useState<{ filePath: string; scrollTop: number; nonce: number } | null>(null);
  const openDocumentsRef = useRef(openDocuments);
  const activeDocumentPathRef = useRef(activeDocumentPath);
  const optionsRef = useRef(options);
  const pendingRefreshesRef = useRef<Map<string, { timeoutId: number; diskVersion: FileStatInfo | null }>>(new Map());
  const scrollRestoreNonceRef = useRef(0);

  const activeDocument = activeDocumentPath ? openDocuments[activeDocumentPath] ?? null : null;
  const activeKnowledge = activeDocumentPath ? knowledgeByPath[activeDocumentPath] ?? null : null;

  useEffect(() => {
    openDocumentsRef.current = openDocuments;
  }, [openDocuments]);

  useEffect(() => {
    activeDocumentPathRef.current = activeDocumentPath;
  }, [activeDocumentPath]);

  useEffect(() => {
    optionsRef.current = options;
  }, [options]);

  useEffect(() => {
    const timer = setInterval(() => {
      const dirtyPaths = Object.entries(openDocumentsRef.current)
        .filter(([, doc]) => doc.dirty)
        .map(([path]) => path);
      for (const filePath of dirtyPaths) {
        void saveDocument(filePath);
      }
    }, 5000);
    return () => clearInterval(timer);
  }, []);

  function pruneToOpenPaths(openPaths: Set<string>) {
    setOpenDocuments((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([filePath, document]) => openPaths.has(filePath) || document.dirty),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
    setKnowledgeByPath((current) => pruneRecordToKeys(current, openPaths));
    setBranchFamiliesByPath((current) => pruneRecordToKeys(current, openPaths));
  }

  async function ensureDocumentLoaded(filePath: string) {
    const [document, diskVersion] = await Promise.all([window.exo.notes.read(filePath), window.exo.notes.stat(filePath)]);
    const [knowledge, branchFamily] = await loadMarkdownContext(document, filePath, optionsRef.current.workspaceModel);

    setOpenDocuments((current) => ({
      ...current,
      [filePath]: {
        ...document,
        dirty: current[filePath]?.dirty ?? false,
        diskVersion: current[filePath]?.dirty ? current[filePath].diskVersion : diskVersion,
        frontmatter: current[filePath]?.dirty ? current[filePath].frontmatter : document.frontmatter,
        body: current[filePath]?.dirty ? current[filePath].body : document.body,
      },
    }));
    updateMarkdownContext(filePath, knowledge, branchFamily);
  }

  function scheduleRefresh(filePath: string, diskVersion?: FileStatInfo | null) {
    const currentDocument = openDocumentsRef.current[filePath];
    if (!currentDocument || currentDocument.dirty) {
      return;
    }

    const pending = pendingRefreshesRef.current.get(filePath);
    if (pending) {
      window.clearTimeout(pending.timeoutId);
    }

    const timeoutId = window.setTimeout(() => {
      pendingRefreshesRef.current.delete(filePath);
      void refreshFromDisk(filePath, diskVersion);
    }, 250);
    pendingRefreshesRef.current.set(filePath, { timeoutId, diskVersion: diskVersion ?? null });
  }

  async function refreshFromDisk(filePath: string, knownVersion?: FileStatInfo | null) {
    const currentDocument = openDocumentsRef.current[filePath];
    if (!currentDocument || currentDocument.dirty) {
      return;
    }

    const scrollTop = filePath === activeDocumentPathRef.current ? optionsRef.current.getEditorScrollTopForPath(filePath) : null;
    const [document, diskVersion] = await Promise.all([
      window.exo.notes.read(filePath),
      knownVersion === undefined ? window.exo.notes.stat(filePath) : Promise.resolve(knownVersion),
    ]);
    const [knowledge, branchFamily] = await loadMarkdownContext(document, filePath, optionsRef.current.workspaceModel);

    setOpenDocuments((current) => {
      const currentDocument = current[filePath];
      if (!currentDocument || currentDocument.dirty) {
        return current;
      }

      if (
        currentDocument.body === document.body &&
        JSON.stringify(currentDocument.frontmatter) === JSON.stringify(document.frontmatter)
      ) {
        return {
          ...current,
          [filePath]: {
            ...currentDocument,
            diskVersion,
          },
        };
      }

      return {
        ...current,
        [filePath]: {
          ...document,
          dirty: false,
          diskVersion,
        },
      };
    });
    updateMarkdownContext(filePath, knowledge, branchFamily);

    if (scrollTop !== null) {
      scrollRestoreNonceRef.current += 1;
      setScrollRestoreRequest({ filePath, scrollTop, nonce: scrollRestoreNonceRef.current });
    }
  }

  function updateBody(body: string) {
    const filePath = activeDocumentPathRef.current;
    if (!filePath || !openDocumentsRef.current[filePath]) {
      return;
    }

    const nextDocuments = {
      ...openDocumentsRef.current,
      [filePath]: {
        ...openDocumentsRef.current[filePath],
        body,
        dirty: true,
      },
    };
    openDocumentsRef.current = nextDocuments;
    setOpenDocuments(nextDocuments);
    setDocumentSaveStatuses((current) => ({ ...current, [filePath]: "idle" }));
  }

  function updateFrontmatter(key: string, value: unknown) {
    const filePath = activeDocumentPathRef.current;
    if (!filePath || !openDocumentsRef.current[filePath]) {
      return;
    }

    const nextDocuments = {
      ...openDocumentsRef.current,
      [filePath]: {
        ...openDocumentsRef.current[filePath],
        frontmatter: {
          ...openDocumentsRef.current[filePath].frontmatter,
          [key]: value,
        },
        dirty: true,
      },
    };
    openDocumentsRef.current = nextDocuments;
    setOpenDocuments(nextDocuments);
    setDocumentSaveStatuses((current) => ({ ...current, [filePath]: "idle" }));
  }

  async function saveDocument(filePath: string) {
    const document = openDocumentsRef.current[filePath];
    if (!document) {
      return;
    }

    setDocumentSaveStatuses((current) => ({ ...current, [filePath]: "saving" }));
    try {
      await window.exo.notes.save(filePath, document.frontmatter, document.body);
      const diskVersion = await window.exo.notes.stat(filePath);
      const remainsOpen = optionsRef.current.getOpenEditorPaths().has(filePath);
      if (document.kind === "markdown" && remainsOpen && isAttachedNote(filePath, optionsRef.current.workspaceModel)) {
        const [knowledge, branchFamily] = await Promise.all([
          window.exo.notes.getKnowledge(filePath),
          window.exo.notes.getBranchFamily(filePath),
        ]);
        updateMarkdownContext(filePath, knowledge, branchFamily);
      }
      setOpenDocuments((current) => {
        if (!current[filePath]) {
          return current;
        }
        if (!remainsOpen) {
          const next = { ...current };
          delete next[filePath];
          return next;
        }
        return {
          ...current,
          [filePath]: {
            ...current[filePath],
            dirty:
              current[filePath].body !== document.body ||
              JSON.stringify(current[filePath].frontmatter) !== JSON.stringify(document.frontmatter),
            diskVersion,
          },
        };
      });
      setDocumentSaveStatuses((current) => ({ ...current, [filePath]: "saved" }));
      window.setTimeout(() => {
        setDocumentSaveStatuses((current) => current[filePath] === "saved" ? { ...current, [filePath]: "idle" } : current);
      }, 1600);
    } catch (error) {
      console.error("[exo] failed to save document", { filePath, error });
      setDocumentSaveStatuses((current) => ({ ...current, [filePath]: "error" }));
      throw error;
    }
  }

  async function createBranchFromActiveDocument(): Promise<BranchCreateResult | null> {
    if (!activeDocumentPath) {
      return null;
    }

    const document = openDocumentsRef.current[activeDocumentPath];
    if (!document || document.kind !== "markdown") {
      return null;
    }

    const result = await window.exo.notes.createBranch(activeDocumentPath, document.frontmatter, document.body);
    setBranchFamiliesByPath((current) => ({
      ...current,
      [activeDocumentPath]: result.family,
      [result.branchFilePath]: result.family,
    }));
    return result;
  }

  function deletePathsWithin(targetPath: string) {
    setOpenDocuments((current) =>
      Object.fromEntries(Object.entries(current).filter(([filePath]) => !isPathWithin(targetPath, filePath))),
    );
    setKnowledgeByPath((current) =>
      Object.fromEntries(Object.entries(current).filter(([filePath]) => !isPathWithin(targetPath, filePath))),
    );
    setBranchFamiliesByPath((current) =>
      Object.fromEntries(Object.entries(current).filter(([filePath]) => !isPathWithin(targetPath, filePath))),
    );
  }

  function remapOpenPaths(sourcePath: string, nextPath: string) {
    const remapRecord = <T,>(record: Record<string, T>): Record<string, T> =>
      Object.fromEntries(
        Object.entries(record).map(([filePath, value]) => [
          isPathWithin(sourcePath, filePath) ? filePath.replace(sourcePath, nextPath) : filePath,
          value,
        ]),
      );

    setOpenDocuments((current) =>
      Object.fromEntries(
        Object.entries(current).map(([filePath, value]) => {
          const remappedPath = isPathWithin(sourcePath, filePath) ? filePath.replace(sourcePath, nextPath) : filePath;
          return [
            remappedPath,
            {
              ...value,
              filePath: remappedPath,
            },
          ];
        }),
      ),
    );
    setKnowledgeByPath((current) => remapRecord(current));
    setBranchFamiliesByPath((current) => remapRecord(current));
    if (activeDocumentPath && isPathWithin(sourcePath, activeDocumentPath)) {
      setActiveDocumentPath(activeDocumentPath.replace(sourcePath, nextPath));
    }
  }

  function updateMarkdownContext(filePath: string, knowledge: NoteKnowledge | null, branchFamily: BranchFamily | null) {
    setKnowledgeByPath((current) => ({
      ...current,
      ...(knowledge ? { [filePath]: knowledge } : {}),
    }));
    setBranchFamiliesByPath((current) => ({
      ...current,
      ...(branchFamily ? { [filePath]: branchFamily } : {}),
    }));
  }

  return {
    openDocuments,
    knowledgeByPath,
    documentSaveStatuses,
    branchFamiliesByPath,
    activeDocumentPath,
    activeDocument,
    activeKnowledge,
    scrollRestoreRequest,
    setActiveDocumentPath,
    pruneToOpenPaths,
    ensureDocumentLoaded,
    scheduleRefresh,
    updateBody,
    updateFrontmatter,
    saveDocument,
    createBranchFromActiveDocument,
    deletePathsWithin,
    remapOpenPaths,
  };
}

async function loadMarkdownContext(
  document: NoteDocument,
  filePath: string,
  model: WorkspaceModel | null,
): Promise<[NoteKnowledge | null, BranchFamily | null]> {
  if (document.kind !== "markdown" || !isAttachedNote(filePath, model)) {
    return [null, null];
  }
  return Promise.all([window.exo.notes.getKnowledge(filePath), window.exo.notes.getBranchFamily(filePath)]);
}

function isAttachedNote(filePath: string, model: WorkspaceModel | null): boolean {
  return model ? model.noteRoots.some((root) => isPathWithin(root.path, filePath)) : true;
}

function isPathWithin(parentPath: string, targetPath: string): boolean {
  return targetPath === parentPath || targetPath.startsWith(`${parentPath}/`);
}

function pruneRecordToKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => keys.has(key)));
}
