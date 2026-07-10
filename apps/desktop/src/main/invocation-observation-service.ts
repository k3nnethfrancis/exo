import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  InvocationStore,
  resolveInvocationStoreLayout,
  safeStoreSegment,
  type InvocationRecord,
  type WorkspaceSettings,
} from "@exo/core";

import type { TerminalManager } from "./terminal-manager";
import type { WorkspaceChangeEvent, WorkspaceWatcherService } from "./workspace-watchers";

interface ActiveObservation {
  record: InvocationRecord;
  before: FileSnapshot;
  observedPaths: Set<string>;
  overlapAtStart: boolean;
  finalizing: boolean;
}

interface FileSnapshot {
  path: string;
  exists: boolean;
  content: string;
  sha256: string | null;
}

const OBSERVATION_EXIT_GRACE_MS = 500;

export class InvocationObservationService extends EventEmitter {
  private readonly activeByInvocationId = new Map<string, ActiveObservation>();
  private readonly activeInvocationIdsByTerminalId = new Map<string, string>();

  constructor(
    private readonly options: {
      workspaceWatcherService: WorkspaceWatcherService;
      terminalManager: TerminalManager;
      getWorkspaceSettings: () => WorkspaceSettings;
    },
  ) {
    super();
    this.options.workspaceWatcherService.subscribe((event) => this.handleWorkspaceChange(event));
    this.options.terminalManager.on("exit", (event: { id: string; exitCode?: number }) => {
      const invocationId = this.activeInvocationIdsByTerminalId.get(event.id);
      if (!invocationId) {
        return;
      }
      windowSettle(() => void this.finalize(invocationId, "process-exited", event.exitCode), OBSERVATION_EXIT_GRACE_MS);
    });
  }

  async snapshotTaggedDocument(filePath: string): Promise<FileSnapshot> {
    return snapshotTextFile(filePath);
  }

  async observe(record: InvocationRecord, before?: FileSnapshot): Promise<void> {
    if (record.context !== "note" || !record.taggedDocumentPath) {
      return;
    }
    const snapshot = before ?? await snapshotTextFile(record.taggedDocumentPath);
    const overlapAtStart = Array.from(this.activeByInvocationId.values()).some(
      (active) => active.record.taggedDocumentPath === record.taggedDocumentPath,
    );
    this.activeByInvocationId.set(record.id, {
      record,
      before: snapshot,
      observedPaths: new Set(),
      overlapAtStart,
      finalizing: false,
    });
    if (record.terminalSessionId) {
      this.activeInvocationIdsByTerminalId.set(record.terminalSessionId, record.id);
    }
  }

  async endObservation(invocationId: string): Promise<InvocationRecord | null> {
    return this.finalize(invocationId, "user-ended");
  }

  async markOrphanedRunningInvocations(): Promise<void> {
    const store = new InvocationStore(this.options.getWorkspaceSettings().workspaceRoot);
    const records = await store.listRecords();
    await Promise.all(
      records
        .filter((record) => record.status === "pending" || record.status === "running")
        .map((record) =>
          store.writeRecord({
            ...record,
            status: "orphaned",
            endedAt: new Date().toISOString(),
            attribution: {
              status: "ambiguous",
              reason: "Attribution incomplete because Exo restarted during this invocation.",
            },
          }),
        ),
    );
  }

  private handleWorkspaceChange(event: WorkspaceChangeEvent): void {
    if (!event.filePath) {
      return;
    }
    for (const active of this.activeByInvocationId.values()) {
      active.observedPaths.add(path.resolve(event.filePath));
    }
  }

  private async finalize(
    invocationId: string,
    status: "process-exited" | "user-ended" | "timeout-ended",
    exitCode?: number,
  ): Promise<InvocationRecord | null> {
    const active = this.activeByInvocationId.get(invocationId);
    if (!active || active.finalizing) {
      return null;
    }
    active.finalizing = true;

    const after = await snapshotTextFile(active.before.path);
    const changed = active.before.sha256 !== after.sha256;
    const invocationStore = new InvocationStore(this.options.getWorkspaceSettings().workspaceRoot);
    const diffRefs = [...active.record.diffRefs];
    const changedFileRefs = [...active.record.changedFileRefs];

    if (changed) {
      const diffId = "diff-1";
      const diffRef = path.join(".exo", "invocations", safeStoreSegment(active.record.id), "diffs", `${diffId}.patch`);
      const diffPath = path.join(resolveInvocationStoreLayout(invocationStore.layout.workspaceRoot).invocationsDir, safeStoreSegment(active.record.id), "diffs", `${diffId}.patch`);
      await mkdir(path.dirname(diffPath), { recursive: true });
      await writeFile(diffPath, unifiedWholeFileDiff(active.before, after), "utf8");
      diffRefs.push({
        id: diffId,
        path: active.before.path,
        format: "unified",
        ref: diffRef,
      });
      const attribution = active.overlapAtStart || !active.observedPaths.has(path.resolve(active.before.path))
        ? "ambiguous"
        : "likely";
      changedFileRefs.push({
        path: active.before.path,
        kind: after.exists ? active.before.exists ? "modified" : "created" : "deleted",
        observedAt: new Date().toISOString(),
        attribution,
        diffRefId: diffId,
      });
    }

    const nextRecord: InvocationRecord = {
      ...active.record,
      status,
      endedAt: new Date().toISOString(),
      ...(exitCode === undefined ? {} : { exitCode }),
      changedFileRefs,
      diffRefs,
      attribution: changed
        ? {
            status: changedFileRefs.some((file) => file.attribution === "ambiguous") ? "ambiguous" : "likely",
            reason: active.overlapAtStart
              ? "Another invocation overlapped this tagged document."
              : changedFileRefs.some((file) => file.attribution === "likely")
                ? "Tagged document changed during this invocation window."
                : "Tagged document changed, but Exo did not observe a matching watcher event.",
          }
        : { status: "unattributed", reason: "No tagged document changes observed." },
    };
    await invocationStore.writeRecord(nextRecord);
    this.emit("updated", nextRecord);
    this.activeByInvocationId.delete(invocationId);
    if (active.record.terminalSessionId) {
      this.activeInvocationIdsByTerminalId.delete(active.record.terminalSessionId);
    }
    return nextRecord;
  }
}

async function snapshotTextFile(filePath: string): Promise<FileSnapshot> {
  try {
    await stat(filePath);
    const content = await readFile(filePath, "utf8");
    return {
      path: filePath,
      exists: true,
      content,
      sha256: sha256(content),
    };
  } catch {
    return {
      path: filePath,
      exists: false,
      content: "",
      sha256: null,
    };
  }
}

function unifiedWholeFileDiff(before: FileSnapshot, after: FileSnapshot): string {
  const beforeLines = before.content.split("\n");
  const afterLines = after.content.split("\n");
  return [
    `--- a/${path.basename(before.path)}`,
    `+++ b/${path.basename(after.path)}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function windowSettle(callback: () => void, ms: number): void {
  setTimeout(callback, ms).unref?.();
}
