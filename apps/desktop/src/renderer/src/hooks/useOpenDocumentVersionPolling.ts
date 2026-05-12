import { useEffect, type MutableRefObject } from "react";

import type { FileStatInfo } from "../../../shared/api";

export interface PollableOpenDocument {
  dirty: boolean;
  diskVersion: FileStatInfo | null;
}

export function useOpenDocumentVersionPolling<TDocument extends PollableOpenDocument>(
  documentsRef: MutableRefObject<Record<string, TDocument>>,
  pendingRefreshesRef: MutableRefObject<Map<string, { timeoutId: number; diskVersion: FileStatInfo | null }>>,
  onVersionChange: (filePath: string, diskVersion: FileStatInfo) => void,
) {
  useEffect(() => {
    let disposed = false;
    let polling = false;

    const interval = window.setInterval(() => {
      if (polling) {
        return;
      }
      polling = true;
      void pollOpenDocumentVersions().catch((error) => {
        console.warn("[exo] open document version poll failed", error);
      }).finally(() => {
        polling = false;
      });
    }, 1000);

    async function pollOpenDocumentVersions() {
      const entries = Object.entries(documentsRef.current).filter(([, document]) => !document.dirty);
      await Promise.all(
        entries.map(async ([filePath, document]) => {
          const nextVersion = await window.exo.notes.stat(filePath).catch((error) => {
            console.warn("[exo] failed to stat open document", { filePath, error });
            return null;
          });
          if (disposed || !nextVersion || fileVersionsEqual(document.diskVersion, nextVersion)) {
            return;
          }

          onVersionChange(filePath, nextVersion);
        }),
      );
    }

    return () => {
      disposed = true;
      window.clearInterval(interval);
      for (const pending of pendingRefreshesRef.current.values()) {
        window.clearTimeout(pending.timeoutId);
      }
      pendingRefreshesRef.current.clear();
    };
  }, [documentsRef, onVersionChange, pendingRefreshesRef]);
}

function fileVersionsEqual(left: FileStatInfo | null, right: FileStatInfo | null): boolean {
  return Boolean(left && right && left.size === right.size && left.mtimeMs === right.mtimeMs);
}
