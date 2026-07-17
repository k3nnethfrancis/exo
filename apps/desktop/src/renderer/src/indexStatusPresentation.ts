import type { IndexStatus } from "@exo/core";

import type { IndexBusyState } from "./workspaceSettingsDialogTypes";

function formatIndexStatus(status: IndexStatus): string {
  const pieces = [
    `Mode: ${status.mode}`,
    `${status.indexedRoots.length} root${status.indexedRoots.length === 1 ? "" : "s"}`,
    `${status.documentCount} document${status.documentCount === 1 ? "" : "s"}`,
  ];
  if (status.pendingEmbeddings > 0) {
    pieces.push(`${status.pendingEmbeddings} note${status.pendingEmbeddings === 1 ? "" : "s"} waiting`);
  }
  return pieces.join(" | ");
}

export function summarizeIndexStatus(status: IndexStatus | null, busy: IndexBusyState): {
  label: string;
  tone: "muted" | "ok" | "warn" | "info" | "error";
  title: string;
  busy: boolean;
} {
  if (busy === "updating") {
    return { label: "Updating search", tone: "info", title: "Updating QMD search.", busy: true };
  }
  if (busy === "syncing") {
    return { label: "Syncing search", tone: "info", title: "Refreshing QMD documents and embeddings.", busy: true };
  }
  if (busy === "embedding") {
    return { label: "Embedding", tone: "info", title: "Building QMD semantic embeddings.", busy: true };
  }
  if (!status) {
    return { label: "Search unknown", tone: "muted", title: "Search status has not loaded yet.", busy: false };
  }
  if (status.backend === "filesystem") {
    return { label: "Simple search", tone: "muted", title: "Immediate filename and path search is active.", busy: false };
  }
  if (status.errors.length > 0) {
    return { label: "QMD needs attention", tone: "error", title: "Simple search remains available. Open Search settings to sync QMD or choose Simple search.", busy: false };
  }
  if (!status.enabled || status.mode === "off" || status.indexedRoots.length === 0) {
    return { label: "QMD unavailable", tone: "muted", title: "Simple search remains available. Choose QMD in Search settings to set it up.", busy: false };
  }
  if (status.documentCount === 0) {
    return { label: "QMD empty", tone: "warn", title: "QMD is configured but has no documents yet. Sync now to build it.", busy: false };
  }
  if ((status.mode === "semantic" || status.mode === "hybrid") && (!status.hasVectorIndex || status.pendingEmbeddings > 0)) {
    return {
      label: status.pendingEmbeddings > 0
        ? `${status.pendingEmbeddings} note${status.pendingEmbeddings === 1 ? "" : "s"} waiting`
        : "Embeddings needed",
      tone: "warn",
      title: formatIndexStatus(status),
      busy: false,
    };
  }
  return { label: "QMD ready", tone: "ok", title: formatIndexStatus(status), busy: false };
}
