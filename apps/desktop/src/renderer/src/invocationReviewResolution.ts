import type { InvocationFileReviewPayload } from "../../shared/api";
import { invocationReviewVirtualPath } from "./invocationReviewQueue";

export async function refreshInvocationReviewAfterResolution(
  payload: InvocationFileReviewPayload,
  action: "keep" | "reject",
  documents: {
    isDocumentOpen: (filePath: string) => boolean;
    removeOpenPath: (filePath: string) => void;
    reloadDocument: (filePath: string) => Promise<void>;
    openDocument: (filePath: string) => Promise<unknown>;
  },
): Promise<void> {
  const virtualPath = invocationReviewVirtualPath(payload);
  if (virtualPath && documents.isDocumentOpen(virtualPath)) {
    documents.removeOpenPath(virtualPath);
  }
  if (action === "keep") return;

  const beforePath = payload.change.before?.path;
  const afterPath = payload.change.after?.path;
  if (payload.change.operation === "created" && afterPath) {
    documents.removeOpenPath(afterPath);
    return;
  }
  if (payload.change.operation === "renamed" && afterPath) {
    documents.removeOpenPath(afterPath);
  }

  const restoredPath = beforePath ?? afterPath;
  if (!restoredPath) return;
  if (documents.isDocumentOpen(restoredPath)) {
    await documents.reloadDocument(restoredPath);
    return;
  }
  await documents.openDocument(restoredPath);
}
