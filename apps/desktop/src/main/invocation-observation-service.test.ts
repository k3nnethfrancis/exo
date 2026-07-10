import { EventEmitter } from "node:events";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";
import {
  agentCommandSnapshot,
  createDefaultClaudeAgentCommand,
  InvocationStore,
  type InvocationRecord,
  type WorkspaceSettings,
} from "@exo/core";

import { InvocationObservationService } from "./invocation-observation-service";
import type { TerminalManager } from "./terminal-manager";
import type { WorkspaceChangeEvent, WorkspaceWatcherService } from "./workspace-watchers";

describe("InvocationObservationService", () => {
  it("finalizes never-exiting invocations through explicit user-ended observation", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-observer-"));
    const notePath = path.join(workspaceRoot, "note.md");
    await writeFile(notePath, "@claude append a summary\n", "utf8");
    const watcher = fakeWatcher();
    const terminalManager = new EventEmitter() as TerminalManager;
    const service = new InvocationObservationService({
      workspaceWatcherService: watcher.service,
      terminalManager,
      getWorkspaceSettings: () => workspaceSettings(workspaceRoot),
    });
    const command = createDefaultClaudeAgentCommand();
    const before = await service.snapshotTaggedDocument(notePath);
    const record: InvocationRecord = {
      id: "invocation-1",
      status: "running",
      context: "note",
      taggedDocumentPath: notePath,
      originalMentionText: "@claude append a summary",
      mentionProvenance: "human-authored",
      message: "append a summary",
      promptDelivery: command.promptDelivery,
      command: agentCommandSnapshot(command),
      cwd: workspaceRoot,
      createdAt: "2026-07-08T00:00:00.000Z",
      startedAt: "2026-07-08T00:00:00.000Z",
      terminalSessionId: "terminal-1",
      changedFileRefs: [],
      diffRefs: [],
      attribution: { status: "pending" },
    };

    await new InvocationStore(workspaceRoot).writeRecord(record);
    await service.observe(record, before);
    await writeFile(notePath, "@claude append a summary\n\nSummary appended.\n", "utf8");
    watcher.emit({ rootPath: workspaceRoot, eventType: "change", filePath: notePath });

    const finalized = await service.endObservation("invocation-1");

    expect(finalized).toMatchObject({
      id: "invocation-1",
      status: "user-ended",
      changedFileRefs: [{ path: notePath, kind: "modified", attribution: "likely", diffRefId: "diff-1" }],
      diffRefs: [{ id: "diff-1", format: "unified" }],
      attribution: { status: "likely" },
    });
    const stored = await new InvocationStore(workspaceRoot).readRecord("invocation-1");
    expect(stored?.status).toBe("user-ended");
    const diffRef = stored?.diffRefs[0]?.ref;
    expect(diffRef).toBe(".exo/invocations/invocation-1/diffs/diff-1.patch");
    await expect(readFile(path.join(workspaceRoot, diffRef!), "utf8")).resolves.toContain("+Summary appended.");
  });

  it("marks persisted running records orphaned on startup recovery", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "exo-invocation-observer-"));
    const notePath = path.join(workspaceRoot, "note.md");
    await writeFile(notePath, "@claude continue\n", "utf8");
    const watcher = fakeWatcher();
    const terminalManager = new EventEmitter() as TerminalManager;
    const service = new InvocationObservationService({
      workspaceWatcherService: watcher.service,
      terminalManager,
      getWorkspaceSettings: () => workspaceSettings(workspaceRoot),
    });
    const command = createDefaultClaudeAgentCommand();
    await new InvocationStore(workspaceRoot).writeRecord({
      id: "running-1",
      status: "running",
      context: "note",
      taggedDocumentPath: notePath,
      originalMentionText: "@claude continue",
      mentionProvenance: "human-authored",
      message: "continue",
      promptDelivery: command.promptDelivery,
      command: agentCommandSnapshot(command),
      cwd: workspaceRoot,
      createdAt: "2026-07-08T00:00:00.000Z",
      terminalSessionId: "terminal-1",
      changedFileRefs: [],
      diffRefs: [],
      attribution: { status: "pending" },
    });

    await service.markOrphanedRunningInvocations();

    await expect(new InvocationStore(workspaceRoot).readRecord("running-1")).resolves.toMatchObject({
      status: "orphaned",
      attribution: {
        status: "ambiguous",
        reason: "Attribution incomplete because Exo restarted during this invocation.",
      },
    });
  });
});

function fakeWatcher(): {
  service: WorkspaceWatcherService;
  emit: (event: WorkspaceChangeEvent) => void;
} {
  const listeners = new Set<(event: WorkspaceChangeEvent) => void>();
  return {
    service: {
      subscribe(listener: (event: WorkspaceChangeEvent) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    } as unknown as WorkspaceWatcherService,
    emit(event) {
      for (const listener of listeners) {
        listener(event);
      }
    },
  };
}

function workspaceSettings(workspaceRoot: string): WorkspaceSettings {
  return {
    workspaceRoot,
    defaultTerminalCwd: workspaceRoot,
    noteRoots: [workspaceRoot],
    projectRoots: [],
    agentCommands: [createDefaultClaudeAgentCommand()],
    indexedRoots: [],
    indexing: { enabled: false, mode: "off", backend: "qmd" },
    appearanceMode: "system",
    colorThemeId: "exo-neutral",
    editorFontSize: 15,
    terminalFontSize: 13,
    terminalHistoryLines: 100_000,
    terminalTranscriptRetention: "forever",
    terminalTranscriptRetentionDays: 14,
    explorerScale: 1,
    exploreIndexSearchOnEnter: false,
    indexUpdateStrategy: "on-save",
  };
}
